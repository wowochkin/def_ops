/**
 * Векторная подложка (карта OpenHistoricalMap): стиль карты — под знаками редактора, над бумагой,
 * с фильтром «на дату». Чистые функции — без MapLibre (только типы), проверяются тестами.
 */
import type { FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

/** Префикс источников и слоёв подложки в стиле движка. */
export const BASE_PREFIX = 'base-';

/** Объект виден на год `year`: (нет from или from ≤ year) и (нет to или to ≥ year) — обе границы включительно. */
export function dateFilter(year: number): FilterSpecification {
  return ['all',
    ['any', ['!', ['has', 'from']], ['<=', ['get', 'from'], year]],
    ['any', ['!', ['has', 'to']], ['>=', ['get', 'to'], year]],
  ] as FilterSpecification;
}

/** Фильтр слоя с датой: без года — как есть; у слоя без фильтра — только дата. */
export function withDate(filter: FilterSpecification | undefined, year: number | null): FilterSpecification | undefined {
  if (year == null) return filter;
  if (!filter) return dateFilter(year);
  return ['all', dateFilter(year), filter] as FilterSpecification;
}

/**
 * Адрес из стиля — абсолютным (стиль движка собирается заново, относительный адрес не к чему отнести).
 * Строкой, не `new URL`: тот кодирует `{fontstack}` в `%7B…%7D`.
 */
export function absolutize(url: string, base: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(base)?.[0] ?? '';
  if (url.startsWith('//')) return (/^[a-z][a-z0-9+.-]*:/i.exec(base)?.[0] ?? 'http:') + url;
  if (url.startsWith('/')) return origin + url;
  const dir = base.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
  return dir + url;
}

/** Свойства прозрачности по типу слоя (их движок умножает на прозрачность подложки). */
const OPACITY: Partial<Record<LayerSpecification['type'], string[]>> = {
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  symbol: ['text-opacity', 'icon-opacity'],
  circle: ['circle-opacity'],
};

/**
 * Источники и слои стиля векторной карты для стиля движка: с префиксом `base-`, без фона (бумага — своя),
 * прозрачность умножена на `opacity`, фильтры — с датой; `filters` — исходные фильтры (для смены даты).
 */
export function vectorBase(style: StyleSpecification, o: { opacity: number; year: number | null; base: string }): {
  sources: StyleSpecification['sources'];
  layers: LayerSpecification[];
  filters: Record<string, FilterSpecification | undefined>;
  glyphs?: string;
  sprite?: string;
} {
  const sources: StyleSpecification['sources'] = {};
  for (const [id, src] of Object.entries(style.sources)) {
    const s = { ...src } as Record<string, unknown>;
    if (Array.isArray(s.tiles)) s.tiles = (s.tiles as string[]).map((t) => absolutize(t, o.base));
    if (typeof s.url === 'string') s.url = absolutize(s.url, o.base);
    sources[BASE_PREFIX + id] = s as unknown as StyleSpecification['sources'][string];
  }
  const filters: Record<string, FilterSpecification | undefined> = {};
  const layers: LayerSpecification[] = [];
  for (const l of style.layers) {
    if (l.type === 'background') continue;
    const id = BASE_PREFIX + l.id;
    const src = l as LayerSpecification & { source?: string; filter?: FilterSpecification; paint?: Record<string, unknown> };
    const paint: Record<string, unknown> = { ...src.paint };
    for (const k of OPACITY[l.type] ?? []) {
      const v = paint[k] ?? 1;
      if (typeof v === 'number') paint[k] = v * o.opacity;
    }
    filters[id] = src.filter;
    const out = { ...src, id, paint } as Record<string, unknown>;
    if (typeof src.source === 'string') out.source = BASE_PREFIX + src.source;
    const f = withDate(src.filter, o.year);
    if (f) out.filter = f; else delete out.filter;
    layers.push(out as unknown as LayerSpecification);
  }
  const sprite = typeof style.sprite === 'string' ? absolutize(style.sprite, o.base) : undefined;
  return { sources, layers, filters, glyphs: style.glyphs ? absolutize(style.glyphs, o.base) : undefined, sprite };
}
