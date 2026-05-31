# 本地 Node.js WebSocket 代理

这个目录提供一个本地 WebSocket 代理，解决浏览器在握手阶段无法注入自定义 Header 的问题。

## 作用

前端页面连接 `ws://localhost:8765`，本地代理再转发到豆包实时语音服务：

- 上游地址：`wss://openspeech.bytedance.com/api/v3/realtime/dialogue`
- 注入鉴权 Header：
  - `X-Api-App-Id: 6415430121`
  - `X-Api-Access-Key: 9oO3d6NCdV0FlJMIhpft5gn2gEmmme1W`
  - `X-Api-Resource-Id: volc.speech.dialog`

## 安装依赖

```bash
cd led-emoji-screen
npm install
```

## 启动代理

```bash
npm start
```

启动成功后，控制台会显示：

- `WebSocket proxy listening on ws://localhost:8765`

然后再用浏览器打开页面并开始语音对话。
