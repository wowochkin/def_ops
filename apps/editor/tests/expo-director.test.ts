import { describe, expect, it } from 'vitest';
import { EXPO_DEFAULTS, type ExpoSettings } from '../src/expo/settings';
import { INTRO_KEYS, INTRO_DURATION_MS } from '../src/expo/intro-story';
import { BRIEF_POINTS, briefKey, DEBOUNCE_MS, DURATIONS, INTRO_FALLBACK_MS, initialState, sceneKey, scrollMs, step, type DirectorEvent, type DirectorState, type Effect, type Phase } from '../src/expo/director';

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
    finishComment() {
      const p = state.phase;
      if (p.kind === 'turn' && p.commenting) api.send({ t: 'commentDone', n: p.n, session: state.session, token: p.commenting.token });
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
  return run(cfg).send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'introDone' }, { t: 'pickFront', front: 'su_1bf' }).wait(DURATIONS.briefing).wait(DURATIONS.explain);
}

describe('режиссёр сеанса', () => {
  const timed = cfgWith({ timer: { on: true, seconds: 30 } });
  it('full session path', () => {
    const r = run(timed).send({ t: 'ready' });
    expect(r.phase.kind).toBe('attract');
    r.wait(DEBOUNCE_MS).send({ t: 'touch' });
    expect(r.phase.kind).toBe('intro');
    r.send({ t: 'introDone' });
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
      r.send({ t: 'scrollDone' }).finishComment();
    }
    r.send({ t: 'debriefReady' });
    expect(r.phase.kind).toBe('result');
    expect(r.effects.filter((e) => e.e === 'stat')).toEqual([{ e: 'stat', kind: 'started' }, { e: 'stat', kind: 'finished' }]);
    expect(r.state.stats).toEqual({ sessions: 1, finished: 1 });
    r.wait(19_000);
    expect(r.phase.kind).toBe('result');
    r.wait(1_000);
    expect(r.phase.kind).toBe('result');
    expect(r.phase.kind === 'result' && r.phase.leave).toBeTypeOf('number');
    r.wait(20_000);
    expect(r.phase.kind).toBe('attract');
  });

  it('model effects: deal on entering a turn, decide on choice and on delay, replace', () => {
    const r = toChoose(timed);
    expect(r.effects).toContainEqual({ e: 'deal', n: 1, front: 'su_1bf' });
    r.send({ t: 'replace', card: 2 });
    expect(r.effects.at(-1)).toEqual({ e: 'replace', n: 1, card: 2 });
    r.send({ t: 'choose', card: 1 });
    expect(r.effects).toContainEqual({ e: 'decide', n: 1, choice: 1 });
    r.send({ t: 'scrollDone' }).finishComment();
    expect(r.effects).toContainEqual({ e: 'deal', n: 2, front: 'su_1bf' });
    r.wait(DURATIONS.explain + 30_000);
    expect(r.effects).toContainEqual({ e: 'decide', n: 2, choice: 'delay' });
    const j = run().send({ t: 'ready' }, { t: 'jump', phase: 'turn', n: 3 });
    expect(j.effects).toContainEqual({ e: 'deal', n: 3, front: EXPO_DEFAULTS.fronts[0] });
  });

  it('single front skips choice', () => {
    const r = run(cfgWith({ fronts: ['su_1uf'] })).send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'introDone' });
    expect(r.phase.kind).toBe('welcome');
    r.wait(DEBOUNCE_MS).send({ t: 'touch' });
    expect(r.phase.kind).toBe('briefing');
    expect(r.state.front).toBe('su_1uf');
  });

  it('two fronts: touch keeps welcome, unknown front ignored', () => {
    const r = run(cfgWith({ fronts: ['su_1bf'] , })).send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'introDone' });
    r.send({ t: 'pickFront', front: 'su_1uf' });
    expect(r.phase.kind).toBe('welcome');
    const r2 = run().send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'touch' });
    expect(r2.phase.kind).toBe('intro');
  });

  it('briefing skipped by next', () => {
    const r = run().send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'introDone' }, { t: 'pickFront', front: 'su_1uf' }, { t: 'next' });
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'explain' });
  });

  it('timer warns and delays', () => {
    const r = toChoose(timed);
    expect(turn(r.phase)?.step).toBe('choose');
    const mark = r.effects.length;
    r.wait(19_750);
    expect(says(r.since(mark), 'timer-warn')).toBe(false);
    r.wait(250);
    expect(r.since(mark)).toContainEqual({ e: 'say', key: 'timer-warn', priority: 'timer', scene: 'turn-1-choose' });
    expect(turn(r.phase)?.warned).toBe(true);
    expect(r.since(mark).filter((e) => e.e === 'say' && e.key === 'timer-warn')).toHaveLength(1);
    r.wait(10_000);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll', choice: 'delay' });
    expect(says(r.since(mark), 'delay')).toBe(true);
  });

  it('timer off waits and does not decide for the visitor', () => {
    const r = toChoose(cfgWith({ timer: { on: false, seconds: 30 } })).send({ t: 'touch' });
    expect(r.phase).toMatchObject({ kind: 'turn', step: 'choose', deadline: null });
    const mark = r.effects.length;
    r.wait(120_000);
    expect(r.phase).toMatchObject({ step: 'choose', choice: null });
    expect(r.since(mark).some((e) => e.e === 'decide' || e.e === 'aiPick' || (e.e === 'say' && (e.key === 'delay' || e.key === 'offer-decide')))).toBe(false);
  });

  it('the result stays while the account is still being spoken, then warns before the attract screen', () => {
    const r = run().send({ t: 'jump', phase: 'result' }).send({ t: 'hold', ms: 60_000 });
    r.wait(25_000);
    expect(r.phase.kind).toBe('result');
    r.wait(40_000);
    expect(r.phase).toMatchObject({ kind: 'result', leave: 80_000 });
    r.send({ t: 'stay' });
    expect(r.phase).toMatchObject({ kind: 'result', quiet: true });
    expect(r.phase.kind === 'result' && r.phase.leave).toBeUndefined();
    r.wait(20_000);
    expect(r.phase.kind).toBe('result');
    r.wait(70_000);
    expect(r.phase).toMatchObject({ kind: 'result', leave: 175_000 });
    r.wait(20_000);
    expect(r.phase.kind).toBe('attract');
  });

  it('marking a front does not start the briefing; the launch does', () => {
    const r = run().send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'introDone' });
    r.send({ t: 'markFront', front: 'su_1uf' });
    expect(r.phase.kind).toBe('welcome');
    expect(r.state.front).toBe('su_1uf');
    expect(r.effects).toContainEqual({ e: 'say', key: 'marshal-su_1uf', priority: 'scene', scene: 'welcome' });
    r.send({ t: 'pickFront', front: 'su_1uf' });
    expect(r.phase.kind).toBe('briefing');
  });

  it('back from the front choice returns to the attract screen', () => {
    const r = run().send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'introDone' });
    expect(r.phase.kind).toBe('welcome');
    r.send({ t: 'back' });
    expect(r.phase.kind).toBe('attract');
    expect(r.state.front).toBeNull();
    r.send({ t: 'back' });
    expect(r.phase.kind).toBe('attract');
  });

  it('situation and decision tabs switch without dealing again', () => {
    const r = toChoose(timed);
    expect(r.phase).toMatchObject({ step: 'choose' });
    const mark = r.effects.length;
    r.send({ t: 'step', step: 'explain' });
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'explain', choice: null });
    expect(r.since(mark).some((e) => e.e === 'deal' || e.e === 'say')).toBe(false);
    expect(r.since(mark)).toContainEqual({ e: 'scene', key: 'turn-1-explain' });
    r.send({ t: 'step', step: 'choose' });
    expect(r.phase).toMatchObject({ step: 'choose' });
    if (r.phase.kind === 'turn') expect(r.phase.deadline).not.toBeNull();
    r.send({ t: 'choose', card: 0 });
    expect(r.phase).toMatchObject({ step: 'scroll' });
    r.send({ t: 'step', step: 'explain' });
    expect(r.phase).toMatchObject({ step: 'scroll' });
  });

  it('situation after a decision is the marshal line', () => {
    const r = toChoose().send({ t: 'choose', card: 0 }).send({ t: 'scrollDone' }).finishComment();
    expect(r.phase).toMatchObject({ kind: 'turn', n: 2, step: 'explain' });
    expect(r.effects).toContainEqual({ e: 'say', key: 'situation-su_1bf-2', priority: 'scene', scene: 'turn-2-explain' });
    r.wait(DURATIONS.explain).send({ t: 'choose', card: 0 }).send({ t: 'scrollDone' }).finishComment();
    expect(r.phase).toMatchObject({ n: 3, step: 'explain' });
    expect(r.effects).toContainEqual({ e: 'say', key: 'situation-su_1bf-3', priority: 'scene', scene: 'turn-3-explain' });
  });

  it('timer off: not choosing does not start the move', () => {
    const off = cfgWith({ timer: { on: false, seconds: 30 } });
    const r = toChoose(off).send({ t: 'choose', card: 1 }).send({ t: 'scrollDone' }).finishComment().wait(DURATIONS.explain);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 2, step: 'choose' });
    const mark = r.effects.length;
    r.wait(120_000);
    expect(r.phase).toMatchObject({ step: 'choose', choice: null });
    expect(r.since(mark).some((e) => e.e === 'decide' || e.e === 'aiPick' || e.e === 'newSession')).toBe(false);
  });

  it('passive viewer not kicked', () => {
    const off = cfgWith({ timer: { on: false, seconds: 30 } });
    const r = run(off).send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'introDone' }, { t: 'pickFront', front: 'su_1bf' });
    const mark = r.effects.length;
    r.wait(DURATIONS.briefing + DURATIONS.explain + 60_000);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'choose', choice: null });
    expect(r.since(mark).some((e) => e.e === 'decide' || e.e === 'aiPick' || e.e === 'newSession')).toBe(false);
    r.send({ t: 'choose', card: 0 }).send({ t: 'scrollDone' }).finishComment().wait(DURATIONS.explain);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 2, step: 'choose' });
  });

  it('timer on: passive viewer gets delays, not idle', () => {
    const r = run(timed).send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'introDone' }, { t: 'pickFront', front: 'su_1bf' });
    const mark = r.effects.length;
    r.wait(DURATIONS.briefing + DURATIONS.explain + 30_000);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll', choice: 'delay' });
    expect(r.since(mark).some((e) => e.e === 'newSession')).toBe(false);
  });

  it('idle in welcome returns', () => {
    const r = run().send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'introDone' }).wait(89_750);
    expect(r.phase.kind).toBe('welcome');
    r.wait(250);
    expect(r.phase.kind).toBe('attract');
    expect(r.effects).toContainEqual({ e: 'newSession' });
  });

  it('double touch does not skip', () => {
    const one = cfgWith({ fronts: ['su_1uf'] });
    const r = run(one).send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'introDone' }).wait(100).send({ t: 'touch' });
    expect(r.phase.kind).toBe('welcome');
    r.wait(DEBOUNCE_MS).send({ t: 'touch' });
    expect(r.phase.kind).toBe('briefing');
    // Итог: двойное касание «Ещё раз» — только welcome.
    const q = run(one).send({ t: 'ready' }, { t: 'jump', phase: 'result' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'touch' });
    expect(q.phase.kind).toBe('welcome');
    // Касание сразу после входа в фазу не продвигает её.
    const a = run().send({ t: 'ready' }, { t: 'touch' });
    expect(a.phase.kind).toBe('attract');
  });

  it('long timer beats idle', () => {
    const cfg = cfgWith({ timer: { on: true, seconds: 120 }, idleSeconds: 90 });
    const r = toChoose(cfg).send({ t: 'touch' });
    r.wait(119_750);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'choose' });
    r.wait(250);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll', choice: 'delay' });
    expect(r.effects.some((e) => e.e === 'newSession')).toBe(false);
  });

  it('scroll does not end on the clock, only when the map finishes', () => {
    const r = toChoose().send({ t: 'choose', card: 0 });
    r.wait(scrollMs('su_1bf', 1) + 5_000);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll' });
    r.send({ t: 'scrollDone' });
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll' });
    r.finishComment();
    expect(r.phase).toMatchObject({ kind: 'turn', n: 2, step: 'explain' });
  });
  it('double choose ignored', () => {
    const r = toChoose().send({ t: 'choose', card: 0 }, { t: 'choose', card: 2 });
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll', choice: 0 });
    r.wait(scrollMs('su_1bf', 1) - 250);
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll' });
  });

  it('operator pause freezes timers', () => {
    const r = toChoose(timed).wait(25_000);
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
    const r = toChoose().send({ t: 'replace', card: 0 }, { t: 'replace', card: 1 }, { t: 'replace', card: 2 }, { t: 'replace', card: 0 }, { t: 'replace', card: 1 });
    expect(turn(r.phase)?.replacements).toBe(EXPO_DEFAULTS.maxReplacements);
    r.send({ t: 'choose', card: 0 }).send({ t: 'scrollDone' }).finishComment().wait(DURATIONS.explain);
    expect(r.phase).toMatchObject({ n: 2, step: 'choose', replacements: 0 });
  });

  it('restart from any phase', () => {
    const r = toChoose().send({ t: 'choose', card: 0 }).send({ t: 'scrollDone' }).finishComment().wait(DURATIONS.explain).send({ t: 'choose', card: 1 });
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

  it('speak asks voice and counts as input', () => {
    const r = run().send({ t: 'ready' });
    const mark = r.effects.length;
    r.send({ t: 'speak' });
    expect(r.since(mark)).toEqual([]);
    const c = toChoose().wait(5_000).send({ t: 'speak' });
    expect(c.effects).toContainEqual({ e: 'listen' });
    expect(c.effects.some((e) => e.e === 'say' && e.key === 'voice-soon')).toBe(false);
    expect(c.state.lastInput).toBe(c.now);
    expect(c.phase).toMatchObject({ kind: 'turn', step: 'choose' });
  });

  it('step is pure', () => {
    const s = initialState(0);
    const snap = JSON.stringify(s);
    step(s, { t: 'ready' }, EXPO_DEFAULTS);
    expect(JSON.stringify(s)).toBe(snap);
  });
});

