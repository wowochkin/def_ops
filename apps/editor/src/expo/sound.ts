/**
 * Звук стенда — только синтез WebAudio, без записей: фон штаба (низкий гул, далёкая канонада, телеграф) и событийные
 * звуки по смене состояния режиссёра. Громкость — из меню оператора: фон — «Громкость фона» при включённом «Фоновом
 * звуке», событийные звуки — тише голоса на той же громкости фона.
 */
import type { DirectorState } from './director';
import type { ExpoSettings } from './settings';

export type Cue = 'touch' | 'choose' | 'tick' | 'event' | 'reveal';

const left = (s: DirectorState) => {
  const p = s.phase;
  return p.kind === 'turn' && p.step === 'choose' && p.deadline !== null && s.pausedAt === null ? Math.ceil((p.deadline - s.now) / 1000) : null;
};

/** Какие звуки дать на смену состояния (на паузе — ничего). */
export function cuesFor(prev: DirectorState | null, next: DirectorState, flashes = 0): Cue[] {
  if (!prev || next.paused) return [];
  const a = prev.phase, b = next.phase, out: Cue[] = [];
  if (a.kind === 'attract' && b.kind === 'welcome') out.push('touch');
  if (a.kind === 'welcome' && b.kind === 'briefing') out.push('choose');
  if (a.kind === 'turn' && a.step === 'choose' && b.kind === 'turn' && b.step === 'scroll') out.push('choose');
  if (b.kind === 'result' && a.kind !== 'result') out.push('reveal');
  const was = left(prev), now = left(next);
  if (now !== null && now <= 10 && now > 0 && was !== null && now < was) out.push('tick');
  if (flashes > 0) out.push('event');
  return out;
}

/** Громкости: фон (0 — выключен) и событийные звуки. */
export function levels(v: ExpoSettings['volume']) {
  return { ambient: v.ambientOn ? v.ambient : 0, cue: Math.min(1, v.ambient * 0.8 + 0.1) };
}

type Ctx = AudioContext;

function noise(ctx: Ctx, seconds: number, brown = true) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    d[i] = brown ? (last = (last + 0.02 * w) / 1.02) * 3.5 : w;
  }
  return buf;
}

function thump(ctx: Ctx, out: AudioNode, gain: number, at = ctx.currentTime) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx, 1.6, false);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 90 + Math.random() * 60;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 1.5);
  src.connect(lp).connect(g).connect(out);
  src.start(at);
  src.stop(at + 1.6);
}

function tone(ctx: Ctx, out: AudioNode, freq: number, gain: number, len: number, at = ctx.currentTime, type: OscillatorType = 'sine') {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + len + 0.05);
}

/** Звук стенда в окне: `set` — громкости, `play` — событийный звук; без WebAudio — молча. */
export function soundEngine(make: () => Ctx | null = () => (typeof AudioContext === 'function' ? new AudioContext() : null)) {
  let ctx: Ctx | null = null, bed: GainNode | null = null, fx: GainNode | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  let lv = { ambient: 0, cue: 0 };
  const ensure = () => {
    if (ctx) return ctx;
    ctx = make();
    if (!ctx) return null;
    bed = ctx.createGain();
    fx = ctx.createGain();
    bed.gain.value = 0;
    bed.connect(ctx.destination);
    fx.connect(ctx.destination);
    const hum = ctx.createBufferSource();
    hum.buffer = noise(ctx, 4);
    hum.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const hg = ctx.createGain();
    hg.gain.value = 0.35;
    hum.connect(lp).connect(hg).connect(bed);
    hum.start();
    const life = () => {
      if (!ctx || !bed) return;
      if (lv.ambient > 0) {
        if (Math.random() < 0.6) thump(ctx, bed, 0.5 + Math.random() * 0.4);
        else for (let i = 0, t = ctx.currentTime; i < 3 + Math.floor(Math.random() * 6); i++, t += 0.09 + (Math.random() < 0.4 ? 0.18 : 0)) tone(ctx, bed, 980, 0.06, 0.06, t, 'square');
      }
      timer = setTimeout(life, 3000 + Math.random() * 9000);
    };
    life();
    return ctx;
  };
  return {
    set(v: ExpoSettings['volume']) {
      lv = levels(v);
      if (!ctx && lv.ambient === 0) return;
      const c = ensure();
      if (!c || !bed || !fx) return;
      bed.gain.setTargetAtTime(lv.ambient, c.currentTime, 0.5);
      fx.gain.setTargetAtTime(lv.cue, c.currentTime, 0.05);
    },
    play(cue: Cue) {
      const c = ensure();
      if (!c || !fx) return;
      fx.gain.value = lv.cue;
      void c.resume?.();
      const t = c.currentTime;
      if (cue === 'touch') { tone(c, fx, 440, 0.25, 0.25, t); tone(c, fx, 660, 0.2, 0.35, t + 0.12); }
      if (cue === 'choose') { tone(c, fx, 330, 0.25, 0.4, t, 'triangle'); tone(c, fx, 495, 0.2, 0.5, t + 0.15, 'triangle'); }
      if (cue === 'tick') tone(c, fx, 1200, 0.15, 0.04, t, 'square');
      if (cue === 'event') thump(c, fx, 0.8, t);
      if (cue === 'reveal') { tone(c, fx, 196, 0.2, 1.8, t, 'triangle'); tone(c, fx, 294, 0.15, 1.8, t + 0.05, 'triangle'); }
    },
    /** Разблокировать звук после первого касания (политика автозапуска). */
    resume() { void ctx?.resume?.(); },
    close() {
      if (timer) clearTimeout(timer);
      void ctx?.close?.();
      ctx = null;
    },
  };
}
