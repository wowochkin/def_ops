// Ветви игры: имена, развилка при возврате, переключение без потери, старые записи, квота хранилища.
import { describe, expect, it } from 'vitest';
import type { GameRecord, GameTurn, Order } from '@def-ops/sim';
import { branchName, checkoutBranch, forkBranch, lines, MAIN_LINE, storeGame, withRecord, type SavedGame } from '../src/game-branches';

const order = (f: string): Order => ({ formation: f, task: 'attack', target: { kind: 'point', at: [14, 52] }, issuedAt: '', source: 'human' } as unknown as Order);
const at = (k: number) => `1945-04-${String(14 + k).padStart(2, '0')}T06:00`;
const turn = (k: number, f = 'a'): GameTurn => ({ time: at(k), orders: [order(f)], digest: `${f}${k}` });
const rec = (turns: GameTurn[]): GameRecord => ({ version: 1, scenario: 's', rules: 'r', seed: 1, takeover: at(0), human: 'su', ai: 'de', turns });
const seven = [1, 2, 3, 4, 5, 6, 7].map((k) => turn(k));
const game = (turns: GameTurn[]): SavedGame => ({ record: rec(turns), enemy: 'passive', title: 'игра', turn: turns.length ? turns[turns.length - 1].time : at(0) });
const NOW = '2026-10-30T10:00:00.000Z';

describe('branchName', () => {
  it('names a branch by turn and game time, adds a counter when taken', () => {
    expect(branchName(5, '1945-04-18T06:00', [])).toBe('ветвь от хода 5 (18 апреля, 06:00)');
    expect(branchName(5, '1945-04-18T06:00', ['ветвь от хода 5 (18 апреля, 06:00)'])).toBe('ветвь от хода 5 (18 апреля, 06:00) — 2');
    expect(branchName(5, '1945-04-18T06:00', ['ветвь от хода 5 (18 апреля, 06:00)', 'ветвь от хода 5 (18 апреля, 06:00) — 2'])).toBe('ветвь от хода 5 (18 апреля, 06:00) — 3');
  });
});

describe('forkBranch', () => {
  it('forkBranch keeps old line', () => {
    const s = game(seven);
    const f = forkBranch(s, 5, at(5), seven.slice(4), NOW);
    expect(f.record.turns.length).toBe(4);
    expect(f.branches).toHaveLength(1);
    expect(f.branches![0].from).toBe(5);
    expect(f.branches![0].turns).toHaveLength(7);
    expect(f.branches![0].name).toContain('хода 5');
    const again = forkBranch(f, 5, at(5), seven.slice(4), NOW);
    expect(again.branches).toHaveLength(1);
    expect(forkBranch(s, 5, at(5), [], NOW)).toBe(s);
  });
});

describe('checkoutBranch', () => {
  it('checkoutBranch is lossless', () => {
    const f = forkBranch(game(seven), 5, at(5), seven.slice(4), NOW);
    const fresh = [turn(5, 'b'), turn(6, 'b')];
    const s: SavedGame = { ...f, record: { ...f.record, turns: [...f.record.turns, ...fresh] } };
    const id = s.branches![0].id;
    const c = checkoutBranch(s, id);
    expect(JSON.stringify(c.record.turns)).toBe(JSON.stringify(seven));
    expect(c.line).toBe(s.branches![0].name);
    expect(c.branches).toHaveLength(1);
    expect(c.branches![0].name).toBe(MAIN_LINE);
    expect(c.branches![0].turns).toHaveLength(6);
    expect(c.branches![0].from).toBe(5);
    const back = checkoutBranch(c, c.branches![0].id);
    expect(JSON.stringify(back.record.turns)).toBe(JSON.stringify(s.record.turns));
    expect(back.line).toBe(MAIN_LINE);
  });
  it('unknown id leaves the game unchanged', () => {
    const s = game(seven);
    expect(checkoutBranch(s, 'нет')).toBe(s);
  });
});

describe('old saves', () => {
  it('old save without branches', () => {
    const s = game(seven);
    expect(lines(s)).toEqual([{ id: null, name: MAIN_LINE, turns: 7, from: null, current: true }]);
    expect('branches' in withRecord(null, s.record, 'passive', 'игра', s.turn)).toBe(false);
  });
  it('withRecord keeps branches and line', () => {
    const f = { ...forkBranch(game(seven), 5, at(5), seven.slice(4), NOW), line: 'моя' };
    const w = withRecord(f, rec([...f.record.turns, turn(5, 'b')]), 'passive', 'игра', at(5));
    expect(w.branches).toEqual(f.branches);
    expect(w.line).toBe('моя');
    expect(w.record.turns).toHaveLength(5);
    expect(lines(w).map((l) => l.name)).toEqual(['моя', f.branches![0].name]);
  });
});

describe('storeGame', () => {
  it('storeGame reports quota', () => {
    const full = { setItem() { throw new DOMException('quota', 'QuotaExceededError'); } };
    expect(storeGame(full, 'k', game(seven))).toContain('нет места');
    expect(storeGame({ setItem() { /* ok */ } }, 'k', game(seven))).toBeNull();
  });
});
