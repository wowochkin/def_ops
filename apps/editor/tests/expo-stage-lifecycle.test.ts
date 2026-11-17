import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectorEvent, DirectorState } from '../src/expo/director';
import { initialState, step } from '../src/expo/director';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import type { ModelView } from '../src/expo/session';
import type { turnstile } from '../src/expo/speaker';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), speak: vi.fn(), debrief: vi.fn(), silence: vi.fn(), managed: false, resource: vi.fn(), gate: null as ReturnType<typeof turnstile> | null, synthesis: null as (() => { temperature: number; batchSize: 1 | 2 | 4 }) | null }));
vi.mock('../src/shared', () => ({ loadLlm: () => ({ model: 'selected-in-ai' }) }));
vi.mock('../src/expo/debrief', () => ({ operationDebrief: () => { mocks.debrief(); return { paragraphs: ['Итог операции.', 'Первый перелом.', 'Второй перелом.', 'Третий перелом.'], voice: 'zhukov' }; }, debriefUtterances: (p: string[]) => p, commanderVoice: () => 'zhukov' }));
vi.mock('../src/expo/speaker', async original => ({
  ...await original<typeof import('../src/expo/speaker')>(),
  expoSpeaker: (o: { gate: ReturnType<typeof turnstile>; synthesis?: () => { temperature: number; batchSize: 1 | 2 | 4 } }) => {
    mocks.synthesis = o.synthesis ?? null;
    mocks.gate = o.gate;
    return { speaker: { speak: mocks.speak }, prepare: mocks.prepare, silence: mocks.silence,
      managed: () => mocks.managed, input: { ttsResource: mocks.resource }, voiced: () => false, resume() {}, dispose() {}, setVolume() {}, listening: () => false };
  },
}));
import { createStage } from '../src/expo/stage';
const flush = async () => { for (let n = 0; n < 25; n++) await Promise.resolve(); };
const scroll = (preparing = false): DirectorState => ({ ...initialState(0), phase: { kind: 'turn', n: 3, step: 'scroll', deadline: null, warned: false, offered: false, replacements: 0, choice: 0, scrollBegan: true, preparing } });
function setup(state = scroll(), view: ModelView | null = null, settings = EXPO_DEFAULTS) {
  const events: DirectorEvent[] = [];
  const stage = createStage({ aiOn: () => true, snapshot: () => ({ state, settings, model: { view, error: null } }), dispatch: e => events.push(e), onFrame() {}, count() {} });
  return { stage, events, state: (next: DirectorState) => { state = next; } };
}
beforeEach(() => { mocks.managed = false; mocks.resource.mockReset().mockResolvedValue({}); mocks.prepare.mockReset().mockResolvedValue(undefined); mocks.speak.mockReset().mockImplementation(() => ({ done: Promise.resolve(), stop() {} })); mocks.debrief.mockClear(); mocks.silence.mockReset(); vi.stubGlobal('location', { origin: 'http://localhost' }); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('итог после визуализации', () => {
  it('отключённые комментарии не прогружают LLM и не обрабатывают запоздалый эффект', async () => {
    mocks.managed = true;
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const started = step(scroll(), { t: 'scrollDone' }, EXPO_DEFAULTS);
    const effect = started.effects.find(e => e.e === 'commentChoice')!;
    const cfg = { ...EXPO_DEFAULTS, generation: { ...EXPO_DEFAULTS.generation, comments: false, debrief: true } };
    const s = setup(started.state, {} as ModelView, cfg);
    s.stage.handle({ e: 'scene', key: 'turn-3-choose' });
    s.stage.handle(effect); await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.resource).not.toHaveBeenCalled();
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(s.events).toContainEqual({ t: 'commentDone', n: 3, session: 0, token: 1 });
    s.stage.dispose();
  });
  it('отключённый разбор не вычисляет реплики, не синтезирует и не озвучивает итог', async () => {
    const s = setup(scroll(true), {} as ModelView, { ...EXPO_DEFAULTS, generation: { ...EXPO_DEFAULTS.generation, comments: true, debrief: false } });
    s.stage.handle({ e: 'prepareDebrief' });
    s.stage.handle({ e: 'say', key: 'result', priority: 'scene', scene: 'result' }); await flush();
    expect(mocks.debrief).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.speak).not.toHaveBeenCalled();
    expect(s.events).toContainEqual({ t: 'debriefReady' });
    s.stage.dispose();
  });
  it('отключение комментариев сохраняет отдельную подготовку итога', async () => {
    const s = setup(scroll(true), {} as ModelView, { ...EXPO_DEFAULTS, generation: { ...EXPO_DEFAULTS.generation, comments: false, debrief: true } });
    s.stage.handle({ e: 'prepareDebrief' }); await flush();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(s.events).toContainEqual({ t: 'debriefReady' });
    s.stage.dispose();
  });
  it('алгоритм разбора и синтез итога ждут конца визуализации, LLM-комментария и его звука', async () => {
    let finishText!: (r: Response) => void, finishSpeech!: () => void, finishPreparation!: () => void;
    const fetch = vi.fn(() => new Promise<Response>(r => { finishText = r; }));
    vi.stubGlobal('fetch', fetch);
    mocks.speak.mockImplementationOnce(() => ({ done: new Promise<void>(r => { finishSpeech = r; }), stop() {} }));
    mocks.prepare.mockImplementationOnce(() => new Promise<void>(r => { finishPreparation = r; }));
    let state = scroll();
    const view = { front: 'su_1uf', time: '1945-05-02T05:00:00', decisions: [{ n: 3, choice: 'delay', historical: 'x' }], cards: [], feed: [], scales: { notes: {} } } as unknown as ModelView;
    const dispatch = (e: DirectorEvent) => {
      const next = step(state, e, EXPO_DEFAULTS);
      state = next.state;
      next.effects.forEach(effect => stage.handle(effect));
    };
    const stage = createStage({ aiOn: () => true, snapshot: () => ({ state, model: { view, error: null } }), dispatch, onFrame() {}, count() {} });
    stage.handle({ e: 'scene', key: 'turn-3-scroll' });
    await flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.debrief).not.toHaveBeenCalled();
    dispatch({ t: 'scrollDone' }); await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.debrief).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    finishText(new Response('data: '+JSON.stringify({ choices: [{ delta: { content: 'Ваше решение позволило сохранить резервы.' } }] })+'\n\ndata: [DONE]\n\n'));
    await flush();
    expect(mocks.speak).toHaveBeenCalledTimes(1);
    expect(mocks.debrief).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    finishSpeech(); await flush();
    expect(mocks.debrief).toHaveBeenCalledTimes(1);
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(['Итог операции.', 'Первый перелом.', 'Второй перелом.', 'Третий перелом.'], 'zhukov', expect.any(AbortSignal), expect.any(Function));
    expect(state.phase).toMatchObject({ kind: 'turn', preparing: true });
    finishPreparation(); await flush();
    expect(state.phase.kind).toBe('result');
    stage.dispose();
  });
  it('запоздалый конец старой карты не завершает новый ход, пока ждём расчёт', () => {
    const s = scroll();
    if (s.phase.kind !== 'turn') throw new Error('turn');
    s.phase = { ...s.phase, scrollBegan: false, scrollHold: true };
    const next = step(s, { t: 'scrollDone' }, EXPO_DEFAULTS);
    expect(next.effects).toEqual([]);
    expect(next.state.phase).not.toHaveProperty('preparing', true);
  });

  it('не запускает подготовку до окончания карты и комментария третьего решения', () => {
    const s = scroll();
    expect(step(s, { t: 'tick', now: 240000 }, EXPO_DEFAULTS).effects).toEqual([]);
    const done = step(s, { t: 'scrollDone' }, EXPO_DEFAULTS);
    expect(done.state.phase).toHaveProperty('commenting');
    expect(done.state.phase).not.toHaveProperty('preparing', true);
    expect(done.effects).toEqual([{ e: 'commentChoice', n: 3, session: s.session, token: expect.any(Number) }]);
    expect(step(done.state, { t: 'scrollDone' }, EXPO_DEFAULTS).effects).toEqual([]);
  });
  it('устаревшее событие prepareDebrief не синтезирует во время карты', async () => {
    const s = setup(scroll(), {} as ModelView);
    s.stage.handle({ e: 'prepareDebrief' }); await flush();
    expect(mocks.prepare).not.toHaveBeenCalled(); s.stage.dispose();
  });
  it('не открывает итог, пока не готов звук всего разбора', async () => {
    let finish!: () => void;
    mocks.prepare.mockImplementation(() => new Promise<void>(r => { finish = r; }));
    const s = setup(scroll(true), {} as ModelView);
    s.stage.handle({ e: 'prepareDebrief' }); await flush();
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith(['Итог операции.', 'Первый перелом.', 'Второй перелом.', 'Третий перелом.'], 'zhukov', expect.any(AbortSignal), expect.any(Function));
    expect(s.events).not.toContainEqual({ t: 'debriefReady' });
    finish(); await flush();
    expect(s.events).toContainEqual({ t: 'debriefReady' });
    s.stage.dispose();
  });
  it('повтор эффекта не дублирует синтез; перезапуск отменяет работу и отбрасывает завершение старого итога', async () => {
    let resolve!: () => void;
    mocks.prepare.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
    const s = setup(scroll(true), {} as ModelView);
    s.stage.handle({ e: 'prepareDebrief' }); s.stage.handle({ e: 'prepareDebrief' });
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    const signal = mocks.prepare.mock.calls[0][2] as AbortSignal;
    s.stage.handle({ e: 'newSession' });
    expect(signal.aborted).toBe(true);
    resolve(); await flush();
    expect(s.events).not.toContainEqual({ t: 'debriefReady' }); s.stage.dispose();
  });
  it('ошибка синтеза не оставляет экран навсегда на подготовке', async () => {
    mocks.prepare.mockRejectedValue(new Error('нет связи с голосом'));
    const s = setup(scroll(true), {} as ModelView);
    s.stage.handle({ e: 'prepareDebrief' }); await flush();
    expect(s.events).toContainEqual({ t: 'debriefReady' }); s.stage.dispose();
  });
  it('отложенный до прокрутки запрос LLM не стартует после освобождения очереди', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const s = setup(); let release!: () => void;
    const held = mocks.gate!.run(() => new Promise<void>(r => { release = r; }));
    await flush();
    s.stage.handle({ e: 'ask', q: 'Какова обстановка?' });
    s.stage.handle({ e: 'scene', key: 'turn-3-scroll' });
    release(); await held; await flush();
    expect(fetch).not.toHaveBeenCalled(); s.stage.dispose();
  });
  it('активный запрос LLM прерывается сразу при старте прокрутки', async () => {
    let signal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_url, opts) => { signal = opts.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))); }));
    const s = setup();
    s.stage.handle({ e: 'ask', q: 'Какова обстановка?' }); await flush();
    expect(signal.aborted).toBe(false);
    s.stage.handle({ e: 'scene', key: 'turn-3-scroll' });
    expect(signal.aborted).toBe(true); await flush(); s.stage.dispose();
  });
});

