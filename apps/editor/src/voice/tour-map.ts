/**
 * Карта на шаге тура (разбор хода): карта плавно переезжает к месту (или показывает все точки шага), там — метка-пульс
 * и рамка вокруг участников (подсветка voice/highlight, слой FlashLayer); общий шаг проигрывает ход — время карты идёт
 * от начала хода к концу (движение войск, линия фронта, зоны влияния сдвигаются). Пауза — проигрывание встаёт; конец
 * разбора — время карты снова «сейчас», подсветка снята. Чистый модуль (без React): CommandView подключает его к
 * своей карте (tour.tsx, setTourMap); кадры и часы — снаружи (в окне — requestAnimationFrame).
 */
import type { LngLat } from '@def-ops/core';
import type { MapEngine } from '../engine/types';
import { showAt } from '../engine/free-center';
import { flash, flashState } from './highlight';
import type { TourMapControl } from './tour';

/** Переезд карты к месту шага, мс. */
export const MOVE_MS = 1200;
/** Проигрывание хода на общем шаге, мс. */
export const PLAY_MS = 7000;
/** Метка и рамка держатся, пока идёт шаг (снимает следующий шаг или конец разбора). */
const HOLD_MS = 120_000;
/** Масштаб «показать все точки»: не мельче и не крупнее. */
const FIT_MIN = 7.5, FIT_MAX = 10.5;
/** Доля карты под точками шага (остальное — поля, панель голоса, легенда). */
const FIT_SHARE = 0.55;

export type TourMapEngine = Pick<MapEngine, 'getView' | 'setView' | 'project' | 'unproject' | 'size'> & Partial<Pick<MapEngine, 'getContainer'>>;
export interface TourMapDeps {
  engine(): TourMapEngine | null;
  setTime(t: string): void;
  /** Время карты «сейчас» (конец хода): к нему карта возвращается. */
  now(): string | null;
  frame(cb: () => void): number;
  cancel(id: number): void;
  clock(): number;
}

const ms = (t: string) => Date.parse(`${t}Z`);
const iso = (n: number) => new Date(n).toISOString().slice(0, 16);
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Масштаб, при котором точки pts занимают долю карты FIT_SHARE (одна точка — без изменения). */
function fitView(en: TourMapEngine, pts: LngLat[]): { center: LngLat; zoom: number } {
  const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
  const center: LngLat = [(Math.min(...lng) + Math.max(...lng)) / 2, (Math.min(...lat) + Math.max(...lat)) / 2];
  const z0 = en.getView().zoom;
  const px = pts.map((p) => en.project(p));
  const w = Math.max(...px.map((p) => p[0])) - Math.min(...px.map((p) => p[0])), h = Math.max(...px.map((p) => p[1])) - Math.min(...px.map((p) => p[1]));
  const { width, height } = en.size();
  const k = Math.min((width * FIT_SHARE) / Math.max(w, 1), (height * FIT_SHARE) / Math.max(h, 1));
  const zoom = pts.length < 2 ? z0 : Math.min(FIT_MAX, Math.max(FIT_MIN, z0 + Math.log2(k)));
  return { center, zoom: Math.round(zoom * 4) / 4 };
}

export function createTourMap(d: TourMapDeps): TourMapControl {
  let anim: number | null = null;
  let seq = 0;
  /** Подсветка, которую поставил разбор (чужую — подсветку команды — не снимать). */
  let mine: number | null = null;
  const stop = () => { if (anim !== null) d.cancel(anim); anim = null; };
  const run = (dur: number, f: (k: number) => void, done?: () => void) => {
    const my = ++seq, t0 = d.clock();
    const tick = () => {
      if (my !== seq) return;
      const k = Math.min(1, (d.clock() - t0) / dur);
      f(k);
      if (k < 1) anim = d.frame(tick); else { anim = null; done?.(); }
    };
    tick();
  };
  const unflash = () => { if (mine !== null && flashState()?.seq === mine) flash(null); mine = null; };

  return {
    show(m) {
      stop(); seq++;
      unflash();
      const en = d.engine();
      const now = d.now();
      if (m.play) d.setTime(m.play[0]); else if (now) d.setTime(now);
      const mark = () => {
        const t = [...(m.box && m.box.length > 1 ? [{ box: m.box }] : []), ...(m.spot ? [{ at: m.spot }] : [])];
        if (t.length) { flash(t, HOLD_MS); mine = flashState()?.seq ?? null; }
      };
      const play = () => {
        mark();
        if (!m.play) return;
        const [a, b] = m.play.map(ms);
        run(PLAY_MS, (k) => d.setTime(iso(a + Math.round(((b - a) * k) / 60_000) * 60_000)));
      };
      if (!en) { play(); return; }
      // куда: место (свободная часть карты, не под панелью и легендой) или все точки шага
      // fit с zoom — показать точки целиком, но не крупнее zoom (место боя: участники рядом — виден участок вокруг)
      const fit = m.fit && m.fit.length > 1 ? fitView(en, m.fit) : null;
      const target = fit ? { center: fit.center, zoom: m.zoom !== undefined ? Math.min(fit.zoom, m.zoom) : fit.zoom }
        : m.at ?? m.fit?.[0] ? { center: (m.at ?? m.fit![0]), zoom: m.zoom ?? en.getView().zoom } : null;
      if (!target) { play(); return; }
      const from = en.getView();
      showAt(en, target.center, target.zoom);
      const to = en.getView();
      en.setView(from);
      run(MOVE_MS, (k) => {
        const e = ease(k);
        en.setView({ center: [from.center[0] + (to.center[0] - from.center[0]) * e, from.center[1] + (to.center[1] - from.center[1]) * e], zoom: from.zoom + (to.zoom - from.zoom) * e });
      }, play);
    },
    pause() { stop(); seq++; },
    reset() {
      stop(); seq++;
      unflash();
      const now = d.now();
      if (now) d.setTime(now);
    },
  };
}
