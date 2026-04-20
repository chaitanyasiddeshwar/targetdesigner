import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGET_CURVES_DIR = path.resolve(__dirname, 'src/target_curves');
const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;

async function listTargetCurveFiles() {
  try {
    const entries = await fsp.readdir(TARGET_CURVES_DIR, { withFileTypes: true });
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

function resolveTargetCurvePath(fileName) {
  const safeName = String(fileName || '').trim();
  if (!safeName || safeName.includes('/') || safeName.includes('\\')) {
    return null;
  }

  const resolved = path.resolve(TARGET_CURVES_DIR, safeName);
  if (!resolved.startsWith(`${TARGET_CURVES_DIR}${path.sep}`)) {
    return null;
  }

  return resolved;
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
  const filePath = resolveTargetCurvePath(fileName);
  if (!filePath) {
    throw new Error('Invalid target curve path.');
  }

  await fsp.mkdir(TARGET_CURVES_DIR, { recursive: true });

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

function attachTargetCurveRoutes(middlewares) {
  middlewares.use(async (req, res, next) => {
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
      const fileName = pathname.slice('/target_curves/'.length);
      const filePath = resolveTargetCurvePath(fileName);
      if (!filePath) {
        res.statusCode = 400;
        res.end('Invalid target curve path.');
        return;
      }

      try {
        const stat = await fsp.stat(filePath);
        if (!stat.isFile()) {
          res.statusCode = 404;
          res.end('Not found.');
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        fs.createReadStream(filePath).pipe(res);
      } catch {
        res.statusCode = 404;
        res.end('Not found.');
      }
      return;
    }

    next();
  });
}

function targetCurvesPlugin() {
  return {
    name: 'target-curves-runtime-routes',
    configureServer(server) {
      attachTargetCurveRoutes(server.middlewares);
    },
    configurePreviewServer(server) {
      attachTargetCurveRoutes(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [targetCurvesPlugin(), react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5180,
    strictPort: true,
  },
});
