// Голос без рук: дежурный режим, подтверждение необратимого, окна и вопросы голосом, диктовка и чтение по частям.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, openModal, register, setSpeaker, topModal, type Action } from '../src/voice/registry';
import { SayGate } from '../src/voice/panel-state';
import { CONFIRM_MS, Dispatcher, RECHECK_MS, STANDBY_SAY } from '../src/voice/dispatch';
import { ModelUnavailable, type ModelReply } from '../src/voice/llm';
import { ordinalIndex, pickByName, yesNo } from '../src/voice/answers';
import { fieldActions, readAloud } from '../src/voice/dictation';
import { voiceDialog } from '../src/dialogs';

type Opts = ConstructorParameters<typeof Dispatcher>[0];
type Hook = NonNullable<Opts['model']>;

let offs: (() => void)[] = [];
let opened: unknown[] = [];
let said: string[] = [];
let t = 0;
let section = 'editor';
const reg = (a: Partial<Action<any>> & { id: string }) =>
  offs.push(register({ section: 'global', title: a.id, describe: '', available: () => true, run: async () => undefined, ...a } as Action));
const mk = (extra: Partial<Opts> = {}) => new Dispatcher({ now: () => t, say: (s) => said.push(s), section: () => section, ...extra });
const reply = (r: ModelReply): Hook => async () => r;

beforeEach(() => {
  offs = []; opened = []; said = []; t = 1_000_000; section = 'editor';
  reg({ id: 'shell.open', run: async (p: unknown) => { opened.push(p); } });
  reg({ id: 'shell.calibrate', run: async () => { opened.push('calibrate'); } });
  reg({ id: 'shell.voices', run: async () => { opened.push('voices'); } });
});
afterEach(() => { offs.forEach((o) => o()); setSpeaker(null); });

describe('ответы «да / нет», номер и название', () => {
  it('да и синонимы, нет и синонимы; прочее — не ответ', () => {
    for (const s of ['да', 'так точно', 'подтверждаю', 'да подтверждаю', 'верно', 'выполняйте', 'давай']) expect(yesNo(s)).toBe('yes');
    for (const s of ['нет', 'отмена', 'отставить', 'не надо', 'никак нет', 'отменить']) expect(yesNo(s)).toBe('no');
    for (const s of ['открой карты', 'да открой карты', 'нет связи', '']) expect(yesNo(s)).toBeNull();
  });
  it('порядковый номер: «второй», «вариант три», «номер 2», «последний»', () => {
    expect(ordinalIndex('первый')).toBe(0);
    expect(ordinalIndex('второй')).toBe(1);
    expect(ordinalIndex('вторую')).toBe(1);
    expect(ordinalIndex('вариант три')).toBe(2);
    expect(ordinalIndex('номер 2')).toBe(1);
    expect(ordinalIndex('2')).toBe(1);
    expect(ordinalIndex('последний', 4)).toBe(3);
    expect(ordinalIndex('открой карты')).toBeNull();
  });
  it('по названию: точное и с огрехами; несколько похожих — все кандидаты', () => {
    const names = ['Жуков, 10 с', 'Жуков, 14 с', 'Гость'];
    expect(pickByName('гость', names)).toEqual([2]);
    expect(pickByName('гостя', names)).toEqual([2]);
    expect(pickByName('жуков', names)).toEqual([0, 1]);
    expect(pickByName('жуков четырнадцать', names)).toEqual([1]);
    expect(pickByName('музыка', names)).toEqual([]);
  });
});

