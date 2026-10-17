import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, actions, register, type Action } from '../src/voice/registry';
import { addressed, CONVERSATION_S, Dispatcher } from '../src/voice/dispatch';

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
  it('не понял — подсказка с тремя примерами', async () => {
    const d = mk();
    expect(await d.utterance('штаб, абракадабра', 1)).toBe('unknown');
    expect(said[0]).toMatch(/^Пока понимаю команды: /);
    expect((said[0].match(/«/g) ?? []).length).toBe(3);
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
