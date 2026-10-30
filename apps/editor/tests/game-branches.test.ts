// Ветви игры: имена, развилка при возврате, переключение без потери, старые записи, квота хранилища.
import { describe, expect, it } from 'vitest';
import type { GameRecord, GameTurn, Order } from '@def-ops/sim';
import { branchName, checkoutBranch, commitGame, deleteBranch, discardSave, forkBranch, lines, sweepBranches, MAIN_LINE, packGame, QUOTA_TEXT, storeGame, switchReply, unpackGame, withRecord, type BranchPayload, type BranchStore, type SavedBranch, type SavedGame } from '../src/game-branches';

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
    keys: async () => [...map.keys()],
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
  it('current line is a strict prefix of the chosen one — not saved again', async () => {
    const st = fakeStore();
    const s = { ...(await forkBranch(st, game(seven), 5, at(5), seven.slice(4), NOW)) }; // текущая — 4 хода, ветвь — 7
    const c = await checkoutBranch(st, s, s.branches![0].id, NOW);
    expect(c.game.branches).toBeUndefined(); // первые 4 хода — начало выбранной линии
    expect(c.game.record.turns).toHaveLength(7);
    expect(st.map.size).toBe(1); // в хранилище — только выбранная (её уберёт commitGame)
  });
  it('empty current line is not saved on checkout', async () => {
    const st = fakeStore();
    const s = await forkBranch(st, game(seven), 1, at(1), seven, NOW); // возврат к ходу 1: текущая — 0 ходов
    expect(s.record.turns).toHaveLength(0);
    const c = await checkoutBranch(st, s, s.branches![0].id, NOW);
    expect(c.game.branches).toBeUndefined();
    expect(c.game.record.turns).toHaveLength(7);
  });
  it('checkout: from of other branches — min(own, chosen)', async () => {
    const st = fakeStore();
    // ветвь A — от хода 3 (7 ходов «a»), ветвь B — от хода 5 (ходы 1–4 «a», 5–6 «b»), текущая — ходы 1–2 «a», 3 «c»
    const a = await forkBranch(st, game(seven), 3, at(3), seven.slice(2), NOW);
    const lineB = [...seven.slice(0, 4), turn(5, 'b'), turn(6, 'b')];
    const withB: SavedGame = { ...a, branches: [...a.branches!, { id: 'B', name: 'ветвь B', from: 5, at: at(5), created: '2026-10-30T11:00:00.000Z', count: 6, turns: lineB }] };
    const cur: SavedGame = { ...withB, record: { ...withB.record, turns: [...seven.slice(0, 2), turn(3, 'c')] } };
    const c = await checkoutBranch(st, cur, a.branches![0].id, NOW); // на ветвь A (from 3)
    const b = c.game.branches!.find((x) => x.id === 'B')!;
    expect(b).toMatchObject({ from: 3, at: at(3) }); // с ветвью A она расходится уже с хода 3
  });
});

