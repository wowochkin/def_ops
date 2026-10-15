/**
 * Запросы службы к внешним источникам (Overpass OHM, шрифты и значки, тайлы XYZ).
 *
 * За прокси (HTTPS_PROXY / HTTP_PROXY, исключения — NO_PROXY) встроенный fetch Node не ходит:
 * тогда запросы идут через fetch undici с EnvHttpProxyAgent (своя пара fetch и диспетчер —
 * без смешения версий undici со встроенной в Node). Без прокси — встроенный fetch.
 */
import { EnvHttpProxyAgent, fetch as undiciFetch } from 'undici';

type Env = Record<string, string | undefined>;

/** Прокси из окружения (HTTPS_PROXY, затем HTTP_PROXY; в любом регистре); нет — null. */
export function proxyFrom(env: Env = process.env): string | null {
  return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || null;
}

/** Прокси без учётных данных — для сообщений. */
function proxyLabel(p: string): string {
  try { return new URL(p).host || p; } catch { return p.replace(/^[^@]*@/, ''); }
}

export interface HttpClient {
  fetch: typeof fetch;
  /** Прокси (для сообщений об ошибках), null — напрямую. */
  proxy: string | null;
}

/** Клиент по окружению: есть прокси — undici с EnvHttpProxyAgent, иначе встроенный fetch. */
export function httpClient(env: Env = process.env): HttpClient {
  const proxy = proxyFrom(env);
  if (!proxy) return { fetch: (input, init) => fetch(input, init), proxy: null };
  const dispatcher = new EnvHttpProxyAgent({
    httpProxy: env.HTTP_PROXY || env.http_proxy || undefined,
    httpsProxy: env.HTTPS_PROXY || env.https_proxy || undefined,
    noProxy: env.NO_PROXY ?? env.no_proxy ?? '',
  });
  const f = (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher }) as unknown as Promise<Response>;
  return { fetch: f as typeof fetch, proxy };
}

/** Клиент службы (окружение процесса). */
export const http = httpClient();

/** Сообщение о сетевой ошибке: текст, код причины (ECONNREFUSED, ENOTFOUND…), прокси, если он задан. */
export function netMessage(e: unknown, proxy: string | null = http.proxy): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  const code = err?.cause?.code ?? (err as { code?: string })?.code;
  let s = err?.message || String(e);
  if (code && !s.includes(code)) s += ` (${code})`;
  else if (!code && err?.cause?.message && !s.includes(err.cause.message)) s += ` (${err.cause.message})`;
  if (proxy) s += `; через прокси ${proxyLabel(proxy)}`;
  return s;
}
