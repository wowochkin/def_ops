/** Реализация MapEngine на MapLibre GL. */
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// воркер MapLibre собирается Vite отдельным модулем (относительный путь из пакета ломается при сборке)
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { ohmYear, type ImageOverlay } from '@def-ops/core';
import type { BasemapSpec, EngineOptions, MapEngine, MapEngineEvents, PointerInfo } from './types';
import { vectorBase, withDate } from './vector-basemap';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

type Vector = ReturnType<typeof vectorBase>;

/** Стиль движка: бумага, над ней подложка (растровая или слои векторной карты); наложения добавляются потом. */
function buildStyle(paper: string, basemap: BasemapSpec | null, opacity: number, vector: Vector | null): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [{ id: 'paper', type: 'background', paint: { 'background-color': paper } }],
  };
  if (basemap?.style) {
    if (vector) {
      Object.assign(style.sources, vector.sources);
      style.layers.push(...vector.layers);
      if (vector.glyphs) style.glyphs = vector.glyphs;
      if (vector.sprite) style.sprite = vector.sprite;
    }
  } else if (basemap) {
    style.sources.base = { type: 'raster', tiles: basemap.tiles, tileSize: basemap.tileSize ?? 256, attribution: basemap.attribution, maxzoom: basemap.maxzoom ?? 18 };
    style.layers.push({ id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': opacity, 'raster-saturation': -0.35 } });
  }
  return style;
}

/** Стили векторных карт по адресу (в адресе — версия карты): запрос — один на адрес, неудачный забывается. */
const styles = new Map<string, Promise<StyleSpecification>>();
const loadedStyles = new Map<string, StyleSpecification>();
function loadStyle(url: string): Promise<StyleSpecification> {
  let p = styles.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`Стиль подложки ${url}: ${r.status}`);
      const st = (await r.json()) as StyleSpecification;
      loadedStyles.set(url, st);
      return st;
    });
    p.catch(() => styles.delete(url));
    styles.set(url, p);
  }
  return p;
}

