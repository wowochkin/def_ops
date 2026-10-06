/**
 * Карта с наложенным слоем тактических знаков.
 *
 * Знаки рендерятся ядром в SVG в мировых координатах документа и помещаются в
 * группу с аффинным преобразованием, которое обновляется при каждом движении
 * карты (геометрия не пересчитывается). Ручки редактирования — отдельный
 * SVG-слой в экранных координатах (постоянный размер при любом зуме).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// воркер MapLibre собирается Vite отдельным модулем (относительный путь из пакета ломается при сборке)
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { LngLat } from '../core/geo';
import { makeProjection } from '../core/geo';
import type { Vec2 } from '../core/vec';
import { dist, sub, dot } from '../core/vec';
import type { ArrowFeature, Feature, FeatureKind, ImageOverlay, MapDocument } from '../core/model';
import { createFeature, zoomFactor } from '../core/factory';
import { renderDocument } from '../core/render/index';
import type { PresetKind } from '../core/presets';
import { type Tool, insertFeature, updateFeature } from './store';
import { findSnap, controlPoints, translateFeature, arrowWidthHandles, widthFromHandle } from './geometry';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

export type Basemap = 'none' | 'osm' | 'topo' | 'esri';

const TILES: Record<Exclude<Basemap, 'none'>, { url: string[]; attr: string; size: number }> = {
  osm: { url: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], attr: '© OpenStreetMap', size: 256 },
  topo: { url: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png'], attr: '© OpenTopoMap (CC-BY-SA)', size: 256 },
  esri: { url: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attr: '© Esri', size: 256 },
};

function buildStyle(paper: string, basemap: Basemap, opacity: number): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [{ id: 'paper', type: 'background', paint: { 'background-color': paper } }],
  };
  if (basemap !== 'none') {
    const t = TILES[basemap];
    style.sources.base = { type: 'raster', tiles: t.url, tileSize: t.size, attribution: t.attr, maxzoom: 18 };
    style.layers.push({ id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': opacity, 'raster-saturation': -0.35 } });
  }
  return style;
}

interface Props {
  doc: MapDocument;
  setDoc: (d: MapDocument, key?: string) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  selectedOverlay: string | null;
  tool: Tool;
  setTool: (t: Tool) => void;
  basemap: Basemap;
  basemapOpacity: number;
  onMapReady?: (m: MlMap) => void;
  onStatus?: (s: string) => void;
}

type Drag =
  | { type: 'point'; id: string; index: number; key: string }
  | { type: 'move'; id: string; start: Vec2; orig: Feature; key: string }
  | { type: 'tailWidth'; id: string; key: string }
  | { type: 'headWidth'; id: string; key: string }
  | { type: 'corner'; id: string; index: number; key: string }
  | { type: 'overlayMove'; id: string; start: Vec2; orig: ImageOverlay; key: string };

const SNAP_PX = 14;

export function MapView(props: Props) {
  const { doc, setDoc, selected, setSelected, tool, setTool } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const worldRef = useRef<SVGGElement>(null);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState<{ points: LngLat[]; anchor: { featureId: string; t: number } | null } | null>(null);
  const [hover, setHover] = useState<LngLat | null>(null);
  const [snapHint, setSnapHint] = useState<Vec2 | null>(null);
  const dragRef = useRef<Drag | null>(null);

  // актуальные значения для обработчиков, созданных один раз
  const live = useRef({ doc, tool, draft, selected, props });
  live.current = { doc, tool, draft, selected, props };

  const proj = useMemo(() => makeProjection(doc.origin, doc.refZoom), [doc.origin, doc.refZoom]);

  // ---------- создание карты
  useEffect(() => {
    const v = doc.view ?? { center: doc.origin, zoom: doc.refZoom, bearing: 0 };
    const map = new maplibregl.Map({
      container: container.current!,
      style: buildStyle(doc.paper, props.basemap, props.basemapOpacity),
      center: v.center,
      zoom: v.zoom,
      bearing: v.bearing,
      pitchWithRotate: false,
      dragRotate: true,
      doubleClickZoom: false,
      attributionControl: { compact: true },
      maxPitch: 0,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.touchPitch.disable();
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    mapRef.current = map;
    const onMove = () => setTick((t) => t + 1);
    map.on('move', onMove);
    map.on('resize', onMove);
    map.on('load', () => { syncOverlays(map, live.current.doc.overlays); onMove(); });
    props.onMapReady?.(map);
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- подложка
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(buildStyle(doc.paper, props.basemap, props.basemapOpacity));
    map.once('styledata', () => syncOverlays(map, live.current.doc.overlays));
  }, [doc.paper, props.basemap, props.basemapOpacity]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) syncOverlays(map, doc.overlays);
  }, [doc.overlays]);

  // ---------- черновик рисуемого объекта
  const draftFeature = useMemo((): Feature | null => {
    if (tool.mode !== 'draw' || !draft) return null;
    const map = mapRef.current;
    const k = map ? zoomFactor(doc, map.getZoom()) : 1;
    const pts = hover ? [...draft.points, hover] : draft.points;
    const f = createFeature(tool.kind as PresetKind, tool.preset, { points: pts }, k);
    if (f.kind === 'arrow') f.anchor = draft.anchor;
    f.id = '__draft__';
    return f;
  }, [tool, draft, hover, doc]);

  // ---------- рендер знаков (только при изменении документа)
  const rendered = useMemo(() => {
    const d = draftFeature ? { ...doc, features: [...doc.features, draftFeature] } : doc;
    return renderDocument(d, 'm');
  }, [doc, draftFeature]);

  useEffect(() => {
    const g = worldRef.current;
    if (!g) return;
    g.innerHTML =
      `<defs>${rendered.defs}</defs>` +
      rendered.features.map((f) => `<g data-id="${f.id}" class="feat${f.id === selected ? ' sel' : ''}">${f.svg}</g>`).join('');
  }, [rendered, selected]);

  // ---------- преобразование мир → экран
  const map = mapRef.current;
  let transform = '';
  let scale = 1;
  if (map) {
    const o = map.project(doc.origin as [number, number]);
    scale = Math.pow(2, map.getZoom() - doc.refZoom);
    transform = `translate(${o.x} ${o.y}) rotate(${-map.getBearing()}) scale(${scale})`;
  }
  const toScreen = (w: Vec2): Vec2 => {
    if (!map) return w;
    const p = map.project(proj.toLngLat(w) as [number, number]);
    return [p.x, p.y];
  };
  const llToScreen = (ll: LngLat): Vec2 => {
    if (!map) return [0, 0];
    const p = map.project(ll as [number, number]);
    return [p.x, p.y];
  };
  const screenToWorld = (x: number, y: number): Vec2 => {
    const ll = mapRef.current!.unproject([x, y]);
    return proj.toWorld([ll.lng, ll.lat]);
  };
  void tick;

  // ---------- события карты: рисование
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const { tool, draft, doc } = live.current;
      if (tool.mode !== 'draw') return;
      const ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
      const k = zoomFactor(doc, map.getZoom());
      if (tool.kind === 'symbol' || tool.kind === 'label') {
        let text: string | undefined;
        if (tool.kind === 'label') {
          const t = window.prompt('Текст надписи (перенос строки — \\n):', 'Надпись');
          if (!t) return;
          text = t.replace(/\\n/g, '\n');
        }
        const f = createFeature(tool.kind, tool.preset, { at: ll, text }, k);
        setDoc(insertFeature(doc, f));
        setSelected(f.id);
        return;
      }
      if (!draft) {
        let anchor = null;
        let p0 = ll;
        if (tool.kind === 'arrow' && !e.originalEvent.altKey) {
          const s = findSnap(doc, proj.toWorld(ll), SNAP_PX / Math.pow(2, map.getZoom() - doc.refZoom));
          if (s) { anchor = { featureId: s.featureId, t: s.t }; p0 = proj.toLngLat(s.point); }
        }
        setDraft({ points: [p0], anchor });
      } else {
        const last = draft.points[draft.points.length - 1];
        const a = map.project(last as [number, number]);
        if (Math.hypot(a.x - e.point.x, a.y - e.point.y) < 3) return; // повторный клик в ту же точку
        setDraft({ ...draft, points: [...draft.points, ll] });
      }
    };
    const onDbl = (e: maplibregl.MapMouseEvent) => {
      if (live.current.tool.mode !== 'draw') return;
      e.preventDefault();
      finishDraft();
    };
    const onMoveMouse = (e: maplibregl.MapMouseEvent) => {
      const { tool, draft, doc } = live.current;
      if (tool.mode !== 'draw') { setSnapHint(null); return; }
      const ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
      if (draft) setHover(ll);
      if (tool.kind === 'arrow' && !draft && !e.originalEvent.altKey) {
        const s = findSnap(doc, proj.toWorld(ll), SNAP_PX / Math.pow(2, map.getZoom() - doc.refZoom));
        setSnapHint(s ? s.point : null);
      } else setSnapHint(null);
      props.onStatus?.(`${ll[1].toFixed(4)}° с.ш., ${ll[0].toFixed(4)}° в.д.`);
    };
    map.on('click', onClick);
    map.on('dblclick', onDbl);
    map.on('mousemove', onMoveMouse);
    return () => { map.off('click', onClick); map.off('dblclick', onDbl); map.off('mousemove', onMoveMouse); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj]);

  function finishDraft() {
    const { tool, draft, doc } = live.current;
    if (tool.mode !== 'draw' || !draft) return;
    const min = tool.kind === 'area' ? 3 : 2;
    if (draft.points.length >= min) {
      const k = zoomFactor(doc, mapRef.current!.getZoom());
      const f = createFeature(tool.kind as PresetKind, tool.preset, { points: draft.points }, k);
      if (f.kind === 'arrow') f.anchor = draft.anchor;
      setDoc(insertFeature(doc, f));
      setSelected(f.id);
    }
    setDraft(null);
    setHover(null);
  }

  // клавиатура для рисования
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (e.key === 'Enter') finishDraft();
      if (e.key === 'Escape') {
        if (live.current.draft) { setDraft(null); setHover(null); } else setTool({ mode: 'select' });
      }
      if (e.key === 'Backspace' && live.current.draft) {
        const d = live.current.draft;
        setDraft(d.points.length > 1 ? { ...d, points: d.points.slice(0, -1) } : null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { setDraft(null); setHover(null); }, [tool]);

  // ---------- перетаскивание
  const beginDrag = (d: Drag, e: React.PointerEvent | PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = d;
    const onMove = (ev: PointerEvent) => applyDrag(ev);
    const onUp = () => {
      dragRef.current = null;
      setSnapHint(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      mapRef.current?.dragPan.enable();
    };
    mapRef.current?.dragPan.disable();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const applyDrag = (ev: PointerEvent) => {
    const d = dragRef.current;
    const map = mapRef.current;
    if (!d || !map) return;
    const rect = map.getContainer().getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const w = screenToWorld(x, y);
    const ll = proj.toLngLat(w);
    const { doc } = live.current;
    const sc = Math.pow(2, map.getZoom() - doc.refZoom);

    if (d.type === 'corner' || d.type === 'overlayMove') {
      const overlays = doc.overlays.map((o) => {
        if (o.id !== d.id) return o;
        if (d.type === 'corner') {
          const c = o.corners.slice() as ImageOverlay['corners'];
          c[d.index] = ll;
          return { ...o, corners: c };
        }
        const dw = sub(w, d.start);
        const c = d.orig.corners.map((p) => proj.toLngLat([proj.toWorld(p)[0] + dw[0], proj.toWorld(p)[1] + dw[1]])) as ImageOverlay['corners'];
        return { ...o, corners: c };
      });
      setDoc({ ...doc, overlays }, d.key);
      return;
    }

    const f = doc.features.find((q) => q.id === d.id);
    if (!f) return;
    let nf: Feature = f;
    if (d.type === 'move') {
      nf = translateFeature(doc, d.orig, sub(w, d.start));
    } else if (d.type === 'point') {
      if (f.kind === 'symbol' || f.kind === 'label') nf = { ...f, at: ll };
      else {
        const pts = f.points.slice();
        if (f.kind === 'arrow' && d.index === 0) {
          const s = ev.altKey ? null : findSnap(doc, w, SNAP_PX / sc, f.id);
          setSnapHint(s ? s.point : null);
          pts[0] = s ? proj.toLngLat(s.point) : ll;
          nf = { ...f, points: pts, anchor: s ? { featureId: s.featureId, t: s.t } : null };
        } else {
          pts[d.index] = ll;
          nf = { ...f, points: pts } as Feature;
        }
      }
    } else if (f.kind === 'arrow') {
      const h = arrowWidthHandles(doc, f);
      if (!h) return;
      if (d.type === 'tailWidth') {
        const tail0 = controlPoints(doc, f)[0];
        const tw = widthFromHandle(tail0, h.tailN, w);
        nf = { ...f, style: { ...f.style, tailWidth: tw } };
      } else {
        const hw = widthFromHandle(h.neck, h.neckN, w);
        const sweep = -dot(sub(w, h.neck), h.neckT);
        nf = { ...f, style: { ...f.style, headWidth: hw, barbSweep: sweep } };
      }
    }
    setDoc(updateFeature(doc, d.id, () => nf), d.key);
  };

  // клик по знаку в режиме выбора
  const onOverlayPointerDown = (e: React.PointerEvent) => {
    if (tool.mode !== 'select' || e.button !== 0) return;
    const el = (e.target as Element).closest('[data-id]');
    const id = el?.getAttribute('data-id');
    if (!id || id === '__draft__') return;
    const f = doc.features.find((q) => q.id === id);
    if (!f) return;
    setSelected(id);
    if (f.locked) return;
    const rect = mapRef.current!.getContainer().getBoundingClientRect();
    const start = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    beginDrag({ type: 'move', id, start, orig: f, key: `move-${id}-${Date.now()}` }, e);
  };

  // ---------- ручки
  const handles: React.ReactNode[] = [];
  const sel = doc.features.find((f) => f.id === selected);
  if (map && sel && tool.mode === 'select' && !sel.locked) {
    const pts = controlPoints(doc, sel).map(toScreen);
    // вставка точки на середине сегмента
    if (sel.kind === 'arrow' || sel.kind === 'line' || sel.kind === 'area') {
      const closed = sel.kind === 'area' || (sel.kind === 'line' && sel.closed);
      const n = pts.length;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (dist(a, b) < 24) continue;
        handles.push(
          <circle key={`m${i}`} className="h-mid" cx={m[0]} cy={m[1]} r={4}
            onPointerDown={(e) => {
              const ll = mapRef.current!.unproject([m[0], m[1]]);
              const f = sel as Exclude<Feature, { kind: 'symbol' | 'label' }>;
              const np = f.points.slice();
              np.splice(i + 1, 0, [ll.lng, ll.lat]);
              const key = `pt-${sel.id}-${Date.now()}`;
              setDoc(updateFeature(doc, sel.id, () => ({ ...f, points: np }) as Feature), key);
              beginDrag({ type: 'point', id: sel.id, index: i + 1, key }, e);
            }} />,
        );
      }
    }
    pts.forEach((p, i) => {
      const isTail = sel.kind === 'arrow' && i === 0;
      const anchored = isTail && (sel as ArrowFeature).anchor;
      handles.push(
        <rect key={`p${i}`} className={`h-pt${isTail ? ' tail' : ''}${anchored ? ' anchored' : ''}`} x={p[0] - 5} y={p[1] - 5} width={10} height={10}
          onPointerDown={(e) => beginDrag({ type: 'point', id: sel.id, index: i, key: `pt-${sel.id}-${Date.now()}` }, e)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (sel.kind === 'symbol' || sel.kind === 'label') return;
            const min = sel.kind === 'area' ? 3 : 2;
            if (sel.points.length <= min) return;
            const np = sel.points.filter((_, j) => j !== i);
            setDoc(updateFeature(doc, sel.id, (f) => ({ ...f, points: np, ...(f.kind === 'arrow' && i === 0 ? { anchor: null } : {}) }) as Feature));
          }}>
          <title>{isTail ? 'Хвост: тяните к линии фронта для привязки (Alt — без привязки). Двойной клик — удалить точку.' : 'Тяните — переместить. Двойной клик — удалить точку.'}</title>
        </rect>,
      );
    });
    if (sel.kind === 'arrow') {
      const h = arrowWidthHandles(doc, sel);
      if (h) {
        const t = toScreen(h.tail), b = toScreen(h.barb);
        handles.push(
          <circle key="tw" className="h-width" cx={t[0]} cy={t[1]} r={5}
            onPointerDown={(e) => beginDrag({ type: 'tailWidth', id: sel.id, key: `tw-${sel.id}-${Date.now()}` }, e)}><title>Ширина хвоста</title></circle>,
          <circle key="hw" className="h-width" cx={b[0]} cy={b[1]} r={5}
            onPointerDown={(e) => beginDrag({ type: 'headWidth', id: sel.id, key: `hw-${sel.id}-${Date.now()}` }, e)}><title>Размах и стреловидность наконечника</title></circle>,
        );
      }
    }
  }
  const ov = doc.overlays.find((o) => o.id === props.selectedOverlay);
  if (map && ov && tool.mode === 'select') {
    const cs = ov.corners.map(llToScreen);
    handles.push(<polygon key="ovp" points={cs.map((c) => c.join(',')).join(' ')} className="ov-frame" />);
    cs.forEach((c, i) =>
      handles.push(<rect key={`ov${i}`} className="h-corner" x={c[0] - 6} y={c[1] - 6} width={12} height={12}
        onPointerDown={(e) => beginDrag({ type: 'corner', id: ov.id, index: i, key: `ov-${ov.id}-${Date.now()}` }, e)} />),
    );
    const cx = cs.reduce((a, c) => a + c[0], 0) / 4, cy = cs.reduce((a, c) => a + c[1], 0) / 4;
    handles.push(<circle key="ovc" className="h-corner" cx={cx} cy={cy} r={8}
      onPointerDown={(e) => {
        const rect = mapRef.current!.getContainer().getBoundingClientRect();
        beginDrag({ type: 'overlayMove', id: ov.id, start: screenToWorld(e.clientX - rect.left, e.clientY - rect.top), orig: ov, key: `ovm-${ov.id}-${Date.now()}` }, e);
      }}><title>Сдвинуть подложку</title></circle>);
  }
  if (snapHint && map) {
    const s = toScreen(snapHint);
    handles.push(<circle key="snap" className="h-snap" cx={s[0]} cy={s[1]} r={8} />);
  }
  if (draft && map) {
    draft.points.forEach((p, i) => {
      const s = llToScreen(p);
      handles.push(<circle key={`d${i}`} className="h-draft" cx={s[0]} cy={s[1]} r={3.5} />);
    });
  }

  const drawing = tool.mode === 'draw';
  return (
    <div className={`mapwrap${drawing ? ' drawing' : ''}`}>
      <div ref={container} className="map" />
      <svg className="overlay" onPointerDown={onOverlayPointerDown}>
        <g ref={worldRef} transform={transform} className={drawing ? 'nohit' : 'hit'} />
      </svg>
      <svg className="handles">{handles}</svg>
    </div>
  );
}

export type DrawKind = FeatureKind;

/** Синхронизация растровых подложек-изображений с картой. */
function syncOverlays(map: MlMap, overlays: ImageOverlay[]) {
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
