# 本地 Node.js WebSocket 代理

这个目录提供本地 WebSocket 代理，用于解决浏览器在握手阶段无法注入自定义 Header 的问题，并承载前端的实时语音 Function Calling 接入示例。

## 作用

前端页面连接 `wss://localhost:8765`，本地代理再转发到豆包实时语音服务：

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

## 启动代理

```bash
DOUBAO_ACCESS_KEY=你的AccessKey npm start
```

启动成功后，控制台会显示：

- `WSS proxy listening on wss://localhost:8765`

## 使用说明

1. 启动本地 WebSocket 代理。
2. 启动 Mem0 后端（如果你需要长期记忆能力）。
3. 用浏览器打开页面并开始语音对话。
4. 当模型判断用户请求属于飞书相关操作时，会在实时语音链路中直接触发 `本地飞书` 工具调用。

## 自定义本地工具执行

如需接入真实本地命令，可在前端页面的 Function Calling 处理逻辑中替换占位代码，并保持回填结果的结构不变，这样语音会话可以继续自然往下进行。