describe('голос и ИИ в режиссёре', () => {
  const toIntro = () => run().send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' });
  it('без очереди интро ждёт срок 12 сцен; длинная предзапись завершается по голосу', () => {
    expect(INTRO_FALLBACK_MS).toBe(INTRO_DURATION_MS);
    const silent = toIntro().wait(INTRO_FALLBACK_MS - 1);
    expect(silent.phase.kind).toBe('intro');
    silent.wait(1);
    expect(silent.phase.kind).toBe('welcome');
    const speaking = toIntro().send({ t: 'introVoice', playing: true }).wait(INTRO_FALLBACK_MS + 10_000);
    expect(speaking.phase.kind).toBe('intro');
    speaking.send({ t: 'introDone' });
    expect(speaking.phase.kind).toBe('welcome');
  });
  it('конец речи во время меню запоминается; закрытие меню открывает выбор фронта', () => {
    const r = toIntro().send({ t: 'introVoice', playing: true }, { t: 'pause' }).wait(60_000).send({ t: 'introDone' });
    expect(r.phase.kind).toBe('intro');
    r.send({ t: 'resume' });
    expect(r.phase.kind).toBe('welcome');
  });
  it('неудачная загрузка клипов возвращает запасной срок, а смена настройки не обрывает интро', () => {
    const r = toIntro().send({ t: 'introVoice', playing: true }).wait(10_000).send({ t: 'introVoice', playing: false });
    expect(step(r.state, { t: 'touch' }, cfgWith({ intro: false })).state.phase.kind).toBe('intro');
    r.wait(INTRO_FALLBACK_MS - 10_000);
    expect(r.phase.kind).toBe('welcome');
  });
  const s0 = (phase: Phase): DirectorState => ({ ...initialState(0), phase, front: 'su_1bf', phaseStart: -10_000, now: 0 });
  it('вопрос — эффект ask, «Говорить» — фраза и listen; в заставке — ничего', () => {
    const turn: Phase = { kind: 'turn', n: 1, step: 'choose', deadline: null, warned: false, offered: false, choice: null, replacements: 0 };
    expect(step(s0(turn), { t: 'ask', q: ' Почему высоты? ' }, EXPO_DEFAULTS).effects).toEqual([{ e: 'ask', q: 'Почему высоты?' }]);
    expect(step(s0(turn), { t: 'speak' }, EXPO_DEFAULTS).effects.map((e) => e.e)).toEqual(['listen']);
    expect(step(s0({ kind: 'attract' }), { t: 'ask', q: 'x' }, EXPO_DEFAULTS).effects).toEqual([]);
  });
  it('вход в фазу сопровождается фразой', () => {
    const r = step(s0({ kind: 'attract' }), { t: 'touch' }, cfgWith({ intro: true }));
    expect(r.state.phase).toEqual({ kind: 'intro' });
    expect(r.effects).toContainEqual({ e: 'say', key: 'intro-1', priority: 'scene', scene: 'intro' });
    expect(r.effects.filter((e) => e.e === 'say').map((e) => e.key)).toEqual(INTRO_KEYS);
    expect(r.effects.findIndex((e) => e.e === 'scene')).toBeLessThan(r.effects.findIndex((e) => e.e === 'say'));
  });
  it('выключенное интро пропускается', () => {
    const r = step(s0({ kind: 'attract' }), { t: 'touch' }, cfgWith({ intro: false }));
    expect(r.state.phase).toEqual({ kind: 'welcome' });
  });
  it('интро кончается речью или пропуском и не кончается касанием', () => {
    const open = step(s0({ kind: 'intro' }), { t: 'introDone' }, EXPO_DEFAULTS);
    expect(open.state.phase).toEqual({ kind: 'welcome' });
    const skip = step(s0({ kind: 'intro' }), { t: 'skipIntro' }, EXPO_DEFAULTS);
    expect(skip.state.phase).toEqual({ kind: 'welcome' });
    const tap = step(s0({ kind: 'intro' }), { t: 'touch' }, EXPO_DEFAULTS);
    expect(tap.state.phase.kind).toBe('intro');
  });
});

