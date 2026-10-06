/**
 * Хранилище реестра в PostgreSQL + PostGIS (схема registry; имя схемы задаётся —
 * тесты работают во временной схеме). Время фактов — tstzrange '[)' (граница null —
 * без ограничения), положение — geometry(Geometry, 4326), у каждой таблицы — tenant.
 */
import type { Entity, EntityType, Fact, GeoJSONGeometry } from '@def-ops/core';
import { createPool, dropSchema, migrate, waitForDb, type Pool } from '@def-ops/db';
import { ConflictError, searchText, type EntityQuery, type RegistryRepo } from './repo';
import { migrations } from './migrations';
import { normTime, pgTime } from './validate';

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Недопустимое имя схемы: ${s}`);
  return s;
};

/** Момент из СУБД (Date) → канонический вид, как у входных данных. */
const fromPg = (d: Date | null): string | null => (d ? normTime(d.toISOString()) : null);

/** Экранирование % и _ для LIKE. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => '\\' + c);

const ENTITY_COLS = `id, type, name, short_name, side, attrs, lower(existence) as ex_from, upper(existence) as ex_to,
  existence is not null as has_ex, source, created_at, updated_at`;
const FACT_COLS = `id, entity_id, lower(valid) as vf, upper(valid) as vt, attrs, public.st_asgeojson(geom, 15) as geom, source, note, created_at`;

interface EntityRow {
  id: string; type: string; name: string; short_name: string | null; side: string | null; attrs: Record<string, unknown>;
  ex_from: Date | null; ex_to: Date | null; has_ex: boolean; source: string | null; created_at: Date; updated_at: Date;
}
interface FactRow {
  id: string; entity_id: string; vf: Date; vt: Date | null; attrs: Record<string, unknown>; geom: string | null;
  source: string | null; note: string | null; created_at: Date;
}

function toEntity(r: EntityRow): Entity {
  const e: Entity = { id: r.id, type: r.type, name: r.name, attrs: r.attrs ?? {} };
  if (r.short_name !== null) e.shortName = r.short_name;
  if (r.side !== null) e.side = r.side as Entity['side'];
  if (r.has_ex) e.existence = { from: fromPg(r.ex_from), to: fromPg(r.ex_to) };
  if (r.source !== null) e.source = r.source;
  e.createdAt = r.created_at.toISOString();
  e.updatedAt = r.updated_at.toISOString();
  return e;
}

function toFact(r: FactRow): Fact {
  const f: Fact = { id: r.id, entityId: r.entity_id, validFrom: fromPg(r.vf)!, validTo: fromPg(r.vt), attrs: r.attrs ?? {} };
  if (r.geom !== null) f.geometry = JSON.parse(r.geom) as GeoJSONGeometry;
  if (r.source !== null) f.source = r.source;
  if (r.note !== null) f.note = r.note;
  f.createdAt = r.created_at.toISOString();
  return f;
}

/** Период существования: null — без ограничений (столбец null). */
const existenceParams = (e: Entity): [string | null, string | null, boolean] =>
  e.existence ? [e.existence.from ? pgTime(e.existence.from) : null, e.existence.to ? pgTime(e.existence.to) : null, true] : [null, null, false];

export interface PgRepoOptions {
  url?: string;
  schema?: string;
  pool?: Pool;
}

export class PgRepo implements RegistryRepo {
  readonly pool: Pool;
  readonly schema: string;
  private own: boolean;

  constructor(o: PgRepoOptions = {}) {
    this.schema = ident(o.schema ?? 'registry');
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

  /* ------------------------------------ типы ------------------------------------ */
  async typeRows(tenant: string): Promise<EntityType[]> {
    const r = await this.pool.query(`select id, name, description, fields, elements, builtin from ${this.s}.entity_types where tenant = $1`, [tenant]);
    return r.rows.map((x) => {
      const t: EntityType = { id: x.id, name: x.name, description: x.description, fields: x.fields };
      if (x.elements) t.elements = x.elements;
      if (x.builtin) t.builtin = true;
      return t;
    });
  }

  async putTypeRow(tenant: string, t: EntityType) {
    await this.pool.query(
      `insert into ${this.s}.entity_types (tenant, id, name, description, fields, elements, builtin) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (tenant, id) do update set name = excluded.name, description = excluded.description, fields = excluded.fields,
         elements = excluded.elements, builtin = excluded.builtin`,
      [tenant, t.id, t.name, t.description, JSON.stringify(t.fields), t.elements ? JSON.stringify(t.elements) : null, !!t.builtin],
    );
  }

  /* ---------------------------------- объекты ---------------------------------- */
  async listEntities(tenant: string, q: EntityQuery): Promise<Entity[]> {
    const p: unknown[] = [tenant];
    const arg = (v: unknown) => { p.push(v); return `$${p.length}`; };
    const where = ['e.tenant = $1'];
    if (q.type) where.push(`e.type = ${arg(q.type)}`);
    if (q.side) where.push(`e.side = ${arg(q.side)}`);
    if (q.q) where.push(`e.search like ${arg('%' + likeEscape(q.q.toLowerCase()) + '%')} escape '\\'`);
    if (q.bbox && q.at) {
      // для каждого объекта — последний действующий на момент факт с положением
      const [a, b, c, d] = q.bbox;
      where.push(`e.id in (
        select g.entity_id from (
          select distinct on (f.entity_id) f.entity_id, f.geom from ${this.s}.facts f
          where f.tenant = $1 and f.valid @> ${arg(pgTime(q.at))}::timestamptz and f.geom is not null
          order by f.entity_id, lower(f.valid) desc, f.created_at desc, f.id desc
        ) g
        where public.st_intersects(g.geom, public.st_makeenvelope(${arg(a)}, ${arg(b)}, ${arg(c)}, ${arg(d)}, 4326)))`);
    }
    const r = await this.pool.query<EntityRow>(
      `select ${ENTITY_COLS} from ${this.s}.entities e where ${where.join(' and ')} order by e.name collate "C", e.id limit ${arg(q.limit)}`, p);
    return r.rows.map(toEntity);
  }

  async getEntity(tenant: string, id: string) {
    const r = await this.pool.query<EntityRow>(`select ${ENTITY_COLS} from ${this.s}.entities where tenant = $1 and id = $2`, [tenant, id]);
    return r.rows[0] ? toEntity(r.rows[0]) : null;
  }

  async getEntities(tenant: string, ids: string[]) {
    if (!ids.length) return [];
    const r = await this.pool.query<EntityRow>(`select ${ENTITY_COLS} from ${this.s}.entities where tenant = $1 and id = any($2::uuid[])`, [tenant, [...new Set(ids)]]);
    return r.rows.map(toEntity);
  }

  async createEntity(tenant: string, e: Entity) {
    const [ef, et, hasEx] = existenceParams(e);
    const r = await this.pool.query<EntityRow>(
      `insert into ${this.s}.entities (tenant, id, type, name, short_name, side, attrs, existence, source, search, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, case when $10 then tstzrange($8::timestamptz, $9::timestamptz, '[)') end, $11, $12, $13, $14)
       returning ${ENTITY_COLS}`,
      [tenant, e.id, e.type, e.name, e.shortName ?? null, e.side ?? null, JSON.stringify(e.attrs), ef, et, hasEx, e.source ?? null, searchText(e), e.createdAt, e.updatedAt],
    );
    return toEntity(r.rows[0]);
  }

  async updateEntity(tenant: string, e: Entity, expectedUpdatedAt?: string) {
    const [ef, et, hasEx] = existenceParams(e);
    const r = await this.pool.query<EntityRow>(
      `update ${this.s}.entities set name = $3, short_name = $4, side = $5, attrs = $6,
         existence = case when $9 then tstzrange($7::timestamptz, $8::timestamptz, '[)') end, source = $10, search = $11, updated_at = $12
       where tenant = $1 and id = $2 and ($13::timestamptz is null or updated_at = $13::timestamptz)
       returning ${ENTITY_COLS}`,
      [tenant, e.id, e.name, e.shortName ?? null, e.side ?? null, JSON.stringify(e.attrs), ef, et, hasEx, e.source ?? null, searchText(e), e.updatedAt,
        expectedUpdatedAt ? pgTime(expectedUpdatedAt) : null],
    );
    if (r.rows[0]) return toEntity(r.rows[0]);
    const cur = await this.getEntity(tenant, e.id);
    if (cur && expectedUpdatedAt) throw new ConflictError(cur.updatedAt!);
    return null;
  }

  async deleteEntity(tenant: string, id: string) {
    // факты удаляются каскадом (внешний ключ on delete cascade)
    const r = await this.pool.query(`delete from ${this.s}.entities where tenant = $1 and id = $2`, [tenant, id]);
    return (r.rowCount ?? 0) > 0;
  }

  /* ----------------------------------- факты ----------------------------------- */
  async listFacts(tenant: string, entityIds: string[]) {
    if (!entityIds.length) return [];
    const r = await this.pool.query<FactRow>(
      `select ${FACT_COLS} from ${this.s}.facts where tenant = $1 and entity_id = any($2::uuid[]) order by lower(valid), created_at, id`,
      [tenant, [...new Set(entityIds)]],
    );
    return r.rows.map(toFact);
  }

  async getFact(tenant: string, entityId: string, factId: string) {
    const r = await this.pool.query<FactRow>(`select ${FACT_COLS} from ${this.s}.facts where tenant = $1 and entity_id = $2 and id = $3`, [tenant, entityId, factId]);
    return r.rows[0] ? toFact(r.rows[0]) : null;
  }

  private factParams(f: Fact) {
    return [pgTime(f.validFrom), f.validTo ? pgTime(f.validTo) : null, JSON.stringify(f.attrs), f.geometry ? JSON.stringify(f.geometry) : null, f.source ?? null, f.note ?? null];
  }

  async addFact(tenant: string, f: Fact) {
    const r = await this.pool.query<FactRow>(
      `insert into ${this.s}.facts (tenant, id, entity_id, valid, attrs, geom, source, note, created_at)
       values ($1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), $6,
               public.st_setsrid(public.st_geomfromgeojson($7::text), 4326), $8, $9, $10)
       returning ${FACT_COLS}`,
      [tenant, f.id, f.entityId, ...this.factParams(f), f.createdAt],
    );
    return toFact(r.rows[0]);
  }

  async updateFact(tenant: string, f: Fact) {
    const r = await this.pool.query<FactRow>(
      `update ${this.s}.facts set valid = tstzrange($4::timestamptz, $5::timestamptz, '[)'), attrs = $6,
         geom = public.st_setsrid(public.st_geomfromgeojson($7::text), 4326), source = $8, note = $9
       where tenant = $1 and id = $2 and entity_id = $3
       returning ${FACT_COLS}`,
      [tenant, f.id, f.entityId, ...this.factParams(f)],
    );
    return r.rows[0] ? toFact(r.rows[0]) : null;
  }

  async deleteFact(tenant: string, entityId: string, factId: string) {
    const r = await this.pool.query(`delete from ${this.s}.facts where tenant = $1 and entity_id = $2 and id = $3`, [tenant, entityId, factId]);
    return (r.rowCount ?? 0) > 0;
  }
}
