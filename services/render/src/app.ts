/**
 * Сервис рендера не хранит состояния: принимает документ в теле запроса или
 * берёт его из сервиса документов по id. Масштабируется горизонтально.
 */
import type { MapDocument } from '@def-ops/core';
import { migrateDocument, exportSVG, toGeoJSON, fromGeoJSON, PRESETS, LIBRARY, CATEGORIES, STYLES, type GeoJSONCollection, type ImportOptions } from '@def-ops/core';
import { Router, HttpError, reply, serviceClient, type Ctx } from '@def-ops/service-kit';

export function buildRouter(documentsUrl: string): Router {
  const r = new Router();
  const parse = (d: unknown): MapDocument => {
    try { return migrateDocument(d); } catch (e) { throw new HttpError(422, 'invalid_document', (e as Error).message); }
  };
  const layersParam = (c: Ctx) => c.query.get('layers')?.split(',').filter(Boolean);
  const svg = (s: string) => reply(200, s, { 'Content-Type': 'image/svg+xml; charset=utf-8' });
  const geo = (g: unknown) => reply(200, g, { 'Content-Type': 'application/geo+json; charset=utf-8' });
  const fetchDoc = (c: Ctx) => serviceClient(documentsUrl, c)<MapDocument>('GET', `/documents/${encodeURIComponent(c.params.id)}`).then(parse);

  /** Каталог условных знаков (пресетов) — для UI других модулей. */
  r.get('/presets', () => Object.fromEntries(Object.entries(PRESETS).map(([kind, table]) => [
    kind, Object.entries(table as Record<string, { name: string; group: string; style: () => unknown }>).map(([id, p]) => ({ id, name: p.name, group: p.group, style: p.style() })),
  ])));

  /** Библиотека знаков: категории, стили, элементы с описаниями и вариантами. */
  r.get('/library', () => ({ styles: STYLES, categories: CATEGORIES, elements: LIBRARY }));

  r.post('/render/svg', async (c) => {
    const b = await c.json<{ document: unknown; layers?: string[]; background?: string | null; padding?: number }>();
    return svg(exportSVG(parse(b?.document), { layers: b.layers, background: b.background, padding: b.padding }));
  });
  r.post('/render/geojson', async (c) => {
    const b = await c.json<{ document: unknown; layers?: string[] }>();
    return geo(toGeoJSON(parse(b?.document), { layers: b.layers }));
  });
  r.post('/import/geojson', async (c) => {
    const b = await c.json<{ document: unknown; geojson: GeoJSONCollection; options?: ImportOptions }>();
    try { return fromGeoJSON(parse(b?.document), b.geojson, b.options); } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(422, 'invalid_geojson', (e as Error).message);
    }
  });

  // по документу из хранилища: ?layers=a,b — только эти слои
  r.get('/render/documents/:id.svg', async (c) => svg(exportSVG(await fetchDoc(c), { layers: layersParam(c), background: c.query.get('transparent') ? null : undefined })));
  r.get('/render/documents/:id.geojson', async (c) => geo(toGeoJSON(await fetchDoc(c), { layers: layersParam(c) })));
  return r;
}
