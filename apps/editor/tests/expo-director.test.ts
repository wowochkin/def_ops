import { describe, expect, it } from 'vitest';
import { EXPO_DEFAULTS, type ExpoSettings } from '../src/expo/settings';
import { DURATIONS, initialState, step, type DirectorEvent, type DirectorState, type Effect, type Phase } from '../src/expo/director';

const cfgWith = (patch: Partial<ExpoSettings>): ExpoSettings => ({ ...JSON.parse(JSON.stringify(EXPO_DEFAULTS)), ...patch });

/** Прогон событий от initialState(0): часы двигает wait (тиками по 250 мс, как оболочка). */
function run(cfg: ExpoSettings = EXPO_DEFAULTS) {
  let state: DirectorState = initialState(0);
  let now = 0;
  const effects: Effect[] = [];
  const api = {
    get state() { return state; },
    get phase(): Phase { return state.phase; },
    effects,
    get now() { return now; },
    send(...evs: DirectorEvent[]) {
      for (const ev of evs) {
        if (ev.t === 'tick') now = ev.now;
        const r = step(state, ev, cfg);
        state = r.state;
        effects.push(...r.effects);
      }
      return api;
    },
    wait(ms: number) {
      const end = now + ms;
      while (now < end) api.send({ t: 'tick', now: Math.min(end, now + 250) });
      return api;
    },
    /** Эффекты с момента отметки. */
    since(mark: number) { return effects.slice(mark); },
  };
  return api;
}

const says = (fx: Effect[], key: string) => fx.some((e) => e.e === 'say' && e.key === key);
const turn = (p: Phase) => (p.kind === 'turn' ? p : null);

/** До выбора в переломе 1: ready, touch, pickFront, бриф и пояснение по времени. */
function toChoose(cfg: ExpoSettings = EXPO_DEFAULTS) {
  return run(cfg).send({ t: 'ready' }, { t: 'touch' }, { t: 'pickFront', front: 'su_1bf' }).wait(DURATIONS.briefing).wait(DURATIONS.explain);
}