export function createMapLibreEngine(container: HTMLElement, opts: EngineOptions): MapEngine {
  let paper = opts.paper, basemap = opts.basemap, opacity = opts.basemapOpacity;
  let year = opts.basemapDate ? ohmYear(opts.basemapDate) : null;
  let overlays: ImageOverlay[] = [];
  let alive = true;
  /** Исходные фильтры слоёв векторной подложки (для смены даты без перестройки стиля). */
  let filters: Record<string, maplibregl.FilterSpecification | undefined> = {};
  /** Стиль движка; у векторной подложки — когда её стиль уже получен (до того — одна бумага). */
  const compose = (): StyleSpecification => {
    filters = {};
    if (!basemap?.style) return buildStyle(paper, basemap, opacity, null);
    const url = basemap.style;
    const cached = loadedStyles.get(url);
    if (!cached) {
      loadStyle(url).then(() => {
        if (alive && basemap?.style === url) restyle(); // ответ на сменённую подложку не нужен
      }).catch((e) => console.warn(e));
      return buildStyle(paper, basemap, opacity, null);
    }
    const v = vectorBase(cached, { opacity, year, base: url });
    filters = v.filters;
    return buildStyle(paper, basemap, opacity, v);
  };
  const map = new maplibregl.Map({
    container,
    style: compose(),
    center: opts.view.center,
    zoom: opts.view.zoom,
    bearing: opts.view.bearing,
    pitchWithRotate: false,
    doubleClickZoom: false,
    attributionControl: { compact: true },
    maxPitch: 0,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  map.touchPitch.disable();
  map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'bottom-right');
  // масштаб (линейка и численный) рисует редактор — ScaleBar

  const restyle = () => {
    map.setStyle(compose());
    // первый styledata приходит, пока тайлы, значки и шрифты нового стиля ещё грузятся (стиль «не загружен») —
    // тогда наложения (сканы) добавить ещё нельзя: повторить, когда карта успокоится
    const resync = () => { if (!alive) return; if (map.isStyleLoaded()) syncOverlays(map, overlays); else map.once('idle', resync); };
    map.once('styledata', resync);
  };
  const info = (e: maplibregl.MapMouseEvent): PointerInfo => ({
    lngLat: [e.lngLat.lng, e.lngLat.lat],
    point: [e.point.x, e.point.y],
    altKey: e.originalEvent.altKey,
    shiftKey: e.originalEvent.shiftKey,
    preventDefault: () => e.preventDefault(),
  });

  return {
    id: 'maplibre',
    project(ll) { const p = map.project(ll as [number, number]); return [p.x, p.y]; },
    unproject(p) { const ll = map.unproject(p as [number, number]); return [ll.lng, ll.lat]; },
    getView() { const c = map.getCenter(); return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing() }; },
    setView(v) { map.jumpTo({ center: v.center as [number, number] | undefined, zoom: v.zoom, bearing: v.bearing }); },
    size() { const c = map.getContainer(); return { width: c.clientWidth, height: c.clientHeight }; },
    getContainer: () => map.getContainer(),
    setPaper(c) { if (c !== paper) { paper = c; restyle(); } },
    setBasemap(spec, op) {
      if (spec?.id === basemap?.id && JSON.stringify(spec) === JSON.stringify(basemap) && op === opacity) return;
      basemap = spec; opacity = op; restyle();
    },
    setBasemapDate(iso) {
      const y = iso ? ohmYear(iso) : null;
      if (y === year) return;
      year = y;
      // фильтры слоёв подложки — без перестройки стиля; стиль ещё грузится — собрать заново с новым годом
      try { for (const [id, f] of Object.entries(filters)) if (map.getLayer(id)) map.setFilter(id, withDate(f, year)); } catch { restyle(); }
    },
    setOverlays(list) { overlays = list; if (map.isStyleLoaded()) syncOverlays(map, list); },
    setPanEnabled(on) { if (on) map.dragPan.enable(); else map.dragPan.disable(); },
    on<K extends keyof MapEngineEvents>(ev: K, cb: MapEngineEvents[K]) {
      if (ev === 'view') {
        const f = cb as () => void;
        map.on('move', f); map.on('resize', f);
        return () => { map.off('move', f); map.off('resize', f); };
      }
      if (ev === 'ready') {
        const f = () => { syncOverlays(map, overlays); (cb as () => void)(); };
        if (map.loaded()) queueMicrotask(f); else map.once('load', f);
        return () => map.off('load', f);
      }
      const type = ev === 'move' ? 'mousemove' : ev;
      const f = (e: maplibregl.MapMouseEvent) => (cb as (p: PointerInfo) => void)(info(e));
      map.on(type as 'click', f);
      return () => map.off(type as 'click', f);
    },
    destroy() { alive = false; map.remove(); },
  };
}

/** Синхронизация растровых подложек-изображений с картой. */
function syncOverlays(map: maplibregl.Map, overlays: ImageOverlay[]) {
  if (!map.isStyleLoaded()) return;
  const style = map.getStyle();
  const existing = new Set(Object.keys(style.sources).filter((s) => s.startsWith('ov-')));
  for (const o of overlays) {
    const sid = `ov-${o.id}`;
    existing.delete(sid);
    const coords = o.corners as unknown as [[number, number], [number, number], [number, number], [number, number]];
    const src = map.getSource(sid) as maplibregl.ImageSource | undefined;
    if (!src) {
      map.addSource(sid, { type: 'image', url: o.url, coordinates: coords });
      map.addLayer({ id: sid, type: 'raster', source: sid, paint: { 'raster-opacity': o.opacity, 'raster-fade-duration': 0 } });
    } else if (src.url !== o.url) {
      // картинка сменилась (например, «классы» → «сравнение дорог») — подменить изображение
      src.updateImage({ url: o.url, coordinates: coords });
      map.setPaintProperty(sid, 'raster-opacity', o.opacity);
    } else {
      src.setCoordinates(coords);
      map.setPaintProperty(sid, 'raster-opacity', o.opacity);
    }
    map.setLayoutProperty(sid, 'visibility', o.visible ? 'visible' : 'none');
  }
  for (const sid of existing) {
    if (map.getLayer(sid)) map.removeLayer(sid);
    map.removeSource(sid);
  }
}
