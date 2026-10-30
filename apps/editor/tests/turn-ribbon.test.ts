// Лента ходов: краткий итог хода по журналу, элементы ленты (номер, время, итог, развилки).
import { describe, expect, it } from 'vitest';
import type { GameRecord, GameTurn } from '@def-ops/sim';
import type { JournalDay } from '../src/sim/game-protocol';
import type { SavedBranch } from '../src/game-branches';
import { ribbonItems, turnSummary } from '../src/turn-ribbon';

const day = (time: string, events: string[]): JournalDay => ({ time, orders: [], actions: [], events });
const turnAt = (time: string): GameTurn => ({ time, orders: [], actions: [] } as unknown as GameTurn);
const REC = { version: 1, scenario: 'berlin-1945-tasks', takeover: '1945-04-16T05:00',
  turns: [turnAt('1945-04-16T05:00'), turnAt('1945-04-17T05:00'), turnAt('1945-04-18T05:00')] } as unknown as GameRecord;

describe('turnSummary', () => {
  it('первое донесение, кроме служебных строк', () => {
    expect(turnSummary(day('1945-04-16T05:00', ['Управление: штаб фронта взят игроком.', 'Приказ 8 гв. А: наступать.', 'Распоряжение не исполнено: нет парков.',
      'Команда не исполнена: штаба нет.', '8-я гвардейская армия прорвала оборону у Зелова.']))).toBe('8-я гвардейская армия прорвала оборону у Зелова.');
  });
  it('длиннее 70 знаков — обрезка с «…»', () => {
    const s = turnSummary(day('1945-04-16T05:00', ['8-я гвардейская армия прорвала первую и вторую полосы обороны у Зелова и вышла к Мюнхебергу с боями.']));
    expect(s.length).toBeLessThanOrEqual(70);
    expect(s.endsWith('…')).toBe(true);
    expect(s.startsWith('8-я гвардейская армия прорвала')).toBe(true);
  });
  it('нет донесений — «без существенных событий»; нет дня — «текущий ход»', () => {
    expect(turnSummary(day('1945-04-16T05:00', ['Управление: штаб взят.']))).toBe('без существенных событий');
    expect(turnSummary(day('1945-04-16T05:00', []))).toBe('без существенных событий');
    expect(turnSummary(undefined)).toBe('текущий ход');
  });
});

describe('ribbonItems', () => {
  const journal = [day('1945-04-16T05:00', ['Начато наступление.']), day('1945-04-17T05:00', ['Бой за высоты.']), day('1945-04-18T05:00', [])];
  it('запись из 3 ходов → 4 элемента, последний — текущий', () => {
    const items = ribbonItems(REC, journal, '1945-04-19T05:00', []);
    expect(items.map((x) => x.n)).toEqual([1, 2, 3, 4]);
    expect(items.map((x) => x.current)).toEqual([false, false, false, true]);
    expect(items[1].label).toBe('2 · 17.04 05:00');
    expect(items[1].time).toBe('1945-04-17T05:00');
    expect(items[1].summary).toBe('Бой за высоты.');
    expect(items[2].summary).toBe('без существенных событий');
    expect(items[3].label).toBe('4 · 19.04 05:00');
    expect(items[3].summary).toBe('текущий ход');
  });
  it('ветвь с from: 2 — в развилках хода 2', () => {
    const b: SavedBranch = { id: 'b1', name: 'ветвь от хода 2 (17 апреля, 05:00)', from: 2, at: '1945-04-17T05:00', created: '2026-10-30T10:00:00Z', count: 5, enemy: 'llm' };
    const items = ribbonItems(REC, journal, '1945-04-19T05:00', [b]);
    expect(items[1].forks).toEqual([{ id: 'b1', name: b.name }]);
    expect(items.filter((x) => x.forks.length).map((x) => x.n)).toEqual([2]);
  });
  it('ходов ещё не было — один элемент, текущий', () => {
    const items = ribbonItems({ ...REC, turns: [] }, [], '1945-04-16T05:00', []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ n: 1, current: true, label: '1 · 16.04 05:00', summary: 'текущий ход' });
  });
});
