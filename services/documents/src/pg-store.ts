/**
 * Хранилище документов в PostgreSQL (схема documents).
 * Документ хранится целиком (jsonb); ревизии — отдельной таблицей, последние KEEP штук.
 * Оптимистичная блокировка — по номеру ревизии внутри транзакции (select … for update).
 */
import type { MapDocument } from '@def-ops/core';
import { migrate, tx, type Migration, type Pool } from '@def-ops/db';
import { ConflictError, newDocId, type DocumentMeta, type DocumentStore } from './store';

export const DOCUMENTS_MIGRATIONS: Migration[] = [
  {
    id: 1, name: 'documents',
    sql: `
      create table documents (
        tenant text not null,
        id text not null,
        name text not null,
        revision int not null,
        data jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (tenant, id)
      );
      create index documents_updated on documents (tenant, updated_at desc);
      create table document_revisions (
        tenant text not null,
        id text not null,
        revision int not null,
        data jsonb not null,
        updated_at timestamptz not null default now(),
        primary key (tenant, id, revision),
        foreign key (tenant, id) references documents (tenant, id) on delete cascade
      );`,
  },
];

type Row = { id: string; name: string; revision: number; data: MapDocument; created_at: Date; updated_at: Date };

const stamp = (r: Row): MapDocument & { createdAt: string; updatedAt: string } => ({
  ...r.data, id: r.id, revision: r.revision, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});

export class PgStore implements DocumentStore {
  private s: string;
  constructor(private pool: Pool, schema = 'documents', private keep = 50) {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error(`Недопустимое имя схемы: ${schema}`);
    this.s = schema;
  }

  /** Создать/обновить таблицы. Вызывается при старте сервиса. */
  async init(): Promise<void> {
    await migrate(this.pool, this.s, DOCUMENTS_MIGRATIONS);
  }

  async ready() {
    try { await this.pool.query('select 1'); return true; } catch { return false; }
  }

  async list(t: string): Promise<DocumentMeta[]> {
    const { rows } = await this.pool.query(
      `select id, name, revision, created_at, updated_at,
              coalesce(jsonb_array_length(data->'layers'), 0) as layers,
              coalesce(jsonb_array_length(data->'features'), 0) as features
         from ${this.s}.documents where tenant = $1 order by updated_at desc`, [t]);
    return rows.map((r) => ({
      id: r.id, name: r.name, revision: r.revision, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
      layers: Number(r.layers), features: Number(r.features),
    }));
  }

  async get(t: string, id: string) {
    const { rows } = await this.pool.query<Row>(`select * from ${this.s}.documents where tenant = $1 and id = $2`, [t, id]);
    return rows[0] ? stamp(rows[0]) : null;
  }

  async revisions(t: string, id: string) {
    const { rows } = await this.pool.query(
      `select revision, updated_at from ${this.s}.document_revisions where tenant = $1 and id = $2 order by revision`, [t, id]);
    return rows.map((r) => ({ revision: r.revision as number, updatedAt: (r.updated_at as Date).toISOString() }));
  }

  async getRevision(t: string, id: string, revision: number) {
    const { rows } = await this.pool.query(
      `select r.revision, r.data, r.updated_at, d.created_at, d.name, d.id
         from ${this.s}.document_revisions r join ${this.s}.documents d using (tenant, id)
        where r.tenant = $1 and r.id = $2 and r.revision = $3`, [t, id, revision]);
    return rows[0] ? stamp(rows[0] as Row) : null;
  }

  save(t: string, doc: MapDocument, expected?: number): Promise<MapDocument> {
    const id = doc.id ?? newDocId();
    return tx(this.pool, async (c) => {
      const cur = (await c.query(`select revision, created_at from ${this.s}.documents where tenant = $1 and id = $2 for update`, [t, id])).rows[0];
      const curRev: number = cur?.revision ?? 0;
      if (expected !== undefined && curRev !== expected) throw new ConflictError(curRev);
      const revision = curRev + 1;
      // в теле документа служебные поля не храним — они в столбцах
      const { id: _i, revision: _r, createdAt: _c, updatedAt: _u, ...body } = doc as MapDocument & { createdAt?: string; updatedAt?: string };
      const data = JSON.stringify(body);
      const { rows } = await c.query<Row>(
        `insert into ${this.s}.documents (tenant, id, name, revision, data) values ($1, $2, $3, $4, $5)
           on conflict (tenant, id) do update set name = excluded.name, revision = excluded.revision, data = excluded.data, updated_at = now()
         returning *`, [t, id, doc.name ?? '', revision, data]);
      await c.query(`insert into ${this.s}.document_revisions (tenant, id, revision, data) values ($1, $2, $3, $4)`, [t, id, revision, data]);
      await c.query(`delete from ${this.s}.document_revisions where tenant = $1 and id = $2 and revision <= $3`, [t, id, revision - this.keep]);
      return stamp(rows[0]);
    });
  }

  async delete(t: string, id: string) {
    const r = await this.pool.query(`delete from ${this.s}.documents where tenant = $1 and id = $2`, [t, id]);
    return (r.rowCount ?? 0) > 0;
  }
}
