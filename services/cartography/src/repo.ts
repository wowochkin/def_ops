/**
 * Хранилище метаданных карт и заданий. Интерфейс MapRepo реализован дважды: в
 * памяти (тесты, работа без СУБД — STORAGE=memory) и в PostgreSQL/PostGIS
 * (pg-repo.ts). Обе реализации ведут себя одинаково — это проверяют общие тесты.
 * Сами тайлы лежат на диске (tiles.ts), здесь — только описания.
 */
import type { MapJob, MapSource } from '@def-ops/core';

export interface MapRepo {
  ready(): Promise<boolean>;
  close(): Promise<void>;

  /** Карты организации, по названию. */
  listMaps(tenant: string): Promise<MapSource[]>;
  getMap(tenant: string, id: string): Promise<MapSource | null>;
  createMap(tenant: string, m: MapSource): Promise<MapSource>;
  /** Заменить описание карты; null — карты нет. */
  updateMap(tenant: string, m: MapSource): Promise<MapSource | null>;
  deleteMap(tenant: string, id: string): Promise<boolean>;

  /** Задания организации, новые первыми; mapId — только по одной карте. */
  listJobs(tenant: string, mapId?: string): Promise<MapJob[]>;
  getJob(tenant: string, id: string): Promise<MapJob | null>;
  /** Записать задание (создать или заменить). */
  saveJob(tenant: string, j: MapJob): Promise<void>;
  /**
   * Задания, оставшиеся «в очереди» или «выполняется» после остановки сервиса,
   * помечаются неудавшимися (задания выполняются внутри процесса). Возвращает их число.
   */
  failInterrupted(message: string): Promise<number>;
}

/** Порядок карт: по названию, затем по id. */
export const byName = (a: MapSource, b: MapSource) => a.name.localeCompare(b.name, 'ru') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Порядок заданий: новые первыми. */
export const newestFirst = (a: MapJob, b: MapJob) => b.createdAt.localeCompare(a.createdAt) || (a.id < b.id ? 1 : -1);

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryRepo implements MapRepo {
  private maps = new Map<string, Map<string, MapSource>>();
  private jobs = new Map<string, Map<string, MapJob>>();

  private bucket<T>(m: Map<string, Map<string, T>>, tenant: string): Map<string, T> {
    let b = m.get(tenant);
    if (!b) m.set(tenant, (b = new Map()));
    return b;
  }

  async ready() { return true; }
  async close() { /* нечего закрывать */ }

  async listMaps(tenant: string) { return [...this.bucket(this.maps, tenant).values()].sort(byName).map(clone); }
  async getMap(tenant: string, id: string) {
    const m = this.bucket(this.maps, tenant).get(id);
    return m ? clone(m) : null;
  }
  async createMap(tenant: string, m: MapSource) {
    this.bucket(this.maps, tenant).set(m.id, clone(m));
    return clone(m);
  }
  async updateMap(tenant: string, m: MapSource) {
    const b = this.bucket(this.maps, tenant);
    if (!b.has(m.id)) return null;
    b.set(m.id, clone(m));
    return clone(m);
  }
  async deleteMap(tenant: string, id: string) { return this.bucket(this.maps, tenant).delete(id); }

  async listJobs(tenant: string, mapId?: string) {
    return [...this.bucket(this.jobs, tenant).values()].filter((j) => !mapId || j.mapId === mapId).sort(newestFirst).map(clone);
  }
  async getJob(tenant: string, id: string) {
    const j = this.bucket(this.jobs, tenant).get(id);
    return j ? clone(j) : null;
  }
  async saveJob(tenant: string, j: MapJob) { this.bucket(this.jobs, tenant).set(j.id, clone(j)); }
  async failInterrupted(message: string) {
    let n = 0;
    const now = new Date().toISOString();
    for (const b of this.jobs.values())
      for (const j of b.values())
        if (j.status === 'queued' || j.status === 'running') { Object.assign(j, { status: 'failed', message, updatedAt: now }); n++; }
    return n;
  }
}
