# Node.js WebSocket 代理

这个目录同时提供两套代理服务：

- **本地开发版**：`proxy.js`
  - 保持现状不变
  - 使用 `mkcert` 生成的本地证书
  - 监听 `wss://localhost:8765`
- **TCE 部署版**：`proxy-tce.js`
  - 面向字节内部 TCE 容器部署
  - 不依赖本地证书，直接监听普通 `HTTP/WS`
  - 端口为 `process.env.PORT || 8765`
  - 提供 `/healthz` 健康检查
  - 支持 `SIGTERM` / `SIGINT` 优雅停机

## 作用

前端页面通过代理转发到豆包实时语音服务，解决浏览器在握手阶段无法注入自定义 Header 的问题。

- 上游地址：`wss://openspeech.bytedance.com/api/v3/realtime/dialogue`
- 注入鉴权 Header：
  - `X-Api-App-Id: 6415430121`
  - `X-Api-Access-Key: 通过环境变量 DOUBAO_ACCESS_KEY 注入`
  - `X-Api-Resource-Id: volc.speech.dialog`

## Function Calling 接入方式

页面在建立语音会话时，会在启动请求中附带 `本地飞书` 工具定义：

- 工具名：`本地飞书`
- 描述：当用户提到飞书相关操作时调用
- 参数：`text`（字符串）

当前前端处理逻辑如下：

1. 监听服务端下发的 Function Calling 消息。
2. 当识别到 `本地飞书` 调用时，先执行本地占位逻辑：

```js
console.log('TODO: 执行本地飞书命令', args)
```

3. 随后通过会话更新指令把工具执行结果回填给当前语音会话。

> 说明：当前仓库中本地飞书执行仍为占位实现。你可以把这段逻辑替换成真实的本地 Feishu / Lark 命令或桌面自动化调用。

## 安装依赖

```bash
cd led-emoji-screen
npm install
```

## 本地开发版启动方式

```bash
DOUBAO_ACCESS_KEY=你的AccessKey npm start
```

启动成功后，控制台会显示：

- `WSS proxy listening on wss://localhost:8765`

### 本地开发版额外要求

`proxy.js` 依赖 `mkcert` 生成的本地证书，需将以下文件放在当前目录：

- `localhost.pem`
- `localhost-key.pem`

示例：

```bash
mkcert -install
mkcert localhost
```

## TCE 部署版启动方式

### 直接用 Node 启动

```bash
DOUBAO_ACCESS_KEY=你的AccessKey PORT=8765 npm run start:tce
```

服务特性：

- WebSocket 监听：`ws://0.0.0.0:${PORT}`
- 健康检查：`GET /healthz`
- 平台可通过网关统一接入 TLS，容器内无需证书

### Docker 构建

```bash
docker build -t led-emoji-screen-proxy-tce .
```

### Docker 运行

```bash
docker run --rm -p 8765:8765 \
  -e DOUBAO_ACCESS_KEY=你的AccessKey \
  -e PORT=8765 \
  led-emoji-screen-proxy-tce
```

容器启动命令默认执行：

```bash
node proxy-tce.js
```

## 使用说明

### 本地开发场景

1. 启动本地 WebSocket 代理：`npm start`
2. 启动 Mem0 后端（如果你需要长期记忆能力）
3. 用浏览器打开页面并开始语音对话
4. 当前页面默认连接 `wss://localhost:8765`

### TCE 场景

1. 部署 `proxy-tce.js` 对应的容器
2. 通过平台网关对外提供 `wss://` 接入
3. 将前端中的 WebSocket 地址改为 TCE 网关地址
4. 记忆后端服务当前**不在本次迁移范围内**

## 自定义本地工具执行

如需接入真实本地命令，可在前端页面的 Function Calling 处理逻辑中替换占位代码，并保持回填结果的结构不变，这样语音会话可以继续自然往下进行。