describe('ввод в обстановку — доклад по пунктам', () => {
  const toBrief = () => run().send({ t: 'ready' }).wait(DEBOUNCE_MS).send({ t: 'touch' }, { t: 'introDone' }, { t: 'pickFront', front: 'su_1bf' });
  it('каждый пункт — своя сцена и своя фраза; пункт меняется по концу фразы', () => {
    const r = toBrief();
    expect(r.phase).toEqual({ kind: 'briefing', point: 0 });
    expect(says(r.effects, briefKey('su_1bf', 0))).toBe(true);
    r.send({ t: 'briefDone', point: 0 });
    expect(r.phase).toEqual({ kind: 'briefing', point: 1 });
    expect(r.effects).toContainEqual({ e: 'scene', key: sceneKey(r.state) });
    expect(says(r.effects, 'brief-su_1bf-2')).toBe(true);
    // запоздалый конец фразы прежнего пункта ничего не меняет
    r.send({ t: 'briefDone', point: 0 });
    expect(r.phase).toEqual({ kind: 'briefing', point: 1 });
  });
  it('посетитель листает и пропускает доклад; без голоса пункты идут по сроку', () => {
    const r = toBrief();
    r.send({ t: 'brief', point: 4 });
    expect(r.phase).toEqual({ kind: 'briefing', point: 4 });
    r.wait(DURATIONS.briefPoint);
    expect(r.phase).toEqual({ kind: 'briefing', point: 5 });
    // последний пункт по концу фразы не уходит — ждёт срока или «К решениям»
    r.send({ t: 'briefDone', point: BRIEF_POINTS - 1 });
    expect(r.phase).toEqual({ kind: 'briefing', point: 5 });
    r.send({ t: 'next' });
    expect(r.phase).toMatchObject({ kind: 'turn', n: 1, step: 'explain' });
    // статистика: сеанс начат один раз, а не на каждом пункте
    expect(r.effects.filter((e) => e.e === 'stat' && e.kind === 'started')).toHaveLength(1);
  });
});

it('кнопка голоса переключает флаг и не двигает сеанс', () => {
  const s = initialState(0);
  expect(s.voice).toBe(true);
  const r = step(s, { t: 'voice' }, EXPO_DEFAULTS);
  expect(r.state.voice).toBe(false);
  expect(r.state.phase).toEqual(s.phase);
  expect(r.effects).toEqual([]);
  expect(step(r.state, { t: 'voice' }, EXPO_DEFAULTS).state.voice).toBe(true);
});
