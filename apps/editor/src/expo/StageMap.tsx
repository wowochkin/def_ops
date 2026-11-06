/**
 * Карта стенда — `MapView` полного режима, один экземпляр на окно: сцены меняют документ, момент, приказ поверх
 * и кадр камеры, но не пересоздают карту. Время при прокрутке и на заставке бежит внутри этого компонента
 * (10–20 раз в секунду: армии идут плавно, а карта не перерисовывается на каждом кадре) — остальная сцена при этом
 * не перерисовывается. Карта не принимает ввода посетителя.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { zoomForScale, type Feature, type MapDocument } from '@def-ops/core';
import { MapView } from '../MapView';
import type { MapEngine } from '../engine/types';
import { basemapDate } from '../engine/basemaps';
import { useBasemaps } from '../shared';
import { withLevel } from '../map-levels';
import type { LevelId } from '../map-level-scale';
import { zoneOverlays, zoneUrl } from '../zones-overlay';
import type { ZoneGrid } from '@def-ops/sim';
import { fitView, type ZoneFrame } from './stage-doc';
import { MapFx, reducedMotion, type MapFxSpec } from './film';

/** Бег времени: от `from` до `to` за `ms`; `loop` — по кругу с паузой `hold`; `step` — мс между кадрами карты; `delay` — пауза до старта. */
export interface TimeRun { from: string; to: string; ms: number; key: string; loop?: boolean; hold?: number; step?: number; delay?: number; /** Без ускорения к середине: час операции занимает одно и то же время экрана. */ linear?: boolean }
export type Bbox = [number, number, number, number];

const iso = (t: number) => new Date(t).toISOString().slice(0, 16);
const ms = (s: string) => Date.parse(`${s.slice(0, 16)}:00Z`);
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Картинки зон влияния — по сетке один раз (сетки документа не меняются). */
const zoneUrls = new WeakMap<ZoneGrid, string | null>();
const urlOf = (g: ZoneGrid | null) => {
  if (!g) return null;
  if (!zoneUrls.has(g)) zoneUrls.set(g, zoneUrl(g));
  return zoneUrls.get(g) ?? null;
};

