/**
 * Карта с наложенным слоем тактических знаков.
 *
 * Знаки рендерятся ядром в SVG в мировых координатах документа и помещаются в
 * группу с аффинным преобразованием, которое обновляется при каждом движении
 * карты (геометрия не пересчитывается). Ручки редактирования — отдельный
 * SVG-слой в экранных координатах (постоянный размер при любом зуме).
 */
import { askText } from './dialogs';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArrowFeature, Feature, FeatureKind, ImageOverlay, LngLat, MapDocument, PresetKind, Vec2 } from '@def-ops/core';
import {
  makeProjection, dist, sub, dot, createFeature, zoomFactor, pickLayer, isFeatureEditable, renderDocument, documentAt,
} from '@def-ops/core';
import type { TimeInstant } from '@def-ops/core';
import { type Tool, insertFeature, updateFeature, commitAt } from './store';
import { findSnap, controlPoints, translateFeature, arrowWidthHandles, widthFromHandle } from './geometry';
import type { BasemapSpec, MapEngine, PointerInfo } from './engine/types';
import { ENGINES, DEFAULT_ENGINE } from './engine/registry';

interface Props {
  doc: MapDocument;
  setDoc: (d: MapDocument, key?: string) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  selectedOverlay: string | null;
  tool: Tool;
  setTool: (t: Tool) => void;
  /** Слой для новых объектов (null — автоматически по смыслу знака). */
  activeLayer: string | null;
  basemap: BasemapSpec | null;
  basemapOpacity: number;
  /** Картографический движок из реестра (по умолчанию MapLibre). */
  engineId?: string;
  onEngineReady?: (e: MapEngine) => void;
  onStatus?: (s: string) => void;
  /** Момент, на который показана обстановка (null — все знаки без учёта времени). */
  time?: TimeInstant | null;
  /** Новые знаки появляются с момента time. */
  newFromNow?: boolean;
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
  const mapRef = useRef<MapEngine | null>(null);
  const worldRef = useRef<SVGGElement>(null);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState<{ points: LngLat[]; anchor: { featureId: string; t: number } | null } | null>(null);
  const [hover, setHover] = useState<LngLat | null>(null);
  const [snapHint, setSnapHint] = useState<Vec2 | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const time = props.time ?? null;
  /** Документ на выбранный момент: что видно и где. Правки пишутся в исходный doc (commitAt). */
  const shown = useMemo(() => documentAt(doc, time), [doc, time]);
  /** Записать отредактированный (показанный) знак в документ с учётом времени. */
  const commit = (base: MapDocument, id: string, edited: Feature, key?: string) =>
    setDoc(updateFeature(base, id, (orig) => commitAt(orig, edited, live.current.time, base.timeline?.motion ?? 'smooth')), key);
  /** Новый знак: при включённом «новые — с этой даты» появляется с текущего момента. */
  const stamp = <F extends Feature>(f: F): F => (live.current.time && live.current.props.newFromNow ? { ...f, time: { from: live.current.time } } : f);

  // актуальные значения для обработчиков, созданных один раз
  const live = useRef({ doc, shown, time, tool, draft, selected, props });
  live.current = { doc, shown, time, tool, draft, selected, props };

  const proj = useMemo(() => makeProjection(doc.origin, doc.refZoom), [doc.origin, doc.refZoom]);

