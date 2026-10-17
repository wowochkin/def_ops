import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, actions, register, type Action } from '../src/voice/registry';
import { addressed, CONVERSATION_S, Dispatcher, normalizeCommand } from '../src/voice/dispatch';

let offs: (() => void)[] = [];
let opened: unknown[] = [];
let said: string[] = [];
let t = 0;
let section = 'editor';
const reg = (a: Partial<Action<any>> & { id: string }) =>
  offs.push(register({ section: 'global', title: a.id, describe: '', available: () => true, run: async () => undefined, ...a } as Action));
const mk = () => new Dispatcher({ now: () => t, say: (s) => said.push(s), section: () => section });

beforeEach(() => {
  offs = []; opened = []; said = []; t = 1_000_000; section = 'editor';
  reg({ id: 'shell.open', run: async (p: unknown) => { opened.push(p); } });
  reg({ id: 'shell.calibrate', run: async () => { opened.push('calibrate'); } });
  reg({ id: 'shell.voices', run: async () => { opened.push('voices'); } });
});
afterEach(() => offs.forEach((o) => o()));

describe('реестр', () => {
  it('actions(section) — общие и раздела; снятие регистрации', async () => {
    reg({ id: 'replay.play', section: 'replay' });
    reg({ id: 'maps.zoom', section: 'maps' });
    expect(actions('replay').map((a) => a.id)).toContain('replay.play');
    expect(actions('replay').map((a) => a.id)).not.toContain('maps.zoom');
    expect(actions('replay').map((a) => a.id)).toContain('shell.open');
    expect(await act('shell.open', { section: 'maps' })).toBeUndefined();
    await expect(act('nope')).rejects.toThrow();
  });
  it('недоступное действие не выполняется', async () => {
    reg({ id: 'x.y', available: () => 'нет игры' });
    expect(await act('x.y')).toBe('нет игры');
  });
});

describe('обращение', () => {
  it('только в начале', () => {
    expect(addressed('Штаб, открой переигровку')?.rest).toBe('открой переигровку');
    expect(addressed('штап открой карты')?.rest).toBe('открой карты');
    expect(addressed('Товарищ генерал, что я могу сказать?')).not.toBeNull();
    expect(addressed('Товарищ полковник: калибровка')?.rest).toBe('калибровка');
    expect(addressed('Передайте в штаб армии')).toBeNull();
    expect(addressed('Штаб.')?.rest).toBe('');
    expect(addressed('штабной офицер')).toBeNull();
  });
});

