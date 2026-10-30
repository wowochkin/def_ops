// Возврат к ходу и переход на ветвь в потоке игры: когда возврат допустим, общая часть двух линий, отпечаток, с
// которым сверяется возврат, порядок «снять прежний запрос штаба противника — спросить заново».
import { describe, expect, it, vi } from 'vitest';
import type { GameRecord, GameTurn, Order } from '@def-ops/sim';
import { applyBranch, BUSY_REFUSAL, recordTurn, dropPending, switchLine, commonPrefix, expectedDigest, restartAi, rewindCheck, rewindFlow, rewindLine, TURN_REFUSAL, turnGate, type BranchOps } from '../src/sim/game-rewind';

const order = (formation: string): Order => ({ formation, task: 'attack', target: { kind: 'point', at: [14, 52] }, issuedAt: '', source: 'human' } as unknown as Order);
const turn = (time: string, digest?: string, f = 'a'): GameTurn => ({ time, orders: [order(f)], ...(digest ? { digest } : {}) });
const rec = (turns: GameTurn[], startDigest?: string): GameRecord => ({ version: 1, scenario: 's', rules: 'r', seed: 1, takeover: '', human: 'su', ai: 'de', turns, ...(startDigest ? { startDigest } : {}) });

describe('rewindCheck', () => {
  it('rewindCheck refuses while busy', () => {
    expect(rewindCheck({ busy: true, played: 5, turn: 2 })).toContain('идёт расчёт хода');
    expect(rewindCheck({ busy: true, played: 5, turn: 2 })).toBe('идёт расчёт хода — вернуться можно, когда он закончится');
    expect(rewindCheck({ busy: false, played: 5, turn: 2 })).toBeNull();
    expect(rewindCheck({ busy: false, played: 5, turn: 1 })).toBeNull();
    expect(rewindCheck({ busy: false, played: 5, turn: 6 })).toContain('это и есть текущий ход');
    expect(rewindCheck({ busy: false, played: 5, turn: 7 })).toContain('хода 7 ещё не было');
    expect(rewindCheck({ busy: false, played: 5, turn: 7 })).toContain('сыграно ходов: 5');
    expect(rewindCheck({ busy: false, played: 5, turn: 0 })).toContain('такого хода нет');
    expect(rewindCheck({ busy: false, played: 5, turn: 2.5 })).toContain('такого хода нет');
  });
});

describe('commonPrefix', () => {
  it('по отпечаткам: одинаковые 3 хода и разный 4-й — 3', () => {
    const a = [turn('t1', 'd1'), turn('t2', 'd2'), turn('t3', 'd3'), turn('t4', 'd4')];
    const b = [turn('t1', 'd1'), turn('t2', 'd2'), turn('t3', 'd3'), turn('t4', 'x4'), turn('t5', 'd5')];
    expect(commonPrefix(a, b)).toBe(3);
  });
  it('линия — продолжение другой: длина короткой', () => {
    const a = [turn('t1', 'd1'), turn('t2', 'd2')];
    const b = [...a, turn('t3', 'd3')];
    expect(commonPrefix(a, b)).toBe(2);
    expect(commonPrefix(b, a)).toBe(2);
  });
  it('ходы без отпечатка с одинаковыми приказами — равны, с разными — нет', () => {
    expect(commonPrefix([turn('t1'), turn('t2')], [turn('t1'), turn('t2')])).toBe(2);
    expect(commonPrefix([turn('t1'), turn('t2')], [turn('t1'), turn('t2', undefined, 'b')])).toBe(1);
  });
  it('разное время — 0', () => {
    expect(commonPrefix([turn('t1', 'd1')], [turn('t0', 'd1')])).toBe(0);
    expect(commonPrefix([turn('t1')], [turn('t0')])).toBe(0);
  });
});

describe('expectedDigest', () => {
  it('keep 0 — на начало игры, keep k — конец хода k; старая запись — нет', () => {
    const r = rec([turn('t1', 'd1'), turn('t2', 'd2')], 'd0');
    expect(expectedDigest(r, 0)).toBe('d0');
    expect(expectedDigest(r, 2)).toBe('d2');
    expect(expectedDigest(r, 1)).toBe('d1');
    const old = rec([turn('t1'), turn('t2')]);
    expect(expectedDigest(old, 0)).toBeUndefined();
    expect(expectedDigest(old, 2)).toBeUndefined();
  });
});

