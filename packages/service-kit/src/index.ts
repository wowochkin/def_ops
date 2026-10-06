/**
 * Каркас микросервиса на node:http без внешних зависимостей.
 *
 * Соглашения платформы:
 *  - каждый сервис отдаёт GET /health (жив) и GET /ready (готов принимать запросы);
 *  - организация (tenant) приходит в заголовке X-Tenant-Id — его ставит шлюз
 *    после проверки API-ключа; сервисы доступны только во внутренней сети;
 *  - сквозной X-Request-Id пробрасывается во все межсервисные вызовы;
 *  - ошибки — JSON { error: { code, message } } с HTTP-статусом;
 *  - журналы — одна JSON-строка на запрос (stdout).
 */
import http from 'node:http';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  tenant: string;
  requestId: string;
  /** Тело запроса, разобранное как JSON (лениво). */
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

/** Ответ с явным статусом, типом и заголовками. */
export class Reply {
  constructor(public status: number, public body: unknown, public headers: Record<string, string> = {}) {}
}
export const reply = (status: number, body: unknown, headers?: Record<string, string>) => new Reply(status, body, headers);

interface Route { method: string; re: RegExp; keys: string[]; handler: Handler }

export class Router {
  private routes: Route[] = [];
  add(method: string, pattern: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)(\.[a-z]+)?/g, (_, k: string, ext?: string) => {
      keys.push(k);
      return '/([^/]+?)' + (ext ? '\\' + ext : '');
    }) + '/?$');
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p: string, h: Handler) { return this.add('GET', p, h); }
  post(p: string, h: Handler) { return this.add('POST', p, h); }
  put(p: string, h: Handler) { return this.add('PUT', p, h); }
  patch(p: string, h: Handler) { return this.add('PATCH', p, h); }
  delete(p: string, h: Handler) { return this.add('DELETE', p, h); }
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | 'method' | null {
    let methodMismatch = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      if (r.method !== method) { methodMismatch = true; continue; }
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
    return methodMismatch ? 'method' : null;
  }
}

export interface ServiceOptions {
  name: string;
  version?: string;
  port: number;
  router: Router;
  /** Максимальный размер тела запроса, байт (по умолчанию 25 МБ — документы с растровыми подложками). */
  bodyLimit?: number;
  /** Проверка готовности (подключение к хранилищу и т.п.). */
  ready?: () => Promise<boolean> | boolean;
  /** Разрешённые источники CORS (для прямых вызовов из браузера; обычно CORS делает шлюз). */
  cors?: string | null;
}

export function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'payload_too_large', `Тело запроса больше ${limit} байт`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function log(service: string, rec: Record<string, unknown>) {
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), service, ...rec }) + '\n');
}

export function createService(o: ServiceOptions) {
  const limit = o.bodyLimit ?? 25 * 1024 * 1024;
  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url || '/', 'http://local');
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    const tenant = sanitizeTenant(req.headers['x-tenant-id'] as string) || 'default';
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Service', o.name);
    if (o.cors) {
      res.setHeader('Access-Control-Allow-Origin', o.cors);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match, X-Api-Key, X-Request-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Request-Id');
      if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    }
    let status = 500;
    try {
      if (url.pathname === '/health') { status = 200; return send(res, reply(200, { status: 'ok', service: o.name, version: o.version ?? '0' })); }
      if (url.pathname === '/ready') {
        const ok = o.ready ? await o.ready() : true;
        status = ok ? 200 : 503;
        return send(res, reply(status, { ready: ok, service: o.name }));
      }
      const m = o.router.match(req.method || 'GET', url.pathname);
      if (m === 'method') throw new HttpError(405, 'method_not_allowed', 'Метод не поддерживается');
      if (!m) throw new HttpError(404, 'not_found', `Нет маршрута ${req.method} ${url.pathname}`);
      let body: Buffer | null = null;
      const raw = async () => (body ??= await readBody(req, limit));
      const ctx: Ctx = {
        req, res, params: m.params, query: url.searchParams, tenant, requestId,
        text: async () => (await raw()).toString('utf8'),
        json: async <T,>() => {
          const t = (await raw()).toString('utf8');
          try { return JSON.parse(t || 'null') as T; } catch { throw new HttpError(400, 'bad_json', 'Тело запроса — некорректный JSON'); }
        },
      };
      const out = await m.handler(ctx);
      if (res.writableEnded || res.headersSent) { status = res.statusCode; return; } // обработчик ответил сам (поток)
      const r = out instanceof Reply ? out : reply(out === undefined ? 204 : 200, out);
      status = r.status;
      send(res, r);
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, 'internal', (e as Error).message || 'Внутренняя ошибка');
      status = err.status;
      if (status >= 500) log(o.name, { level: 'error', requestId, error: String((e as Error)?.stack || e) });
      if (!res.headersSent) send(res, reply(err.status, { error: { code: err.code, message: err.message } }));
    } finally {
      if (url.pathname !== '/health' && url.pathname !== '/ready')
        log(o.name, { level: 'info', requestId, tenant, method: req.method, path: url.pathname, status, ms: Date.now() - started });
    }
  });
  return {
    server,
    listen(): Promise<number> {
      return new Promise((resolve) => server.listen(o.port, () => {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : o.port;
        log(o.name, { level: 'info', msg: `listening on :${port}` });
        resolve(port);
      }));
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

function send(res: http.ServerResponse, r: Reply) {
  for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  if (r.body === undefined || r.body === null || r.status === 204) { res.writeHead(r.status).end(); return; }
  if (typeof r.body === 'string' || Buffer.isBuffer(r.body)) {
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.writeHead(r.status).end(r.body);
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.writeHead(r.status).end(JSON.stringify(r.body));
}

/** Идентификатор организации: латиница, цифры, - и _, до 64 символов. */
export function sanitizeTenant(t?: string | null): string | null {
  if (!t) return null;
  return /^[a-zA-Z0-9_-]{1,64}$/.test(t) ? t : null;
}

/** Клиент для межсервисных вызовов с пробросом организации и X-Request-Id. */
export function serviceClient(baseUrl: string, ctx?: Pick<Ctx, 'tenant' | 'requestId'>) {
  return async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(baseUrl.replace(/\/$/, '') + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(ctx ? { 'X-Tenant-Id': ctx.tenant, 'X-Request-Id': ctx.requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) throw new HttpError(r.status, data?.error?.code ?? 'upstream', data?.error?.message ?? `Ошибка вышестоящего сервиса ${r.status}`);
    return data as T;
  };
}

export function env(name: string, def: string): string {
  return process.env[name] ?? def;
}

/** Корректное завершение по SIGTERM/SIGINT (Kubernetes, docker stop). */
export function onShutdown(fn: () => Promise<void>) {
  const h = async () => { await fn(); process.exit(0); };
  process.once('SIGTERM', h);
  process.once('SIGINT', h);
}
