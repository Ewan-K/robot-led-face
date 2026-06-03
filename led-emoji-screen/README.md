# 本地 Node.js 代理与意图桥接服务

这个目录提供两类本地服务：

1. `proxy.js`：本地 WebSocket 代理，解决浏览器在握手阶段无法注入自定义 Header 的问题。
2. `intent-bridge.js`：本地 HTTP 意图桥接服务，用于接收前端识别到的意图，并执行对应的本地命令。

## 作用

### 1) 语音代理

前端页面连接 `wss://localhost:8765`，本地代理再转发到豆包实时语音服务：

- 上游地址：`wss://openspeech.bytedance.com/api/v3/realtime/dialogue`
- 注入鉴权 Header：
  - `X-Api-App-Id: 6415430121`
  - `X-Api-Access-Key: 通过环境变量 DOUBAO_ACCESS_KEY 注入`
  - `X-Api-Resource-Id: volc.speech.dialog`

### 2) 意图桥接

前端在收到 `ChatResponse` 文本流后，会做简单关键词匹配：

- 若文本中包含 `本地飞书`
- 则会向 `http://127.0.0.1:9989/intent` 发起 `POST` 请求
- `intent-bridge.js` 收到请求后，会执行本地命令

当前示例命令为：

```bash
echo TODO_本地飞书命令
```

你可以把它替换成真正需要执行的本地 Feishu / Lark 命令。

## 安装依赖

```bash
cd led-emoji-screen
npm install
```

## 启动服务

### 启动 WebSocket 代理

```bash
DOUBAO_ACCESS_KEY=你的AccessKey npm start
```

### 启动意图桥接服务

```bash
npm run intent-bridge
```

## 启动成功后的输出

### WebSocket 代理

- `WSS proxy listening on wss://localhost:8765`

### 意图桥接服务

- `intent-bridge listening on http://127.0.0.1:9989`

## 健康检查

```bash
curl http://127.0.0.1:9989/healthz
```

## 手动测试意图触发

```bash
curl -X POST http://127.0.0.1:9989/intent \
  -H 'Content-Type: application/json' \
  -d '{"intent":"本地飞书","source_text":"请帮我打开本地飞书"}'
```

然后再用浏览器打开页面并开始语音对话。若模型回复里出现 `本地飞书`，前端会自动 dispatch 到本地桥接服务。
