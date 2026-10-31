/**
 * Карта стенда — `MapView` полного режима, один экземпляр на окно: сцены меняют документ, момент, приказ поверх
 * и кадр камеры, но не пересоздают карту. Время при прокрутке и на заставке бежит внутри этого компонента
 * (не чаще 30 раз в секунду) — остальная сцена при этом не перерисовывается. Карта не принимает ввода посетителя.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Feature, MapDocument } from '@def-ops/core';
import { MapView } from '../MapView';
import type { MapEngine } from '../engine/types';
import { localBasemapSpec } from '../engine/basemaps';
import type { BasemapSpec } from '../engine/types';
import { cartography } from '../MapsPanel';
import { fitView } from './stage-doc';
import { reducedMotion } from './ExpoMap';

/** Бег времени: от `from` до `to` за `ms`; `loop` — по кругу с паузой `hold` в конце. */
export interface TimeRun { from: string; to: string; ms: number; key: string; loop?: boolean; hold?: number }
export type Bbox = [number, number, number, number];

const iso = (t: number) => new Date(t).toISOString().slice(0, 16);
const ms = (s: string) => Date.parse(`${s.slice(0, 16)}:00Z`);
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Подложка стенда без сети: своя карта службы картографии (векторная «на дату» лучше), иначе «Бумага». */
function useStageBasemap(): BasemapSpec | null {
  const [spec, setSpec] = useState<BasemapSpec | null>(null);
  useEffect(() => {
    let alive = true;
    cartography
      .list()
      .then((maps) => {
        const m = maps.find((x) => x.kind === 'vector') ?? maps[0];
        if (alive && m) setSpec(localBasemapSpec(m, { tiles: cartography.tileTemplate(m), style: cartography.styleUrl(m) }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return spec;
}

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
    const t0 = performance.now(), period = run.ms + (run.loop ? run.hold ?? 3000 : 0);
    let id = 0, last = 0;
    const tick = (now: number) => {
      const e = now - t0;
      const p = Math.min(1, (run.loop ? e % period : e) / run.ms);
      if (now - last >= 33 || p === 1) {
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
  camera: { bbox: Bbox; key: string; ms?: number } | null;
  /** Знаки поверх: стрелки приказа, пути на итоге. */
  extra?: Feature[];
  onTime?: (t: string) => void;
  onEngine?: (e: MapEngine | null) => void;
}

export const StageMap = memo(function StageMap({ doc, time, run = null, camera, extra, onTime, onEngine }: StageMapProps) {
  const basemap = useStageBasemap();
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const t = useClock(time, run, onTime);
  const shown = useMemo(() => (doc && extra?.length ? { ...doc, features: [...doc.features, ...extra] } : doc), [doc, extra]);
  useEffect(() => onEngine?.(engine), [engine, onEngine]);
  useEffect(() => {
    if (!engine || !camera) return;
    engine.setPanEnabled(false);
    const { width, height } = engine.size();
    if (!width || !height) return;
    const v = fitView(camera.bbox, width, height);
    const d = reducedMotion() ? 0 : camera.ms ?? 2400;
    if (d && engine.flyTo) engine.flyTo(v, d);
    else engine.setView(v);
  }, [engine, camera?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return (
    <MapView
      doc={shown}
      setDoc={() => {}}
      selected={null}
      setSelected={() => {}}
      selectedOverlay={null}
      tool={{ mode: 'select' }}
      setTool={() => {}}
      activeLayer={null}
      basemap={basemap}
      basemapOpacity={0.85}
      basemapDate={basemap?.dated ? (t ?? doc?.timeline?.start ?? '1945-04-16') : null}
      onEngineReady={setEngine}
      onStatus={() => {}}
      time={t}
      newFromNow={false}
    />
  );
});
