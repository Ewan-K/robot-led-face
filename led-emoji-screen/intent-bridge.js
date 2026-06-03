const http = require('http');
const { exec } = require('child_process');

const PORT = Number(process.env.INTENT_BRIDGE_PORT || 9989);
const HOST = process.env.INTENT_BRIDGE_HOST || '127.0.0.1';

const ACTIONS = {
  '本地飞书': 'echo TODO_本地飞书命令'
};

function sendJSON(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('invalid json body'));
      }
    });
    req.on('error', reject);
  });
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        reject({
          message: error.message,
          stdout: stdout || '',
          stderr: stderr || ''
        });
        return;
      }
      resolve({
        stdout: stdout || '',
        stderr: stderr || ''
      });
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJSON(res, 204, {});
    return;
  }

  if (req.method === 'GET' && req.url === '/healthz') {
    sendJSON(res, 200, {
      ok: true,
      service: 'intent-bridge'
    });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/intent') {
    sendJSON(res, 404, {
      ok: false,
      error: 'not found'
    });
    return;
  }

  try {
    const body = await readJSON(req);
    const intent = typeof body.intent === 'string' ? body.intent.trim() : '';
    if (!intent) {
      sendJSON(res, 400, {
        ok: false,
        error: 'intent is required'
      });
      return;
    }

    const command = ACTIONS[intent];
    if (!command) {
      sendJSON(res, 400, {
        ok: false,
        error: `unsupported intent: ${intent}`
      });
      return;
    }

    console.log(`[intent-bridge] intent=${intent}`);
    if (body.source_text) {
      console.log(`[intent-bridge] source_text=${String(body.source_text).slice(0, 200)}`);
    }

    const result = await runCommand(command);
    sendJSON(res, 200, {
      ok: true,
      intent,
      command,
      result
    });
  } catch (error) {
    const detail = error && error.message ? error.message : 'internal error';
    sendJSON(res, 500, {
      ok: false,
      error: detail,
      stdout: error && error.stdout ? error.stdout : '',
      stderr: error && error.stderr ? error.stderr : ''
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[intent-bridge] listening on http://${HOST}:${PORT}`);
  console.log('[intent-bridge] ready intents:', Object.keys(ACTIONS).join(', '));
});
