import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState, step, type DirectorEvent, type DirectorState } from '../src/expo/director';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import { LINES } from '../src/expo/lines';
import { introGap, INTRO_CUES, INTRO_DURATION_MS, INTRO_KEYS } from '../src/expo/intro-story';
import type { Line, Speaker } from '../src/expo/voice-queue';
import type { AiFrame } from '../src/expo/ai-runner';
import { clipPlayer, stageSpeaker, turnstile } from '../src/expo/speaker';

const audio = vi.hoisted(() => ({
  available: new Set<string>(),
  spoken: [] as { text: string; line?: Line; finish: (played?: boolean) => void; stopped: boolean }[],
  silenced: 0,
  speaker: undefined as Speaker | undefined,
}));
vi.mock('../src/shared', () => ({ loadLlm: () => ({ model: '' }) }));
vi.mock('../src/expo/speaker', async (original) => ({
  ...await original<typeof import('../src/expo/speaker')>(),
  expoSpeaker: () => ({
    speaker: audio.speaker ?? { speak(text: string, line?: Line) {
      let done = () => {};
      let played = false;
      const finished = new Promise<void>((r) => { done = r; });
      const entry = { text, line, finish: (heard = true) => { played = heard; done(); }, stopped: false };
      audio.spoken.push(entry);
      return { done: finished, played: () => played, stop: () => { entry.stopped = true; done(); } };
    } } satisfies Speaker,
    voiced: (f: { text: string }) => audio.available.has(f.text),
    silence: () => { audio.silenced++; },
    setVolume() {}, resume() {}, dispose() {}, listening: () => false,
  }),
}));
import { createStage } from '../src/expo/stage';

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const intro = INTRO_KEYS.map((key) => LINES.say[key][0]);
function setup(available: number[], speaker?: Speaker) {
  audio.speaker = speaker;
  audio.available = new Set(available.map((n) => intro[n - 1]));
  audio.spoken = [];
  audio.silenced = 0;
  const events: DirectorEvent[] = [];
  const frames: AiFrame[] = [];
  let state: DirectorState = { ...initialState(0), phase: { kind: 'intro' } };
  const stage = createStage({ aiOn: () => true, snapshot: () => ({ state, model: { view: null, error: null } }), dispatch: (e) => events.push(e), onFrame: (frame) => frames.push(frame), count() {} });
  const enter = () => {
    state = { ...state, phase: { kind: 'intro' } };
    stage.handle({ e: 'scene', key: 'intro' });
    for (const key of INTRO_KEYS) stage.handle({ e: 'say', key, priority: 'scene', scene: 'intro' });
  };
  const send = (event: DirectorEvent) => {
    const next = step(state, event, EXPO_DEFAULTS);
    state = next.state;
    next.effects.forEach(effect => stage.handle(effect));
  };
  return { stage, events, frames, enter, send, setState: (s: DirectorState) => { state = s; } };
}
afterEach(() => vi.useRealTimers());

