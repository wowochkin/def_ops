import { describe, expect, it } from 'vitest';
import { initialState, step, type DirectorState } from '../src/expo/director';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import { INTRO_KEYS, INTRO_CUES, introCueStart, introGap } from '../src/expo/intro-story';

const showing = (): DirectorState => ({ ...initialState(30_000), phase: { kind: 'intro', voiced: true } });

describe('ручное переключение интро', () => {
  it('сразу меняет раздел и ставит в очередь только его и оставшиеся реплики', () => {
    const before = showing();
    const { state, effects } = step(before, { t: 'introSeek', line: 2 }, EXPO_DEFAULTS);
    expect(state.phase).toEqual({ kind: 'intro', line: 2 });
    expect(state.phaseStart).toBe(before.now - introCueStart(2));
    expect(state.session).toBe(before.session);
    expect(state.lastInput).toBe(30_000);
    expect(effects).toEqual([
      { e: 'scene', key: 'intro' },
      ...INTRO_KEYS.slice(1).map(key => ({ e: 'say', key, priority: 'scene', scene: 'intro' })),
    ]);
  });

  it('без очереди оставляет финальную сцену и трёхсекундную паузу целиком', () => {
    let selected = step(showing(), { t: 'introSeek', line: INTRO_CUES.length }, EXPO_DEFAULTS).state;
    const end = selected.now + INTRO_CUES.at(-1)!.durationMs + introGap(INTRO_CUES.length - 1);
    while (selected.now < end - 1) selected = step(selected, { t: 'tick', now: Math.min(end - 1, selected.now + 250) }, EXPO_DEFAULTS).state;
    expect(selected.phase.kind).toBe('intro');
    expect(step(selected, { t: 'tick', now: end }, EXPO_DEFAULTS).state.phase.kind).toBe('welcome');
  });

  it('автоматическая очередь обновляет авторитетный номер раздела', () => {
    const state = step(showing(), { t: 'introVoice', playing: true, line: 4 }, EXPO_DEFAULTS).state;
    expect(state.phase).toEqual({ kind: 'intro', voiced: true, line: 4 });
  });

  it('без исполнителя речи после ручного перехода продолжает переключать разделы по часам', () => {
    let state = step(showing(), { t: 'introSeek', line: 2 }, EXPO_DEFAULTS).state;
    const next = state.now + INTRO_CUES[1].durationMs + introGap(1);
    while (state.now < next) state = step(state, { t: 'tick', now: Math.min(next, state.now + 250) }, EXPO_DEFAULTS).state;
    expect(state.phase).toEqual({ kind: 'intro', line: 3 });
  });

  it('отклоняет неверный номер, ввод на паузе и переключение вне интро', () => {
    const intro = showing();
    for (const line of [0, -1, INTRO_CUES.length + 1, 1.5, NaN, Infinity]) {
      expect(step(intro, { t: 'introSeek', line }, EXPO_DEFAULTS)).toEqual({ state: intro, effects: [] });
    }
    const paused = { ...intro, paused: true, pausedAt: intro.now };
    expect(step(paused, { t: 'introSeek', line: 3 }, EXPO_DEFAULTS)).toEqual({ state: paused, effects: [] });
    const welcome: DirectorState = { ...intro, phase: { kind: 'welcome' } };
    expect(step(welcome, { t: 'introSeek', line: 3 }, EXPO_DEFAULTS)).toEqual({ state: welcome, effects: [] });
  });
});
