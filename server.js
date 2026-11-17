const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 4173);
const CLOUDINARY_API = 'https://api.cloudinary.com/v1_1';

loadEnvFile();

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    process.env[match[1]] = value;
  }
}

function cloudinaryConfig() {
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || process.env.cloudinaryCloudname || '',
    apiKey: process.env.CLOUDINARY_API_KEY || process.env.cloudinaryAPIKey || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || process.env.cloudinaryAPISecret || ''
  };
}

function signParams(params, secret) {
  const canonical = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
  return crypto.createHash('sha1').update(canonical + secret).digest('hex');
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 8192) {
        reject(Object.assign(new Error('Request is too large'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function localHost(req) {
  if (!req.headers.host) return false;
  try {
    const hostname = new URL(`http://${req.headers.host}`).hostname;
    return hostname === '127.0.0.1' || hostname === 'localhost';
  } catch {
    return false;
  }
}

function validId(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    const cfg = cloudinaryConfig();
    return json(res, 200, { configured: !!(cfg.cloudName && cfg.apiKey && cfg.apiSecret) });
  }

  if (req.method === 'GET' && url.pathname === '/api/yaml') {
    const files = fs.readdirSync(ROOT)
      .filter(name => /^unit_[a-z0-9_-]+\.ya?ml$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return json(res, 200, files);
  }

  const yamlMatch = url.pathname.match(/^\/api\/yaml\/([^/]+)$/);
  if (req.method === 'GET' && yamlMatch) {
    const name = decodeURIComponent(yamlMatch[1]);
    if (!/^unit_[a-z0-9_-]+\.ya?ml$/i.test(name)) return json(res, 400, { error: 'Invalid YAML filename' });
    const file = path.join(ROOT, name);
    if (!fs.existsSync(file)) return json(res, 404, { error: 'YAML file not found' });
    res.writeHead(200, { 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(file).pipe(res);
  }

  if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: 'Request origin is not allowed' });
  const cfg = cloudinaryConfig();
  if (!cfg.cloudName || !cfg.apiKey || !cfg.apiSecret) {
    return json(res, 503, { error: 'Cloudinary credentials are not configured in .env' });
  }

  if (req.method === 'POST' && url.pathname === '/api/sign-upload') {
    try {
      const input = await readJson(req);
      if (!validId(input.sourceId) || !validId(input.itemId)) {
        return json(res, 400, { error: 'Invalid recording identifier' });
      }
      const timestamp = Math.floor(Date.now() / 1000);
      const params = {
        invalidate: 'true',
        overwrite: 'true',
        public_id: `recordings/${input.sourceId}/${input.itemId}`,
        timestamp: String(timestamp)
      };
      return json(res, 200, {
        ...params,
        signature: signParams(params, cfg.apiSecret),
        apiKey: cfg.apiKey,
        cloudName: cfg.cloudName
      });
    } catch (error) {
      return json(res, error.status || 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/delete') {
    try {
      const input = await readJson(req);
      if (typeof input.publicId !== 'string' ||
          !/^recordings\/[a-z0-9-]+\/[a-z0-9-]+$/.test(input.publicId)) {
        return json(res, 400, { error: 'Invalid recording identifier' });
      }
      const timestamp = String(Math.floor(Date.now() / 1000));
      const params = { invalidate: 'true', public_id: input.publicId, timestamp };
      const form = new URLSearchParams({
        ...params,
        api_key: cfg.apiKey,
        signature: signParams(params, cfg.apiSecret)
      });
      const response = await fetch(`${CLOUDINARY_API}/${encodeURIComponent(cfg.cloudName)}/video/destroy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form
      });
      const result = await response.json();
      if (!response.ok || (result.result !== 'ok' && result.result !== 'not found')) {
        return json(res, 502, { error: result.error && result.error.message || 'Cloudinary deletion failed' });
      }
      return json(res, 200, { deleted: true });
    } catch (error) {
      return json(res, error.status || 502, { error: error.message });
    }
  }

  return json(res, 404, { error: 'API route not found' });
}

const server = http.createServer(async (req, res) => {
  if (!localHost(req)) {
    res.writeHead(403);
    return res.end('Local access only');
  }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  const routes = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/recorder.html': ['index.html', 'text/html; charset=utf-8'],
    '/yaml.js': ['yaml.js', 'text/javascript; charset=utf-8']
  };
  const route = routes[url.pathname];
  if (!route) {
    res.writeHead(404);
    return res.end('Not found');
  }
  const [file, type] = route;
  res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(path.join(ROOT, file)).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Audio recorder available at http://127.0.0.1:${PORT}`);
});

module.exports = { signParams, validId };