describe('разборщик', () => {
  it('окно разговора 12 с', async () => {
    const d = mk();
    expect(await d.utterance('открой карты', 1)).toBe('ignored');
    d.spoke();
    t += 11_000;
    expect(await d.utterance('открой карты', 2)).toBe('done');
    d.spoke();
    t += 13_000;
    expect(CONVERSATION_S).toBe(12);
    expect(await d.utterance('открой знаки', 3)).toBe('ignored');
    expect(opened).toEqual([{ section: 'maps' }]);
  });
  it('открой переигровку → shell.open replay', async () => {
    const d = mk();
    expect(await d.utterance('Штаб, открой переигровку', 1)).toBe('done');
    expect(await d.utterance('штаб покажи моделирование', 2)).toBe('done');
    expect(await d.utterance('штаб, перейди в ИИ', 3)).toBe('done');
    expect(await d.utterance('штаб открой редактор', 4)).toBe('done');
    expect(await d.utterance('штаб покажи знания', 5)).toBe('done');
    expect(await d.utterance('штаб открой знаки', 6)).toBe('done');
    expect(opened).toEqual(['replay', 'modeling', 'staff', 'editor', 'knowledge', 'library'].map((s) => ({ section: s })));
  });
  it('калибровка, голоса, стоп', async () => {
    const d = mk();
    await d.utterance('штаб, калибровка', 1);
    await d.utterance('штаб голоса', 2);
    expect(await d.utterance('штаб тихо', 3)).toBe('done');
    expect(opened).toEqual(['calibrate', 'voices']);
  });
  it('что я могу сказать — не больше 7 фраз', async () => {
    for (let i = 0; i < 12; i++) reg({ id: `e.a${i}`, section: 'editor', say: [`штаб, фраза ${i}`, `штаб, ещё ${i}`] });
    const d = mk();
    expect(await d.utterance('штаб, что я могу сказать?', 1)).toBe('done');
    expect(said).toHaveLength(1);
    expect((said[0].match(/фраза|ещё/g) ?? []).length).toBeLessThanOrEqual(7);
    expect(said[0]).toMatch(/фраза 0/);
  });
  it('подсказка панели «Штаб, что я могу?» и другие слова справки', async () => {
    reg({ id: 'e.x', section: 'editor', say: ['штаб, фраза икс'] });
    const d = mk();
    const phrases = ['Штаб, что я могу?', 'штаб, что ты умеешь?', 'штаб, что умеешь', 'штаб, что можно сказать?', 'штаб, помощь'];
    for (const [i, p] of phrases.entries()) expect(await d.utterance(p, i + 1)).toBe('done');
    expect(said).toHaveLength(phrases.length);
    for (const t of said) expect(t).toMatch(/^Можно сказать: .*«штаб, фраза икс»/);
  });
  it('голое «Штаб.» — короткое «Слушаю.», а не «Не понял вас»', async () => {
    const d = mk();
    expect(await d.utterance('Штаб.', 1)).toBe('done');
    expect(said).toEqual(['Слушаю.']);
  });
  it('не понял — подсказка с тремя примерами', async () => {
    const d = mk();
    expect(await d.utterance('штаб, абракадабра', 1)).toBe('unknown');
    expect(said[0]).toMatch(/^Не понял вас\. Можно сказать, например: /);
    expect((said[0].match(/«/g) ?? []).length).toBe(3);
  });
  it('не понял — примеры ближайшие по словам', async () => {
    reg({ id: 'm.zoom', section: 'editor', say: ['штаб, приблизь карту'] });
    reg({ id: 'm.turn', section: 'editor', say: ['штаб, делай ход'] });
    reg({ id: 'm.x', section: 'editor', say: ['штаб, сохрани документ'] });
    reg({ id: 'm.y', section: 'editor', say: ['штаб, отмени приказ'] });
    const d = mk();
    await d.utterance('штаб, сделай документ', 1);
    expect(said[0]).toContain('сохрани документ');
    expect((said[0].match(/«/g) ?? []).length).toBe(3);
  });
  it('а можешь …? — есть действие / нет действия', async () => {
    reg({ id: 'm.zoom', section: 'editor', title: 'Приблизить карту', say: ['штаб, приблизь карту'] });
    const d = mk();
    expect(await d.utterance('штаб, а можешь приблизить карту?', 1)).toBe('done');
    expect(said[0]).toBe('Да, скажите: «штаб, приблизь карту».');
    expect(await d.utterance('штаб, можешь спеть песню?', 2)).toBe('done');
    expect(said[1]).toMatch(/^Этого система пока не предусматривает\. Могу: «/);
  });
  it('continues после исполненной — не склеивается и не повторяется', async () => {
    const d = mk();
    expect(await d.utterance('штаб открой карты', 1)).toBe('done');
    d.spoke();
    await d.utterance('и знаки', 2, 1);
    expect(opened).toEqual([{ section: 'maps' }]);
    expect(said[0]).toMatch(/^Не понял вас/);
  });
  it('ошибка действия не выходит из utterance', async () => {
    offs.forEach((o) => o()); offs = [];
    const d = mk();
    expect(await d.utterance('штаб открой карты', 1)).toBe('unknown');
    expect(said[0]).toMatch(/^Не удалось/);
  });
  it('разделы — слова целиком', async () => {
    const d = mk();
    expect(await d.utterance('штаб открой картинку', 1)).toBe('unknown');
    expect(await d.utterance('штаб открой знакомый', 2)).toBe('unknown');
    expect(opened).toEqual([]);
  });
  it('continues — прежняя реплика не исполняется', async () => {
    const d = mk();
    expect(await d.utterance('штаб открой', 1)).toBe('unknown');
    expect(await d.utterance('карты', 2, 1)).toBe('done');
    expect(opened).toEqual([{ section: 'maps' }]);
    // склейка без дубля
    expect(await d.utterance('штаб открой', 3)).toBe('unknown');
    expect(await d.utterance('штаб открой знаки', 4, 3)).toBe('done');
    expect(opened).toEqual([{ section: 'maps' }, { section: 'library' }]);
  });
});

