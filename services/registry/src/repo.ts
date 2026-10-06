/**
 * Хранилище реестра. Интерфейс RegistryRepo реализован дважды: в памяти
 * (тесты, работа без СУБД — STORAGE=memory) и в PostgreSQL/PostGIS (pg-repo.ts).
 * Обе реализации ведут себя одинаково — это проверяют общие тесты.
 *
 * Проверка входных данных — в validate.ts (до вызова хранилища); состояние на
 * момент считается только функцией stateAt из @def-ops/core.
 */
import type { Entity, EntityType, Fact } from '@def-ops/core';
import { stateAt, toTime } from '@def-ops/core';
import { bboxIntersects, geometryBBox, type BBox } from './validate';

export class ConflictError extends Error {
  constructor(public current: string) { super(`Объект изменён другим пользователем (текущая отметка изменения ${current})`); }
}

export interface EntityQuery {
  /** Поиск по наименованию, краткому обозначению и номеру (без учёта регистра). */
  q?: string;
  type?: string;
  side?: string;
  limit: number;
  /** Вместе с at: только объекты, чьё положение на момент at пересекает прямоугольник. */
  bbox?: BBox;
  at?: string;
}

export interface RegistryRepo {
  ready(): Promise<boolean>;
  close(): Promise<void>;

  /** Записи типов организации (собственные типы и добавленные к встроенным поля). */
  typeRows(tenant: string): Promise<EntityType[]>;
  putTypeRow(tenant: string, row: EntityType): Promise<void>;

  listEntities(tenant: string, q: EntityQuery): Promise<Entity[]>;
  getEntity(tenant: string, id: string): Promise<Entity | null>;
  /** Объекты по списку id (несуществующие пропускаются; порядок не гарантируется). */
  getEntities(tenant: string, ids: string[]): Promise<Entity[]>;
  createEntity(tenant: string, e: Entity): Promise<Entity>;
  /** Заменить объект; expectedUpdatedAt — оптимистичная блокировка (ConflictError). null — объекта нет. */
  updateEntity(tenant: string, e: Entity, expectedUpdatedAt?: string): Promise<Entity | null>;
  /** Удалить объект вместе с его фактами. */
  deleteEntity(tenant: string, id: string): Promise<boolean>;

  /** Факты объектов, по возрастанию validFrom (затем createdAt, id). */
  listFacts(tenant: string, entityIds: string[]): Promise<Fact[]>;
  getFact(tenant: string, entityId: string, factId: string): Promise<Fact | null>;
  addFact(tenant: string, f: Fact): Promise<Fact>;
  updateFact(tenant: string, f: Fact): Promise<Fact | null>;
  deleteFact(tenant: string, entityId: string, factId: string): Promise<boolean>;
}

/** Строка для поиска: наименование, краткое обозначение, номер — в нижнем регистре. */
export function searchText(e: Entity): string {
  return [e.name, e.shortName ?? '', typeof e.attrs.number === 'string' || typeof e.attrs.number === 'number' ? String(e.attrs.number) : '']
    .join('\n').toLowerCase();
}

/** Порядок выдачи объектов: по наименованию (посимвольно), затем по id. */
export const byName = (a: Entity, b: Entity) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Порядок фактов: validFrom, затем время создания, затем id. */
export const factOrder = (a: Fact, b: Fact) =>
  toTime(a.validFrom) - toTime(b.validFrom) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const clone = <T>(v: T): T => structuredClone(v);

export class MemoryRepo implements RegistryRepo {
  private types = new Map<string, Map<string, EntityType>>();
  private entities = new Map<string, Map<string, Entity>>();
  private facts = new Map<string, Map<string, Fact>>();

  private bucket<T>(m: Map<string, Map<string, T>>, tenant: string): Map<string, T> {
    let b = m.get(tenant);
    if (!b) m.set(tenant, (b = new Map()));
    return b;
  }

  async ready() { return true; }
  async close() { /* нечего закрывать */ }

  async typeRows(tenant: string) { return [...this.bucket(this.types, tenant).values()].map(clone); }
  async putTypeRow(tenant: string, row: EntityType) { this.bucket(this.types, tenant).set(row.id, clone(row)); }

  async listEntities(tenant: string, q: EntityQuery): Promise<Entity[]> {
    const needle = q.q?.toLowerCase();
    let all = [...this.bucket(this.entities, tenant).values()].filter((e) =>
      (!q.type || e.type === q.type) && (!q.side || e.side === q.side) && (!needle || searchText(e).includes(needle)));
    if (q.bbox && q.at) {
      const facts = await this.listFacts(tenant, all.map((e) => e.id));
      const box = q.bbox, at = q.at;
      all = all.filter((e) => {
        const g = stateAt(e, facts, at).geometry;
        return !!g && bboxIntersects(geometryBBox(g), box);
      });
    }
    return all.sort(byName).slice(0, q.limit).map(clone);
  }

  async getEntity(tenant: string, id: string) {
    const e = this.bucket(this.entities, tenant).get(id);
    return e ? clone(e) : null;
  }

  async getEntities(tenant: string, ids: string[]) {
    const b = this.bucket(this.entities, tenant);
    return [...new Set(ids)].map((id) => b.get(id)).filter((e): e is Entity => !!e).map(clone);
  }

  async createEntity(tenant: string, e: Entity) {
    this.bucket(this.entities, tenant).set(e.id, clone(e));
    return clone(e);
  }

  async updateEntity(tenant: string, e: Entity, expectedUpdatedAt?: string) {
    const b = this.bucket(this.entities, tenant);
    const cur = b.get(e.id);
    if (!cur) return null;
    if (expectedUpdatedAt && toTime(expectedUpdatedAt) !== toTime(cur.updatedAt!)) throw new ConflictError(cur.updatedAt!);
    b.set(e.id, clone(e));
    return clone(e);
  }

  async deleteEntity(tenant: string, id: string) {
    const fb = this.bucket(this.facts, tenant);
    for (const [fid, f] of fb) if (f.entityId === id) fb.delete(fid);
    return this.bucket(this.entities, tenant).delete(id);
  }

  async listFacts(tenant: string, entityIds: string[]) {
    const ids = new Set(entityIds);
    return [...this.bucket(this.facts, tenant).values()].filter((f) => ids.has(f.entityId)).sort(factOrder).map(clone);
  }

  async getFact(tenant: string, entityId: string, factId: string) {
    const f = this.bucket(this.facts, tenant).get(factId);
    return f && f.entityId === entityId ? clone(f) : null;
  }

  async addFact(tenant: string, f: Fact) {
    this.bucket(this.facts, tenant).set(f.id, clone(f));
    return clone(f);
  }

  async updateFact(tenant: string, f: Fact) {
    const b = this.bucket(this.facts, tenant);
    const cur = b.get(f.id);
    if (!cur || cur.entityId !== f.entityId) return null;
    b.set(f.id, clone(f));
    return clone(f);
  }

  async deleteFact(tenant: string, entityId: string, factId: string) {
    const b = this.bucket(this.facts, tenant);
    const cur = b.get(factId);
    if (!cur || cur.entityId !== entityId) return false;
    return b.delete(factId);
  }
}
