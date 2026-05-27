const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 8787);
const TARGET_URL = process.env.DOUBAO_PROXY_TARGET || 'https://openspeech.bytedance.com';
const DOUBAO_ACCESS_KEY = (process.env.DOUBAO_ACCESS_KEY || '').trim();

if (!DOUBAO_ACCESS_KEY) {
  console.warn('[proxy] Warning: DOUBAO_ACCESS_KEY 未设置，转发请求时不会附带 X-Api-Access-Key Header。');
}

function buildForwardHeaders(req, target) {
  return {
    host: target.host,
    connection: 'close',
    accept: req.headers.accept || '*/*',
    'accept-language': req.headers['accept-language'] || 'zh-CN,zh;q=0.9',
    'content-type': req.headers['content-type'] || 'application/json',
    'user-agent': req.headers['user-agent'] || 'robot-led-face-local-proxy/1.0',
    'x-api-app-id': req.headers['x-api-app-id'] || '',
    'x-api-resource-id': req.headers['x-api-resource-id'] || '',
    'x-api-app-key': req.headers['x-api-app-key'] || '',
    ...(DOUBAO_ACCESS_KEY ? { 'x-api-access-key': DOUBAO_ACCESS_KEY } : {})
  };
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/proxy')) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: 'Not Found' }));
    return;
  }

  const upstream = new URL(req.url.replace(/^\/proxy/, ''), TARGET_URL);
  const chunks = [];

  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const proxyReq = https.request(
      upstream,
      {
        method: 'POST',
        headers: buildForwardHeaders(req, upstream)
      },
      proxyRes => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', error => {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ message: 'Proxy request failed', error: error.message }));
    });

    proxyReq.end(body);
  });
});

server.listen(PORT, () => {
  console.log(`[proxy] Listening on http://localhost:${PORT}`);
  console.log(`[proxy] Forward target: ${TARGET_URL}`);
});