describe('forkBranch: from и повторы', () => {
  it('fork at n moves from of later branches to n', async () => {
    const st = fakeStore();
    const f = await forkBranch(st, game(seven), 5, at(5), seven.slice(4), NOW); // ветвь от 5
    const cont: SavedGame = { ...f, record: { ...f.record, turns: [...f.record.turns, turn(5, 'b'), turn(6, 'b')] } };
    const g = await forkBranch(st, cont, 3, at(3), cont.record.turns.slice(2), '2026-10-30T11:00:00.000Z'); // возврат к 3
    expect(g.record.turns).toHaveLength(2);
    expect(g.branches!.map((b) => [b.from, b.at])).toEqual([[3, at(3)], [3, at(3)]]);
  });
  it('a line that is a strict prefix of an existing branch is not saved', async () => {
    const st = fakeStore();
    const f = await forkBranch(st, game(seven), 5, at(5), seven.slice(4), NOW); // ветвь — 7 ходов, текущая — 4
    // доиграли текущую до 5 ходов теми же ходами ветви и вернулись к ходу 3: линия — 5 первых ходов ветви
    const cont: SavedGame = { ...f, record: { ...f.record, turns: seven.slice(0, 5) } };
    const g = await forkBranch(st, cont, 3, at(3), seven.slice(2, 5), NOW);
    expect(g.branches).toHaveLength(1);
    expect(st.map.size).toBe(1);
  });
  it('duplicate check covers unmigrated branches (turns in the save, no count)', async () => {
    const st = fakeStore();
    const legacy = { ...game(seven.slice(0, 4)), branches: [{ id: 'old', name: 'ветвь', from: 5, at: at(5), created: NOW, turns: seven } as unknown as SavedBranch] };
    const s: SavedGame = { ...legacy, record: { ...legacy.record, turns: seven } };
    const g = await forkBranch(st, s, 5, at(5), seven.slice(4), NOW);
    expect(g.branches).toHaveLength(1);
    expect(st.map.size).toBe(0);
  });
  it('store fails — the branch stays in the save, duplicate check still applies', async () => {
    const broken: BranchStore = { put: async () => { throw new Error('IndexedDB недоступна'); }, get: async () => { throw new Error('IndexedDB недоступна'); }, del: async () => undefined };
    const errors: string[] = [];
    const f = await forkBranch(broken, game(seven), 5, at(5), seven.slice(4), NOW, (e) => errors.push(e));
    expect(errors).toEqual(['IndexedDB недоступна']);
    expect(f.branches![0].turns).toHaveLength(7);
    const again = await forkBranch(broken, { ...f, record: { ...f.record, turns: seven } }, 5, at(5), seven.slice(4), NOW, (e) => errors.push(e));
    expect(again.branches).toHaveLength(1);
  });
});

describe('orphan payloads', () => {
  it('sweepBranches removes payloads the save does not reference', async () => {
    const st = fakeStore();
    const f = await forkBranch(st, game(seven), 5, at(5), seven.slice(4), NOW);
    await st.put('g1:b1', { turns: [] }); // сирота: прежняя игра или неудачная запись
    await st.put(`${f.gid}:lost`, { turns: [] });
    await sweepBranches(st, f);
    expect([...st.map.keys()]).toEqual([`${f.gid}:${f.branches![0].id}`]);
  });
  it('sweepBranches without keys() in the store — nothing happens', async () => {
    const st = fakeStore();
    await st.put('x:y', { turns: [] });
    await sweepBranches({ put: st.put, get: st.get, del: st.del }, null);
    expect(st.map.size).toBe(1);
  });
  it('discardSave drops branch payloads and the save', async () => {
    const st = fakeStore();
    const f = await forkBranch(st, game(seven), 5, at(5), seven.slice(4), NOW);
    const removed: string[] = [];
    await discardSave(st, { removeItem: (k: string) => void removed.push(k) }, 'k', f);
    expect(st.map.size).toBe(0);
    expect(removed).toEqual(['k']);
  });
});

