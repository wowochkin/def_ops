import { describe, expect, it } from 'vitest';
import { loadContext } from '../src/data';
import { runScenario } from '../src';

describe('сроки приказов', () => {
  const ctx = loadContext('berlin-1945-tasks');

  it('документальный срок записан у приказов с источником: достоверность A/B и срок не пустой', () => {
    const withBasis = ctx.scenario.orders.filter((o) => o.basis);
    expect(withBasis.length).toBeGreaterThan(10);
    for (const o of withBasis) {
      expect(['A', 'B']).toContain(o.basis!.reliability);
      expect(o.basis!.documented, o.id).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
      expect(o.basis!.source.length, o.id).toBeGreaterThan(5);
    }
  });

  it('приказ действует с момента доведения (orderPartialTurn): за первые ходы войска проходят меньше, чем по умолчанию', () => {
    const km = (rules: typeof ctx.rules) => runScenario({ ...ctx, rules }, 1).final.journal.filter((j) => j.kind === 'move' && j.time < '1945-04-19').reduce((a, j) => a + (j as { km: number }).km, 0);
    expect(ctx.rules.orderPartialTurn).toBeUndefined();
    expect(km({ ...ctx.rules, orderPartialTurn: true })).toBeLessThan(km(ctx.rules));
  }, 60000);
});