/** Момент карты: стоит на `time` или бежит по `run`; сообщает дату наружу через `onTime` (табло без перерисовки сцены). */
function useClock(time: string | null, run: TimeRun | null, onTime?: (t: string) => void, onDone?: () => void): string | null {
  const [t, setT] = useState(time);
  const cb = useRef(onTime);
  const done = useRef(onDone);
  cb.current = onTime;
  done.current = onDone;
  useEffect(() => {
    if (!run) {
      setT(time);
      if (time) cb.current?.(time);
      return;
    }
    const a = ms(run.from), b = ms(run.to);
    let finished = false;
    const finish = () => {
      if (finished || run.loop) return;
      finished = true;
      done.current?.();
    };
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
      // выставочная прокрутка всё равно доигрывается: иначе ход обрывается в момент, когда документ карты появился
      if (run.linear && typeof requestAnimationFrame === 'function') {
        /* fall through to the animation */
      } else {
        setT(run.to);
        cb.current?.(run.to);
        finish();
        return;
      }
    }
    const t0 = performance.now() + (run.delay ?? 0), period = run.ms + (run.loop ? run.hold ?? 3000 : 0), every = run.step ?? 50;
    let id = 0, last = 0;
    const tick = (now: number) => {
      const e = Math.max(0, now - t0);
      const p = Math.min(1, (run.loop ? e % period : e) / run.ms);
      if (now - last >= every || p === 1) {
        last = now;
        const v = iso(a + (b - a) * (run.loop || run.linear ? p : ease(p)));
        setT(v);
        cb.current?.(v);
      }
      if (p === 1 && !run.loop) finish();
      else id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [time, run?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return t;
}

export interface StageMapProps {
  doc: MapDocument | null;
  time: string | null;
  run?: TimeRun | null;
  /** Кадр камеры: рамка и ключ (новый ключ — пролёт к рамке). */
  camera: { bbox: Bbox; key: string; ms?: number; pad?: number; /** Рамка закрывает окно целиком, без пустой бумаги по краям. */ cover?: boolean; /** Численный масштаб 1:N; центр рамки сохраняется. */ scale?: number } | null;
  /** Знаки поверх: стрелки приказа, пути на итоге. */
  extra?: Feature[];
  /** Вспышки артиллерии и дым поверх карты. */
  fx?: MapFxSpec | null;
  /** Уровень знаков, как переключатель уровня полного режима: обзор — армии («Фронт»), участок — «Корпус». */
  level?: LevelId;
  /** Зоны влияния сторон по суткам: на время карты — переход от зон суток к зонам следующих. */
  zones?: ZoneFrame[] | null;
  onTime?: (t: string) => void;
  /** Прокрутка дошла до конца (не круг заставки). */
  onDone?: () => void;
  onEngine?: (e: MapEngine | null) => void;
}

export const StageMap = memo(function StageMap({ doc, time, run = null, camera, extra, fx = null, level = 'front', zones = null, onTime, onDone, onEngine }: StageMapProps) {
  // подложка — та, что выбрана в полном режиме (вид «Подложка»), с той же прозрачностью и датой начала операции
  const bm = useBasemaps();
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const t = useClock(time, run, onTime, onDone);
  const zFrame = useMemo(() => {
    if (!zones?.length || !t) return null;
    const at = Date.parse(`${t.slice(0, 16)}:00Z`);
    let hit = zones[0];
    for (const f of zones) if (Date.parse(`${f.time.slice(0, 16)}:00Z`) <= at) hit = f;
    return hit;
  }, [zones, t]);
  // один снимок суток, без наложения двух картинок: в 05:00 смена была вспышкой
  const zOv = zFrame ? zoneOverlays({ cur: zFrame.grid, prev: null, urls: { cur: urlOf(zFrame.grid), prev: null }, from: zFrame.time, to: zFrame.time, time: t, on: true }) : [];
  const zKey = zFrame ? `${zFrame.time}:${zOv[0]?.url.slice(-24) ?? ''}` : '';
  const shown = useMemo(() => {
    if (!doc) return null;
    const base = withLevel(extra?.length ? { ...doc, features: [...doc.features, ...extra] } : doc, level);
    // на участке (корпус) удары армий иначе выключены — на переломе без них карта без линий хода
    const d = level === 'corps'
      ? { ...base, layers: base.layers.map((l) => (l.id === 'lvl-op-moves' ? { ...l, visible: true } : l)) }
      : base;
    return zOv.length ? { ...d, overlays: [...d.overlays, ...zOv] } : d;
  }, [doc, extra, level, zKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onEngine?.(engine);
  }, [engine, onEngine]);
  useEffect(() => {
    if (!engine || !camera) return;
    let alive = true;
    // окно карты часто ещё нулевое в момент смены сцены: без повтора кадр остаётся прежним (широкий доклад, его левый край — Магдебург)
    const apply = (fly: boolean) => {
      if (!alive) return;
      engine.resize?.();
      const { width, height } = engine.size();
      if (!width || !height) return;
      engine.setPanEnabled(false);
      const v = fitView(camera.bbox, width, height, camera.pad ?? 0.08, camera.cover);
      if (camera.scale) v.zoom = zoomForScale(v.center[1], camera.scale);
      const d = reducedMotion() ? 0 : camera.ms ?? 2400;
      if (fly && d && engine.flyTo) engine.flyTo(v, d);
      else engine.setView(v);
    };
    apply(true);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => apply(false));
    ro?.observe(engine.getContainer());
    return () => { alive = false; ro?.disconnect(); };
  }, [engine, camera?.key, camera?.scale, camera?.bbox?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return (
    <div className="expo-stage-map">
      <MapView
        doc={shown}
        setDoc={() => {}}
        selected={null}
        setSelected={() => {}}
        selectedOverlay={null}
        tool={{ mode: 'select' }}
        setTool={() => {}}
        activeLayer={null}
        basemap={bm.current}
        basemapOpacity={bm.opacity}
        basemapDate={basemapDate(bm.current, doc?.timeline?.start ?? null, bm.year)}
        onEngineReady={setEngine}
        onStatus={() => {}}
        time={t}
        newFromNow={false}
      />
      {engine && <MapFx engine={engine} fx={fx} />}
      <MapKey />
    </div>
  );
});

/** Условные обозначения стенда: то, что видно на уровне фронта. */
function MapKey() {
  return (
    <ul className="expo-mapkey" aria-label="Условные обозначения">
      <li><svg viewBox="0 0 36 16" aria-hidden="true"><ellipse cx="18" cy="8" rx="14" ry="6" fill="none" stroke="#c0392b" strokeWidth="2" /></svg>свои войска</li>
      <li><svg viewBox="0 0 36 16" aria-hidden="true"><ellipse cx="18" cy="8" rx="14" ry="6" fill="none" stroke="#2c5f8a" strokeWidth="2" /></svg>противник</li>
      <li><svg viewBox="0 0 36 16" aria-hidden="true"><path d="M2 8h24M20 3l8 5-8 5" fill="none" stroke="#c0392b" strokeWidth="2" /></svg>удар</li>
      <li><svg viewBox="0 0 36 16" aria-hidden="true"><path d="M2 8h32" stroke="#c0392b" strokeWidth="2.5" /></svg>линия фронта</li>
      <li><svg viewBox="0 0 36 16" aria-hidden="true"><path d="M2 8h32" stroke="#6b5344" strokeWidth="2" strokeDasharray="5 3" /></svg>разграничительная линия</li>
      <li><svg viewBox="0 0 36 16" aria-hidden="true"><rect x="2" y="3" width="32" height="10" fill="#c0392b" opacity="0.35" /></svg>зона своих</li>
      <li><svg viewBox="0 0 36 16" aria-hidden="true"><rect x="2" y="3" width="32" height="10" fill="#2c5f8a" opacity="0.35" /></svg>зона противника</li>
    </ul>
  );
}