describe('подтверждение необратимого', () => {
  const del = vi.fn(async () => 'Игра удалена.');
  const mkm = (r: ModelReply, extra: Partial<Opts> = {}) => mk({ model: reply(r), ...extra });
  beforeEach(() => {
    del.mockClear();
    reg({ id: 'game.delete', section: 'editor', title: 'Удалить игру', irreversible: true, confirm: () => 'Завершить игру и удалить её запись?', run: del });
  });
  const ask = { say: 'Удаляю.', call: { id: 'game.delete', params: {} } };

  it('модель вызывает необратимое → вопрос, а не исполнение; «да» исполняет', async () => {
    const pend: unknown[] = [];
    const d = mkm(ask, { onPending: (p) => pend.push(p) });
    expect(await d.utterance('штаб, удали игру', 1)).toBe('done');
    expect(del).not.toHaveBeenCalled();
    expect(said).toEqual(['Завершить игру и удалить её запись? Скажите «да», чтобы подтвердить, или «нет» — чтобы отменить. Жду ответа.']);
    expect(d.pending).toMatchObject({ action: 'game.delete', params: {}, text: 'Завершить игру и удалить её запись?' });
    expect(pend).toHaveLength(1);
    // «да» — без обращения: подтверждение ждёт ответа
    t += 5000;
    expect(await d.utterance('да', 2)).toBe('done');
    expect(del).toHaveBeenCalledTimes(1);
    expect(said.at(-1)).toBe('Игра удалена.');
    expect(d.pending).toBeNull();
    expect(pend.at(-1)).toBeNull();
  });
  it.each(['нет', 'Штаб, отмена', 'отставить', 'не надо'])('«%s» — отмена с короткой фразой', async (no) => {
    const d = mkm(ask);
    await d.utterance('штаб, удали игру', 1);
    expect(await d.utterance(no, 2)).toBe('done');
    expect(del).not.toHaveBeenCalled();
    expect(said.at(-1)).toBe('Отменено.');
    expect(d.pending).toBeNull();
  });
  it('15 с молчания — «Отменяю — подтверждения не было»; «да» после этого — ничего', async () => {
    const d = mkm(ask);
    await d.utterance('штаб, удали игру', 1);
    d.spoke(); // вопрос договорён — 15 с отсчитываются от его конца
    t += CONFIRM_MS - 1;
    d.tick();
    expect(d.pending).not.toBeNull();
    t += 2;
    d.tick();
    expect(d.pending).toBeNull();
    expect(said.at(-1)).toBe('Отменяю — подтверждения не было.');
    expect(CONFIRM_MS).toBe(15_000);
    expect(await d.utterance('штаб, да', 2)).toBe('done');
    expect(del).not.toHaveBeenCalled();
    expect(said.at(-1)).toBe('Подтверждать сейчас нечего.');
  });
  it('«да» после 15 с без tick (часы не успели) — всё равно не исполняется', async () => {
    const d = mkm(ask);
    await d.utterance('штаб, удали игру', 1);
    t += CONFIRM_MS + 1;
    await d.utterance('штаб, да', 2);
    expect(del).not.toHaveBeenCalled();
  });
  it('новая просьба — прежнее отменено, просьба исполняется; «да» потом — ничего', async () => {
    const d = mkm(ask);
    await d.utterance('штаб, удали игру', 1);
    expect(await d.utterance('штаб, открой карты', 2)).toBe('done');
    expect(opened).toEqual([{ section: 'maps' }]);
    expect(said).toContain('Прежнее отменено.');
    expect(d.pending).toBeNull();
    await d.utterance('штаб, да', 3);
    expect(del).not.toHaveBeenCalled();
  });
  it('кнопки «Да» / «Нет» — тот же ответ (answer)', async () => {
    const d = mkm(ask);
    await d.utterance('штаб, удали игру', 1);
    await d.answer(false);
    expect(del).not.toHaveBeenCalled();
    await d.utterance('штаб, удали игру', 2);
    await d.answer(true);
    expect(del).toHaveBeenCalledTimes(1);
    await d.answer(true);
    expect(del).toHaveBeenCalledTimes(1);
  });
  it('к «да» действие стало недоступно — не исполняется, причина', async () => {
    let av: true | string = true;
    offs.push(register({ id: 'game.delete', section: 'editor', title: 'x', describe: '', irreversible: true, available: () => av, run: del }));
    const d = mkm(ask);
    await d.utterance('штаб, удали игру', 1);
    av = 'игра уже закончена';
    await d.utterance('да', 2);
    expect(del).not.toHaveBeenCalled();
    expect(said.at(-1)).toBe('Сейчас нельзя: игра уже закончена.');
  });
  it('предложение (propose) — то же ожидание «да / нет»', async () => {
    const d = mk();
    d.propose('Калибровки ещё не было. Провести её?', 'shell.calibrate');
    expect(said).toEqual(['Калибровки ещё не было. Провести её? Скажите «да», чтобы подтвердить, или «нет» — чтобы отменить. Жду ответа.']);
    await d.utterance('так точно', 1);
    expect(opened).toEqual(['calibrate']);
  });
});

