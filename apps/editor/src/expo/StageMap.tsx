/**
 * Карта стенда — `MapView` полного режима, один экземпляр на окно: сцены меняют документ, момент, приказ поверх
 * и кадр камеры, но не пересоздают карту. Время при прокрутке и на заставке бежит внутри этого компонента
 * (10–20 раз в секунду: армии идут плавно, а карта не перерисовывается на каждом кадре) — остальная сцена при этом
 * не перерисовывается. Карта не принимает ввода посетителя.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, MapDocument } from '@def-ops/core';
import { MapView } from '../MapView';
import type { MapEngine } from '../engine/types';
import { basemapDate } from '../engine/basemaps';
import { useBasemaps } from '../shared';
import { withLevel } from '../map-levels';
import type { LevelId } from '../map-level-scale';
import { zoneOverlays, zonesAt, zonesKey, zoneUrl } from '../zones-overlay';
import type { ZoneGrid } from '@def-ops/sim';
import { fitView, type ZoneFrame } from './stage-doc';
import { MapFx, reducedMotion, type MapFxSpec } from './film';

/** Бег времени: от `from` до `to` за `ms`; `loop` — по кругу с паузой `hold`; `step` — мс между кадрами карты; `delay` — пауза до старта. */
export interface TimeRun { from: string; to: string; ms: number; key: string; loop?: boolean; hold?: number; step?: number; delay?: number }
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
function useClock(time: string | null, run: TimeRun | null, onTime?: (t: string) => void): string | null {
  const [t, setT] = useState(time);
  const cb = useRef(onTime);
  cb.current = onTime;
  useEffect(() => {
    if (!run) {
      setT(time);
      if (time) cb.current?.(time);
      return;
    }
    const a = ms(run.from), b = ms(run.to);
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
      setT(run.to);
      cb.current?.(run.to);
      return;
    }
    const t0 = performance.now() + (run.delay ?? 0), period = run.ms + (run.loop ? run.hold ?? 3000 : 0), every = run.step ?? 50;
    let id = 0, last = 0;
    const tick = (now: number) => {
      const e = Math.max(0, now - t0);
      const p = Math.min(1, (run.loop ? e % period : e) / run.ms);
      if (now - last >= every || p === 1) {
        last = now;
        const v = iso(a + (b - a) * (run.loop ? p : ease(p)));
        setT(v);
        cb.current?.(v);
      }
      if (run.loop || p < 1) id = requestAnimationFrame(tick);
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
  camera: { bbox: Bbox; key: string; ms?: number; pad?: number } | null;
  /** Знаки поверх: стрелки приказа, пути на итоге. */
  extra?: Feature[];
  /** Вспышки артиллерии и дым поверх карты. */
  fx?: MapFxSpec | null;
  /** Уровень знаков, как переключатель уровня полного режима: обзор — армии («Фронт»), участок — «Корпус». */
  level?: LevelId;
  /** Зоны влияния сторон по суткам: на время карты — переход от зон суток к зонам следующих. */
  zones?: ZoneFrame[] | null;
  onTime?: (t: string) => void;
  onEngine?: (e: MapEngine | null) => void;
}

export const StageMap = memo(function StageMap({ doc, time, run = null, camera, extra, fx = null, level = 'front', zones = null, onTime, onEngine }: StageMapProps) {
  // подложка — та, что выбрана в полном режиме (вид «Подложка»), с той же прозрачностью и датой начала операции
  const bm = useBasemaps();
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const t = useClock(time, run, onTime);
  const zAt = useMemo(() => (zones?.length && t ? zonesAt(zones, t) : null), [zones, t]);
  const zOv = zAt && t ? zoneOverlays({ cur: zAt.cur, prev: zAt.prev, urls: { cur: urlOf(zAt.cur), prev: urlOf(zAt.prev) }, from: zAt.from, to: zAt.to, time: t, on: true }) : [];
  const zKey = zonesKey(zAt, { own: true, enemy: true }, zOv);
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
      const { width, height } = engine.size();
      if (!width || !height) return;
      engine.setPanEnabled(false);
      const v = fitView(camera.bbox, width, height, camera.pad ?? 0.08);
      const d = reducedMotion() ? 0 : camera.ms ?? 2400;
      if (fly && d && engine.flyTo) engine.flyTo(v, d);
      else engine.setView(v);
    };
    apply(true);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => apply(false));
    ro?.observe(engine.getContainer());
    return () => { alive = false; ro?.disconnect(); };
  }, [engine, camera?.key, camera?.bbox?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
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
    </div>
  );
});
