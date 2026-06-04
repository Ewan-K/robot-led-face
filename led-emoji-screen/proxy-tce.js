const http = require('http');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 8765;
const TARGET_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue';
const ACCESS_KEY = process.env.DOUBAO_ACCESS_KEY || '';
const AUTH_HEADERS = {
  'X-Api-App-Id': '6415430121',
  'X-Api-Access-Key': ACCESS_KEY,
  'X-Api-Resource-Id': 'volc.speech.dialog'
};

if (!ACCESS_KEY) {
  console.warn('[proxy-tce] ⚠️  警告：未设置环境变量 DOUBAO_ACCESS_KEY，鉴权将失败！');
}

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not found' }));
});

const wss = new WebSocket.Server({ noServer: true });
const activeUpstreams = new Set();
const activeClients = new Set();
let isShuttingDown = false;

const forceTerminateSocket = (socket, timeoutMs = 5000) => {
  setTimeout(() => {
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      return;
    }
    socket.terminate();
  }, timeoutMs).unref();
};

server.on('upgrade', (req, socket, head) => {
  if (isShuttingDown) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (client) => {
    wss.emit('connection', client, req);
  });
});

wss.on('connection', (client, request) => {
  activeClients.add(client);
  console.log(`[proxy-tce] Client connected from ${request.socket.remoteAddress || 'unknown'}`);

  const upstream = new WebSocket(TARGET_URL, { headers: AUTH_HEADERS });
  activeUpstreams.add(upstream);

  let closed = false;
  const pendingMessages = [];

  const cleanup = () => {
    activeClients.delete(client);
    activeUpstreams.delete(upstream);
  };

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
      forceTerminateSocket(client);
    }

    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close();
      forceTerminateSocket(upstream);
    }
  };

  upstream.on('open', () => {
    console.log('[proxy-tce] Upstream connected');
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
    console.log(`[proxy-tce] Client disconnected (${code} ${reason})`);
    closeBoth(code || 1000, reason);
    cleanup();
  });

  upstream.on('close', (code, reasonBuffer) => {
    const reason = reasonBuffer && reasonBuffer.length ? reasonBuffer.toString() : 'upstream closed';
    console.log(`[proxy-tce] Upstream disconnected (${code} ${reason})`);
    closeBoth(code || 1011, reason);
    cleanup();
  });

  client.on('error', (error) => {
    console.error('[proxy-tce] Client error:', error.message);
    closeBoth(1011, 'client error');
  });

  upstream.on('error', (error) => {
    console.error('[proxy-tce] Upstream error:', error.message);
    if (client.readyState === WebSocket.OPEN) {
      client.close(1011, 'upstream error');
      forceTerminateSocket(client);
    }
  });
});

const shutdown = (signal) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`[proxy-tce] Received ${signal}, starting graceful shutdown...`);

  server.close((error) => {
    if (error) {
      console.error('[proxy-tce] Error while closing HTTP server:', error.message);
      process.exitCode = 1;
    }

    if (activeClients.size === 0 && activeUpstreams.size === 0) {
      console.log('[proxy-tce] Shutdown complete');
      process.exit();
    }
  });

  for (const client of activeClients) {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close(1001, 'server shutting down');
      forceTerminateSocket(client);
    }
  }

  for (const upstream of activeUpstreams) {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close(1001, 'server shutting down');
      forceTerminateSocket(upstream);
    }
  }

  setTimeout(() => {
    console.warn('[proxy-tce] Graceful shutdown timeout reached, forcing exit');
    process.exit();
  }, 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.on('error', (error) => {
  console.error('[proxy-tce] Server error:', error.message);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy-tce] ✅ WS proxy listening on http://0.0.0.0:${PORT}`);
  console.log(`[proxy-tce] Health check ready at http://0.0.0.0:${PORT}/healthz`);
  console.log(`[proxy-tce] Forwarding upstream to ${TARGET_URL}`);
});