it('быстрый выбор удерживает запуск карты до завершения подготовки GPU', () => {
  const s = scroll();
  if (s.phase.kind === 'turn') s.phase = { ...s.phase, scrollBegan: false };
  const waiting = step(s, { t: 'gpuWait' } as DirectorEvent, EXPO_DEFAULTS).state;
  const tooEarly = step(waiting, { t: 'scrollReady' }, EXPO_DEFAULTS).state;
  expect(tooEarly.phase).toMatchObject({ gpuHold: true, scrollBegan: false });
  const ready = step(tooEarly, { t: 'gpuReady' } as DirectorEvent, EXPO_DEFAULTS).state;
  expect(step(ready, { t: 'scrollReady' }, EXPO_DEFAULTS).state.phase).toMatchObject({ scrollBegan: true });
});

it('прогресс итога синхронизируется и не открывает результат до последнего фрагмента', async () => {
  let finish!: () => void;
  mocks.prepare.mockImplementation((_texts, _voice, _signal, progress) => {
    progress({ done: 0, total: 2, stage: 'load' });
    progress({ done: 1, total: 2, stage: 'synthesis' });
    return new Promise<void>(resolve => { finish = () => { progress({ done: 2, total: 2, stage: 'synthesis' }); resolve(); }; });
  });
  let state = scroll(true);
  const dispatch = (event: DirectorEvent) => { state = step(state, event, EXPO_DEFAULTS).state; };
  const stage = createStage({ aiOn: () => true, snapshot: () => ({ state, model: { view: {} as ModelView, error: null } }), dispatch, onFrame() {}, count() {} });
  stage.handle({ e: 'prepareDebrief' }); await flush();
  expect(state.phase).toMatchObject({ preparing: true, debriefProgress: { done: 1, total: 2 } });
  finish(); await flush();
  expect(state.phase.kind).toBe('result');
  expect(state.phase).not.toHaveProperty('debriefProgress');
  stage.dispose();
});

