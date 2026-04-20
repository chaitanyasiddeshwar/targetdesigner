#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOST = process.env.TD_HOST || '127.0.0.1';
const PORT = Number(process.env.TD_PORT || 5180);
const SHOULD_OPEN_BROWSER = process.env.TD_OPEN_BROWSER !== '0';
const SERVER_URL = `http://${HOST}:${PORT}`;

function browserUrlForHost(host, port) {
  if (host === '0.0.0.0' || host === '::') {
    return `http://127.0.0.1:${port}`;
  }
  return `http://${host}:${port}`;
}

const DIST_ROOT = path.resolve(__dirname, '..', 'dist');
const RUNTIME_ROOT = process.pkg ? path.dirname(process.execPath) : path.resolve(__dirname, '..');
const TARGET_CURVES_ROOT = path.join(RUNTIME_ROOT, 'target_curves');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

function contentTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function safeResolve(baseDir, relativePath) {
  const cleaned = String(relativePath || '').replace(/^[/\\]+/, '');
  const resolved = path.resolve(baseDir, cleaned);
  if (resolved === baseDir || resolved.startsWith(`${baseDir}${path.sep}`)) {
    return resolved;
  }
  return null;
}

function sanitizeTemplateName(name) {
  const clean = String(name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ');
  return clean || 'target';
}

function toTemplateFileName(name) {
  const safe = sanitizeTemplateName(name);
  return /\.txt$/i.test(safe) ? safe : `${safe}.txt`;
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_JSON_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON payload.'));
      }
    });

    req.on('error', (error) => {
      reject(error);
    });
  });
}

async function saveTargetCurveTemplate({ name, text, overwrite }) {
  const fileName = toTemplateFileName(name);
  const filePath = safeResolve(TARGET_CURVES_ROOT, fileName);
  if (!filePath) {
    throw new Error('Invalid target curve path.');
  }

  await fsp.mkdir(TARGET_CURVES_ROOT, { recursive: true });

  if (!overwrite) {
    try {
      const stat = await fsp.stat(filePath);
      if (stat.isFile()) {
        const error = new Error(`File \"${fileName}\" already exists.`);
        error.code = 'EEXIST';
        throw error;
      }
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw error;
    }
  }

  await fsp.writeFile(filePath, String(text || ''), 'utf8');
  return {
    name: fileName.replace(/\.txt$/i, ''),
    fileName,
  };
}

async function listTargetCurveFiles() {
  try {
    const entries = await fsp.readdir(TARGET_CURVES_ROOT, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.txt$/i.test(entry.name))
      .map((entry) => ({
        name: entry.name.replace(/\.txt$/i, ''),
        fileName: entry.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function sendFile(res, filePath) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    res.statusCode = 404;
    res.end('Not found.');
    return;
  }

  if (!stat.isFile()) {
    res.statusCode = 404;
    res.end('Not found.');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', contentTypeFor(filePath));
  fs.createReadStream(filePath).pipe(res);
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

let shuttingDown = false;

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = decodeURIComponent(requestUrl.pathname || '/');

  if (pathname === '/api/target-curves') {
    if (req.method === 'GET') {
      const curves = await listTargetCurveFiles();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(curves));
      return;
    }

    if (req.method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error.message || 'Invalid request body.' }));
        return;
      }

      try {
        const saved = await saveTargetCurveTemplate({
          name: body?.name,
          text: body?.text,
          overwrite: Boolean(body?.overwrite),
        });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(saved));
      } catch (error) {
        res.statusCode = error?.code === 'EEXIST' ? 409 : 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error?.message || 'Unable to save target curve.' }));
      }
      return;
    }

    res.statusCode = 405;
    res.setHeader('Allow', 'GET, POST');
    res.end('Method not allowed.');
    return;
  }

  if (pathname.startsWith('/target_curves/')) {
    const requestedFile = pathname.slice('/target_curves/'.length);
    const filePath = safeResolve(TARGET_CURVES_ROOT, requestedFile);

    if (!filePath) {
      res.statusCode = 400;
      res.end('Invalid path.');
      return;
    }

    await sendFile(res, filePath);
    return;
  }

  const staticAssetPath = pathname === '/' ? 'index.html' : pathname;
  const resolvedStaticPath = safeResolve(DIST_ROOT, staticAssetPath);
  if (!resolvedStaticPath) {
    res.statusCode = 400;
    res.end('Invalid path.');
    return;
  }

  try {
    const stat = await fsp.stat(resolvedStaticPath);
    if (stat.isFile()) {
      await sendFile(res, resolvedStaticPath);
      return;
    }
  } catch {
    // Fall back to SPA index below.
  }

  await sendFile(res, path.join(DIST_ROOT, 'index.html'));
});

function stopServer() {
  if (shuttingDown) return;
  shuttingDown = true;

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  server.close(() => {
    process.exit(0);
  });
}

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    const existingUrl = browserUrlForHost(HOST, PORT);
    console.log(`Port ${PORT} is already in use. Opening existing instance at ${existingUrl}.`);
    if (SHOULD_OPEN_BROWSER) {
      openBrowser(existingUrl);
    }
    process.exit(0);
    return;
  }

  console.error(`Server failed: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Target Designer running at ${SERVER_URL}`);
  console.log(`Serving built assets from ${DIST_ROOT}`);
  console.log(`Serving target curves from ${TARGET_CURVES_ROOT}`);
  if (process.stdin.isTTY) {
    console.log('Press q to stop.');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (key) => {
      if (key === '\u0003' || String(key).toLowerCase() === 'q') {
        stopServer();
      }
    });
  } else {
    console.log('Press Ctrl+C to stop.');
  }

  if (SHOULD_OPEN_BROWSER) {
    openBrowser(browserUrlForHost(HOST, PORT));
  }
});

process.on('SIGINT', stopServer);
process.on('SIGTERM', stopServer);