describe('огрехи распознавания', () => {
  it('точные команды — без поправок', async () => {
    const d = mk();
    expect(await d.utterance('Штаб, переигровка', 1)).toBe('done');
    expect(d.lastFixes).toEqual([]);
    expect(await d.utterance('Штаб, карты', 2)).toBe('done');
    expect(opened).toEqual([{ section: 'replay' }, { section: 'maps' }]);
  });
  it.each([
    'штап переигровку', 'шаб, переигровка', 'штаб пере игровку', 'штаб переигровк', 'штаб, переиграть',
    'Штат, переигровка', 'штап открой пере игровку',
  ])('«%s» → replay с поправкой', async (phrase) => {
    const d = mk();
    expect(await d.utterance(phrase, 1)).toBe('done');
    expect(opened).toEqual([{ section: 'replay' }]);
    expect(d.lastFixes.length).toBeGreaterThan(0);
    expect(d.lastUnderstood).toMatch(/^штаб /);
  });
  it('нормализация возвращает исправленный текст и поправки', () => {
    const r = normalizeCommand('Шаб, пере игровку');
    expect(r.text).toBe('штаб переигровку');
    expect(r.fixes).toHaveLength(2);
    expect(normalizeCommand('Штаб, карты')).toEqual({ text: 'штаб карты', fixes: [] });
  });
  it('ложные срабатывания не открывают ничего', async () => {
    const d = mk();
    for (const [i, p] of ['Штаб, картинку', 'Штаб, знакомый', 'передайте в штат армии', 'Передайте в штаб армии', 'штаб, открой картинку'].entries())
      await d.utterance(p, i + 1);
    expect(opened).toEqual([]);
  });
  it('«штат» посреди фразы — не обращение', () => {
    expect(normalizeCommand('передайте в штат армии').text).toBe('передайте в штат армии');
    expect(addressed(normalizeCommand('передайте в штат армии').text)).toBeNull();
  });
});

describe('отбой', () => {
  const sent: unknown[] = [];
  beforeEach(() => {
    sent.length = 0;
    (globalThis as any).window = { dispatchEvent: (e: CustomEvent) => { sent.push([e.type, e.detail]); return true; } };
  });
  afterEach(() => { delete (globalThis as any).window; });
  it.each(['Штаб, отбой', 'Штаб, выключи голос.', 'штаб отбой!'])('«%s» → voice:power false', async (phrase) => {
    const d = mk();
    expect(await d.utterance(phrase, 1)).toBe('done');
    expect(sent).toEqual([['voice:power', false]]);
    expect(said).toEqual(['Голос выключен. Включить — кнопкой на панели.']);
  });
});

describe('огрехи: исправление 1', () => {
  it('нестрогое обращение без команды — не обращение', async () => {
    const d = mk();
    for (const [i, p] of ['Штат сотрудников увеличили', 'Штаба не будет до вечера', 'Штабс-капитан пришёл', 'Таб открой', 'Стаб, привет'].entries()) {
      expect(await d.utterance(p, i + 1)).toBe('ignored');
      expect(d.lastFixes).toEqual([]);
      expect(d.correction(i + 1)).toEqual({ fixes: [], understood: '' });
    }
    expect(opened).toEqual([]);
    expect(said).toEqual([]);
  });
  it('нестрогое обращение с командой работает', async () => {
    const d = mk();
    expect(await d.utterance('штап, переигровка', 1)).toBe('done');
    expect(await d.utterance('шаб открой карты', 2)).toBe('done');
    expect(await d.utterance('штап, что я могу?', 3)).toBe('done');
    expect(opened).toEqual([{ section: 'replay' }, { section: 'maps' }]);
    expect(d.correction(2).fixes).toEqual(['шаб → штаб']);
    expect(d.correction(2).understood).toBe('штаб открой карты');
  });
  it('склейка с поправленной репликой не дублируется', async () => {
    const d = mk();
    expect(await d.utterance('штап открой', 1)).toBe('unknown');
    expect(await d.utterance('штап открой знаки', 2, 1)).toBe('done');
    expect(opened).toEqual([{ section: 'library' }]);
  });
  it('разделы: первая буква должна совпасть', async () => {
    const d = mk();
    for (const [i, p] of ['Штаб, парты', 'Штаб, карта местности', 'Штаб, знак', 'Штаб, 5'].entries()) await d.utterance(p, i + 1);
    expect(opened).toEqual([]);
  });
});
