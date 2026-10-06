/**
 * Хранилище документов. Интерфейс DocumentStore позволяет заменить файловое
 * хранилище на СУБД (PostgreSQL/PostGIS и т.п.) без изменения API сервиса.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MapDocument } from '@def-ops/core';

export interface DocumentMeta {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  layers: number;
  features: number;
}

export class ConflictError extends Error {
  constructor(public current: number) { super(`Документ изменён другим пользователем (текущая ревизия ${current})`); }
}

export interface DocumentStore {
  list(tenant: string): Promise<DocumentMeta[]>;
  get(tenant: string, id: string): Promise<MapDocument | null>;
  revisions(tenant: string, id: string): Promise<{ revision: number; updatedAt: string }[]>;
  getRevision(tenant: string, id: string, revision: number): Promise<MapDocument | null>;
  /** Сохранить: id назначается, если его нет; expectedRevision — оптимистичная блокировка. */
  save(tenant: string, doc: MapDocument, expectedRevision?: number): Promise<MapDocument>;
  delete(tenant: string, id: string): Promise<boolean>;
  ready(): Promise<boolean>;
}

type Stamped = MapDocument & { createdAt?: string; updatedAt?: string };

export function newDocId(): string {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function validId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

function meta(d: Stamped): DocumentMeta {
  return {
    id: d.id!, name: d.name, revision: d.revision ?? 0, createdAt: d.createdAt ?? '', updatedAt: d.updatedAt ?? '',
    layers: d.layers?.length ?? 0, features: d.features?.length ?? 0,
  };
}

/** Последовательное выполнение операций над одним документом (без гонок внутри процесса). */
class Locks {
  private chains = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(key, next.catch(() => undefined));
    return next;
  }
}

/** Хранилище в памяти — для тестов и демонстраций. */
export class MemoryStore implements DocumentStore {
  private data = new Map<string, Map<string, Stamped[]>>();
  private locks = new Locks();
  private bucket(t: string) { let b = this.data.get(t); if (!b) this.data.set(t, (b = new Map())); return b; }
  async list(t: string) { return [...this.bucket(t).values()].map((h) => meta(h[h.length - 1])); }
  async get(t: string, id: string) { const h = this.bucket(t).get(id); return h ? structuredClone(h[h.length - 1]) : null; }
  async revisions(t: string, id: string) { return (this.bucket(t).get(id) ?? []).map((d) => ({ revision: d.revision!, updatedAt: d.updatedAt! })); }
  async getRevision(t: string, id: string, r: number) { return structuredClone(this.bucket(t).get(id)?.find((d) => d.revision === r) ?? null); }
  save(t: string, doc: MapDocument, expected?: number) {
    const id = doc.id ?? newDocId();
    return this.locks.run(`${t}/${id}`, async () => {
      const h = this.bucket(t).get(id) ?? [];
      const cur = h[h.length - 1];
      if (expected !== undefined && (cur?.revision ?? 0) !== expected) throw new ConflictError(cur?.revision ?? 0);
      const now = new Date().toISOString();
      const next: Stamped = { ...structuredClone(doc), id, revision: (cur?.revision ?? 0) + 1, createdAt: cur?.createdAt ?? now, updatedAt: now };
      this.bucket(t).set(id, [...h, next].slice(-50));
      return structuredClone(next);
    });
  }
  async delete(t: string, id: string) { return this.bucket(t).delete(id); }
  async ready() { return true; }
}

/**
 * Файловое хранилище: <root>/<tenant>/<id>/current.json и revisions/<n>.json.
 * Запись атомарная (временный файл + rename). Хранится до KEEP последних ревизий.
 */
export class FileStore implements DocumentStore {
  private locks = new Locks();
  constructor(private root: string, private keep = 50) {}
  private dir(t: string, id?: string) { return id ? path.join(this.root, t, id) : path.join(this.root, t); }

  async ready() {
    try { await fs.mkdir(this.root, { recursive: true }); await fs.access(this.root); return true; } catch { return false; }
  }

  async list(t: string): Promise<DocumentMeta[]> {
    let ids: string[] = [];
    try { ids = await fs.readdir(this.dir(t)); } catch { return []; }
    const out: DocumentMeta[] = [];
    for (const id of ids) {
      const d = await this.read(path.join(this.dir(t, id), 'current.json'));
      if (d) out.push(meta(d));
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(t: string, id: string) { return this.read(path.join(this.dir(t, id), 'current.json')); }

  async revisions(t: string, id: string) {
    let files: string[] = [];
    try { files = await fs.readdir(path.join(this.dir(t, id), 'revisions')); } catch { return []; }
    const out: { revision: number; updatedAt: string }[] = [];
    for (const f of files) {
      const st = await fs.stat(path.join(this.dir(t, id), 'revisions', f));
      out.push({ revision: parseInt(f, 10), updatedAt: st.mtime.toISOString() });
    }
    return out.sort((a, b) => a.revision - b.revision);
  }

  async getRevision(t: string, id: string, r: number) { return this.read(path.join(this.dir(t, id), 'revisions', `${r}.json`)); }

  save(t: string, doc: MapDocument, expected?: number): Promise<MapDocument> {
    const id = doc.id ?? newDocId();
    return this.locks.run(`${t}/${id}`, async () => {
      const dir = this.dir(t, id);
      const cur = await this.get(t, id) as Stamped | null;
      if (expected !== undefined && (cur?.revision ?? 0) !== expected) throw new ConflictError(cur?.revision ?? 0);
      const now = new Date().toISOString();
      const next: Stamped = { ...doc, id, revision: (cur?.revision ?? 0) + 1, createdAt: cur?.createdAt ?? now, updatedAt: now };
      await fs.mkdir(path.join(dir, 'revisions'), { recursive: true });
      const body = JSON.stringify(next);
      await atomicWrite(path.join(dir, 'revisions', `${next.revision}.json`), body);
      await atomicWrite(path.join(dir, 'current.json'), body);
      // старые ревизии
      const old = next.revision! - this.keep;
      if (old > 0) await fs.rm(path.join(dir, 'revisions', `${old}.json`), { force: true });
      return next;
    });
  }

  async delete(t: string, id: string) {
    try { await fs.access(this.dir(t, id)); } catch { return false; }
    await fs.rm(this.dir(t, id), { recursive: true, force: true });
    return true;
  }

  private async read(file: string): Promise<Stamped | null> {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
  }
}

async function atomicWrite(file: string, data: string) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data, 'utf8');
  await fs.rename(tmp, file);
}