it('быстрый выбор ждёт завершения начатой загрузки LLM до старта карты', async () => {
  mocks.managed = true;
  let release!: () => void;
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('/load')) await new Promise<void>(resolve => { release = resolve; });
    return Response.json(url.endsWith('/models') ? { models: [{ key: 'selected-in-ai', type: 'llm', loaded_instances: [] }] } : { instance_id: 'selected-in-ai' });
  }));
  let state = scroll();
  if (state.phase.kind === 'turn') state.phase = { ...state.phase, step: 'choose', choice: null, scrollBegan: false };
  const dispatch = (event: DirectorEvent) => { state = step(state, event, EXPO_DEFAULTS).state; };
  const stage = createStage({ aiOn: () => true, snapshot: () => ({ state, model: { view: null, error: null } }), dispatch, onFrame() {}, count() {} });
  stage.handle({ e: 'scene', key: 'turn-3-choose' });
  await flush();
  expect(calls.some(url => url.endsWith('/load'))).toBe(true);
  if (state.phase.kind === 'turn') state.phase = { ...state.phase, step: 'scroll', choice: 0 };
  stage.handle({ e: 'scene', key: 'turn-3-scroll' });
  dispatch({ t: 'scrollReady' });
  expect(state.phase).toMatchObject({ gpuHold: true, scrollBegan: false });
  release(); await flush();
  expect(state.phase).toMatchObject({ gpuHold: false, scrollBegan: false });
  dispatch({ t: 'scrollReady' });
  expect(state.phase).toMatchObject({ scrollBegan: true });
  stage.dispose();
});

