/**
 * Клиент API платформы (через шлюз). Работает в браузере и в Node 18+.
 * Используется редактором; его же могут подключать другие модули и системы.
 */
import type { Entity, EntityState, EntityType, Fact, GeoJSONCollection, GeoJSONGeometry, Layer, MapDocument, Side, TimeInstant, TimeSpan } from '@def-ops/core';

export interface DocumentMeta {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  layers: number;
  features: number;
}

export interface DocumentEvent {
  type: 'document.created' | 'document.updated' | 'document.deleted' | 'layer.updated' | 'layer.features.replaced';
  tenant: string;
  documentId: string;
  revision?: number;
  layerId?: string;
  source?: string;
  at: string;
}

/** Событие реестра объектов (поток /registry/events). */
export interface RegistryEvent {
  type: 'entity.created' | 'entity.updated' | 'entity.deleted' | 'fact.changed';
  tenant: string;
  entityId: string;
  factId?: string;
  change?: 'created' | 'updated' | 'deleted';
  source?: string;
  at: string;
}

/** Поиск объектов реестра. bbox ([minLon, minLat, maxLon, maxLat]) — только вместе с at. */
export interface EntityQuery {
  q?: string;
  type?: string;
  side?: Side;
  at?: TimeInstant;
  bbox?: [number, number, number, number];
  limit?: number;
}

/** Новый объект реестра. */
export type EntityInput = Pick<Entity, 'type' | 'name'> & Partial<Pick<Entity, 'shortName' | 'side' | 'attrs' | 'existence' | 'source'>>;

/** Изменение объекта: attrs сливаются (null — удалить ключ), null у полей — снять значение; updatedAt — проверка, что объект не меняли. */
export interface EntityPatch {
  name?: string;
  shortName?: string | null;
  side?: Side | null;
  attrs?: Record<string, unknown>;
  existence?: TimeSpan | null;
  source?: string | null;
  updatedAt?: string;
}

/** Факт: временные характеристики и/или положение с момента validFrom. */
export interface FactInput {
  validFrom: TimeInstant;
  validTo?: TimeInstant | null;
  attrs?: Record<string, unknown>;
  geometry?: GeoJSONGeometry | null;
  source?: string | null;
  note?: string | null;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
  get isConflict() { return this.status === 409; }
}

export interface ClientOptions {
  /** Адрес шлюза с префиксом API, по умолчанию '/api'. */
  baseUrl?: string;
  apiKey?: string;
  /** Имя системы-источника изменений (попадает в события). */
  sourceSystem?: string;
  fetch?: typeof fetch;
}

export class DefOpsClient {
  private base: string;
  private f: typeof fetch;
  constructor(private o: ClientOptions = {}) {
    this.base = (o.baseUrl ?? '/api').replace(/\/$/, '');
    this.f = o.fetch ?? fetch.bind(globalThis);
  }