  // ---------- создание карты через адаптер движка
  useEffect(() => {
    const v = doc.view ?? { center: doc.origin, zoom: doc.refZoom, bearing: 0 };
    const factory = ENGINES[props.engineId ?? DEFAULT_ENGINE] ?? ENGINES[DEFAULT_ENGINE];
    const engine = factory.create(container.current!, { view: v, paper: doc.paper, basemap: props.basemap, basemapOpacity: props.basemapOpacity });
    mapRef.current = engine;
    engine.setOverlays(live.current.doc.overlays);
    const bump = () => setTick((t) => t + 1);
    const offs = [engine.on('view', bump), engine.on('ready', bump)];
    props.onEngineReady?.(engine);
    return () => { offs.forEach((f) => f()); engine.destroy(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.engineId]);

  // ---------- подложка и растровые наложения
  useEffect(() => { mapRef.current?.setPaper(doc.paper); }, [doc.paper]);
  useEffect(() => { mapRef.current?.setBasemap(props.basemap, props.basemapOpacity); }, [props.basemap, props.basemapOpacity]);
  useEffect(() => { mapRef.current?.setOverlays(doc.overlays); }, [doc.overlays]);

  // ---------- черновик рисуемого объекта
  const draftFeature = useMemo((): Feature | null => {
    if (tool.mode !== 'draw' || !draft) return null;
    const map = mapRef.current;
    const k = map ? zoomFactor(doc, map.getView().zoom) : 1;
    const pts = hover ? [...draft.points, hover] : draft.points;
    const layerId = pickLayer(doc, tool.kind, tool.preset, props.activeLayer, tool.side);
    const f = createFeature(tool.kind as PresetKind, tool.preset, { points: pts, layerId }, k, tool.side);
    if (f.kind === 'arrow') f.anchor = draft.anchor;
    f.id = '__draft__';
    return f;
  }, [tool, draft, hover, doc, props.activeLayer]);

  // ---------- рендер знаков (только при изменении документа)
  const rendered = useMemo(() => {
    const d = draftFeature ? { ...shown, features: [...shown.features, draftFeature] } : shown;
    return renderDocument(d, 'm');
  }, [shown, draftFeature]);

  useEffect(() => {
    const g = worldRef.current;
    if (!g) return;
    const locked = new Set(doc.layers.filter((l) => l.locked || l.source?.readOnly).map((l) => l.id));
    g.innerHTML =
      `<defs>${rendered.defs}</defs>` +
      rendered.layers.map((l) =>
        `<g data-layer="${l.id}" class="layer${locked.has(l.id) ? ' locked' : ''}"${l.opacity < 1 ? ` opacity="${l.opacity}"` : ''}>` +
        l.features.map((f) => `<g data-id="${f.id}" class="feat${f.id === selected ? ' sel' : ''}">${f.svg}</g>`).join('') +
        '</g>').join('');
  }, [rendered, selected, doc.layers]);

  // ---------- преобразование мир → экран
  const map = mapRef.current;
  let transform = '';
  let scale = 1;
  if (map) {
    const o = map.project(doc.origin);
    const v = map.getView();
    scale = Math.pow(2, v.zoom - doc.refZoom);
    transform = `translate(${o[0]} ${o[1]}) rotate(${-v.bearing}) scale(${scale})`;
  }
  const toScreen = (w: Vec2): Vec2 => (map ? map.project(proj.toLngLat(w)) : w);
  const llToScreen = (ll: LngLat): Vec2 => (map ? map.project(ll) : [0, 0]);
  const screenToWorld = (x: number, y: number): Vec2 => proj.toWorld(mapRef.current!.unproject([x, y]));
  void tick;

  // ---------- события карты: рисование
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = () => map.getView().zoom;
    const onClick = (e: PointerInfo) => {
      const { tool, draft, doc } = live.current;
      if (tool.mode !== 'draw') return;
      const ll = e.lngLat;
      const k = zoomFactor(doc, zoom());
      if (tool.kind === 'symbol' || tool.kind === 'label') {
        let text: string | undefined;
        if (tool.kind === 'label') {
          const t = askText('Текст надписи (перенос строки — \\n):', 'Надпись');
          if (!t) return;
          text = t.replace(/\\n/g, '\n');
        }
        const layerId = pickLayer(doc, tool.kind, tool.preset, live.current.props.activeLayer, tool.side);
        const f = stamp(createFeature(tool.kind, tool.preset, { at: ll, text, layerId }, k, tool.side));
        setDoc(insertFeature(doc, f));
        setSelected(f.id);
        return;
      }
      if (!draft) {
        let anchor = null;
        let p0 = ll;
        if (tool.kind === 'arrow' && !e.altKey) {
          const s = findSnap(live.current.shown, proj.toWorld(ll), SNAP_PX / Math.pow(2, zoom() - doc.refZoom));
          if (s) { anchor = { featureId: s.featureId, t: s.t }; p0 = proj.toLngLat(s.point); }
        }
        setDraft({ points: [p0], anchor });
      } else {
        const last = draft.points[draft.points.length - 1];
        const a = map.project(last);
        if (Math.hypot(a[0] - e.point[0], a[1] - e.point[1]) < 3) return; // повторный клик в ту же точку
        setDraft({ ...draft, points: [...draft.points, ll] });
      }
    };
    const onDbl = (e: PointerInfo) => {
      if (live.current.tool.mode !== 'draw') return;
      e.preventDefault();
      finishDraft();
    };
    const onMoveMouse = (e: PointerInfo) => {
      const { tool, draft, doc } = live.current;
      const ll = e.lngLat;
      props.onStatus?.(`${ll[1].toFixed(4)}° с.ш., ${ll[0].toFixed(4)}° в.д.`);
      if (tool.mode !== 'draw') { setSnapHint(null); return; }
      if (draft) setHover(ll);
      if (tool.kind === 'arrow' && !draft && !e.altKey) {
        const s = findSnap(live.current.shown, proj.toWorld(ll), SNAP_PX / Math.pow(2, zoom() - doc.refZoom));
        setSnapHint(s ? s.point : null);
      } else setSnapHint(null);
    };
    const offs = [map.on('click', onClick), map.on('dblclick', onDbl), map.on('move', onMoveMouse)];
    return () => offs.forEach((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj, props.engineId]);

  function finishDraft() {
    const { tool, draft, doc } = live.current;
    if (tool.mode !== 'draw' || !draft) return;
    const min = tool.kind === 'area' ? 3 : 2;
    if (draft.points.length >= min) {
      const k = zoomFactor(doc, mapRef.current!.getView().zoom);
      const layerId = pickLayer(doc, tool.kind, tool.preset, live.current.props.activeLayer, tool.side);
      const f = stamp(createFeature(tool.kind as PresetKind, tool.preset, { points: draft.points, layerId }, k, tool.side));
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
      mapRef.current?.setPanEnabled(true);
    };
    mapRef.current?.setPanEnabled(false);
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
    const sc = Math.pow(2, map.getView().zoom - doc.refZoom);

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

    const { shown } = live.current;
    const f = shown.features.find((q) => q.id === d.id);
    if (!f) return;
    let nf: Feature = f;
    if (d.type === 'move') {
      nf = translateFeature(shown, d.orig, sub(w, d.start));
    } else if (d.type === 'point') {
      if (f.kind === 'symbol' || f.kind === 'label') nf = { ...f, at: ll };
      else {
        const pts = f.points.slice();
        if (f.kind === 'arrow' && d.index === 0) {
          const s = ev.altKey ? null : findSnap(shown, w, SNAP_PX / sc, f.id);
          setSnapHint(s ? s.point : null);
          pts[0] = s ? proj.toLngLat(s.point) : ll;
          nf = { ...f, points: pts, anchor: s ? { featureId: s.featureId, t: s.t } : null };
        } else {
          pts[d.index] = ll;
          nf = { ...f, points: pts } as Feature;
        }
      }
    } else if (f.kind === 'arrow') {
      const h = arrowWidthHandles(shown, f);
      if (!h) return;
      if (d.type === 'tailWidth') {
        const tail0 = controlPoints(shown, f)[0];
        const tw = widthFromHandle(tail0, h.tailN, w);
        nf = { ...f, style: { ...f.style, tailWidth: tw } };
      } else {
        const hw = widthFromHandle(h.neck, h.neckN, w);
        const sweep = -dot(sub(w, h.neck), h.neckT);
        nf = { ...f, style: { ...f.style, headWidth: hw, barbSweep: sweep } };
      }
    }
    commit(doc, d.id, nf, d.key);
  };

  // клик по знаку в режиме выбора
  const onOverlayPointerDown = (e: React.PointerEvent) => {
    if (tool.mode !== 'select' || e.button !== 0) return;
    const el = (e.target as Element).closest('[data-id]');
    const id = el?.getAttribute('data-id');
    if (!id || id === '__draft__') return;
    const f = shown.features.find((q) => q.id === id);
    if (!f || !isFeatureEditable(doc, f)) return;
    setSelected(id);
    const rect = mapRef.current!.getContainer().getBoundingClientRect();
    const start = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    beginDrag({ type: 'move', id, start, orig: f, key: `move-${id}-${Date.now()}` }, e);
  };

  // ---------- ручки
  const handles: React.ReactNode[] = [];
  const sel = shown.features.find((f) => f.id === selected);
  if (map && sel && tool.mode === 'select' && isFeatureEditable(doc, sel)) {
    const pts = controlPoints(shown, sel).map(toScreen);
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
              const ll = mapRef.current!.unproject(m);
              const f = sel as Exclude<Feature, { kind: 'symbol' | 'label' }>;
              const np = f.points.slice();
              np.splice(i + 1, 0, ll);
              const key = `pt-${sel.id}-${Date.now()}`;
              commit(doc, sel.id, { ...f, points: np } as Feature, key);
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
            commit(doc, sel.id, { ...sel, points: np, ...(sel.kind === 'arrow' && i === 0 ? { anchor: null } : {}) } as Feature);
          }}>
          <title>{isTail ? 'Хвост: тяните к линии фронта для привязки (Alt — без привязки). Двойной клик — удалить точку.' : 'Тяните — переместить. Двойной клик — удалить точку.'}</title>
        </rect>,
      );
    });
    if (sel.kind === 'arrow') {
      const h = arrowWidthHandles(shown, sel);
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