describe('дежурный режим', () => {
  const events: unknown[] = [];
  beforeEach(() => {
    events.length = 0;
    (globalThis as any).window = { dispatchEvent: (e: CustomEvent) => { events.push([e.type, e.detail]); return true; } };
  });
  afterEach(() => { delete (globalThis as any).window; });

  it.each(['Штаб, отбой', 'Штаб, выключи голос'])('«%s» — дежурю: voice:standby true, микрофон не выключается', async (p) => {
    const st: boolean[] = [];
    const d = mk({ onStandby: (on) => st.push(on) });
    expect(await d.utterance(p, 1)).toBe('done');
    expect(d.standby).toBe(true);
    expect(st).toEqual([true]);
    expect(events).toEqual([['voice:standby', true]]);
    expect(events).not.toContainEqual(['voice:power', false]);
    expect(said).toEqual([STANDBY_SAY]);
    expect(STANDBY_SAY).toBe('Дежурю. Скажите: «Штаб, на связь».');
  });
  it('в дежурном «Штаб, открой карты» не исполняется и штаб молчит; «Штаб, на связь» будит', async () => {
    const d = mk();
    await d.utterance('Штаб, отбой', 1);
    said.length = 0;
    t += 10_000;
    expect(await d.utterance('Штаб, открой карты', 2)).toBe('ignored');
    expect(await d.utterance('Штаб, калибровка', 3)).toBe('ignored');
    expect(await d.utterance('открой карты', 4)).toBe('ignored');
    expect(opened).toEqual([]);
    expect(said).toEqual([]);
    expect(await d.utterance('Штаб, на связь!', 5)).toBe('done');
    expect(d.standby).toBe(false);
    expect(said).toEqual(['На связи.']);
    expect(events.at(-1)).toEqual(['voice:standby', false]);
    expect(await d.utterance('Штаб, открой карты', 6)).toBe('done');
    expect(opened).toEqual([{ section: 'maps' }]);
  });
  it.each(['Штаб, подъём', 'Штаб, включись', 'штаб на связь'])('«%s» — тоже будит', async (p) => {
    const d = mk();
    await d.utterance('Штаб, отбой', 1);
    t += 10_000;
    expect(await d.utterance(p, 2)).toBe('done');
    expect(d.standby).toBe(false);
  });
  it('будит действие shell.wake (если оно в реестре)', async () => {
    const wake = vi.fn(async () => undefined);
    reg({ id: 'shell.wake', run: wake });
    const d = mk();
    await d.utterance('Штаб, отбой', 1);
    t += 10_000;
    await d.utterance('Штаб, на связь', 2);
    expect(wake).toHaveBeenCalledTimes(1);
  });
  it('эхо собственной фразы штаба («…Скажите: Штаб, на связь») не будит', async () => {
    const d = mk();
    await d.utterance('Штаб, отбой', 1);
    // фраза ещё звучит — микрофон поймал её хвост
    expect(await d.utterance('Штаб, на связь.', 2)).toBe('ignored');
    expect(d.standby).toBe(true);
    // договорена — дальше это человек (хвост эха после конца фразы отсекает сервис: сообщение echo)
    d.spoke();
    t += 500;
    expect(await d.utterance('Штаб, на связь', 4)).toBe('done');
    expect(d.standby).toBe(false);
  });
  it('модель в дежурном не зовётся; ждущий ответ модели отменяется', async () => {
    let signal: AbortSignal | null = null;
    const m = vi.fn((_t: string, _a: Action[], c: { signal: AbortSignal }) => { signal = c.signal; return new Promise<ModelReply>(() => {}); });
    const d = mk({ model: m as unknown as Hook });
    void d.utterance('штаб, что нового', 1);
    await Promise.resolve();
    await d.utterance('Штаб, отбой', 2);
    expect(signal!.aborted).toBe(true);
    t += 10_000;
    await d.utterance('Штаб, расскажи про погоду', 3);
    expect(m).toHaveBeenCalledTimes(1);
  });
  it('setStandby извне (кнопка, событие окна) — то же состояние; повторно — без второй фразы', () => {
    const d = mk();
    d.setStandby(true);
    d.setStandby(true);
    expect(said).toEqual([STANDBY_SAY]);
    d.setStandby(false);
    expect(said).toEqual([STANDBY_SAY, 'На связи.']);
  });
  it('в дежурном ожидание подтверждения снято', async () => {
    const del = vi.fn(async () => undefined);
    reg({ id: 'x.del', section: 'editor', irreversible: true, run: del });
    const d = mk({ model: reply({ say: '', call: { id: 'x.del', params: {} } }) });
    await d.utterance('штаб, сотри', 1);
    expect(d.pending).not.toBeNull();
    await d.utterance('Штаб, отбой', 2);
    expect(d.pending).toBeNull();
  });
});

describe('окно ждёт ответа (N4)', () => {
  it('открыто окно — команды не исполняются молча: «Сначала ответьте на вопрос: …»', async () => {
    const answer = vi.fn(async () => undefined);
    reg({ id: 'dlg.yes', run: answer });
    const close = openModal({ question: 'Удалить слой?', parse: (r) => (yesNo(r) === 'yes' ? { id: 'dlg.yes' } : null) });
    const d = mk();
    expect(await d.utterance('Штаб, открой карты', 1)).toBe('unknown');
    expect(opened).toEqual([]);
    expect(said).toEqual(['Сначала ответьте на вопрос: Удалить слой?']);
    expect(await d.utterance('Штаб, да', 2)).toBe('done');
    expect(answer).toHaveBeenCalledTimes(1);
    close();
    expect(topModal()).toBeNull();
    expect(await d.utterance('Штаб, открой карты', 3)).toBe('done');
    expect(opened).toEqual([{ section: 'maps' }]);
  });
  it('в окне работают стоп-слова, «отбой» и «повтори»', async () => {
    const stop = vi.fn();
    const close = openModal({ question: 'Удалить слой?', read: 'Удалить слой? Скажите «да» или «нет».', parse: () => null });
    const d = mk({ stop });
    d.spoke();
    expect(await d.utterance('стоп', 1)).toBe('done');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(await d.utterance('Штаб, повтори', 2)).toBe('done');
    expect(said.at(-1)).toBe('Удалить слой? Скажите «да» или «нет».');
    expect(await d.utterance('Штаб, отбой', 3)).toBe('done');
    expect(d.standby).toBe(true);
    close();
  });
  it('модель при открытом окне не зовётся', async () => {
    const m = vi.fn(async () => ({ say: 'Солнечно.' }));
    const close = openModal({ question: 'Удалить слой?', parse: () => null });
    const d = mk({ model: m as never });
    await d.utterance('Штаб, расскажи про погоду', 1);
    expect(m).not.toHaveBeenCalled();
    close();
  });
  it('окна — стопкой: закрыли верхнее — снова отвечает нижнее', () => {
    const a = openModal({ question: 'А?', parse: () => null });
    const b = openModal({ question: 'Б?', parse: () => null });
    expect(topModal()?.question).toBe('Б?');
    b();
    expect(topModal()?.question).toBe('А?');
    a();
    expect(topModal()).toBeNull();
  });
  it('открытое окно зачитывает свой вопрос (speak)', () => {
    setSpeaker((s) => said.push(s));
    const close = openModal({ question: 'Удалить слой?', read: 'Удалить слой? Скажите «да» или «нет».', parse: () => null });
    expect(said).toEqual(['Удалить слой? Скажите «да» или «нет».']);
    close();
  });
});

