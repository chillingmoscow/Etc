// BFF (backend-for-frontend) для PoC приложения официанта.
// Отдаёт и статику PWA, и API. Без внешних зависимостей (только Node 18+).
// Креды QuickResto живут ТОЛЬКО здесь (на сервере), никогда не на клиенте.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG } from './config.mjs';
import * as qr from './quickResto.mjs';
import { store } from './store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PWA_DIR = join(__dirname, '..', 'pwa');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(data);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch { return null; }
}

async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = normalize(join(PWA_DIR, urlPath));
  if (!filePath.startsWith(PWA_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(PWA_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(data);
    } catch {
      send(res, 404, { error: 'not found' });
    }
  }
}

const server = createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://x').pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return send(res, 204, '');

    if (p === '/api/health') {
      return send(res, 200, { ok: true, mode: CONFIG.mock ? 'mock' : 'real', layer: CONFIG.layer || null });
    }
    if (p === '/api/menu' && req.method === 'GET') {
      return send(res, 200, await qr.readMenu());
    }
    if (p === '/api/tables' && req.method === 'GET') {
      return send(res, 200, await qr.readTables());
    }
    if (p === '/api/orders' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body) return send(res, 400, { error: 'invalid json' });
      const key = body.idempotencyKey || randomUUID();
      // Идемпотентность: тот же ключ → тот же результат (защита от дублей при ретраях).
      const existing = store.byKey(key);
      if (existing) return send(res, 200, { ...existing, idempotent: true });
      try {
        const created = await qr.createOrder({ ...body, idempotencyKey: key });
        store.save(key, created, body);
        return send(res, 201, created);
      } catch (e) {
        return send(res, 502, { error: 'quickresto_create_failed', detail: String(e?.message || e) });
      }
    }
    const m = p.match(/^\/api\/orders\/([^/]+)\/status$/);
    if (m && req.method === 'GET') {
      return send(res, 200, await qr.getOrderStatus(decodeURIComponent(m[1])));
    }
    if (p === '/api/orders' && req.method === 'GET') {
      return send(res, 200, store.all());
    }
    return serveStatic(req, res);
  } catch (e) {
    send(res, 500, { error: 'internal', detail: String(e?.message || e) });
  }
});

server.listen(CONFIG.port, () => {
  console.log(`[BFF] http://localhost:${CONFIG.port}  mode=${CONFIG.mock ? 'MOCK (без кредов)' : 'REAL'}  layer=${CONFIG.layer || '-'}`);
  if (CONFIG.mock) {
    console.log('[BFF] Креды QuickResto не заданы → MOCK-режим (демо).');
    console.log('[BFF] Для боевого режима задайте QR_LAYER/QR_LOGIN/QR_PASSWORD (см. .env.example) и снимите QR_MOCK.');
  }
});
