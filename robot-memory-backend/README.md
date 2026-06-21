# Robot LED Face · Mem0 长期记忆后端

这是给前面的 **豆包端到端实时语音前端** 配套的本地后端服务。

它做了 6 件事：

1. 在本地启动一个 `FastAPI` 服务，默认监听 `https://127.0.0.1:8766`
2. 用 `Mem0` 管理长期记忆
3. 用本地 `Qdrant` 磁盘模式保存向量数据
4. 给前端提供记忆检索 / 落库 API，并把检索结果注入到豆包会话的 `system_role`
5. 为浏览器返回 `CORS` 头，允许内网 HTTPS 前端页面访问本地服务
6. 支持 `OPTIONS` 预检请求

---

## 当前实现特点

### 默认模式：纯本地存储 + 本地 embedding

默认配置如下：

- **后端框架**：FastAPI
- **记忆框架**：Mem0
- **向量库**：Qdrant 本地磁盘模式
- **Embedding**：`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`
- **记忆写入策略**：`infer=false`

这意味着：

- 记忆**保存在本机**，不会依赖外部向量数据库
- 语义检索用的是**本地 embedding 模型**
- 默认不会调用 LLM 去做“事实提炼”，而是把每轮用户 / 助手对话直接写入 Mem0
- 这种方式更稳，适合你当前这个本地语音前端先跑通长期记忆闭环

### 可选模式：启用 Mem0 事实抽取

如果你后面想把“原始对话存储”升级成“事实级记忆抽取”，可以把：

```env
MEM0_INFER=true
```

然后再配置：

- 本地 `Ollama`
- 或 OpenAI 兼容 LLM 接口

README 里已经给了对应环境变量入口。

---

## 目录结构

```text
robot-memory-backend/
├── main.py
├── requirements.txt
├── .env.example
├── .env
└── data/
    ├── qdrant/
    └── history.db
```

说明：

- `data/qdrant/`：Qdrant 本地向量数据
- `data/history.db`：Mem0 的历史数据库

---

## API 列表

### 1) 健康检查

```http
GET /health
```

### 2) 写入一轮对话

```http
POST /memory/add
Content-Type: application/json

{
  "user_id": "yangyifan.today",
  "user_text": "我最近在做机器人LED点阵表情屏。",
  "bot_text": "好的，我会记住你正在做机器人LED点阵表情屏项目。"
}
```

### 3) 检索相关长期记忆

```http
POST /memory/search
Content-Type: application/json

{
  "user_id": "yangyifan.today",
  "query": "你记得我最近在做什么项目吗？",
  "top_k": 5
}
```

返回里会带：

- `summary_text`：给前端直接展示 / 注入模型提示词的摘要文本
- `results`：原始命中记忆列表

### 4) 获取全部记忆

```http
GET /memory/all?user_id=yangyifan.today&top_k=50
```

---

## 启动步骤

### 1. 安装依赖

```bash
cd robot-memory-backend
pip install -r requirements.txt
```

### 2. 检查环境变量

项目里已经放了 `.env.example` 和一份默认可运行的 `.env`。

如需重置，可执行：

```bash
cp .env.example .env
```

默认关键配置：

```env
HOST=127.0.0.1
PORT=8766
SSL_CERTFILE=./certs/127.0.0.1.pem
SSL_KEYFILE=./certs/127.0.0.1-key.pem
ALLOW_ORIGINS=https://your-internal-frontend.bytedance.net
ALLOW_METHODS=GET,POST,OPTIONS
ALLOW_HEADERS=Content-Type,Authorization
MEM0_VECTOR_PROVIDER=qdrant
MEM0_EMBEDDER_PROVIDER=huggingface
MEM0_EMBEDDER_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
MEM0_INFER=false
```

### 3. 生成本地 HTTPS 证书

```bash
cd robot-memory-backend
bash scripts/generate_local_certs.sh
```

这个脚本会调用 `mkcert` 生成覆盖 `127.0.0.1 / localhost / ::1` 的本地可信证书，并写到：

```text
robot-memory-backend/certs/127.0.0.1.pem
robot-memory-backend/certs/127.0.0.1-key.pem
```

### 4. 启动服务

```bash
cd robot-memory-backend
python main.py
```

如果证书配置正确，启动后你可以看到类似：

```text
Uvicorn running on https://127.0.0.1:8766
```

---

## 与前端的集成方式

我已经把 `led-emoji-screen/index.html` 接好了：

1. **开始连接语音前**
   - 前端先请求 `POST /memory/search`
   - 取回长期记忆摘要
   - 注入豆包 `StartSession` 的 `dialog.system_role`

2. **每轮问答结束后**
   - 前端自动请求 `POST /memory/add`
   - 把本轮 `user_text + bot_text` 写入 Mem0

3. **写入完成后**
   - 前端再次请求 `POST /memory/search`
   - 刷新页面上的“长期记忆（Mem0）”卡片
   - 并通过 `UpdateConfig` 更新豆包会话里的 `system_role`

也就是说，现在已经形成了一个闭环：

```text
语音输入 -> 豆包回复 -> 前端落库到 Mem0 -> 检索长期记忆 -> 更新后续对话提示词
```

---

## 运行顺序建议

建议按这个顺序启动：

### 1) 启动记忆后端

```bash
cd robot-memory-backend
python main.py
```

### 2) 启动豆包 WebSocket 代理

```bash
cd led-emoji-screen
npm start
```

### 3) 打开前端页面

如果你是本地打开 HTML，或通过 HTTPS 内网页面访问前端，前端都会尝试访问：

- `wss://localhost:8765`
- `https://127.0.0.1:8766`

因此这两个本地服务都要先启动；同时请把内网页面的域名加入 `ALLOW_ORIGINS`。

---

## 已验证内容

我已经本地验证通过：

- `GET /health`
- `OPTIONS /memory/search`
- `POST /memory/add`
- `POST /memory/search`
- `GET /memory/all`

其中：

- `/memory/search` 已能返回可直接注入 system prompt 的 `summary_text`
- `OPTIONS` 预检会被正确处理（实际返回由 CORS 中间件接管，通常是 `200 OK`）
- 当配置 `SSL_CERTFILE / SSL_KEYFILE` 后，服务会以 `https://127.0.0.1:8766` 方式启动

---

## 已知说明

### 1. 首次启动可能会下载 embedding 模型

第一次运行时，`sentence-transformers` 会下载本地 embedding 模型，启动会比后续慢一些。

### 2. 默认是“原始对话记忆”而不是“事实抽取记忆”

这是我有意做的默认选择。

原因是：

- 你当前目标是先让语音前端具备稳定的长期记忆闭环
- `infer=true` 需要额外可用的 LLM
- 默认 `infer=false` 更稳、更容易本地落地

如果你后续希望升级成更“智能”的事实提炼型记忆，我可以继续帮你切到：

- `Ollama + Mem0 infer=true`
- 或 OpenAI 兼容 LLM + Mem0 infer=true

### 3. Qdrant 使用本地磁盘模式

所以数据会保存在：

```text
robot-memory-backend/data/qdrant/
```

只要不删这个目录，重启服务后记忆仍然在。

---

## 一条快速自测命令

```bash
curl -s https://127.0.0.1:8766/health
```

如果返回：

```json
{"ok":true,...}
```

说明后端已经起来了。
