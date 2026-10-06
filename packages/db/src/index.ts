/**
 * PostgreSQL для сервисов платформы.
 *
 * Каждый сервис владеет своей схемой в общей базе (documents, registry, …) и сам
 * накатывает свои миграции — таблица <схема>.migrations. Другие сервисы в чужие
 * схемы не ходят: данные получают через API владельца.
 *
 * Подключение — переменная DATABASE_URL (postgres://user:pass@host:5432/db).
 */
import pg from 'pg';

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export interface Migration {
  /** Порядковый номер; применённые миграции не меняются — только новые. */
  id: number;
  name: string;
  sql: string;
}

export function createPool(url = process.env.DATABASE_URL, max = Number(process.env.DB_POOL_MAX ?? 10)): Pool {
  if (!url) throw new Error('Не задан DATABASE_URL');
  const pool = new pg.Pool({ connectionString: url, max });
  // ошибки простаивающих соединений не должны ронять сервис
  pool.on('error', () => undefined);
  return pool;
}

/** Ждать, пока база примет подключение (контейнер СУБД может стартовать дольше сервиса). */
export async function waitForDb(pool: Pool, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { await pool.query('select 1'); return; } catch (e) {
      if (Date.now() > until) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Выполнить fn в транзакции; при ошибке — откат. */
export async function tx<T>(pool: Pool, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Недопустимое имя схемы: ${s}`);
  return s;
};

/**
 * Накатить миграции схемы. Безопасно при одновременном старте нескольких
 * экземпляров сервиса (рекомендательная блокировка на время миграции).
 * Внутри SQL миграции схема доступна как search_path.
 */
export async function migrate(pool: Pool, schema: string, migrations: Migration[]): Promise<number[]> {
  const s = ident(schema);
  return tx(pool, async (c) => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`migrate:${s}`]);
    await c.query(`create schema if not exists ${s}`);
    await c.query(`create table if not exists ${s}.migrations (id int primary key, name text not null, applied_at timestamptz not null default now())`);
    const done = new Set((await c.query(`select id from ${s}.migrations`)).rows.map((r) => r.id as number));
    const applied: number[] = [];
    for (const m of [...migrations].sort((a, b) => a.id - b.id)) {
      if (done.has(m.id)) continue;
      await c.query(`set local search_path to ${s}, public`);
      await c.query(m.sql);
      await c.query(`insert into ${s}.migrations (id, name) values ($1, $2)`, [m.id, m.name]);
      applied.push(m.id);
    }
    return applied;
  });
}

/** Удалить схему целиком — для тестов. */
export async function dropSchema(pool: Pool, schema: string): Promise<void> {
  await pool.query(`drop schema if exists ${ident(schema)} cascade`);
}
