// Ветви игры: имена, развилка при возврате, переключение без потери, старые записи, квота хранилища.
import { describe, expect, it } from 'vitest';
import type { GameRecord, GameTurn, Order } from '@def-ops/sim';
import { branchName, checkoutBranch, commitGame, deleteBranch, forkBranch, lines, MAIN_LINE, packGame, storeGame, unpackGame, withRecord, type BranchPayload, type BranchStore, type SavedGame } from '../src/game-branches';

const order = (f: string): Order => ({ formation: f, task: 'attack', target: { kind: 'point', at: [14, 52] }, issuedAt: '', source: 'human' } as unknown as Order);
const at = (k: number) => `1945-04-${String(14 + k).padStart(2, '0')}T06:00`;
const turn = (k: number, f = 'a'): GameTurn => ({ time: at(k), orders: [order(f)], digest: `${f}${k}` });
const rec = (turns: GameTurn[]): GameRecord => ({ version: 1, scenario: 's', rules: 'r', seed: 1, takeover: at(0), human: 'su', ai: 'de', turns });
const seven = [1, 2, 3, 4, 5, 6, 7].map((k) => turn(k));
const game = (turns: GameTurn[]): SavedGame => ({ record: rec(turns), enemy: 'passive', title: 'игра', turn: turns.length ? turns[turns.length - 1].time : at(0) });
const fakeStore = () => {
  const map = new Map<string, BranchPayload>();
  const st: BranchStore & { map: typeof map } = {
    map,
    put: async (k, p) => { map.set(k, JSON.parse(JSON.stringify(p))); },
    get: async (k) => map.get(k),
    del: async (k) => { map.delete(k); },
  };
  return st;
};
const NOW = '2026-10-30T10:00:00.000Z';

describe('branchName', () => {
  it('names a branch by turn and game time, adds a counter when taken', () => {
    expect(branchName(5, '1945-04-18T06:00', [])).toBe('ветвь от хода 5 (18 апреля, 06:00)');
    expect(branchName(5, '1945-04-18T06:00', ['ветвь от хода 5 (18 апреля, 06:00)'])).toBe('ветвь от хода 5 (18 апреля, 06:00) — 2');
    expect(branchName(5, '1945-04-18T06:00', ['ветвь от хода 5 (18 апреля, 06:00)', 'ветвь от хода 5 (18 апреля, 06:00) — 2'])).toBe('ветвь от хода 5 (18 апреля, 06:00) — 3');
  });
});

describe('forkBranch', () => {
  it('forkBranch keeps old line', async () => {
    const st = fakeStore();
    const s = game(seven);
    const f = await forkBranch(st, s, 5, at(5), seven.slice(4), NOW);
    expect(f.record.turns.length).toBe(4);
    expect(f.branches).toHaveLength(1);
    expect(f.branches![0].from).toBe(5);
    expect(f.branches![0].count).toBe(7);
    expect(f.branches![0].turns).toBeUndefined();
    expect(f.branches![0].name).toContain('хода 5');
    expect(JSON.stringify(f.branches)).not.toContain('orders'); // ходы ветви не в записи
    expect(st.map.size).toBe(1);
    const again = await forkBranch(st, f, 5, at(5), seven.slice(4), NOW);
    expect(again.branches).toHaveLength(1);
    expect(st.map.size).toBe(1);
    expect(await forkBranch(st, s, 5, at(5), [], NOW)).toBe(s);
  });
});