  private async req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, raw = false): Promise<T> {
    const h: Record<string, string> = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (this.o.apiKey) h['X-Api-Key'] = this.o.apiKey;
    if (this.o.sourceSystem) h['X-Source-System'] = this.o.sourceSystem;
    const r = await this.f(this.base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) {
      let code = 'http_' + r.status, msg = r.statusText;
      try { const e = await r.json(); code = e.error?.code ?? code; msg = e.error?.message ?? msg; } catch { /* */ }
      throw new ApiError(r.status, code, msg);
    }
    if (r.status === 204) return undefined as T;
    return (raw ? r.text() : r.json()) as Promise<T>;
  }

  /** Доступность платформы и её сервисов. */
  async health(): Promise<{ status: string; services: Record<string, string>; auth: string } | null> {
    try {
      const r = await this.f(this.base + '/health');
      return await r.json();
    } catch { return null; }
  }

  documents = {
    list: () => this.req<DocumentMeta[]>('GET', '/documents'),
    get: (id: string) => this.req<MapDocument>('GET', `/documents/${enc(id)}`),
    create: (doc: MapDocument) => this.req<MapDocument>('POST', '/documents', doc),
    /** Сохранить; при переданной ревизии сервер проверит, что документ не меняли (иначе ApiError 409). */
    save: (doc: MapDocument, expectedRevision?: number) =>
      this.req<MapDocument>('PUT', `/documents/${enc(doc.id!)}`, doc, expectedRevision !== undefined ? { 'If-Match': `"${expectedRevision}"` } : {}),
    remove: (id: string) => this.req<void>('DELETE', `/documents/${enc(id)}`),
    revisions: (id: string) => this.req<{ revision: number; updatedAt: string }[]>('GET', `/documents/${enc(id)}/revisions`),
    revision: (id: string, rev: number) => this.req<MapDocument>('GET', `/documents/${enc(id)}/revisions/${rev}`),
  };

  layers = {
    list: (docId: string) => this.req<Layer[]>('GET', `/documents/${enc(docId)}/layers`),
    create: (docId: string, layer: Partial<Layer> & { above?: string }) =>
      this.req<{ layer: Layer; revision: number }>('POST', `/documents/${enc(docId)}/layers`, layer),
    update: (docId: string, layerId: string, patch: Partial<Layer>) =>
      this.req<{ layer: Layer; revision: number }>('PATCH', `/documents/${enc(docId)}/layers/${enc(layerId)}`, patch),
    remove: (docId: string, layerId: string, moveTo?: string) =>
      this.req<{ revision: number }>('DELETE', `/documents/${enc(docId)}/layers/${enc(layerId)}${moveTo ? `?moveTo=${enc(moveTo)}` : ''}`),
    features: (docId: string, layerId: string) => this.req<GeoJSONCollection>('GET', `/documents/${enc(docId)}/layers/${enc(layerId)}/features`),
    /** Полностью заменить объекты слоя (подача слоя внешней системой). */
    replaceFeatures: (docId: string, layerId: string, fc: GeoJSONCollection) =>
      this.req<{ revision: number; features: number }>('PUT', `/documents/${enc(docId)}/layers/${enc(layerId)}/features`, fc),
  };

  render = {
    svg: (doc: MapDocument, opts: { layers?: string[]; background?: string | null } = {}) =>
      this.req<string>('POST', '/render/svg', { document: doc, ...opts }, {}, true),
    geojson: (doc: MapDocument, layers?: string[]) => this.req<GeoJSONCollection>('POST', '/render/geojson', { document: doc, layers }),
    documentSvgUrl: (id: string, layers?: string[]) => `${this.base}/render/documents/${enc(id)}.svg${layers ? `?layers=${layers.map(enc).join(',')}` : ''}`,
  };

  /** Реестр объектов: формирования, сооружения, населённые пункты; факты во времени. */
  registry = {
    types: () => this.req<EntityType[]>('GET', '/registry/types'),
    /** Создать/изменить тип организации; к встроенному типу можно только добавить поля. */
    putType: (type: Pick<EntityType, 'id' | 'fields'> & Partial<Pick<EntityType, 'name' | 'description' | 'elements'>>) =>
      this.req<EntityType>('PUT', `/registry/types/${enc(type.id)}`, type),
    entities: {
      /** Поиск; с at — у каждого объекта состояние на момент; с bbox и at — объекты в районе на момент. */
      list: (q: EntityQuery = {}) => {
        const p = new URLSearchParams();
        if (q.q) p.set('q', q.q);
        if (q.type) p.set('type', q.type);
        if (q.side) p.set('side', q.side);
        if (q.at) p.set('at', q.at);
        if (q.bbox) p.set('bbox', q.bbox.join(','));
        if (q.limit) p.set('limit', String(q.limit));
        return this.req<(Entity & { state?: EntityState })[]>('GET', `/registry/entities${p.size ? `?${p}` : ''}`);
      },
      get: (id: string, at?: TimeInstant) =>
        this.req<{ entity: Entity; state?: EntityState }>('GET', `/registry/entities/${enc(id)}${at ? `?at=${enc(at)}` : ''}`),
      create: (e: EntityInput) => this.req<Entity>('POST', '/registry/entities', e),
      update: (id: string, patch: EntityPatch) => this.req<Entity>('PATCH', `/registry/entities/${enc(id)}`, patch),
      /** Удалить объект вместе с фактами. */
      remove: (id: string) => this.req<void>('DELETE', `/registry/entities/${enc(id)}`),
    },
    facts: {
      list: (entityId: string) => this.req<Fact[]>('GET', `/registry/entities/${enc(entityId)}/facts`),
      add: (entityId: string, f: FactInput) => this.req<Fact>('POST', `/registry/entities/${enc(entityId)}/facts`, f),
      update: (entityId: string, factId: string, patch: Partial<FactInput>) =>
        this.req<Fact>('PATCH', `/registry/entities/${enc(entityId)}/facts/${enc(factId)}`, patch),
      remove: (entityId: string, factId: string) => this.req<void>('DELETE', `/registry/entities/${enc(entityId)}/facts/${enc(factId)}`),
    },
    /** История одной характеристики по фактам. */
    history: (entityId: string, key: string) =>
      this.req<{ t: TimeInstant; to?: TimeInstant | null; value: unknown; factId: string }[]>('GET', `/registry/entities/${enc(entityId)}/history?key=${enc(key)}`),
    /** Состояния многих объектов на момент (для отрисовки знаков карты). Несуществующие id пропускаются. */
    states: (ids: string[], at: TimeInstant) => this.req<{ states: EntityState[] }>('POST', '/registry/states', { ids, at }),
    /** Подписка на изменения реестра (Server-Sent Events). Возвращает функцию отписки. */
    subscribe: (onEvent: (e: RegistryEvent) => void, entityId?: string): (() => void) => {
      const q = new URLSearchParams();
      if (entityId) q.set('entityId', entityId);
      if (this.o.apiKey) q.set('api_key', this.o.apiKey);
      const es = new EventSource(`${this.base}/registry/events${q.size ? `?${q}` : ''}`);
      const types: RegistryEvent['type'][] = ['entity.created', 'entity.updated', 'entity.deleted', 'fact.changed'];
      const h = (m: MessageEvent) => { try { onEvent(JSON.parse(m.data)); } catch { /* */ } };
      types.forEach((t) => es.addEventListener(t, h as EventListener));
      return () => es.close();
    },
  };

  /** Библиотека знаков: стили, категории, элементы с описаниями. */
  library = () => this.req<{ styles: unknown[]; sources: { id: string; short: string; title: string }[]; categories: { id: string; name: string; description: string }[]; elements: unknown[] }>('GET', '/library');

  presets = () => this.req<Record<string, { id: string; name: string; group: string; style: unknown }[]>>('GET', '/presets');

  /** Подписка на события изменений (Server-Sent Events). Возвращает функцию отписки. */
  subscribe(onEvent: (e: DocumentEvent) => void, documentId?: string): () => void {
    const q = new URLSearchParams();
    if (documentId) q.set('documentId', documentId);
    if (this.o.apiKey) q.set('api_key', this.o.apiKey);
    const es = new EventSource(`${this.base}/events${q.size ? `?${q}` : ''}`);
    const types: DocumentEvent['type'][] = ['document.created', 'document.updated', 'document.deleted', 'layer.updated', 'layer.features.replaced'];
    const h = (m: MessageEvent) => { try { onEvent(JSON.parse(m.data)); } catch { /* */ } };
    types.forEach((t) => es.addEventListener(t, h as EventListener));
    return () => es.close();
  }
}

const enc = encodeURIComponent;