describe('окна dialogs.ts голосом', () => {
  beforeEach(() => setSpeaker((s) => said.push(s)));
  it('confirmAsync: штаб зачитывает вопрос; «да» — нажимает «ОК»', async () => {
    const out: unknown[] = [];
    const off = voiceDialog({ message: 'Завершить игру и удалить её запись?', ok: 'Завершить и удалить' }, (o) => out.push(o));
    expect(said[0]).toMatch(/^Завершить игру и удалить её запись\? Скажите «да» — «Завершить и удалить», или «нет»\. Жду ответа\.$/);
    const d = mk();
    expect(await d.utterance('штаб, да', 1)).toBe('done');
    expect(out).toEqual([true]);
    // ответ снял временные действия и окно
    expect(topModal()).toBeNull();
    await expect(act('dialog.answer', { choice: 'да' })).rejects.toThrow();
    off();
  });
  it('confirmAsync: «нет» / «отмена» — «Отмена»', async () => {
    const out: unknown[] = [];
    voiceDialog({ message: 'Удалить?' }, (o) => out.push(o));
    await mk().utterance('штаб, отмена', 1);
    expect(out).toEqual([false]);
    // «отставить» в окне — тоже «нет» (а не стоп-слово с остатком)
    voiceDialog({ message: 'Удалить?' }, (o) => out.push(o));
    await mk().utterance('штаб, отставить', 2);
    expect(out).toEqual([false, false]);
  });
  it('chooseAsync: «второй» — второй вариант, по названию — тот, что назван', async () => {
    const out: unknown[] = [];
    voiceDialog({ message: 'Что сделать с игрой?', labels: ['Сохранить', 'Удалить', 'Продолжить'] }, (o) => out.push(o));
    expect(said[0]).toBe('Что сделать с игрой? Варианты: первый — «Сохранить», второй — «Удалить», третий — «Продолжить». Или «отмена». Жду ответа.');
    await mk().utterance('штаб, второй', 1);
    expect(out).toEqual([1]);
    voiceDialog({ message: 'Что сделать?', labels: ['Сохранить', 'Удалить', 'Продолжить'] }, (o) => out.push(o));
    await mk().utterance('штаб, продолжить', 2);
    expect(out).toEqual([1, 2]);
  });
  it('chooseAsync: непонятный вариант — переспрос, окно остаётся', async () => {
    const out: unknown[] = [];
    const off = voiceDialog({ message: 'Что сделать?', labels: ['Сохранить', 'Удалить'] }, (o) => out.push(o));
    await mk().utterance('штаб, седьмой', 1);
    expect(out).toEqual([]);
    expect(said.at(-1)).toMatch(/^Такого варианта нет/);
    off();
  });
  it('askText: диктовка, «допиши», «готово» — введённое; «отмена» — null', async () => {
    let value = 'Участок';
    const out: unknown[] = [];
    voiceDialog({ message: 'Название участка:', input: { get: () => value, set: (s) => { value = s; } } }, (o) => out.push(o === false ? false : value));
    expect(said[0]).toBe('Название участка. Сейчас записано: «Участок». Продиктуйте текст, затем скажите «готово». Жду ответа.');
    const d = mk();
    d.spoke(); // вопрос зачитан — окно разговора открыто
    await d.utterance('штаб, напиши Зеловские высоты', 1);
    expect(value).toBe('Зеловские высоты');
    expect(said.at(-1)).toBe('Записал: «Зеловские высоты». Скажите «готово» или продиктуйте заново.');
    await d.utterance('допиши северный склон', 2);
    expect(value).toBe('Зеловские высоты северный склон');
    expect(out).toEqual([]);
    await d.utterance('готово', 3);
    expect(out).toEqual(['Зеловские высоты северный склон']);
    voiceDialog({ message: 'Имя:', input: { get: () => value, set: (s) => { value = s; } } }, (o) => out.push(o));
    await d.utterance('штаб, отмена', 4);
    expect(out.at(-1)).toBe(false);
  });
  it('say: «понятно» закрывает сообщение', async () => {
    const out: unknown[] = [];
    voiceDialog({ message: 'Не удалось открыть файл.', alone: true }, (o) => out.push(o));
    expect(said[0]).toBe('Не удалось открыть файл. Скажите «понятно». Жду ответа.');
    await mk().utterance('штаб, понятно', 1);
    expect(out).toEqual([true]);
  });
});

