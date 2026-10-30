// Возврат к ходу и переход на ветвь в потоке игры: когда возврат допустим, общая часть двух линий, отпечаток, с
// которым сверяется возврат, порядок «снять прежний запрос штаба противника — спросить заново».
import { describe, expect, it } from 'vitest';
import type { GameRecord, GameTurn, Order } from '@def-ops/sim';
import { commonPrefix, expectedDigest, restartAi, rewindCheck } from '../src/sim/game-rewind';

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