describe('switchReply: ответ потока на переход на ветвь', () => {
  /** Запись игры, как её хранит окно: localStorage + хранилище ходов ветвей. */
  const window_ = () => {
    const st = fakeStore();
    let ls = '';
    const local = { setItem(_k: string, v: string) { ls = v; } };
    const commit = (game: SavedGame) => commitGame(st, local, 'k', { game, stale: [] });
    return { st, local, commit, saved: () => unpackGame(JSON.parse(ls) as SavedGame) };
  };
  /** Начало перехода, как в окне: развилка (текущая — 4 хода + 2 своих, ветвь — 7 ходов), выбор ветви, запись. */
  const begin = async (w: ReturnType<typeof window_>) => {
    const f = await forkBranch(w.st, game(seven), 5, at(5), seven.slice(4), NOW);
    const prev: SavedGame = { ...f, record: { ...f.record, turns: [...f.record.turns, turn(5, 'b'), turn(6, 'b')] } };
    await w.commit(prev);
    const c = await checkoutBranch(w.st, prev, prev.branches![0].id, NOW);
    const r = await w.commit(c.game);
    return { prev, next: r.game, stale: c.stale };
  };
  /** Шаг окна: записать что сказано, убрать ненужные ходы. */
  const apply = async (w: ReturnType<typeof window_>, x: ReturnType<typeof switchReply>) => {
    if (x.save) await w.commit(x.save);
    for (const k of x.del) await w.st.del(k);
  };
  it('late switched after timeout re-applies the checkout: no line lost', async () => {
    const w = window_();
    const p = await begin(w);
    const fail = switchReply(p, 'fail', false);
    expect(fail).toMatchObject({ save: p.prev, keep: true });
    await apply(w, fail);
    expect(w.saved().line).toBeUndefined(); // запись — прежняя линия
    // поток всё же перешёл на ветвь: запись — снова после перехода, обе линии целы
    const late = switchReply(p, 'switched', true);
    expect(late).toMatchObject({ save: p.next, del: p.stale, keep: false });
    await apply(w, late);
    const s = w.saved();
    expect(JSON.stringify(s.record.turns)).toBe(JSON.stringify(seven));
    expect(w.st.map.size).toBe(1); // ходы прежней линии; копия ветви убрана
    const back = await checkoutBranch(w.st, s, s.branches![0].id, NOW);
    expect(JSON.stringify(back.game.record.turns)).toBe(JSON.stringify(p.prev.record.turns));
  });
  it('late record without switched: the old line stays, the chosen branch is still in the store', async () => {
    const w = window_();
    const p = await begin(w);
    await apply(w, switchReply(p, 'fail', false));
    const late = switchReply(p, 'record', true);
    expect(late).toEqual({ save: null, del: [], keep: false });
    const s = w.saved();
    const c = await checkoutBranch(w.st, s, s.branches![0].id, NOW);
    expect(JSON.stringify(c.game.record.turns)).toBe(JSON.stringify(seven));
  });
  it('в срок: switched — запись уже после перехода, ходы ветви убрать; record без switched — прежняя запись', async () => {
    const w = window_();
    const p = await begin(w);
    expect(switchReply(p, 'switched', false)).toEqual({ save: null, del: p.stale, keep: false });
    expect(switchReply(p, 'record', false)).toEqual({ save: p.prev, del: [], keep: false });
    // переход ещё не отдан потоку (записи после перехода нет) — помнить нечего
    expect(switchReply({ ...p, next: null }, 'fail', false)).toEqual({ save: p.prev, del: [], keep: false });
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
    const legacy: SavedGame = { ...game(seven.slice(0, 4)), branches: [{ id: 'old', name: 'ветвь', from: 5, at: at(5), created: NOW, count: 7, turns: seven }] };
    let written = '';
    const r = await commitGame(st, { setItem(_k: string, v: string) { written = v; } }, 'k', { game: legacy, stale: [] });
    expect(r.error).toBeNull();
    expect(JSON.parse(written).branches[0].turns).toBeUndefined();
    expect(st.map.size).toBe(1);
    const c = await checkoutBranch(st, r.game, 'old', NOW);
    expect(JSON.stringify(c.game.record.turns)).toBe(JSON.stringify(seven));
  });
});

describe('commitGame: хранилище ветвей отказало', () => {
  const legacy = (): SavedGame => ({ ...game(seven.slice(0, 4)), branches: [{ id: 'old', name: 'ветвь', from: 5, at: at(5), created: NOW, count: 7, turns: seven }] });
  const broken = (): BranchStore => ({ put: async () => { throw new Error('IndexedDB недоступна'); }, get: async () => undefined, del: async () => undefined });
  it('commitGame stores inline turns when migration fails', async () => {
    let written = '';
    const r = await commitGame(broken(), { setItem(_k: string, v: string) { written = v; } }, 'k', { game: legacy(), stale: [] });
    expect(r.saved).toBe(true);
    expect(JSON.parse(written).branches[0].turns).toHaveLength(7);
    expect(r.game.branches![0].turns).toHaveLength(7);
    expect(r.error).toBe('Ветви не перенесены в хранилище окна: IndexedDB недоступна. Запись игры сохранена, ходы ветвей — в ней; следующая запись попробует перенести их ещё раз.');
  });
  it('migration fails and localStorage is full — QUOTA_TEXT, nothing saved', async () => {
    const r = await commitGame(broken(), { setItem() { throw new DOMException('q', 'QuotaExceededError'); } }, 'k', { game: legacy(), stale: [] });
    expect(r.saved).toBe(false);
    expect(r.error).toBe(QUOTA_TEXT);
  });
  it('удачная запись — saved: true, без ошибки', async () => {
    const r = await commitGame(fakeStore(), { setItem() { /* ok */ } }, 'k', { game: legacy(), stale: [] });
    expect(r).toMatchObject({ saved: true, error: null });
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