describe('диктовка в поле и чтение по частям', () => {
  let text = '';
  beforeEach(() => {
    text = '';
    for (const a of fieldActions('cmd.intent', 'Замысел', () => text, (s) => { text = s; })) offs.push(register(a));
  });
  it('действия поля: write / append / clear / read', async () => {
    expect(await act('cmd.intent.write', { text: 'Прорвать оборону' })).toBe('Записал в «Замысел».');
    expect(text).toBe('Прорвать оборону');
    await act('cmd.intent.append', { text: 'на Зеловских высотах' });
    expect(text).toBe('Прорвать оборону на Зеловских высотах');
    expect(await act('cmd.intent.read')).toBe('Прорвать оборону на Зеловских высотах');
    await act('cmd.intent.clear');
    expect(text).toBe('');
    expect(await act('cmd.intent.read')).toBe('«Замысел» пусто.');
  });
  it('голосом: «запиши в замысел: …», «допиши в замысел …», «прочитай замысел», «очисти замысел»', async () => {
    const d = mk();
    expect(await d.utterance('Штаб, запиши в замысел: прорвать оборону противника', 1)).toBe('done');
    expect(text).toBe('Прорвать оборону противника');
    await d.utterance('Штаб, допиши в замысел к исходу дня', 2);
    expect(text).toBe('Прорвать оборону противника к исходу дня');
    await d.utterance('Штаб, прочитай замысел', 3);
    expect(said.at(-1)).toBe('Прорвать оборону противника к исходу дня');
    await d.utterance('Штаб, очисти замысел', 4);
    expect(text).toBe('');
  });
  it('длинное читается частями: «дальше» — следующая часть, «хватит» — конец чтения', async () => {
    text = 'Первое предложение. Второе предложение. Третье предложение. Четвёртое предложение. Пятое предложение.';
    const first = readAloud(text);
    expect(first).toBe('Первое предложение. Второе предложение. Дальше?');
    const d = mk({ stop: () => {} });
    d.spoke();
    expect(await d.utterance('дальше', 1)).toBe('done');
    expect(said.at(-1)).toBe('Третье предложение. Четвёртое предложение. Дальше?');
    expect(await d.utterance('хватит', 2)).toBe('done');
    // чтение окончено: «дальше» больше не читает
    said.length = 0;
    await d.utterance('штаб, дальше', 3);
    expect(said.join(' ')).not.toMatch(/Пятое/);
  });
  it('последняя часть — без «Дальше?»; длинное предложение режется по словам', () => {
    expect(readAloud('Одно. Два.')).toBe('Одно. Два.');
    const long = `${'слово '.repeat(120).trim()}.`;
    const p = readAloud(long);
    expect(p.length).toBeLessThanOrEqual(320);
    expect(p.endsWith('Дальше?')).toBe(true);
  });
});

describe('модель «недоступна» перепроверяется (N1)', () => {
  let thinking: boolean[] = [];
  beforeEach(() => { thinking = []; });
  it('проверка в «ИИ» не прошла; через 31 с непонятая фраза → перепроверка → прошла → модель', async () => {
    const m = vi.fn(async () => ({ say: 'Солнечно.' }));
    let ready = false;
    const recheck = vi.fn(async () => { ready = true; return true; });
    const d = mk({ model: m as never, modelReady: () => ready, recheck, thinking: (on) => thinking.push(on) });
    // первая непонятая — перепроверка сразу (прежде проверок не было)
    recheck.mockImplementationOnce(async () => false);
    expect(await d.utterance('штаб, расскажи про погоду', 1)).toBe('unknown');
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(m).not.toHaveBeenCalled();
    expect(said.at(-1)).toMatch(/^Не понял вас\. Языковая модель сейчас недоступна/);
    // через 10 с — без перепроверки, сразу честный ответ
    t += 10_000;
    await d.utterance('штаб, расскажи про погоду', 2);
    expect(recheck).toHaveBeenCalledTimes(1);
    t += RECHECK_MS + 1000;
    expect(RECHECK_MS).toBe(30_000);
    expect(await d.utterance('штаб, расскажи про погоду', 3)).toBe('done');
    expect(recheck).toHaveBeenCalledTimes(2);
    expect(m).toHaveBeenCalledTimes(1);
    expect(said.at(-1)).toBe('Солнечно.');
    // пока перепроверка — «Думаю»
    expect(thinking.slice(0, 2)).toEqual([true, false]);
  });
  it('сбой модели (ModelUnavailable) — не слепые 3 минуты: через 30 с перепроверка', async () => {
    let fail = true;
    const m = vi.fn(async () => { if (fail) throw new ModelUnavailable(); return { say: 'Ясно.' }; });
    const recheck = vi.fn(async () => !fail);
    const d = mk({ model: m as never, recheck });
    await d.utterance('штаб, как дела у соседей', 1);
    expect(said.at(-1)).toMatch(/^Связи с моделью нет/);
    t += 5000;
    await d.utterance('штаб, как дела у соседей', 2);
    expect(recheck).not.toHaveBeenCalled();
    expect(m).toHaveBeenCalledTimes(1);
    fail = false;
    t += RECHECK_MS;
    expect(await d.utterance('штаб, как дела у соседей', 3)).toBe('done');
    expect(recheck).toHaveBeenCalledTimes(1);
    expect(said.at(-1)).toBe('Ясно.');
  });
  it('перепроверка висит — не дольше 5 с, потом честный ответ', async () => {
    vi.useFakeTimers();
    try {
      const m = vi.fn(async () => ({ say: 'x' }));
      const d = mk({ model: m as never, modelReady: () => false, recheck: () => new Promise<boolean>(() => {}) });
      const r = d.utterance('штаб, расскажи про погоду', 1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await r).toBe('unknown');
      expect(m).not.toHaveBeenCalled();
      expect(said.at(-1)).toMatch(/Языковая модель сейчас недоступна/);
    } finally { vi.useRealTimers(); }
  });
});

