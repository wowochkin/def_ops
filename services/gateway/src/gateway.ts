/**
 * API-шлюз — единственная точка входа извне.
 *  - Аутентификация: X-Api-Key (или ?api_key= для EventSource) → организация.
 *    Ключи задаются переменной API_KEYS="ключ:организация,…". При AUTH=open
 *    (разработка) ключ не обязателен, организация — из X-Tenant-Id или default.
 *  - Маршрутизация по префиксу к внутренним сервисам (таблица ROUTES).
 *  - Входящий X-Tenant-Id от клиента НЕ доверяется — шлюз выставляет его сам.
 *  - Отдаёт собранный редактор (STATIC_DIR) — фронтенд и API на одном адресе.
 *  - /llm/… → локальная языковая модель (LLM_URL, LM Studio): /llm/v1/… → <LLM_URL origin>/v1/… — редактору не нужен
 *    CORS (так же, как в разработке через vite).
 *  - Тела запросов и ответов идут потоком, без буферизации и перекодирования:
 *    тайлы, архивы карт, загрузка сканов в сотни мегабайт, Server-Sent Events.
 *    Заголовки (Content-Type, Cache-Control, ETag, If-None-Match → 304) — как есть.
 *  - Сервису передаётся X-Forwarded-Prefix — часть пути, которую шлюз снял
 *    (/api для /api/cartography → /cartography): так сервис строит адреса для клиента.
 *  - Настольное приложение (DOWNLOADS_DIR): POST /api/save?name=… — файл игры (журнал, разбор, запись) в папку
 *    «Загрузки» без окна выбора; только со своего окна (Host — этот компьютер, Origin — адрес окна приложения;
 *    защита от DNS rebinding), только .md / .pdf / .json, имя занято — «имя (2)».
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
  /** Языковая модель для /llm/… (OpenAI-совместимый сервер, например http://localhost:1234/v1). */
  llmUrl?: string;
  corsOrigin: string;
  /** Файл состояния голосового сервиса (state.json) для GET /api/voice; без него — всегда {"state":"unsupported"}. */
  voiceState?: string;
  /** Предел времени на запрос целиком, мс (долгая загрузка скана; 0 — без предела). По умолчанию 1 ч. */
  requestTimeoutMs?: number;
  /** Папка «Загрузки» для POST /api/save (только настольное приложение; нет — адреса нет). */
  downloadsDir?: string;
  /** Разработка: сохранять может и окно vite (:5173), которое проводит /api на шлюз. */
  downloadsDev?: boolean;
  /**
   * Настольное приложение: шлюз открыт (auth 'open') на постоянном порту 127.0.0.1, и закрывать его нечем, кроме
   * проверки, что запрос пришёл от своего окна. Все запросы: Host — этот компьютер и порт шлюза (защита от DNS rebinding);
   * Origin, если есть, — адрес окна; изменяющим методам Origin обязателен. Окно разработки (:5173) — с downloadsDev.
   */
  localOnly?: boolean;
}

/** Что можно сохранить в «Загрузки»: файлы игры. */
const SAVE_EXT = new Set(['.md', '.pdf', '.json']);
const SAVE_MAX = 50 * 1024 * 1024;
/** Имя в «Загрузках» — не длиннее (байт UTF-8; предел файловых систем — 255, запас на « (2)»). */
const NAME_MAX_BYTES = 240;
/** Только этот компьютер: имя в Host — из этого списка (страница после DNS rebinding приходит со своим именем). */
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
/** Окно разработки (vite) проводит /api на шлюз — только при флаге разработки. */
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/**
 * Имя файла в «Загрузки»: без пути и с расширением файла игры (иначе null); управляющие и запрещённые в Windows знаки
 * заменены «_», длина — в байтах UTF-8 (длинное обрезается, расширение остаётся).
 */
