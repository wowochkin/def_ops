/**
 * API-шлюз — единственная точка входа извне.
 *  - Аутентификация: X-Api-Key (или ?api_key= для EventSource) → организация.
 *    Ключи задаются переменной API_KEYS="ключ:организация,…". При AUTH=open
 *    (разработка) ключ не обязателен, организация — из X-Tenant-Id или default.
 *  - Маршрутизация по префиксу к внутренним сервисам (таблица ROUTES).
 *  - Входящий X-Tenant-Id от клиента НЕ доверяется — шлюз выставляет его сам.
 *  - Отдаёт собранный редактор (STATIC_DIR) — фронтенд и API на одном адресе.
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { log, sanitizeTenant } from '@def-ops/service-kit';

export interface GatewayConfig {
  port: number;
  services: Record<string, string>;
  /** Префикс API → [сервис, префикс на стороне сервиса]. */
  routes: [string, string, string][];
  auth: 'open' | 'keys';
  apiKeys: Map<string, string>;
  staticDir?: string;
  corsOrigin: string;
}

export function parseKeys(s: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of s.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [k, t] = pair.split(':');
    if (k && sanitizeTenant(t)) m.set(k, t);
  }
  return m;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
};

export function createGateway(cfg: GatewayConfig) {
  const sendErr = (res: http.ServerResponse, status: number, code: string, message: string) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: { code, message } }));
  };

  return http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url || '/', 'http://gw');
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Access-Control-Allow-Origin', cfg.corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match, X-Api-Key, X-Request-Id, X-Source-System, X-Tenant-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Request-Id');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

    if (!url.pathname.startsWith('/api/')) return serveStatic(cfg, url.pathname, res);

    // --- служебное: здоровье платформы и список сервисов
    if (url.pathname === '/api/health') {
      const checks = await Promise.all(Object.entries(cfg.services).map(async ([name, base]) => {
        try {
          const r = await fetch(base + '/ready', { signal: AbortSignal.timeout(1500) });
          return [name, r.ok ? 'up' : 'degraded'] as const;
        } catch { return [name, 'down'] as const; }
      }));
      const services = Object.fromEntries(checks);
      const ok = checks.every(([, s]) => s === 'up');
      res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ status: ok ? 'ok' : 'degraded', services, auth: cfg.auth }));
      return;
    }

    // --- аутентификация
    const key = (req.headers['x-api-key'] as string) || url.searchParams.get('api_key') || '';
    let tenant: string | null = null;
    if (key) tenant = cfg.apiKeys.get(key) ?? null;
    if (!tenant && cfg.auth === 'open') tenant = sanitizeTenant(req.headers['x-tenant-id'] as string) || 'default';
    if (!tenant) return sendErr(res, 401, 'unauthorized', 'Нужен действительный API-ключ (заголовок X-Api-Key)');

    // --- маршрутизация
    const route = cfg.routes.find(([prefix]) => url.pathname === prefix || url.pathname.startsWith(prefix + '/'));
    if (!route) return sendErr(res, 404, 'not_found', `Неизвестный адрес API ${url.pathname}`);
    const [prefix, service, target] = route;
    const base = cfg.services[service];
    url.searchParams.delete('api_key');
    const upstreamPath = target + url.pathname.slice(prefix.length) + (url.searchParams.size ? `?${url.searchParams}` : '');

    const headers: http.OutgoingHttpHeaders = { ...req.headers };
    delete headers['x-api-key'];
    delete headers.host;
    headers['x-tenant-id'] = tenant;
    headers['x-request-id'] = requestId;
    headers['x-forwarded-for'] = req.socket.remoteAddress;

    const up = http.request(base + upstreamPath, { method: req.method, headers }, (ur) => {
      const h = { ...ur.headers };
      delete h['access-control-allow-origin'];
      res.writeHead(ur.statusCode || 502, h);
      ur.pipe(res); // потоково, в т.ч. Server-Sent Events
      ur.on('end', () => log('gateway', { level: 'info', requestId, tenant, method: req.method, path: url.pathname, upstream: service, status: ur.statusCode, ms: Date.now() - started }));
    });
    up.on('error', (e) => {
      log('gateway', { level: 'error', requestId, upstream: service, error: e.message });
      if (!res.headersSent) sendErr(res, 502, 'bad_gateway', `Сервис «${service}» недоступен`);
    });
    // клиент ушёл раньше ответа (например, закрыл поток событий) — рвём и запрос к сервису
    res.on('close', () => { if (!res.writableEnded) up.destroy(); });
    req.pipe(up);
  });
}

async function serveStatic(cfg: GatewayConfig, pathname: string, res: http.ServerResponse) {
  if (!cfg.staticDir) { res.writeHead(404).end('Not found'); return; }
  const root = path.resolve(cfg.staticDir);
  let file = path.resolve(root, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const st = await fs.stat(file);
    if (st.isDirectory()) file = path.join(file, 'index.html');
  } catch { file = path.join(root, 'index.html'); } // SPA
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' }).end(data);
  } catch { res.writeHead(404).end('Not found'); }
}