describe('«отставить» с остатком (N3)', () => {
  it('без модели — «Отставлено», остаток правилами не исполняется', async () => {
    const stop = vi.fn();
    const d = mk({ stop });
    expect(await d.utterance('Штаб, отставить переигровку', 1)).toBe('done');
    expect(await d.utterance('Штаб, отставить, открой карты', 2)).toBe('done');
    expect(opened).toEqual([]);
    expect(stop).toHaveBeenCalledTimes(2);
    expect(said).toEqual(['Отставлено.', 'Отставлено.']);
  });
  it('с моделью — фраза целиком уходит в модель, правила остаток не исполняют', async () => {
    const m = vi.fn(async () => ({ say: 'Есть, отставить.' }));
    const d = mk({ model: m as never });
    await d.utterance('Штаб, отставить переигровку', 1);
    expect(opened).toEqual([]);
    expect(m).toHaveBeenCalledTimes(1);
    expect((m.mock.calls[0] as unknown[])[0]).toBe('Штаб, отставить переигровку');
  });
  it('прочие стоп-слова с просьбой — по-прежнему: замолчать и исполнить', async () => {
    const d = mk({ stop: () => {} });
    d.spoke();
    expect(await d.utterance('Стоп, открой карты', 1)).toBe('done');
    expect(opened).toEqual([{ section: 'maps' }]);
  });
});

describe('«повтори» и «да» без вопроса', () => {
  it('«повтори» — последняя фраза штаба', async () => {
    const d = mk();
    await d.utterance('штаб', 1);
    await d.utterance('штаб, повтори', 2);
    expect(said).toEqual(['Слушаю.', 'Слушаю.']);
  });
});

describe('действия оболочки: дежурный режим', () => {
  it('shell.standby и shell.wake — событие окна voice:standby', async () => {
    const events: unknown[] = [];
    (globalThis as any).window = { dispatchEvent: (e: CustomEvent) => { events.push([e.type, e.detail]); return true; } };
    try {
      const { shellActions } = await import('../src/voice/actions/shell');
      const list = shellActions();
      const wake = list.find((a) => a.id === 'shell.wake')!;
      const standby = list.find((a) => a.id === 'shell.standby')!;
      expect(wake.say).toContain('штаб, на связь');
      await standby.run(undefined);
      await wake.run(undefined);
      expect(events).toEqual([['voice:standby', true], ['voice:standby', false]]);
    } finally { delete (globalThis as any).window; }
  });
});