describe('restartAi', () => {
  it('rewind drops pending ai', () => {
    const calls: string[] = [];
    restartAi({ drop: () => calls.push('drop'), start: () => calls.push('start') });
    expect(calls).toEqual(['drop', 'start']);
  });
});

/** Линия игры в миниатюре: мир — строка сыгранного, отпечаток хода — мир после него, stash[k] — мир на начало хода k + 1. */
function line(failOn?: string, failOld?: string) {
  // возврат при откате ветви (в линии на месте keep — ход ветви): failOld — ход прежней линии, который тогда не посчитается
  let restoring = false;
  const L = { world: '', stash: [''], turns: [] as GameTurn[], notices: [] as string[], staff: { a: 1 } };
  const ops: BranchOps = {
    rewindTo: (keep) => { restoring = L.turns.length > keep && L.turns[keep]?.orders[0].formation === 'b'; return rewindLine(L, keep, null, (w) => { L.world = w; }); },
    play: async (t) => {
      L.world += `|${t.time}:${t.orders[0].formation}`;
      if (t.time === failOn && t.orders[0].formation === 'b') throw new Error('запись не сходится');
      if (t.time === failOld && t.orders[0].formation === 'a' && restoring) throw new Error('ядро не ответило');
      t.digest = L.world;
      L.stash.push(L.world);
    },
    over: () => false,
    push: (t) => L.turns.push(t),
    notice: (x) => L.notices.push(x),
  };
  return { L, ops };
}

describe('applyBranch', () => {
  it('ветвь от хода 3 встаёт целиком', async () => {
    const { L, ops } = line();
    expect((await applyBranch(L.turns, [turn('t1'), turn('t2'), turn('t3')], ops)).ok).toBe(true);
    const branch = [turn('t1', L.turns[0].digest), turn('t2', L.turns[1].digest), turn('t3', undefined, 'b'), turn('t4', undefined, 'b')];
    expect((await applyBranch(L.turns, branch, ops)).ok).toBe(true);
    expect(L.turns.map((t) => `${t.time}${t.orders[0].formation}`)).toEqual(['t1a', 't2a', 't3b', 't4b']);
    expect(L.stash).toHaveLength(5);
    expect(L.notices).toEqual([]);
  });
  it('switch fails midway → line restored, digests equal the old line', async () => {
    const { L, ops } = line('t4');
    await applyBranch(L.turns, [turn('t1'), turn('t2'), turn('t3'), turn('t4')], ops);
    const old = L.turns.map((t) => ({ time: t.time, digest: t.digest })), world = L.world;
    const branch = [turn('t1'), turn('t2'), turn('t3', undefined, 'b'), turn('t4', undefined, 'b'), turn('t5', undefined, 'b')];
    const r = await applyBranch(L.turns, branch, ops);
    expect(r.ok).toBe(false);
    expect(L.notices).toEqual(['ветвь не применена: запись не сходится']);
    expect(L.turns.map((t) => ({ time: t.time, digest: t.digest }))).toEqual(old);
    expect(L.world).toBe(world);
    expect(L.stash).toHaveLength(5);
  });
  it('identical-digest switch: общие ходы — с данными ветви (решение, доклад посредника)', async () => {
    const { L, ops } = line();
    const note = (t: GameTurn, text: string) => ({ ...t, human: { text } } as unknown as GameTurn);
    await applyBranch(L.turns, [note(turn('t1'), 'прежнее'), note(turn('t2'), 'прежнее')], ops);
    const branch = [note(turn('t1', L.turns[0].digest), 'ветви'), note(turn('t2', L.turns[1].digest), 'ветви'), turn('t3', undefined, 'b')];
    expect((await applyBranch(L.turns, branch, ops)).ok).toBe(true);
    expect(L.turns.map((t) => (t.human as unknown as { text?: string } | undefined)?.text)).toEqual(['ветви', 'ветви', undefined]);
    expect(L.stash).toHaveLength(4);
  });
  it('окончание игры — дальше ходы ветви не считаются', async () => {
    const { L, ops } = line();
    let n = 0;
    const r = await applyBranch(L.turns, [turn('t1'), turn('t2'), turn('t3')], { ...ops, over: () => n++ >= 2 });
    expect(r.ok).toBe(true);
    expect(L.turns).toHaveLength(2);
  });
});