describe('интро: сборка голоса', () => {
  it('ручной переход обрывает клип, очищает хвост очереди и начинает выбранную сцену', async () => {
    const s = setup([1, 2, 3, INTRO_CUES.length]);
    s.enter();
    const first = audio.spoken[0];
    s.send({ t: 'introSeek', line: 2 });
    expect(first.stopped).toBe(true);
    expect(audio.spoken.at(-1)?.line?.mark).toBe(INTRO_KEYS[1]);
    expect(s.frames.at(-1)?.introLine).toBe(2);
    const second = audio.spoken.at(-1)!;
    s.send({ t: 'introSeek', line: INTRO_CUES.length });
    expect(second.stopped).toBe(true);
    expect(audio.spoken.at(-1)?.line?.mark).toBe(INTRO_KEYS.at(-1));
    first.finish(); second.finish();
    await flush();
    expect(s.events).not.toContainEqual({ t: 'introDone' });
    expect(s.frames.at(-1)?.introLine).toBe(INTRO_CUES.length);
    audio.spoken.at(-1)!.finish();
    await flush();
    expect(s.events.filter(e => e.t === 'introDone')).toHaveLength(1);
    expect(audio.spoken).toHaveLength(3);
    s.stage.dispose();
  });

  it('возврат с финала подавляет его запоздалое завершение и продолжает новый порядок', async () => {
    const s = setup([1, 2, 3, INTRO_CUES.length]);
    s.enter();
    s.send({ t: 'introSeek', line: INTRO_CUES.length });
    expect(s.frames.at(-1)?.introLine).toBe(INTRO_CUES.length);
    audio.spoken.at(-1)!.finish();
    s.send({ t: 'introSeek', line: 2 });
    await flush();
    expect(s.events).not.toContainEqual({ t: 'introDone' });
    expect(s.frames.at(-1)?.introLine).toBe(2);
    expect(audio.spoken.at(-1)?.line?.mark).toBe(INTRO_KEYS[1]);
    audio.spoken.at(-1)!.finish();
    await flush();
    expect(s.frames.at(-1)?.introLine).toBe(3);
    expect(audio.spoken.at(-1)?.line?.mark).toBe(INTRO_KEYS[2]);
    s.stage.dispose();
  });

  it('переход во время межсценовой паузы отменяет старый таймер и сохраняет финальную паузу', async () => {
    vi.useFakeTimers();
    const speaker = stageSpeaker({ manifest: () => null, player: clipPlayer(() => { throw new Error('нет клипа'); }), aiOn: () => false, live: null, gate: turnstile() });
    const s = setup([], speaker);
    s.enter();
    await vi.advanceTimersByTimeAsync(INTRO_CUES[0].durationMs + 1000);
    s.send({ t: 'introSeek', line: INTRO_CUES.length });
    expect(s.frames.at(-1)?.introLine).toBe(INTRO_CUES.length);
    await vi.advanceTimersByTimeAsync(INTRO_CUES.at(-1)!.durationMs + introGap(INTRO_CUES.length - 1) - 1);
    expect(s.frames.at(-1)?.introLine).toBe(INTRO_CUES.length);
    expect(s.events).not.toContainEqual({ t: 'introDone' });
    await vi.advanceTimersByTimeAsync(1);
    expect(s.events.filter(e => e.t === 'introDone')).toHaveLength(1);
    s.stage.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('меню замораживает тихую сцену и после закрытия сдвигает общие часы сцены', async () => {
    vi.useFakeTimers();
    const speaker = stageSpeaker({ manifest: () => null, player: clipPlayer(() => { throw new Error('нет клипа'); }), aiOn: () => false, live: null, gate: turnstile() });
    const s = setup([], speaker);
    s.enter();
    await vi.advanceTimersByTimeAsync(4000);
    s.setState({ ...initialState(4000), phase: { kind: 'intro' }, paused: true, pausedAt: 4000 });
    s.stage.tick();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.frames.at(-1)?.introLine).toBe(1);
    s.setState({ ...initialState(64_000), phase: { kind: 'intro' } });
    s.stage.tick();
    expect(s.frames.at(-1)?.introCueStartedAt).toBe(60_000);
    await vi.advanceTimersByTimeAsync(INTRO_CUES[0].durationMs + introGap(0) - 4001);
    expect(s.frames.at(-1)?.introLine).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.frames.at(-1)?.introLine).toBe(2);
    s.stage.dispose();
  });

  it('без клипов все сцены идут отмеренный срок без живого синтеза', async () => {
    vi.useFakeTimers();
    const live = vi.fn();
    const player = clipPlayer(() => { throw new Error('нет клипа'); });
    const speaker = stageSpeaker({ manifest: () => null, player, aiOn: () => true,
      live: { ready: () => true, say: live }, gate: turnstile() });
    const s = setup([], speaker);
    s.enter();
    for (let i = 0; i < INTRO_CUES.length; i++) {
      expect(s.frames.at(-1)?.introLine).toBe(i + 1);
      expect(s.events).not.toContainEqual({ t: 'introDone' });
      await vi.advanceTimersByTimeAsync(INTRO_CUES[i].durationMs);
      if (introGap(i)) {
        await vi.advanceTimersByTimeAsync(introGap(i) - 1);
        expect(s.frames.at(-1)?.introLine).toBe(i + 1);
        await vi.advanceTimersByTimeAsync(1);
      }
    }
    expect(s.events.filter((e) => e.t === 'introDone')).toHaveLength(1);
    expect(live).not.toHaveBeenCalled();
    s.stage.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('часть записей отсутствует: сцены не перескакивают, последняя завершает монтаж', async () => {
    const s = setup([1, 6]);
    s.enter();
    for (let i = 0; i < INTRO_CUES.length; i++) {
      expect(audio.spoken[i].line?.mark).toBe(INTRO_KEYS[i]);
      expect(audio.spoken[i].line?.source).toBe('prepared');
      expect(audio.spoken[i].line?.durationMs).toBe(INTRO_CUES[i].durationMs);
      expect(s.events).not.toContainEqual({ t: 'introDone' });
      audio.spoken[i].finish(i === 0 || i === 5);
      await flush();
    }
    expect(audio.spoken.map((x) => x.text)).toEqual(intro);
    expect(s.events.filter((e) => e.t === 'introDone')).toHaveLength(1);
    s.stage.dispose();
  });

  it('зависший файл заменяется тихой сценой и не блокирует следующие', async () => {
    vi.useFakeTimers();
    const player = clipPlayer(() => { throw new Error('аудио не должно запускаться'); }, () => new Promise(() => {}));
    const speaker = stageSpeaker({
      manifest: () => ({ version: 1, voice: 'chief', engine: 'qwen3', clips: { [intro[0]]: { file: 'intro.ogg', ms: 20_000 } } }),
      player, aiOn: () => true, live: null, gate: turnstile(),
    });
    const s = setup([1], speaker);
    s.enter();
    await vi.advanceTimersByTimeAsync(INTRO_CUES[0].durationMs + introGap(0) - 1);
    expect(s.frames.at(-1)?.introLine).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.frames.at(-1)?.introLine).toBe(2);
    await vi.advanceTimersByTimeAsync(INTRO_DURATION_MS - INTRO_CUES[0].durationMs);
    expect(s.events.filter((e) => e.t === 'introDone')).toHaveLength(1);
    s.stage.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('касание заставки обрывает старую речь сразу; пропуск не выдаёт запоздалый конец интро', async () => {
    vi.useFakeTimers();
    const s = setup([1, 2, 3, 4]);
    s.setState({ ...initialState(0), phase: { kind: 'attract' } });
    s.stage.tick();
    vi.advanceTimersByTime(1500);
    s.stage.tick();
    const attract = audio.spoken[0];
    expect(attract.line?.scene).toBe('attract');
    s.enter();
    expect(attract.stopped).toBe(true);
    expect(audio.silenced).toBe(1);
    const first = audio.spoken[1];
    s.setState({ ...initialState(0), phase: { kind: 'welcome' } });
    s.stage.handle({ e: 'scene', key: 'welcome' });
    expect(first.stopped).toBe(true);
    await flush();
    expect(s.events).not.toContainEqual({ t: 'introDone' });
    s.stage.dispose();
  });
});
