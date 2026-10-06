/**
 * Хранилище карт и заданий в PostgreSQL + PostGIS (схема cartography; имя схемы
 * задаётся — тесты работают во временной схеме). У каждой таблицы — tenant.
 */
import type { LngLat, MapJob, MapSource } from '@def-ops/core';
import { createPool, dropSchema, migrate, waitForDb, type Pool } from '@def-ops/db';
import { byName, newestFirst, type MapRepo } from './repo';
import { migrations } from './migrations';

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Недопустимое имя схемы: ${s}`);
  return s;
};

/** Кольцо границы → GeoJSON-многоугольник (замкнутый). */
const ringGeoJSON = (ring?: LngLat[] | null) =>
  ring && ring.length >= 3 ? JSON.stringify({ type: 'Polygon', coordinates: [[...ring, ring[0]]] }) : null;

export interface PgRepoOptions {
  url?: string;
  schema?: string;
  pool?: Pool;
}

export class PgRepo implements MapRepo {
  readonly pool: Pool;
  readonly schema: string;
  private own: boolean;

  constructor(o: PgRepoOptions = {}) {
    this.schema = ident(o.schema ?? 'cartography');
    this.own = !o.pool;
    this.pool = o.pool ?? createPool(o.url);
  }

  /** Дождаться СУБД и накатить миграции. */
  async init(timeoutMs?: number): Promise<this> {
    await waitForDb(this.pool, timeoutMs);
    await migrate(this.pool, this.schema, migrations);
    return this;
  }

  /** Удалить схему (для тестов). */
  async drop() { await dropSchema(this.pool, this.schema); }

  async ready() {
    try { await this.pool.query('select 1'); return true; } catch { return false; }
  }

  async close() { if (this.own) await this.pool.end(); }

  private get s() { return this.schema; }

  /* ------------------------------------ карты ------------------------------------ */
  async listMaps(tenant: string): Promise<MapSource[]> {
    const r = await this.pool.query(`select doc from ${this.s}.maps where tenant = $1`, [tenant]);
    return r.rows.map((x) => x.doc as MapSource).sort(byName);
  }

  async getMap(tenant: string, id: string): Promise<MapSource | null> {
    const r = await this.pool.query(`select doc from ${this.s}.maps where tenant = $1 and id = $2`, [tenant, id]);
    return r.rows[0]?.doc ?? null;
  }

  private mapParams(tenant: string, m: MapSource) {
    const [w, s, e, n] = m.bounds;
    return [tenant, m.id, m.name, m.kind, JSON.stringify(m), w, s, e, n, ringGeoJSON(m.coverage), m.createdAt, m.updatedAt];
  }

  async createMap(tenant: string, m: MapSource): Promise<MapSource> {
    await this.pool.query(
      `insert into ${this.s}.maps (tenant, id, name, kind, doc, bounds, coverage, created_at, updated_at)
       values ($1, $2, $3, $4, $5, public.st_makeenvelope($6, $7, $8, $9, 4326),
         public.st_setsrid(public.st_geomfromgeojson($10), 4326), $11, $12)`,
      this.mapParams(tenant, m),
    );
    return m;
  }

  async updateMap(tenant: string, m: MapSource): Promise<MapSource | null> {
    const r = await this.pool.query(
      `update ${this.s}.maps set name = $3, kind = $4, doc = $5, bounds = public.st_makeenvelope($6, $7, $8, $9, 4326),
         coverage = public.st_setsrid(public.st_geomfromgeojson($10), 4326), created_at = $11, updated_at = $12
       where tenant = $1 and id = $2`,
      this.mapParams(tenant, m),
    );
    return r.rowCount ? m : null;
  }

  async deleteMap(tenant: string, id: string): Promise<boolean> {
    const r = await this.pool.query(`delete from ${this.s}.maps where tenant = $1 and id = $2`, [tenant, id]);
    return !!r.rowCount;
  }

  /* ----------------------------------- задания ----------------------------------- */
  async listJobs(tenant: string, mapId?: string): Promise<MapJob[]> {
    const r = mapId
      ? await this.pool.query(`select doc from ${this.s}.jobs where tenant = $1 and map_id = $2`, [tenant, mapId])
      : await this.pool.query(`select doc from ${this.s}.jobs where tenant = $1`, [tenant]);
    return r.rows.map((x) => x.doc as MapJob).sort(newestFirst);
  }

  async getJob(tenant: string, id: string): Promise<MapJob | null> {
    const r = await this.pool.query(`select doc from ${this.s}.jobs where tenant = $1 and id = $2`, [tenant, id]);
    return r.rows[0]?.doc ?? null;
  }

  async saveJob(tenant: string, j: MapJob): Promise<void> {
    await this.pool.query(
      `insert into ${this.s}.jobs (tenant, id, map_id, type, status, doc, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (tenant, id) do update set status = excluded.status, doc = excluded.doc, updated_at = excluded.updated_at`,
      [tenant, j.id, j.mapId, j.type, j.status, JSON.stringify(j), j.createdAt, j.updatedAt],
    );
  }

  async failInterrupted(message: string): Promise<number> {
    const now = new Date().toISOString();
    const r = await this.pool.query(
      `update ${this.s}.jobs set status = 'failed', updated_at = $2::timestamptz,
         doc = doc || jsonb_build_object('status', 'failed', 'message', $1::text, 'updatedAt', $3::text)
       where status in ('queued', 'running')`,
      [message, now, now],
    );
    return r.rowCount ?? 0;
  }
}