export function saveName(raw: string): string | null {
  const name = raw.trim();
  const ext = path.extname(name).toLowerCase();
  if (!name || /[\\/]/.test(name) || name.startsWith('.') || name.includes('..') || !SAVE_EXT.has(ext)) return null;
  // знаки направления письма (U+202A–202E, U+2066–2069) убираются: имя на экране не должно обманывать
  let stem = name.slice(0, name.length - ext.length).replace(/[\u202a-\u202e\u2066-\u2069]/g, '').replace(/[\u0000-\u001f\u007f:<>|?*"]/g, '_').trim();
  if (!stem) return null;
  while (Buffer.byteLength(stem + ext) > NAME_MAX_BYTES) stem = [...stem].slice(0, -1).join('');
  return stem + ext;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Host запроса — этот компьютер и порт, на котором принят запрос. */
function localHost(req: http.IncomingMessage): boolean {
  const port = req.socket.localPort;
  const host = req.headers.host ?? '';
  return LOCAL_HOSTS.some((h) => host === `${h}:${port}`);
}

/** Origin — адрес окна приложения (шлюз этого компьютера; при разработке — ещё vite :5173). */
function windowOrigin(req: http.IncomingMessage, origin: string, dev: boolean): boolean {
  const port = req.socket.localPort;
  return LOCAL_HOSTS.some((h) => origin === `http://${h}:${port}`) || (dev && DEV_ORIGINS.includes(origin));
}

/**
 * Запрос со своего окна: Host — этот компьютер и порт шлюза, Origin есть и совпадает с адресом окна приложения.
 * Без Origin и с чужим — нет.
 */
function ownWindow(req: http.IncomingMessage, dev: boolean): boolean {
  const origin = req.headers.origin;
  return localHost(req) && !!origin && windowOrigin(req, origin, dev);
}

/**
 * Защита настольного режима для любого запроса шлюза: причина отказа или null.
 *  - Host не из списка → отказ (страница после DNS rebinding приходит со своим именем);
 *  - Origin есть и не окно приложения → отказ, в том числе для чтения: чужая страница может ходить на 127.0.0.1:порт
 *    напрямую, и без этого «Access-Control-Allow-Origin: *» отдал бы ей ответ;
 *  - POST/PUT/PATCH/DELETE без Origin → отказ (окно браузера Origin на таких запросах шлёт всегда).
 * GET своего окна Origin не шлёт — это не отказ.
 */
export function localGuard(req: http.IncomingMessage, dev: boolean): string | null {
  if (!localHost(req)) return 'Host запроса — не этот компьютер';
  const origin = req.headers.origin;
  if (origin !== undefined) return windowOrigin(req, origin, dev) ? null : 'Origin запроса — не окно приложения';
  if (MUTATING.has(req.method ?? '')) return 'изменяющему запросу нужен Origin окна приложения';
  return null;
}

/** Файл — в «Загрузки»: своё окно, имя без пути, расширение файла игры; занято — «имя (2).md». */
async function saveDownload(dir: string, dev: boolean, url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
  const send = (status: number, body: object) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  if (req.method !== 'POST') return send(405, { error: { code: 'method', message: 'только POST' } });
  if (!ownWindow(req, dev)) return send(403, { error: { code: 'forbidden', message: 'сохранять может только окно приложения' } });
  const name = saveName(url.searchParams.get('name') ?? '');
  if (!name) return send(400, { error: { code: 'bad_name', message: 'имя файла: без пути, .md, .pdf или .json' } });
  const ext = path.extname(name);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > SAVE_MAX) return send(413, { error: { code: 'too_large', message: 'файл больше 50 МБ' } });
    chunks.push(c as Buffer);
  }
  await fs.mkdir(dir, { recursive: true });
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const file = path.join(dir, n === 1 ? name : `${stem} (${n})${ext}`);
    try {
      await fs.writeFile(file, Buffer.concat(chunks), { flag: 'wx' });
      return send(200, { path: file });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') return send(500, { error: { code: 'write', message: (e as Error).message } });
    }
  }
  return send(409, { error: { code: 'exists', message: 'слишком много файлов с таким именем' } });
}

