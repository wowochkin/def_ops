import { describe, expect, it, vi } from 'vitest';
import type { Action } from '../src/voice/registry';
import { askModel, createVoiceModel, MODEL_TIMEOUT_MS, ModelUnavailable, systemText, toTools } from '../src/voice/llm';
import { numberWords, speakable } from '../src/voice/speech';
import type { LlmSettings } from '../src/sim/game-protocol';

const A = (a: Partial<Action> & { id: string }): Action =>
  ({ section: 'global', title: a.id, describe: `опис ${a.id}`, available: () => true, run: async () => undefined, ...a }) as Action;
const OPEN = A({
  id: 'shell.open', title: 'Открыть раздел', describe: 'Переходит в раздел приложения.', say: ['штаб, открой переигровку'],
  params: { type: 'object', properties: { section: { enum: ['editor', 'replay'] } }, required: ['section'] },
});
const GAME = A({ id: 'command.turn', title: 'Сделать ход', describe: 'Делает ход.', say: ['штаб, делай ход'], available: () => 'игра не начата' });
const SETTINGS: LlmSettings = { url: '/llm/v1', model: 'qwen3.6', thinking: 'medium' };

type Call = { url: string; body: any };
/** Поддельный fetch: ответы по очереди; Error — сбой сети, объект — тело ответа. */
function fake(replies: (Error | object | number)[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = replies.shift();
    if (r === undefined || r instanceof Error) throw r ?? new Error('нет ответа');
    if (typeof r === 'number') return new Response('{}', { status: r });
    return new Response(JSON.stringify(r), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const msg = (content: string | null, tool?: { name: string; args: string }) => ({
  choices: [{ message: { role: 'assistant', content, ...(tool ? { tool_calls: [{ id: 't1', type: 'function', function: { name: tool.name, arguments: tool.args } }] } : {}) } }],
});
const ctx = (f: typeof fetch, extra: object = {}) => ({ actions: [OPEN, GAME], settings: SETTINGS, history: [], fetch: f, delays: [0, 0], ...extra });

describe('числа словами', () => {
  it.each([
    [0, 'ноль'], [7, 'семь'], [12, 'двенадцать'], [21, 'двадцать один'], [40, 'сорок'], [115, 'сто пятнадцать'],
    [1000, 'тысяча'], [2345, 'две тысячи триста сорок пять'], [5000, 'пять тысяч'], [21000, 'двадцать одна тысяча'],
    [1945, 'тысяча девятьсот сорок пять'], [999999, 'девятьсот девяносто девять тысяч девятьсот девяносто девять'],
  ])('%i → %s', (n, w) => expect(numberWords(n)).toBe(w));
});

describe('speakable', () => {
  it('цифры — словами', () => {
    expect(speakable('Встреча в 5 часов.')).toBe('Встреча в пять часов.');
    expect(speakable('Потери 1 250 человек.')).toBe('Потери тысяча двести пятьдесят человек.');
    expect(speakable('Продвижение 2,5 километра, ещё 10 км.')).toBe('Продвижение две целых пять десятых километра, ещё десять километров.');
    expect(speakable('Начало в 6:00, отход в 7:30.')).toBe('Начало в шесть ноль-ноль, отход в семь тридцать.');
    expect(speakable('Это было в 1945 году.')).toBe('Это было в тысяча девятьсот сорок пятом году.');
    expect(speakable('Ввести 1-ю ударную армию к 16-му, 8-я гв. армия — №3.')).toBe('Ввести первую ударную армию к шестнадцатому, восьмая гвардейская армия — номер три.');
    expect(speakable('Атака 16.04 захлебнулась.')).toBe('Атака шестнадцатого апреля захлебнулась.');
    expect(speakable('Готово на 30%.')).toBe('Готово на тридцать процентов.');
  });
  it('без разметки и английских вставок в скобках', () => {
    expect(speakable('**Открываю** раздел (replay).')).toBe('Открываю раздел.');
  });
  it('английские слова вне скобок — выпадают', () => {
    expect(speakable('Открываю replay раздел.')).toBe('Открываю раздел.');
    expect(speakable('Вызываю shell__open.')).toBe('Вызываю.');
  });
  it('род числа по существительному: женский и средний', () => {
    expect(speakable('Вводим 1 дивизию.')).toBe('Вводим одну дивизию.');
    expect(speakable('В резерве 1 дивизия и 2 армии.')).toBe('В резерве одна дивизия и две армии.');
    expect(speakable('Подошли 2 танковые бригады.')).toBe('Подошли две танковые бригады.');
    expect(speakable('Осталось 1 орудие.')).toBe('Осталось одно орудие.');
    expect(speakable('Осталось 2 орудия и 21 рота.')).toBe('Осталось два орудия и двадцать одна рота.');
    expect(speakable('Пришёл 1 полк.')).toBe('Пришёл один полк.');
  });
  it('римские номера соединений — порядковыми словами, не стираются', () => {
    expect(speakable('Против нас LVI танковый корпус.')).toBe('Против нас пятьдесят шестой танковый корпус.');
    expect(speakable('Отходит XI армейский корпус, за ним IX армия.')).toBe('Отходит одиннадцатый армейский корпус, за ним девятая армия.');
    expect(speakable('Против нас LVI тк.')).toBe('Против нас пятьдесят шестой танковый корпус.');
    expect(speakable('Штаб XXXIX корпуса.')).toBe('Штаб тридцать девятого корпуса.');
  });
  it('марки техники остаются читаемыми', () => {
    expect(speakable('Подошли T-34.')).toBe('Подошли Т тридцать четыре.');
    expect(speakable('Подошли Т-34 и КВ-1.')).toBe('Подошли Т тридцать четыре и КВ один.');
    expect(speakable('Против нас Pz IV.')).toBe('Против нас Т четыре.');
  });
  it('сокращения единиц раскрываются', () => {
    expect(speakable('Ушли 2 мин назад.')).toBe('Ушли две минуты назад.');
    expect(speakable('Через 5 мин.')).toBe('Через пять минут.');
    expect(speakable('Ещё 1 ч.')).toBe('Ещё один час.');
    expect(speakable('Через 1 мин. начнём.')).toBe('Через одну минуту начнём.');
    expect(speakable('Осталось до 5 км.')).toBe('Осталось до пяти километров.');
    expect(speakable('Против нас XI ак.')).toBe('Против нас одиннадцатый армейский корпус.');
  });
  it('после «до/от» с существительным в единственном числе — порядковое', () => {
    expect(speakable('Отошли до 2 линии.')).toBe('Отошли до второй линии.');
    expect(speakable('Отошли до 3 рубежа.')).toBe('Отошли до третьего рубежа.');
    expect(speakable('Отошли до 2 линии обороны.')).not.toMatch(/до две/);
    expect(speakable('Дошли до 2 рот.')).toBe('Дошли до двух рот.');
    expect(speakable('Встреча в 5 часов, I think.')).toBe('Встреча в пять часов.');
  });
  it('круглый год — «двухтысячном»', () => {
    expect(speakable('Это было в 2000 году.')).toBe('Это было в двухтысячном году.');
    expect(speakable('С 3000 года.')).toBe('С трёхтысячного года.');
  });
  it('дробь с единицей — не дата', () => {
    expect(speakable('Прошли 3.05 км.')).toBe('Прошли три целых пять сотых километра.');
    expect(speakable('Атака 16.04 захлебнулась.')).toBe('Атака шестнадцатого апреля захлебнулась.');
  });
  it('длинный ответ укорачивается: до двух предложений и 300 знаков', () => {
    expect(speakable('Первое. Второе! Третье? Четвёртое.')).toBe('Первое. Второе!');
    const long = speakable(`${'очень длинное слово '.repeat(40)}конец.`);
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long).toMatch(/[.!?…]$/);
  });
});

describe('инструменты', () => {
  it('toTools: имя без точек, описание, параметры или пустой объект', () => {
    const t = toTools([OPEN, A({ id: 'shell.voices', describe: 'Открывает выбор голоса.' })]);
    expect(t[0]).toEqual({ type: 'function', function: { name: 'shell__open', description: 'Переходит в раздел приложения.', parameters: OPEN.params } });
    expect(t[1].function).toEqual({ name: 'shell__voices', description: 'Открывает выбор голоса.', parameters: { type: 'object', properties: {} } });
  });
  it('системный текст: роль, правила речи, доступное с примерами, недоступное с причиной', () => {
    const s = systemText([OPEN, GAME]);
    expect(s).toMatch(/начальник штаба/i);
    expect(s).toMatch(/числа[^.]*словами/i);
    expect(s).toContain('«штаб, открой переигровку»');
    expect(s).toContain('игра не начата');
    expect(s).toMatch(/не придумывай/i);
    expect(s).toContain('Этого система пока не предусматривает');
  });
});

describe('askModel', () => {
  it('свободная формулировка → вызов shell.open replay и ответ', async () => {
    const { f, calls } = fake([msg('Открываю переигровку.', { name: 'shell__open', args: '{"section":"replay"}' })]);
    const r = await askModel('штаб, давай-ка к переигровке', ctx(f));
    expect(r).toEqual({ say: 'Открываю переигровку.', call: { id: 'shell.open', params: { section: 'replay' } } });
    expect(calls[0].url).toBe('/llm/v1/chat/completions');
    const b = calls[0].body;
    expect(b.model).toBe('qwen3.6');
    expect(b.reasoning_effort).toBe('none'); // размышление голоса — по умолчанию выключено, не как в «ИИ»
    expect(b.tools.map((t: any) => t.function.name)).toEqual(['shell__open']); // недоступное — не инструмент
    expect(b.messages[0].role).toBe('system');
    expect(b.messages.at(-1)).toEqual({ role: 'user', content: 'штаб, давай-ка к переигровке' });
  });
  it('своя модель и размышление голоса', async () => {
    const { f, calls } = fake([msg('Слушаю.')]);
    await askModel('штаб', ctx(f, { settings: { ...SETTINGS, voiceModel: 'small', voiceThinking: 'low' } }));
    expect(calls[0].body.model).toBe('small');
    expect(calls[0].body.reasoning_effort).toBe('low');
  });
  it('размышление в тексте вырезается; озвучка — не здесь (в разборщике, один раз)', async () => {
    const { f } = fake([msg('<think>хм</think>Сбор в 5 часов.')]);
    expect((await askModel('когда сбор', ctx(f))).say).toBe('Сбор в 5 часов.');
  });
  it('пустой content, ответ в reasoning_content — берётся он', async () => {
    const { f } = fake([{ choices: [{ message: { role: 'assistant', content: '', reasoning_content: 'Слушаю вас.' } }] }]);
    expect((await askModel('штаб', ctx(f))).say).toBe('Слушаю вас.');
  });
  it('аргументы инструмента объектом — принимаются как есть', async () => {
    const { f } = fake([{ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'shell__open', arguments: { section: 'replay' } } }] } }] }]);
    expect((await askModel('штаб, к переигровке', ctx(f))).call).toEqual({ id: 'shell.open', params: { section: 'replay' } });
  });
  it('id с «__» внутри — вызов находит своё действие', async () => {
    const Z = A({ id: 'maps.zoom__in', describe: 'Приближает.' });
    const { f } = fake([msg('', { name: 'maps__zoom__in', args: '{}' })]);
    expect((await askModel('штаб, ближе', ctx(f, { actions: [OPEN, Z] }))).call).toEqual({ id: 'maps.zoom__in', params: {} });
  });
  it('нечитаемые аргументы — вызов помечен испорченным', async () => {
    const { f } = fake([msg('', { name: 'shell__open', args: '{section: replay' })]);
    expect((await askModel('штаб, к переигровке', ctx(f))).call).toEqual({ id: 'shell.open', params: undefined, broken: true });
  });
  it('сбой ×2, затем ответ: onRetry вызван, итог получен', async () => {
    const { f, calls } = fake([500, msg('', undefined), msg('Есть.', { name: 'shell__open', args: '{"section":"editor"}' })]);
    const retries: number[] = [];
    const r = await askModel('штаб, в редактор', ctx(f, { onRetry: (n: number) => retries.push(n) }));
    expect(retries).toEqual([2, 3]);
    expect(calls).toHaveLength(3);
    expect(r.call).toEqual({ id: 'shell.open', params: { section: 'editor' } });
  });
  it('сбой ×3 — «Связи с моделью нет»', async () => {
    const { f, calls } = fake([500, 503, msg(null)]);
    const p = askModel('штаб, что-нибудь', ctx(f));
    await expect(p).rejects.toBeInstanceOf(ModelUnavailable);
    await expect(p).rejects.toThrow('Связи с моделью нет');
    expect(calls).toHaveLength(3);
  });
  // LM Studio не запущена: повтор не поможет, а человек ждёт — сразу «Связи с моделью нет»
  it.each([
    ['отказ соединения', new TypeError('Failed to fetch')],
    ['502 шлюза (llm_unavailable)', 502],
    ['400 — запрос не подходит модели', 400],
  ])('%s — сразу ModelUnavailable, без повторов', async (_w, r) => {
    const { f, calls } = fake([r as Error | number, msg('Есть.')]);
    const retries: number[] = [];
    await expect(askModel('штаб, что-нибудь', ctx(f, { onRetry: (n: number) => retries.push(n) }))).rejects.toBeInstanceOf(ModelUnavailable);
    expect(calls).toHaveLength(1);
    expect(retries).toEqual([]);
  });
  it('нет ответа 20 с — повтор (модель зависла или грузится)', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const f = ((_u: string, init: RequestInit) => {
        n++;
        if (n === 2) return Promise.resolve(new Response(JSON.stringify(msg('Есть.')), { status: 200 }));
        return new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason)));
      }) as unknown as typeof fetch;
      const retries: number[] = [];
      const p = askModel('штаб', ctx(f, { onRetry: (k: number) => retries.push(k) }));
      await vi.advanceTimersByTimeAsync(MODEL_TIMEOUT_MS + 10);
      expect((await p).say).toBe('Есть.');
      expect(n).toBe(2);
      expect(retries).toEqual([2]);
    } finally { vi.useRealTimers(); }
  });
  it('отмена — без повторов', async () => {
    const ac = new AbortController();
    ac.abort();
    const { f, calls } = fake([msg('x')]);
    await expect(askModel('штаб', ctx(f, { signal: ac.signal }))).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('createVoiceModel хранит разговор', async () => {
    const { f, calls } = fake([msg('Слушаю.'), msg('Есть.')]);
    const m = createVoiceModel({ settings: () => SETTINGS, fetch: f, delays: [0, 0] });
    const sig = new AbortController().signal;
    await m('штаб, ты тут?', [OPEN], { signal: sig, onRetry: () => {}, section: 'editor' });
    await m('штаб, хорошо', [OPEN], { signal: sig, onRetry: () => {}, section: 'editor' });
    expect(calls[1].body.messages.slice(1)).toEqual([
      { role: 'user', content: 'штаб, ты тут?' }, { role: 'assistant', content: 'Слушаю.' }, { role: 'user', content: 'штаб, хорошо' },
    ]);
  });
});

describe('настройки модели голоса', () => {
  it('loadLlm: вариант через @ снимается и у модели голоса', async () => {
    const store: Record<string, string> = { 'def_ops.llm': JSON.stringify({ voiceModel: 'qwen/qwen3@8bit', model: 'a@4bit' }) };
    (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: () => {}, removeItem: () => {} };
    try {
      const { loadLlm } = await import('../src/shared');
      const s = loadLlm();
      expect(s.voiceModel).toBe('qwen/qwen3');
      expect(s.model).toBe('a');
      store['def_ops.llm'] = JSON.stringify({ enemyModel: 'qwen/qwen3@4bit' });
      expect(loadLlm().enemyModel).toBe('qwen/qwen3');
    } finally { delete (globalThis as any).localStorage; }
  });
});