describe('режиссёр сеанса', () => {
  it('full session path', () => {
    const r = run().send({ t: 'ready' });
    expect(r.phase.kind).toBe('attract');
    r.send({ t: 'touch' });
    expect(r.phase.kind).toBe('welcome');
    r.send({ t: 'pickFront', front: 'su_1bf' });
    expect(r.phase.kind).toBe('briefing');
    expect(r.state.front).toBe('su_1bf');
    r.wait(DURATIONS.briefing);
    for (const n of [1, 2, 3] as const) {
      expect(r.phase).toMatchObject({ kind: 'turn', n, step: 'explain' });
      r.wait(DURATIONS.explain);
      expect(r.phase).toMatchObject({ kind: 'turn', n, step: 'choose', choice: null, deadline: r.now + 30_000 });
      r.send({ t: 'choose', card: 0 });
      expect(r.phase).toMatchObject({ kind: 'turn', n, step: 'scroll', choice: 0 });
      r.wait(DURATIONS.scroll);
    }
    expect(r.phase.kind).toBe('result');
    expect(r.effects.filter((e) => e.e === 'stat')).toEqual([{ e: 'stat', kind: 'started' }, { e: 'stat', kind: 'finished' }]);
    expect(r.state.stats).toEqual({ sessions: 1, finished: 1 });
    r.wait(19_000);
    expect(r.phase.kind).toBe('result');
    r.wait(1_000);
    expect(r.phase.kind).toBe('attract');
  });

  it('single front skips choice', () => {
    const r = run(cfgWith({ fronts: ['su_1uf'] })).send({ t: 'ready' }, { t: 'touch' });
    expect(r.phase.kind).toBe('welcome');
    r.send({ t: 'touch' });
    expect(r.phase.kind).toBe('briefing');
    expect(r.state.front).toBe('su_1uf');
  });

  it('two fronts: touch keeps welcome, unknown front ignored', () => {
    const r = run(cfgWith({ fronts: ['su_1bf'] , })).send({ t: 'ready' }, { t: 'touch' });
    r.send({ t: 'pickFront', front: 'su_1uf' });
    expect(r.phase.kind).toBe('welcome');
    const r2 = run().send({ t: 'ready' }, { t: 'touch' }, { t: 'touch' });
    expect(r2.phase.kind).toBe('welcome');
  });

  it('briefing skipped by next', () => {
    const r = run().send({ t: 'ready' }, { t: 'touch' }, { t: 'pickFront', front: 'su_1uf' }, { t: 'next' });
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'explain' });
  });

  it('timer warns and delays', () => {
    const r = toChoose();
    expect(turn(r.phase)?.step).toBe('choose');
    const mark = r.effects.length;
    r.wait(19_750);
    expect(says(r.since(mark), 'timer-warn')).toBe(false);
    r.wait(250);
    expect(r.since(mark)).toContainEqual({ e: 'say', key: 'timer-warn', priority: 'timer' });
    expect(turn(r.phase)?.warned).toBe(true);
    expect(r.since(mark).filter((e) => e.e === 'say' && e.key === 'timer-warn')).toHaveLength(1);
    r.wait(10_000);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll', choice: 'delay' });
    expect(says(r.since(mark), 'delay')).toBe(true);
  });

  it('timer off offers then ai picks', () => {
    const r = toChoose(cfgWith({ timer: { on: false, seconds: 30 } })).send({ t: 'touch' });
    expect(r.phase).toMatchObject({ kind: 'turn', step: 'choose', deadline: null });
    const mark = r.effects.length;
    r.wait(30_000);
    expect(says(r.since(mark), 'offer-decide')).toBe(true);
    expect(turn(r.phase)?.offered).toBe(true);
    expect(r.since(mark).some((e) => e.e === 'aiPick')).toBe(false);
    r.wait(30_000);
    expect(r.since(mark).filter((e) => e.e === 'aiPick')).toEqual([{ e: 'aiPick', n: 1 }]);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'choose', choice: null });
    r.wait(5_000);
    expect(r.since(mark).filter((e) => e.e === 'aiPick')).toHaveLength(1);
    r.send({ t: 'choose', card: 2 });
    expect(r.phase).toMatchObject({ step: 'scroll', choice: 2 });
  });

  it('idle returns to attract', () => {
    const r = toChoose().send({ t: 'choose', card: 1 }).wait(DURATIONS.scroll);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 2, step: 'explain' });
    r.send({ t: 'touch' });
    const mark = r.effects.length;
    const session = r.state.session;
    r.wait(89_750);
    expect(r.phase.kind).toBe('turn');
    r.wait(250);
    expect(r.phase.kind).toBe('attract');
    expect(r.since(mark)).toContainEqual({ e: 'newSession' });
    expect(r.state.session).toBe(session + 1);
    r.wait(200_000);
    expect(r.phase.kind).toBe('attract');
  });

  it('double choose ignored', () => {
    const r = toChoose().send({ t: 'choose', card: 0 }, { t: 'choose', card: 2 });
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll', choice: 0 });
    r.wait(DURATIONS.scroll - 250);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll' });
  });

  it('operator pause freezes timers', () => {
    const r = toChoose().wait(25_000);
    expect(turn(r.phase)?.step).toBe('choose');
    const mark = r.effects.length;
    r.send({ t: 'pause' }).wait(120_000);
    expect(r.state.paused).toBe(true);
    expect(r.phase).toMatchObject({ kind: 'turn', step: 'choose', choice: null });
    r.send({ t: 'touch', }, { t: 'choose', card: 1 });
    expect(turn(r.phase)?.choice).toBeNull();
    r.send({ t: 'resume' }).wait(4_000);
    expect(r.state.paused).toBe(false);
    expect(r.phase).toMatchObject({ kind: 'turn', step: 'choose' });
    r.wait(2_000);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll', choice: 'delay' });
    expect(r.since(mark).some((e) => e.e === 'newSession')).toBe(false);
  });

  it('replace limited', () => {
    const r = toChoose().send({ t: 'replace', card: 0 }, { t: 'replace', card: 1 }, { t: 'replace', card: 2 });
    expect(turn(r.phase)?.replacements).toBe(2);
    r.send({ t: 'choose', card: 0 }).wait(DURATIONS.scroll).wait(DURATIONS.explain);
    expect(r.phase).toMatchObject({ n: 2, step: 'choose', replacements: 0 });
  });

  it('restart from any phase', () => {
    const r = toChoose().send({ t: 'choose', card: 0 }).wait(DURATIONS.scroll).wait(DURATIONS.explain).send({ t: 'choose', card: 1 });
    expect(r.phase).toMatchObject({ kind: 'turn', n: 2, step: 'scroll' });
    const mark = r.effects.length;
    const session = r.state.session;
    r.send({ t: 'restart' });
    expect(r.phase.kind).toBe('welcome');
    expect(r.state.session).toBe(session + 1);
    expect(r.since(mark)).toContainEqual({ e: 'newSession' });
    const a = run().send({ t: 'ready', }, { t: 'restart' });
    expect(a.phase.kind).toBe('attract');
  });

  it('jump for demo', () => {
    const r = run().send({ t: 'ready' }).wait(1_000).send({ t: 'jump', phase: 'turn', n: 3 });
    expect(r.phase).toMatchObject({ kind: 'turn', n: 3, step: 'explain', choice: null, replacements: 0 });
    expect(r.state.phaseStart).toBe(1_000);
    r.wait(DURATIONS.explain);
    expect(r.phase).toMatchObject({ n: 3, step: 'choose' });
  });

  it('step is pure', () => {
    const s = initialState(0);
    const snap = JSON.stringify(s);
    step(s, { t: 'ready' }, EXPO_DEFAULTS);
    expect(JSON.stringify(s)).toBe(snap);
  });
});
