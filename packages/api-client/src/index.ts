/**
 * Клиент API платформы (через шлюз). Работает в браузере и в Node 18+.
 * Используется редактором; его же могут подключать другие модули и системы.
 */
import type { GeoJSONCollection, Layer, MapDocument } from '@def-ops/core';

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