describe('checkoutBranch', () => {
  const forked = async (st: ReturnType<typeof fakeStore>) => {
    const f = await forkBranch(st, game(seven), 5, at(5), seven.slice(4), NOW);
    return { ...f, record: { ...f.record, turns: [...f.record.turns, turn(5, 'b'), turn(6, 'b')] } };
  };
  it('checkoutBranch is lossless', async () => {
    const st = fakeStore();
    const s = await forked(st);
    const c = await checkoutBranch(st, s, s.branches![0].id, NOW);
    expect(JSON.stringify(c.game.record.turns)).toBe(JSON.stringify(seven));
    expect(c.game.line).toBe(s.branches![0].name);
    expect(c.game.branches).toHaveLength(1);
    expect(c.game.branches![0].name).toBe(MAIN_LINE);
    expect(c.game.branches![0].count).toBe(6);
    expect(c.game.branches![0].from).toBe(5);
    expect(c.stale).toHaveLength(1);
    const res = await commitGame(st, { setItem() { /* ok */ } }, 'k', c);
    expect(res.error).toBeNull();
    expect(st.map.size).toBe(1);
    const back = await checkoutBranch(st, c.game, c.game.branches![0].id, NOW);
    expect(JSON.stringify(back.game.record.turns)).toBe(JSON.stringify(s.record.turns));
    expect(back.game.line).toBe(MAIN_LINE);
  });
  it('failed write keeps the chosen branch payload', async () => {
    const st = fakeStore();
    const s = await forked(st);
    const c = await checkoutBranch(st, s, s.branches![0].id, NOW);
    const r = await commitGame(st, { setItem() { throw new DOMException('q', 'QuotaExceededError'); } }, 'k', c);
    expect(r.error).toContain('нет места');
    expect(st.map.size).toBe(2);
  });
  it('unknown id leaves the game unchanged', async () => {
    const s = game(seven);
    expect((await checkoutBranch(fakeStore(), s, 'нет', NOW)).game).toBe(s);
  });
  it('current line is a strict prefix of the chosen one', async () => {
    const st = fakeStore();
    const s = { ...(await forkBranch(st, game(seven), 5, at(5), seven.slice(4), NOW)) }; // текущая — 4 хода, ветвь — 7
    const c = await checkoutBranch(st, s, s.branches![0].id, NOW);
    expect(c.game.branches![0]).toMatchObject({ from: 5, at: at(5), count: 4 });
    expect(c.game.record.turns).toHaveLength(7);
  });
});

describe('deleteBranch', () => {
  it('removes metadata and payload', async () => {
    const st = fakeStore();
    const f = await forkBranch(st, game(seven), 5, at(5), seven.slice(4), NOW);
    let written = '';
    const r = await deleteBranch(st, { setItem(_k: string, v: string) { written = v; } }, 'k', f, f.branches![0].id);
    expect(r.error).toBeNull();
    expect(r.game.branches).toBeUndefined();
    expect(JSON.parse(written).branches).toBeUndefined();
    expect(st.map.size).toBe(0);
  });
});

describe('legacy branches', () => {
  it('migrates full turns from the save into the store on first write', async () => {
    const st = fakeStore();
    const legacy: SavedGame = { ...game(seven.slice(0, 4)), branches: [{ id: 'old', name: 'ветвь', from: 5, at: at(5), created: NOW, count: 7, enemy: 'passive', turns: seven }] };
    let written = '';
    const r = await commitGame(st, { setItem(_k: string, v: string) { written = v; } }, 'k', { game: legacy, stale: [] });
    expect(r.error).toBeNull();
    expect(JSON.parse(written).branches[0].turns).toBeUndefined();
    expect(st.map.size).toBe(1);
    const c = await checkoutBranch(st, r.game, 'old', NOW);
    expect(JSON.stringify(c.game.record.turns)).toBe(JSON.stringify(seven));
  });
});

describe('doctrine table', () => {
  it('interns doctrine texts and round-trips', () => {
    const text = 'длинный текст доктрины '.repeat(50);
    const turns = [1, 2, 3].map((k) => ({ ...turn(k), doctrine: k === 3 ? null : { su: text, de: 'другой' } }));
    const s = game(turns);
    const packed = packGame(s);
    expect(packed.doctrines).toEqual([text, 'другой']);
    expect(JSON.stringify(packed).split(text).length - 1).toBe(1);
    expect(JSON.stringify(unpackGame(JSON.parse(JSON.stringify(packed))))).toBe(JSON.stringify(s));
    const store = new Map<string, string>();
    storeGame({ setItem: (k: string, v: string) => void store.set(k, v) }, 'k', s);
    expect(JSON.stringify(unpackGame(JSON.parse(store.get('k')!)))).toBe(JSON.stringify(s));
  });
  it('old save without table loads unchanged', () => {
    const s = game([{ ...turn(1), doctrine: { su: 'текст' } }]);
    expect(unpackGame(s)).toEqual(s);
  });
});

describe('old saves', () => {
  it('old save without branches', () => {
    const s = game(seven);
    expect(lines(s)).toEqual([{ id: null, name: MAIN_LINE, turns: 7, from: null, current: true }]);
    expect('branches' in withRecord(null, s.record, 'passive', 'игра', s.turn)).toBe(false);
  });
  it('withRecord keeps branches and line', async () => {
    const f = { ...(await forkBranch(fakeStore(), game(seven), 5, at(5), seven.slice(4), NOW)), line: 'моя' };
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
    const other = storeGame({ setItem() { throw new Error('диск отключён'); } }, 'k', game(seven));
    expect(other).toContain('диск отключён');
    expect(other).not.toContain('нет места');
  });
});