it('после ошибки синтеза открывает итог с готовыми клипами и текстом', async () => {
  mocks.managed = true;
  mocks.prepare.mockRejectedValue(new Error('Нет памяти GPU'));
  const view = { front: 'su_1uf', time: '1945-05-02T05:00:00', decisions: [], cards: [], feed: [], scales: { notes: {} } } as unknown as ModelView;
  const s = setup(scroll(true), view);
  s.stage.handle({ e: 'prepareDebrief' }); await flush();
  expect(s.events).toContainEqual({ t: 'debriefReady' });
  s.stage.handle({ e: 'say', key: 'result', priority: 'scene', scene: 'result' }); await flush();
  expect(mocks.speak).toHaveBeenCalledWith('Итог операции.', expect.objectContaining({ prerecordOnly: true }));
  s.stage.dispose();
});

it('первый опубликованный кадр прокрутки уже удержан при управлении GPU', () => {
  let state = scroll();
  if (state.phase.kind === 'turn') state.phase = { ...state.phase, step: 'choose', choice: null, scrollBegan: false };
  state = step(state, { t: 'gpuManaged', managed: true } as DirectorEvent, EXPO_DEFAULTS).state;
  state = step(state, { t: 'choose', card: 0 }, EXPO_DEFAULTS).state;
  expect(state.phase).toMatchObject({ step: 'scroll', gpuHold: true });
});

it('потеря ответа загрузки удерживает карту и сообщает способ восстановления', async () => {
  mocks.managed = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/load')) throw new Error('connection reset');
    return Response.json({ models: [{ key: 'selected-in-ai', type: 'llm', loaded_instances: [] }] });
  }));
  let state = scroll();
  if (state.phase.kind === 'turn') state.phase = { ...state.phase, step: 'choose', choice: null, scrollBegan: false };
  const events: DirectorEvent[] = [];
  const dispatch = (event: DirectorEvent) => { events.push(event); state = step(state, event, EXPO_DEFAULTS).state; };
  const stage = createStage({ aiOn: () => true, snapshot: () => ({ state, model: { view: null, error: null } }), dispatch, onFrame() {}, count() {} });
  stage.handle({ e: 'scene', key: 'turn-3-choose' }); await flush();
  if (state.phase.kind === 'turn') state.phase = { ...state.phase, step: 'scroll', choice: 0 };
  stage.handle({ e: 'scene', key: 'turn-3-scroll' }); await flush();
  dispatch({ t: 'scrollReady' });
  expect(events).not.toContainEqual({ t: 'gpuReady' });
  expect(state.phase).toMatchObject({ gpuHold: true, scrollBegan: false, gpuError: expect.stringContaining('Перезапустите LM Studio') });
  stage.dispose();
});

