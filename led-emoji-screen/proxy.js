const https = require('https');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const LOCAL_PORT = 8765;
const TARGET_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';

const ACCESS_KEY = process.env.DOUBAO_ACCESS_KEY || '';
if (!ACCESS_KEY) {
  console.warn('[proxy] ⚠️  警告：未设置环境变量 DOUBAO_ACCESS_KEY，鉴权将失败！');
  console.warn('[proxy] 请使用以下方式启动：DOUBAO_ACCESS_KEY=你的AccessKey node proxy.js');
}

const AUTH_HEADERS = {
  'X-Api-App-Id': '6415430121',
  'X-Api-Access-Key': ACCESS_KEY,
  'X-Api-Resource-Id': 'volc.speech.dialog'
};

// 加载 mkcert 生成的本地证书（文件需与 proxy.js 在同一目录）
const CERT_FILE = path.join(__dirname, 'localhost.pem');
const KEY_FILE  = path.join(__dirname, 'localhost-key.pem');

if (!fs.existsSync(CERT_FILE) || !fs.existsSync(KEY_FILE)) {
  console.error('[proxy] ❌ 找不到证书文件！请先执行：');
  console.error('[proxy]    mkcert -install');
  console.error('[proxy]    mkcert localhost');
  console.error('[proxy] 然后将生成的 localhost.pem / localhost-key.pem 放到 proxy.js 同目录下。');
  process.exit(1);
}

const httpsServer = https.createServer({
  cert: fs.readFileSync(CERT_FILE),
  key:  fs.readFileSync(KEY_FILE),
});

const server = new WebSocket.Server({ server: httpsServer });

httpsServer.listen(LOCAL_PORT, () => {
  console.log(`[proxy] ✅ WSS proxy listening on wss://localhost:${LOCAL_PORT}`);
  console.log(`[proxy] Forwarding upstream to ${TARGET_URL}`);
});

server.on('connection', (client, request) => {
  console.log(`[proxy] Client connected from ${request.socket.remoteAddress || 'unknown'}`);

  const upstream = new WebSocket(TARGET_URL, { headers: AUTH_HEADERS });

  let closed = false;
  const pendingMessages = [];

  const flushPendingMessages = () => {
    while (pendingMessages.length && upstream.readyState === WebSocket.OPEN) {
      const { data, isBinary } = pendingMessages.shift();
      upstream.send(data, { binary: isBinary });
    }
  };

  const closeBoth = (code = 1011, reason = 'proxy closed') => {
    if (closed) return;
    closed = true;
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close(code, reason);
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
    }
  };

  upstream.on('open', () => {
    console.log('[proxy] Upstream connected');
    flushPendingMessages();
  });

  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
      return;
    }
    if (upstream.readyState === WebSocket.CONNECTING) {
      pendingMessages.push({ data, isBinary });
    }
  });

  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });

  client.on('close', (code, reasonBuffer) => {
    const reason = reasonBuffer && reasonBuffer.length ? reasonBuffer.toString() : 'client closed';
    console.log(`[proxy] Client disconnected (${code} ${reason})`);
    closeBoth(code || 1000, reason);
  });

  upstream.on('close', (code, reasonBuffer) => {
    const reason = reasonBuffer && reasonBuffer.length ? reasonBuffer.toString() : 'upstream closed';
    console.log(`[proxy] Upstream disconnected (${code} ${reason})`);
    closeBoth(code || 1011, reason);
  });

  client.on('error', (error) => {
    console.error('[proxy] Client error:', error.message);
    closeBoth(1011, 'client error');
  });

  upstream.on('error', (error) => {
    console.error('[proxy] Upstream error:', error.message);
    if (client.readyState === WebSocket.OPEN) {
      client.close(1011, 'upstream error');
    }
  });
});

server.on('error', (error) => {
  console.error('[proxy] Server error:', error.message);
});