/** Снятая шлюзом часть пути: префикс API без префикса на стороне сервиса. */
export function forwardedPrefix(prefix: string, target: string): string {
  return target && prefix.endsWith(target) ? prefix.slice(0, -target.length) : prefix;
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

  const guarded = cfg.auth === 'open' && !!cfg.localOnly;
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url || '/', 'http://gw');
    if (guarded) {
      const why = localGuard(req, !!cfg.downloadsDev);
      if (why) return sendErr(res, 403, 'forbidden', `Запрос не из окна приложения: ${why}`);
    }
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Access-Control-Allow-Origin', cfg.corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match, If-None-Match, X-Api-Key, X-Request-Id, X-Source-System, X-Tenant-Id');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Request-Id, Content-Disposition');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

    if (cfg.llmUrl && url.pathname.startsWith('/llm/')) return proxyLlm(cfg.llmUrl, url, req, res);
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

    // --- состояние голосового сервиса (файл, который пишет запускающий процесс); нет файла — «off»; шлюз не
    // настольного приложения (файла состояния нет вовсе) — «unsupported»: голоса в этой версии нет; ключ не нужен
    if (url.pathname === '/api/voice') {
      let body = '{"state":"unsupported"}';
      if (cfg.voiceState) {
        body = '{"state":"off"}';
        try { const t = await fs.readFile(cfg.voiceState, 'utf8'); JSON.parse(t); body = t; } catch { /* нет файла или он битый */ }
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(body);
      return;
    }

    // --- настольное приложение: файл игры — в «Загрузки» (окно приложения сохраняет без окна выбора)
    if (url.pathname === '/api/save' && cfg.downloadsDir) return saveDownload(cfg.downloadsDir, !!cfg.downloadsDev, url, req, res);

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
    headers['x-forwarded-prefix'] = forwardedPrefix(prefix, target);

    const up = http.request(base + upstreamPath, { method: req.method, headers }, (ur) => {
      const h = { ...ur.headers };
      delete h['access-control-allow-origin'];
      res.writeHead(ur.statusCode || 502, h);
      ur.pipe(res); // потоково, в т.ч. Server-Sent Events и двоичные тела
      ur.on('error', () => res.destroy());
      ur.on('end', () => log('gateway', { level: 'info', requestId, tenant, method: req.method, path: url.pathname, upstream: service, status: ur.statusCode, ms: Date.now() - started }));
    });
    up.on('error', (e) => {
      log('gateway', { level: 'error', requestId, upstream: service, error: e.message });
      if (!res.headersSent) sendErr(res, 502, 'bad_gateway', `Сервис «${service}» недоступен`);
      else res.destroy(); // ответ уже начат — оборвать, чтобы клиент не ждал и не принял обрезок за целое
    });
    // клиент ушёл раньше ответа (например, закрыл поток событий) — рвём и запрос к сервису
    res.on('close', () => { if (!res.writableEnded) up.destroy(); });
    req.pipe(up);
  });
  // загрузка большого скана по медленной сети может идти дольше стандартных 5 минут
  server.requestTimeout = cfg.requestTimeoutMs ?? 3_600_000;
  return server;
}

/** /llm/… → языковая модель: путь без /llm, тело и ответ — потоком (ответы модели идут SSE). */
function proxyLlm(llmUrl: string, url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
  const target = new URL(url.pathname.slice('/llm'.length) + url.search, new URL(llmUrl).origin);
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
  const up = http.request(target, { method: req.method, headers }, (ur) => {
    res.writeHead(ur.statusCode || 502, ur.headers);
    ur.pipe(res);
  });
  up.on('error', (e) => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ error: { code: 'llm_unavailable', message: `Языковая модель недоступна (${target.origin}): ${e.message}` } })); else res.destroy(); });
  res.on('close', () => { if (!res.writableEnded) up.destroy(); });
  req.pipe(up);
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