it('ошибка старой загрузки не меняет состояние нового сеанса или перелома', async () => {
  mocks.managed = true;
  let rejectLoad!: (error: Error) => void;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/load')) return new Promise<Response>((_, reject) => { rejectLoad = reject; });
    return Response.json({ models: [{ key: 'selected-in-ai', type: 'llm', loaded_instances: [] }] });
  }));
  let state = scroll();
  if (state.phase.kind === 'turn') state.phase = { ...state.phase, step: 'choose', choice: null, scrollBegan: false };
  const events: DirectorEvent[] = [];
  const dispatch = (event: DirectorEvent) => { events.push(event); state = step(state, event, EXPO_DEFAULTS).state; };
  const stage = createStage({ aiOn: () => true, snapshot: () => ({ state, model: { view: null, error: null } }), dispatch, onFrame() {}, count() {} });
  stage.handle({ e: 'scene', key: 'turn-3-choose' }); await flush();
  if (state.phase.kind === 'turn') state.phase = { ...state.phase, step: 'scroll', choice: 0 };
  stage.handle({ e: 'scene', key: 'turn-3-scroll' });
  state = { ...state, session: state.session + 1 };
  stage.handle({ e: 'newSession' });
  rejectLoad(new Error('connection reset')); await flush();
  expect(events).not.toContainEqual(expect.objectContaining({ t: 'gpuFailed' }));
  expect(events).not.toContainEqual({ t: 'gpuReady' });
  stage.dispose();
});

it('параметры начатого разбора заморожены до конца результата, следующий сеанс читает новые', async () => {
  let state = scroll(true);
  const settings = { ...EXPO_DEFAULTS, generation: { ...EXPO_DEFAULTS.generation, temperature: 0.3, batchSize: 2 as 1 | 2 | 4, cpuThreads: 1 as 1 | 2 | 4 | 8 } };
  let finish!: () => void;
  mocks.prepare.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const stage = createStage({ aiOn: () => true, snapshot: () => ({ state, settings, model: { view: {} as ModelView, error: null } }), dispatch: event => { state = step(state, event, settings).state; }, onFrame() {}, count() {} });
  stage.handle({ e: 'prepareDebrief' }); await flush();
  expect(mocks.synthesis?.()).toEqual({ temperature: 0.3, batchSize: 2, cpuThreads: 1 });
  settings.generation.temperature = 0.9;
  settings.generation.batchSize = 1;
  settings.generation.cpuThreads = 8;
  expect(mocks.synthesis?.()).toEqual({ temperature: 0.3, batchSize: 2, cpuThreads: 1 });
  finish(); await flush();
  expect(state.phase.kind).toBe('result');
  stage.handle({ e: 'scene', key: 'result' });
  expect(mocks.synthesis?.()).toEqual({ temperature: 0.3, batchSize: 2, cpuThreads: 1 });
  state = { ...scroll(), session: state.session + 1 };
  stage.handle({ e: 'newSession' });
  expect(mocks.synthesis?.()).toEqual({ temperature: 0.9, batchSize: 1, cpuThreads: 8 });
  stage.dispose();
});

