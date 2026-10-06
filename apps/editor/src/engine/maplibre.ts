/** Реализация MapEngine на MapLibre GL. */
import * as maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// воркер MapLibre собирается Vite отдельным модулем (относительный путь из пакета ломается при сборке)
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { ImageOverlay } from '@def-ops/core';
import type { BasemapSpec, EngineOptions, MapEngine, MapEngineEvents, PointerInfo } from './types';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

function buildStyle(paper: string, basemap: BasemapSpec | null, opacity: number): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [{ id: 'paper', type: 'background', paint: { 'background-color': paper } }],
  };
  if (basemap) {
    style.sources.base = { type: 'raster', tiles: basemap.tiles, tileSize: basemap.tileSize ?? 256, attribution: basemap.attribution, maxzoom: basemap.maxzoom ?? 18 };
    style.layers.push({ id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': opacity, 'raster-saturation': -0.35 } });
  }
  return style;
}

export function createMapLibreEngine(container: HTMLElement, opts: EngineOptions): MapEngine {
  let paper = opts.paper, basemap = opts.basemap, opacity = opts.basemapOpacity;
  let overlays: ImageOverlay[] = [];
  const map = new maplibregl.Map({
    container,
    style: buildStyle(paper, basemap, opacity),
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
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  const restyle = () => {
    map.setStyle(buildStyle(paper, basemap, opacity));
    map.once('styledata', () => syncOverlays(map, overlays));
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
    destroy() { map.remove(); },
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