describe('калибровка и голоса голосом: разбор ответов окна', () => {
  it('калибровка: начать, готово, заново, закрыть', async () => {
    const { calibParse } = await import('../src/voice/Calibration');
    expect(calibParse('начать')).toEqual({ id: 'voice.calibrate.start' });
    expect(calibParse('начинай')).toEqual({ id: 'voice.calibrate.start' });
    expect(calibParse('готово')).toEqual({ id: 'voice.calibrate.done' });
    expect(calibParse('заново')).toEqual({ id: 'voice.calibrate.again' });
    expect(calibParse('еще раз')).toEqual({ id: 'voice.calibrate.again' });
    expect(calibParse('закрой')).toEqual({ id: 'voice.calibrate.close' });
    expect(calibParse('отмена')).toEqual({ id: 'voice.calibrate.close' });
    expect(calibParse('открой карты')).toBeNull();
  });
  it('окна калибровки и «Голоса»: их ответы — тоже без обращения (раунд 1, Important-2)', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../src/voice/Calibration.tsx', import.meta.url), 'utf8')
      + (await import('node:fs')).readFileSync(new URL('../src/voice/Voices.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/isAnswer: \(rest\) => calibParse\(rest\) !== null/);
    expect(src).toMatch(/isAnswer: \(rest\) => voicesParse\(rest\) !== null/);
  });
  it('голоса: прослушай, назначь, запиши, удали, закрой', async () => {
    const { voicesParse } = await import('../src/voice/Voices');
    expect(voicesParse('прослушай второй голос')).toEqual({ id: 'voices.preview', params: { name: 'второй' } });
    expect(voicesParse('прослушай голос гость')).toEqual({ id: 'voices.preview', params: { name: 'гость' } });
    expect(voicesParse('назначь гость начальнику штаба')).toEqual({ id: 'voices.assign', params: { name: 'гость', role: 'chief' } });
    expect(voicesParse('назначь первый голос посреднику')).toEqual({ id: 'voices.assign', params: { name: 'первый', role: 'umpire' } });
    expect(voicesParse('запиши новый голос')).toEqual({ id: 'voices.record', params: {} });
    expect(voicesParse('запиши новый голос гость')).toEqual({ id: 'voices.record', params: { name: 'гость' } });
    expect(voicesParse('удали голос гость')).toEqual({ id: 'voices.delete', params: { name: 'гость' } });
    expect(voicesParse('закрой')).toEqual({ id: 'voices.close' });
    expect(voicesParse('открой карты')).toBeNull();
  });
  it('голос по названию или номеру: один — найден, похожих несколько — переспрос, нет — честно', async () => {
    const { voiceByName } = await import('../src/voice/Voices');
    const list = [{ id: 'a', name: 'Жуков, 10 с' }, { id: 'b', name: 'Жуков, 14 с' }, { id: 'c', name: 'Гость' }];
    expect(voiceByName('второй', list)).toEqual({ voice: list[1] });
    expect(voiceByName('гость', list)).toEqual({ voice: list[2] });
    expect(voiceByName('жуков', list)).toEqual({ ask: 'Какой голос: первый — «Жуков, 10 с», второй — «Жуков, 14 с»? Скажите номер.' });
    expect(voiceByName('музыка', list)).toEqual({ ask: 'Голоса «музыка» нет. Есть: «Жуков, 10 с», «Жуков, 14 с», «Гость».' });
  });
});

describe('раунд 1: поправки по рецензии', () => {
  /** Разборщик с настоящими воротами: фраза уходит в «сервис» (sent) через SayGate, supersede — gate.drop(). */
  function withGate(extra: Partial<Opts> = {}) {
    const sent: string[] = [];
    const gate = new SayGate((_id, text) => sent.push(text), () => t, () => false);
    let n = 0;
    const d = mk({ say: (s) => { said.push(s); const id = ++n; gate.say(id, s); return id; }, supersede: () => { gate.drop(); }, ...extra });
    /** Реплика в настоящем порядке протокола: речь началась — кончилась — реплика (синхронная часть) — ворота отпущены. */
    const speak = async (text: string, id: number) => {
      gate.speech(true); gate.speech(false);
      const r = d.utterance(text, id);
      gate.utterance();
      return r;
    };
    return { d, sent, gate, speak };
  }

  it('Important-1: новая обращённая просьба при ждущем подтверждении — «Прежнее отменено.» звучит (ворота)', async () => {
    reg({ id: 'game.delete', section: 'editor', irreversible: true, confirm: () => 'Удалить игру?', run: async () => 'Удалено.' });
    const { d, sent, speak } = withGate({ model: reply({ say: '', call: { id: 'game.delete', params: {} } }) });
    await speak('штаб, удали игру', 1);
    expect(d.pending).not.toBeNull();
    expect(await speak('штаб, открой карты', 2)).toBe('done');
    expect(sent).toContain('Прежнее отменено.');
    expect(opened).toEqual([{ section: 'maps' }]);
  });

  it('Important-2: окно открыто, окно разговора прошло — «да» без «штаб» принимается; иное без обращения — игнор', async () => {
    const out: unknown[] = [];
    const off = voiceDialog({ message: 'Удалить слой?' }, (o) => out.push(o));
    const d = mk();
    d.spoke();
    t += 13_000;
    expect(await d.utterance('открой карты', 1)).toBe('ignored');
    expect(opened).toEqual([]);
    expect(out).toEqual([]);
    expect(await d.utterance('да', 2)).toBe('done');
    expect(out).toEqual([true]);
    off();
    // выбор: номер и название — тоже без обращения
    voiceDialog({ message: 'Что сделать?', labels: ['Сохранить', 'Удалить'] }, (o) => out.push(o));
    t += 60_000;
    await d.utterance('второй', 3);
    voiceDialog({ message: 'Что сделать?', labels: ['Сохранить', 'Удалить'] }, (o) => out.push(o));
    t += 60_000;
    await d.utterance('сохранить', 4);
    expect(out).toEqual([true, 1, 0]);
  });

  it('Minor-9: посторонняя речь без обращения подтверждение не отменяет; «нет» без обращения — отменяет', async () => {
    const del = vi.fn(async () => undefined);
    reg({ id: 'game.delete', section: 'editor', irreversible: true, run: del });
    const d = mk({ model: reply({ say: '', call: { id: 'game.delete', params: {} } }) });
    await d.utterance('штаб, удали игру', 1);
    said.length = 0;
    expect(await d.utterance('передайте в штаб армии', 2)).toBe('ignored');
    expect(await d.utterance('открой карты', 3)).toBe('ignored');
    expect(d.pending).not.toBeNull();
    expect(said).toEqual([]);
    expect(opened).toEqual([]);
    await d.utterance('да', 4);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('Minor-2: сообщение (say) закрывают «ясно / хорошо / понял / дальше / закрой»; другая команда — закрыть сообщение и исполнить', async () => {
    for (const [i, w] of ['ясно', 'хорошо', 'понял', 'дальше', 'закрой'].entries()) {
      const out: unknown[] = [];
      voiceDialog({ message: 'Файл сохранён.', alone: true }, (o) => out.push(o));
      await mk().utterance(`штаб, ${w}`, i + 1);
      expect(out).toEqual([true]);
      expect(topModal()).toBeNull();
    }
    const out: unknown[] = [];
    voiceDialog({ message: 'Файл сохранён.', alone: true }, (o) => out.push(o));
    expect(await mk().utterance('Штаб, открой карты', 9)).toBe('done');
    expect(out).toEqual([true]);
    expect(opened).toEqual([{ section: 'maps' }]);
    expect(topModal()).toBeNull();
  });

  it('Minor-8: вопрос окна зачитывается целиком (до 4 фраз); длинный — частями, «нельзя отменить» не теряется', () => {
    setSpeaker((s) => said.push(s));
    let off = voiceDialog({ message: 'Завершить игру? Запись будет удалена. Это нельзя отменить.' }, () => {});
    expect(said.at(-1)).toBe('Завершить игру? Запись будет удалена. Это нельзя отменить. Скажите «да» или «нет». Жду ответа.');
    off();
    off = voiceDialog({ message: 'Первое. Второе. Третье. Четвёртое. Пятое. Шестое. Это нельзя отменить.' }, () => {});
    expect(said.at(-1)).toMatch(/^Первое\. Второе\./);
    expect(said.at(-1)).toMatch(/Это нельзя отменить\./);
    expect(said.at(-1)).toMatch(/Скажите «да» или «нет»\. Жду ответа\.$/);
    off();
  });

  it('Minor-4: «удали голос …» при нескольких похожих — сначала «какой», вопроса «да / нет» нет', async () => {
    const del = vi.fn(async () => undefined);
    reg({ id: 'v.delete', section: 'editor', irreversible: true, confirm: () => 'Удалить голос?', run: del,
      check: (p: { name: string }) => (p?.name === 'жуков' ? 'Какой голос: первый — «Жуков, 10 с», второй — «Жуков, 14 с»? Скажите номер.' : true) });
    const close = openModal({ question: 'Голоса', parse: (r) => (r.startsWith('удали ') ? { id: 'v.delete', params: { name: r.slice(6) } } : null) });
    const d = mk();
    await d.utterance('штаб, удали жуков', 1);
    expect(d.pending).toBeNull();
    expect(said.at(-1)).toMatch(/^Какой голос/);
    await d.utterance('штаб, удали гость', 2);
    expect(d.pending).not.toBeNull();
    close();
  });

  it('Minor-3: голос по voice_id — и одиннадцатый, и дальше', async () => {
    const { voiceByName } = await import('../src/voice/Voices');
    const list = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, name: `Голос ${i}` }));
    expect(voiceByName('', list, 'v11')).toEqual({ voice: list[11] });
    expect(voiceByName('второй', list, 'нет-такого')).toEqual({ ask: 'Этого голоса уже нет.' });
  });
});