it('начатый комментарий фиксирует температуру ещё до ответа LLM', async () => {
  const started = step(scroll(), { t: 'scrollDone' }, EXPO_DEFAULTS);
  let state = started.state;
  const settings = { ...EXPO_DEFAULTS, generation: { ...EXPO_DEFAULTS.generation, temperature: 0.3 } };
  const view = { front: 'su_1uf', time: '1945-05-02T05:00:00', decisions: [{ n: 3, choice: 'delay', historical: 'x' }], cards: [], feed: [], scales: { notes: {} } } as unknown as ModelView;
  let answer!: (r: Response) => void, played!: () => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(r => { answer = r; })));
  mocks.speak.mockImplementationOnce(() => ({ done: new Promise<void>(r => { played = r; }), stop() {} }));
  const stage = createStage({ aiOn: () => true, snapshot: () => ({ state, settings, model: { view, error: null } }), dispatch: event => { state = step(state, event, settings).state; }, onFrame() {}, count() {} });
  started.effects.forEach(effect => stage.handle(effect)); await flush();
  settings.generation.temperature = 0.8;
  expect(mocks.synthesis?.()).toMatchObject({ temperature: 0.3 });
  answer(new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Резервы сохранены.' } }] }) + '\n\ndata: [DONE]\n\n'));
  await flush();
  expect(mocks.synthesis?.()).toMatchObject({ temperature: 0.3 });
  played(); await flush();
  expect(mocks.synthesis?.()).toMatchObject({ temperature: 0.8 });
  stage.dispose();
});


it('комментарий без озвучки ждёт ответ LLM, затем даёт 3,5 секунды на чтение без TTS', async () => {
  vi.useFakeTimers();
  const started=step(scroll(),{t:'scrollDone'},EXPO_DEFAULTS);
  const settings={...EXPO_DEFAULTS,generation:{...EXPO_DEFAULTS.generation,commentVoice:false}};
  const view={front:'su_1uf',time:'1945-05-02T05:00:00',decisions:[{n:3,choice:'delay',historical:'x'}],cards:[],feed:[],scales:{notes:{}}} as unknown as ModelView;
  let answer!:(r:Response)=>void;
  const fetch=vi.fn(()=>new Promise<Response>(r=>{answer=r;})); vi.stubGlobal('fetch',fetch);
  const frames:any[]=[];const events:DirectorEvent[]=[];
  const stage=createStage({aiOn:()=>true,snapshot:()=>({state:started.state,settings,model:{view,error:null}}),dispatch:e=>events.push(e),onFrame:f=>frames.push(f),count(){}});
  try {
    started.effects.forEach(e=>stage.handle(e));await flush();
    expect(fetch).toHaveBeenCalledOnce();
    expect(events.some(e=>e.t==='commentDone')).toBe(false);
    settings.generation.commentVoice=true; // только следующий этап
    answer(new Response('data: '+JSON.stringify({choices:[{delta:{content:'Резервы сохранены. Продвижение продолжается.'}}]})+'\n\ndata: [DONE]\n\n'));
    await flush();
    expect(frames.some(f=>f.line?.text==='Резервы сохранены. Продвижение продолжается.')).toBe(true);
    expect(mocks.speak).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.resource).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3499);
    expect(events.some(e=>e.t==='commentDone')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);await flush();
    expect(events.some(e=>e.t==='commentDone')).toBe(true);
  } finally {stage.dispose();}
});

it('итог без догенерации пропускает синтез и передаёт фразы на воспроизведение из предзаписи', async () => {
  vi.useFakeTimers();
  const settings={...EXPO_DEFAULTS,generation:{...EXPO_DEFAULTS.generation,debriefVoice:false}};
  const frames:any[]=[]; const events:DirectorEvent[]=[];
  const state=scroll(true);
  const stage=createStage({aiOn:()=>true,snapshot:()=>({state,settings,model:{view:{front:'su_1uf',time:'1945-05-02T05:00:00',decisions:[],cards:[],feed:[],scales:{notes:{}}} as unknown as ModelView,error:null}}),dispatch:e=>events.push(e),onFrame:f=>frames.push(f),count(){}});
  try {
    stage.handle({e:'prepareDebrief'});await flush();
    expect(events).toContainEqual({t:'debriefReady'});
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.resource).not.toHaveBeenCalled();
    settings.generation.debriefVoice=true; // текущий разбор остаётся на готовых записях
    stage.handle({e:'say',key:'result',priority:'scene',scene:'result'});await flush();
    expect(mocks.debrief).toHaveBeenCalledOnce();
    expect(frames.some(f=>f.line?.text==='Итог операции.')).toBe(true);
    expect(mocks.speak).toHaveBeenCalledTimes(4);
    expect(mocks.speak.mock.calls.every(([, line]) => line.prerecordOnly)).toBe(true);
    expect(frames.some(f=>f.line?.text==='Третий перелом.')).toBe(true);
  } finally {stage.dispose();}
});