describe('rewindFlow', () => {
  it('rewind core error → staff unchanged and ai restarted', async () => {
    const { L } = line();
    L.stash.push('|t1', '|t1|t2');
    L.turns.push(turn('t1'), turn('t2'));
    const staff = L.staff;
    const apply = vi.fn(() => { L.staff = { a: 2 }; });
    const calls: string[] = [];
    const ok = await rewindFlow({
      refusal: rewindCheck({ busy: false, played: 2, turn: 1 }),
      run: async () => { await rewindLine(L, 0, () => Promise.reject(new Error('ядро не вернулось')), apply); },
      refuse: (t) => calls.push(`refuse:${t}`), restart: (ok) => calls.push(`restart:${ok}`), setRewinding: (on) => calls.push(`rewinding:${on}`),
    });
    expect(ok).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(L.staff).toBe(staff);
    expect(L.turns).toHaveLength(2);
    expect(L.stash).toHaveLength(3);
    expect(calls).toEqual(['rewinding:true', 'refuse:ядро не вернулось', 'rewinding:false', 'restart:false']);
  });
  it('отказ (идёт расчёт) — ничего не начинается', async () => {
    const run = vi.fn(async () => {});
    const calls: string[] = [];
    await rewindFlow({ refusal: rewindCheck({ busy: true, played: 2, turn: 1 }), run, refuse: (t) => calls.push(t), restart: () => calls.push('restart'), setRewinding: () => calls.push('flag') });
    expect(run).not.toHaveBeenCalled();
    expect(calls).toEqual([BUSY_REFUSAL]);
  });
  it('turn during rewind → refused', () => {
    expect(turnGate(true)).toBe(TURN_REFUSAL);
    expect(TURN_REFUSAL).toBe('идёт возврат к ходу — ход не отдан');
    expect(turnGate(false)).toBeNull();
  });
});

describe('switchLine', () => {
  it('восстановление не удалось → ясная ошибка, обстановка и запись — с нынешней (короче) линией', async () => {
    const { L, ops } = line('t4', 't3');
    await applyBranch(L.turns, [turn('t1'), turn('t2'), turn('t3'), turn('t4')], ops);
    const shown: { ok: boolean; turns: number }[] = [];
    const branch = [turn('t1'), turn('t2'), turn('t3', undefined, 'b'), turn('t4', undefined, 'b')];
    const err = await switchLine(L.turns, branch, { ...ops, show: (ok) => shown.push({ ok, turns: L.turns.length }) }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('ветвь не применена: запись не сходится; линия не восстановлена: ядро не ответило (сыграно ходов: 2)');
    expect(shown).toEqual([{ ok: false, turns: 2 }]);
  });
  it('успех и неудача ветви — show на каждом исходе', async () => {
    const { L, ops } = line('t3');
    const shown: boolean[] = [];
    const o = { ...ops, show: (ok: boolean) => shown.push(ok) };
    expect(await switchLine(L.turns, [turn('t1'), turn('t2')], o)).toBe(true);
    expect(await switchLine(L.turns, [turn('t1'), turn('t2'), turn('t3', undefined, 'b')], o)).toBe(false);
    expect(shown).toEqual([true, false]);
    expect(L.turns).toHaveLength(2);
  });
});

describe('dropPending', () => {
  it('снимает ожидание и останавливает штаб противника, советника и варианты решения', () => {
    const ai = new AbortController(), advise = new AbortController(), plan = new AbortController();
    const calls: string[] = [];
    dropPending({ holdDrop: () => calls.push('hold'), aborts: [ai, advise, null, plan, undefined], reset: () => calls.push('reset') });
    expect([ai.signal.aborted, advise.signal.aborted, plan.signal.aborted]).toEqual([true, true, true]);
    expect(calls).toEqual(['hold', 'reset']);
  });
});

describe('recordTurn', () => {
  it('ghost turn: ход в линию — только после расчёта; расчёт упал — линии без него', async () => {
    const turns: GameTurn[] = [turn('t1', 'd1')];
    await expect(recordTurn(turns, turn('t2'), async () => { throw new Error('ядро не ответило'); })).rejects.toThrow('ядро не ответило');
    expect(turns).toHaveLength(1);
    const r = await recordTurn(turns, turn('t2'), async (t) => { t.digest = 'd2'; return 7; });
    expect(r).toBe(7);
    expect(turns.map((t) => t.digest)).toEqual(['d1', 'd2']);
  });
});