describe('раунд 1: вопрос штаба не кончается словом-ответом (иначе быстрый ответ сервис примет за эхо)', () => {
  const ANSWER_END = /(?:да|нет|отмена|готово|заново|понятно|точно|отставить)[.!?»…\s]*$/i;
  it('подтверждение и предложение; вопросы dialogs.ts — кончаются «Жду ответа.»', () => {
    setSpeaker((s) => said.push(s));
    mk().propose('Удалить игру?', 'shell.open');
    const offs2 = [
      voiceDialog({ message: 'Удалить слой?' }, () => {}),
      voiceDialog({ message: 'Что сделать?', labels: ['Сохранить', 'Удалить'] }, () => {}),
      voiceDialog({ message: 'Имя:', input: { get: () => '', set: () => {} } }, () => {}),
      voiceDialog({ message: 'Файл сохранён.', alone: true }, () => {}),
    ];
    for (const s of said) {
      expect(s).not.toMatch(ANSWER_END);
      expect(s.endsWith('Жду ответа.')).toBe(true);
    }
    offs2.forEach((o) => o());
  });
  it('калибровка: итог словами не кончается словом-ответом', async () => {
    const { CALIB_DONE_SAY, CALIB_FAIL_SAY } = await import('../src/voice/Calibration');
    expect(CALIB_DONE_SAY).not.toMatch(ANSWER_END);
    expect(CALIB_FAIL_SAY('нет шага')).not.toMatch(ANSWER_END);
  });
});
