import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState, step, type DirectorState, type Effect, type DirectorEvent } from '../src/expo/director';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import type { ModelView } from '../src/expo/session';
import type { Line } from '../src/expo/voice-queue';
const mocks = vi.hoisted(() => ({ speak: vi.fn(), silence: vi.fn(), llm: { model: 'selected-in-ai', voiceModel: 'stale-voice' } }));
vi.mock('../src/shared', () => ({ loadLlm: () => mocks.llm }));
vi.mock('../src/expo/speaker', async original => ({ ...await original<typeof import('../src/expo/speaker')>(), expoSpeaker: () => ({
  speaker: { speak: mocks.speak }, silence: mocks.silence, voiced: () => false, resume() {}, dispose() {}, setVolume() {}, listening: () => false,
}) }));
import { createStage } from '../src/expo/stage';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function scrolling(n: 1 | 2 | 3 = 1): DirectorState {
  return { ...initialState(0), session: 7, front: 'su_1uf', phase: { kind: 'turn', n, step: 'scroll', deadline: null, warned: false, offered: false, replacements: 0, choice: 0, scrollBegan: true } };
}
function advance(s: DirectorState, ms: number) { const end = s.now + ms; while (s.now < end) s = step(s, { t: 'tick', now: Math.min(end, s.now + 250) }, EXPO_DEFAULTS).state; return s; }
const response = () => new Response('data: '+JSON.stringify({ choices: [{ delta: { content: 'Ваш выбор изменил ход операции.' } }] })+'\n\n', { headers: { 'content-type': 'text/event-stream' } });
beforeEach(() => { mocks.speak.mockReset(); mocks.silence.mockReset(); vi.stubGlobal('location', { origin: 'http://localhost' }); vi.stubGlobal('fetch', vi.fn(async () => response())); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('комментарий остаётся на завершённом переломе', () => {
  it.each([1, 2] as const)('перелом %s ждёт завершения речи и сразу открывает следующую обстановку', n => {
    let { state, effects } = step(scrolling(n), { t: 'scrollDone' }, EXPO_DEFAULTS);
    const effect = effects.find(e => e.e === 'commentChoice')!;
    expect(effect).toMatchObject({ n, session: 7, token: expect.any(Number) });
    state = advance(state, 20000);
    expect(state.phase).toMatchObject({ kind: 'turn', n, step: 'scroll' });
    expect(state.phase).not.toHaveProperty('rest');
    state = step(state, { t: 'commentDone', n, session: 7, token: (effect as Extract<Effect, {e:'commentChoice'}>).token }, EXPO_DEFAULTS).state;
    expect(state.phase).toMatchObject({ n: n + 1, step: 'explain' });
    expect(state.phaseStart).toBe(state.now);
  });
  it('третий перелом тоже запрашивает комментарий LLM, затем готовит весь итог', () => {
    const started = step(scrolling(3), { t: 'scrollDone' }, EXPO_DEFAULTS);
    const effect = started.effects.find(e => e.e === 'commentChoice') as Extract<Effect, {e:'commentChoice'}>;
    expect(effect).toMatchObject({ n: 3, session: 7 });
    expect(started.effects.some(e => e.e === 'prepareDebrief')).toBe(false);
    expect(advance(started.state, 240000).phase).toMatchObject({ n: 3, step: 'scroll', commenting: { token: effect.token } });
    const preparing = step(started.state, { t: 'commentDone', n: 3, session: 7, token: effect.token }, EXPO_DEFAULTS);
    expect(preparing.state.phase).toMatchObject({ n: 3, step: 'scroll', preparing: true });
    expect(preparing.effects).toEqual([{ e: 'prepareDebrief' }]);
    expect(advance(preparing.state, 240000).phase).toMatchObject({ n: 3, preparing: true });
    expect(step(preparing.state, { t: 'debriefReady' }, EXPO_DEFAULTS).state.phase.kind).toBe('result');
  });
  it.each([1, 2, 3] as const)('без комментариев перелом %s ждёт карту и сразу продолжается даже на нулевых часах', n => {
    const cfg = { ...EXPO_DEFAULTS, generation: { ...EXPO_DEFAULTS.generation, comments: false } };
    expect(advance(scrolling(n), 30000).phase).toMatchObject({ kind: 'turn', n, step: 'scroll' });
    const finished = step(scrolling(n), { t: 'scrollDone' }, cfg);
    expect(finished.state.now).toBe(0);
    if (n === 3) {
      expect(finished.state.phase).toMatchObject({ n: 3, step: 'scroll', preparing: true });
      expect(finished.effects).toEqual([{ e: 'prepareDebrief' }]);
    } else {
      expect(finished.state.phase).toMatchObject({ n: n + 1, step: 'explain' });
      expect(finished.effects).toContainEqual({ e: 'deal', n: n + 1, front: 'su_1uf' });
    }
    expect(finished.effects.some(e => e.e === 'commentChoice')).toBe(false);
  });
  it('без комментария и разбора третий перелом сразу открывает итог после конца карты', () => {
    const cfg = { ...EXPO_DEFAULTS, generation: { ...EXPO_DEFAULTS.generation, comments: false, debrief: false } };
    const finished = step(scrolling(3), { t: 'scrollDone' }, cfg);
    expect(finished.state.phase).toMatchObject({ kind: 'result', narrated: false });
    expect(finished.effects.some(e => e.e === 'prepareDebrief')).toBe(false);
  });
  it.each([1, 2, 3] as const)('длинный ответ LLM на решении %s сокращается до короткого комментария и доходит до озвучки', async n => {
    const text = 'Вы выбрали продолжение наступления на широком фронте. Это позволило сохранить резервы и не ослаблять соседние участки. Армии продолжили движение в соответствии с вашим приказом. Результат следует оценивать по достигнутым рубежам и выполненным задачам.';
    expect(text.length).toBeGreaterThan(220);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\ndata: [DONE]\n\n')));
    mocks.speak.mockImplementation(() => ({ done: Promise.resolve(), stop() {} }));
    const started = step(scrolling(n), { t: 'scrollDone' }, EXPO_DEFAULTS);
    const view = { time: '1945-04-20T05:00:00', decisions: [{ n, choice: 'delay', historical: 'x' }], cards: [], feed: [], scales: { notes: {} } } as unknown as ModelView;
    const stage = createStage({ aiOn: () => true, snapshot: () => ({ state: started.state, model: { view, error: null } }), dispatch() {}, onFrame() {}, count() {} });
    stage.handle({ e: 'scene', key: `turn-${n}-scroll` });
    started.effects.forEach(e => stage.handle(e)); await flush();
    expect(mocks.speak.mock.calls[0][0]).toBe('Вы выбрали продолжение наступления на широком фронте. Это позволило сохранить резервы и не ослаблять соседние участки.');
    expect(mocks.speak.mock.calls[0][0].length).toBeLessThanOrEqual(220);
    expect(mocks.speak.mock.calls[0][1]).toMatchObject({ source: 'now', voice: 'konev-12s', scene: `turn-${n}-scroll` });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]!.body));
    expect(body.max_tokens).toBe(50);
    expect(body.messages[0].content).toContain('220');
    expect(body.messages[0].content).toContain('двумя короткими предложениями');
    expect(body.messages[0].content).not.toContain('четырьмя-шестью');
    stage.dispose();
  });
  it('чужое завершение, повтор scrollDone и прошедшие минуты не отпускают ожидание речи', () => {
    let { state, effects } = step(scrolling(), { t: 'scrollDone' }, EXPO_DEFAULTS);
    const effect = effects.find(e => e.e === 'commentChoice') as Extract<Effect, {e:'commentChoice'}>;
    expect(step(state, { t: 'scrollDone' }, EXPO_DEFAULTS).effects).toEqual([]);
    const event = { t: 'commentDone', n: 1, session: 7, token: effect.token } as const;
    for (const bad of [{ ...event, n: 2 as const }, { ...event, session: 6 }, { ...event, token: effect.token + 1 }]) expect(step(state, bad, EXPO_DEFAULTS).state).toEqual(state);
    state = advance(state, 181000);
    expect(state.phase).toMatchObject({ kind: 'turn', n: 1, step: 'scroll', commenting: { token: effect.token } });
  });
  it('медленная LLM не заменяется через 12 секунд; комментарий получает весь ответ и дожидается звука', async () => {
    vi.useFakeTimers();
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let signal!: AbortSignal;
    const encode = new TextEncoder();
    const send = (content: string) => stream.enqueue(encode.encode('data: '+JSON.stringify({ choices: [{ delta: { content } }] })+'\n\n'));
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      signal = opts.signal;
      return new Response(new ReadableStream<Uint8Array>({ start(c) { stream = c; } }), { headers: { 'content-type': 'text/event-stream' } });
    }));
    let played!: () => void;
    mocks.speak.mockImplementation(() => ({ done: new Promise<void>(r => { played = r; }), stop() {} }));
    const started = step(scrolling(), { t: 'scrollDone' }, EXPO_DEFAULTS);
    const view = { time: '1945-04-20T05:00:00', decisions: [{ n: 1, choice: 'delay', historical: 'x' }], cards: [], feed: [], scales: { notes: {} } } as unknown as ModelView;
    const events: DirectorEvent[] = [];
    const stage = createStage({ aiOn: () => true, snapshot: () => ({ state: started.state, model: { view, error: null } }), dispatch: e => events.push(e), onFrame() {}, count() {} });
    stage.handle({ e: 'scene', key: 'turn-1-scroll' });
    started.effects.forEach(e => stage.handle(e)); await flush();
    // Холодная загрузка LLM: ни одного токена за прежний срок комментария.
    await vi.advanceTimersByTimeAsync(20000);
    expect(signal.aborted).toBe(false);
    expect(mocks.speak).not.toHaveBeenCalled();
    send('Первое предложение о решении.'); await flush();
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20000);
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(signal.aborted).toBe(false);
    send(' Второе предложение о последствиях.'); stream.close(); await flush();
    expect(mocks.speak.mock.calls[0][0]).toBe('Первое предложение о решении. Второе предложение о последствиях.');
    expect(signal.aborted).toBe(false);
    expect(events.some(e => e.t === 'commentDone')).toBe(false);
    const requests = vi.mocked(fetch).mock.calls;
    expect(requests).toHaveLength(1);
    expect(JSON.parse(String(requests[0][1]!.body))).toMatchObject({ model: 'selected-in-ai', ttl: 86400 });
    played(); await flush();
    expect(events.filter(e => e.t === 'commentDone')).toHaveLength(1);
    stage.dispose();
  });
  it('маркер окончания SSE завершает ответ без ожидания закрытия TCP-соединения', async () => {
    const encode = new TextEncoder();
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(encode.encode('data: '+JSON.stringify({ choices: [{ delta: { content: 'Ответ полностью готов.' } }] })+'\n\ndata: [DONE]\n\n')); },
      cancel,
    }))));
    mocks.speak.mockImplementation(() => ({ done: Promise.resolve(), stop() {} }));
    const started = step(scrolling(), { t: 'scrollDone' }, EXPO_DEFAULTS);
    const view = { time: '1945-04-20T05:00:00', decisions: [{ n: 1, choice: 'delay', historical: 'x' }], cards: [], feed: [], scales: { notes: {} } } as unknown as ModelView;
    const stage = createStage({ aiOn: () => true, snapshot: () => ({ state: started.state, model: { view, error: null } }), dispatch() {}, onFrame() {}, count() {} });
    stage.handle({ e: 'scene', key: 'turn-1-scroll' });
    started.effects.forEach(e => stage.handle(e)); await flush();
    expect(mocks.speak).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalled();
    stage.dispose();
  });
  it('ответ, остановленный по лимиту 50 токенов, сохраняет комментарий LLM вместо тихой подмены', async () => {
    const data = [
      { choices: [{ delta: { content: 'Выбранное решение позволило сохранить резервы и продолжить наступ' } }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
    ].map(j => `data: ${JSON.stringify(j)}\n\n`).join('') + 'data: [DONE]\n\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(data)));
    mocks.speak.mockImplementation(() => ({ done: Promise.resolve(), stop() {} }));
    const started = step(scrolling(), { t: 'scrollDone' }, EXPO_DEFAULTS);
    const view = { time: '1945-04-20T05:00:00', decisions: [{ n: 1, choice: 'delay', historical: 'x' }], cards: [], feed: [], scales: { notes: {} } } as unknown as ModelView;
    const stage = createStage({ aiOn: () => true, snapshot: () => ({ state: started.state, model: { view, error: null } }), dispatch() {}, onFrame() {}, count() {} });
    stage.handle({ e: 'scene', key: 'turn-1-scroll' });
    started.effects.forEach(e => stage.handle(e)); await flush();
    expect(mocks.speak.mock.calls[0][0]).toBe('Выбранное решение позволило сохранить резервы и продолжить…');
    expect(mocks.speak.mock.calls[0][1]).toMatchObject({ source: 'now', voice: 'konev-12s' });
    stage.dispose();
  });
  it('stage ждёт реального done голоса и привязывает комментарий к сцене; смена сцены обрывает его', async () => {
    let finish!: () => void; const stop = vi.fn(() => finish());
    mocks.speak.mockImplementation(() => ({ done: new Promise<void>(r => { finish = r; }), stop }));
    const started = step(scrolling(), { t: 'scrollDone' }, EXPO_DEFAULTS);
    let state = started.state;
    const view = { time: '1945-04-20T05:00:00', decisions: [{ n: 1, choice: 'delay', historical: 'x' }], cards: [], feed: [], scales: { notes: {} } } as unknown as ModelView;
    const events: DirectorEvent[] = [];
    const stage = createStage({ aiOn: () => true, snapshot: () => ({ state, model: { view, error: null } }), dispatch: e => events.push(e), onFrame() {}, count() {} });
    stage.handle({ e: 'scene', key: 'turn-1-scroll' });
    started.effects.forEach(e => stage.handle(e)); await flush();
    expect(mocks.speak).toHaveBeenCalledTimes(1);
    const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/chat/completions'));
    expect(request).toBeDefined();
    expect(JSON.parse(String(request![1]!.body)).model).toBe('selected-in-ai');
    expect((request![1]!.headers as Record<string, string>)['x-defops-llm-model']).toBe('selected-in-ai');
    expect((mocks.speak.mock.calls[0][1] as Line).scene).toBe('turn-1-scroll');
    expect(events.some(e => e.t === 'commentDone')).toBe(false);
    finish(); await flush();
    expect(events.filter(e => e.t === 'commentDone')).toEqual([{ t: 'commentDone', n: 1, session: 7, token: (started.effects[0] as Extract<Effect, {e:'commentChoice'}>).token }]);
    // Второй запуск имеет новый token; запоздалый done после смены сцены не должен его завершить.
    const again = step({ ...scrolling(), commentSeq: 1 }, { t: 'scrollDone' }, EXPO_DEFAULTS); state = again.state;
    again.effects.forEach(e => stage.handle(e)); await flush();
    stage.handle({ e: 'scene', key: 'turn-2-explain' }); await flush();
    expect(stop).toHaveBeenCalled();
    expect(events.filter(e => e.t === 'commentDone')).toHaveLength(1);
    stage.dispose();
  });
  it('комментарий, завершённый на паузе с нулевыми часами, сразу отпускает ход после возобновления', () => {
    let { state, effects } = step(scrolling(), { t: 'scrollDone' }, EXPO_DEFAULTS);
    const e = effects[0] as Extract<Effect, {e:'commentChoice'}>;
    state = step(state, { t: 'pause' }, EXPO_DEFAULTS).state;
    state = step(state, { t: 'commentDone', n: e.n, session: e.session, token: e.token }, EXPO_DEFAULTS).state;
    expect(step(state, { t: 'scrollDone' }, EXPO_DEFAULTS)).toEqual({ state, effects: [] });
    state = advance(state, 10000);
    expect(state.phase).toMatchObject({ n: 1, step: 'scroll' });
    state = step(state, { t: 'resume' }, EXPO_DEFAULTS).state;
    expect(state.phase).toMatchObject({ n: 2, step: 'explain' });
    expect(state.phaseStart).toBe(10000);
  });
  it('ошибка проигрывателя отпускает ожидание после окончания попытки', async () => {
    mocks.speak.mockImplementation(() => ({ done: Promise.reject(new Error('audio unavailable')), stop() {} }));
    const started = step(scrolling(), { t: 'scrollDone' }, EXPO_DEFAULTS);
    const view = { time: '1945-04-20T05:00:00', decisions: [{ n: 1, choice: 'delay', historical: 'x' }], cards: [], feed: [], scales: { notes: {} } } as unknown as ModelView;
    const events: DirectorEvent[] = [];
    const stage = createStage({ aiOn: () => true, snapshot: () => ({ state: started.state, model: { view, error: null } }), dispatch: e => events.push(e), onFrame() {}, count() {} });
    stage.handle({ e: 'scene', key: 'turn-1-scroll' });
    started.effects.forEach(e => stage.handle(e)); await flush();
    expect(events.some(e => e.t === 'commentDone')).toBe(true); stage.dispose();
  });
  it('нет решения или сбой голоса завершают ожидание, не зависая навсегда', async () => {
    const started = step(scrolling(), { t: 'scrollDone' }, EXPO_DEFAULTS);
    const events: DirectorEvent[] = [];
    const stage = createStage({ aiOn: () => false, snapshot: () => ({ state: started.state, model: { view: null, error: null } }), dispatch: e => events.push(e), onFrame() {}, count() {} });
    started.effects.forEach(e => stage.handle(e)); await flush();
    expect(events.some(e => e.t === 'commentDone')).toBe(true); stage.dispose();
  });
});
