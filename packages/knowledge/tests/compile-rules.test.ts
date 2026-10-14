import { describe, it, expect } from 'vitest';
import { compileRules, pinKey, pinOf, type Claim, type Entry, type Fact, type RuleInputRef } from '../src';

// пересчёт — как в packages/sim/src/rule-inputs.ts (пакеты друг от друга не зависят: функции — параметром)
const TOL = { A: 0.1, B: 0.2, C: 0.35 } as const;
const corridorOf = (v: { value?: number; range?: [number, number] }, rel?: 'A' | 'B' | 'C'): [number, number] | null => {
  if (!rel) return null;
  const [a, b] = v.range ?? (v.value != null ? [v.value, v.value] : [NaN, NaN]);
  if (!Number.isFinite(a)) return null;
  const t = TOL[rel];
  return [+(a * (1 - t)).toPrecision(12), +(b * (1 + t)).toPrecision(12)];
};
/** Исходные поправки местности; показатель = ln(коридор) / ln(поправка). */
const TERRAIN: Record<string, number> = { 'defense.terrain.forest': 1.5, 'defense.terrain.urban': 2, 'defense.terrain.open': 1 };
const toMultiplier = (key: string, c: [number, number], path?: string): [number, number] | null => {
  if (key === 'terrainExp') {
    const b = TERRAIN[path ?? 'defense.terrain.forest'];
    if (!b || Math.abs(Math.log(b)) < 1e-9) return null;
    return [Math.log(c[0]) / Math.log(b), Math.log(c[1]) / Math.log(b)];
  }
  if (key === 'advance') return [c[0] / 30, c[1] / 30];
  return c;
};
const SPACE: Record<string, [number, number]> = { prepared: [1.0, 2.2], terrainExp: [0.5, 2.5], advance: [0.3, 1.6], movement: [0.4, 1.2] };
const INPUTS: RuleInputRef[] = [
  { path: 'defense.prepared', calib: 'prepared', engine: 'army', value: 1.35 },
  { path: 'defense.terrain.forest', calib: 'terrainExp', engine: 'army', value: 1.5 },
  { path: 'defense.terrain.urban', calib: 'terrainExp', engine: 'army', value: 2 },
  { path: 'defense.terrain.open', calib: 'terrainExp', engine: 'army', value: 1 },
  { path: 'advanceMax', calib: 'advance', engine: 'army', value: 30 },
  { path: 'riverCrossHours', engine: 'army', value: 12 },
  { path: 'pocket.capitulateHours', engine: 'army', value: 96 },
  { path: 'foot.road', calib: 'movement', engine: 'army', value: 30, side: 'su' },
  { path: 'agents.combat.penetrationKmDay', engine: 'agents', value: 20 },
];
const O = { corridorOf, toMultiplier, space: SPACE };

const param = (p: string, v: { value?: number; range?: [number, number]; scale?: number; side?: 'su' | 'de'; why?: string }): Claim => ({ kind: 'param', param: p, ...v });
const fact = (claim: Claim, reliability?: 'A' | 'B' | 'C'): Fact => ({ key: 'numbers', value: JSON.stringify(claim), claim, ...(reliability ? { reliability, source: 'src:X' } : {}) });
const entry = (id: string, facts: Fact[], updatedAt = ''): Entry => ({ id, category: 'organization', title: id, summary: '', status: 'checked', facts, updatedAt });

describe('compileRules: коридоры', () => {
  it('коридор prepared из норматива B: значение ±20 %', () => {
    const r = compileRules([entry('e1', [fact(param('defense.prepared', { value: 1.5 }), 'B')])], INPUTS, {}, O);
    expect(r.corridors.prepared.range).toEqual([1.2, 1.8]);
    expect(r.corridors.prepared.fact?.entry).toBe('e1');
    expect(r.corridors.prepared.wider).toBeUndefined();
  });
  it('без норматива — прежние границы (CALIB_SPACE), факта нет', () => {
    const r = compileRules([], INPUTS, {}, O);
    expect(r.corridors.prepared).toEqual({ range: [1.0, 2.2], fact: null });
    expect(Object.keys(r.corridors).sort()).toEqual(Object.keys(SPACE).sort());
  });
  it('допущение не задаёт коридор', () => {
    const r = compileRules([entry('e1', [fact(param('defense.prepared', { value: 1.5, why: 'нет источника' }))])], INPUTS, {}, O);
    expect(r.corridors.prepared).toEqual({ range: [1.0, 2.2], fact: null });
  });
  it('коридор шире прежних границ — коридор источника с пометкой wider', () => {
    const r = compileRules([entry('e1', [fact(param('defense.prepared', { range: [1.5, 2.5] }), 'C')])], INPUTS, {}, O);
    expect(r.corridors.prepared.range).toEqual([0.975, 3.375]);
    expect(r.corridors.prepared.wider).toBe(true);
  });
  it('через таблицу: advanceMax 25–45 (B) → множитель advance', () => {
    const r = compileRules([entry('e1', [fact(param('advanceMax', { range: [25, 45] }), 'B')])], INPUTS, {}, O);
    const [lo, hi] = r.corridors.advance.range;
    expect(lo).toBeCloseTo(20 / 30, 9);
    expect(hi).toBeCloseTo(54 / 30, 9);
    expect(r.corridors.advance.wider).toBe(true);
  });
  it('пересчёт невозможен (ln 1 = 0) — прежние границы с пометкой tableMissing', () => {
    const r = compileRules([entry('e1', [fact(param('defense.terrain.open', { value: 1.2 }), 'A')])], INPUTS, {}, O);
    expect(r.corridors.terrainExp).toMatchObject({ range: [0.5, 2.5], tableMissing: true });
    expect(r.corridors.terrainExp.fact?.entry).toBe('e1');
  });
  it('масштаб: значение на 1/scale входа — коридор умножается на scale', () => {
    const r = compileRules([entry('e1', [fact(param('riverCrossHours', { range: [2, 6], scale: 3 }), 'B')])], INPUTS, {}, O);
    expect(r.provenance.find((p) => p.path === 'riverCrossHours')!.corridor).toEqual([4.8, 21.6]);
  });
  it('сторона: норматив другой стороны на вход стороны не берётся', () => {
    const r = compileRules([entry('e1', [fact(param('foot.road', { range: [25, 35], side: 'de' }), 'A')])], INPUTS, {}, O);
    expect(r.provenance.find((p) => p.path === 'foot.road')).toMatchObject({ fact: null, reliability: 'assumption' });
    const s = compileRules([entry('e1', [fact(param('foot.road', { range: [25, 35], side: 'su' }), 'A')])], INPUTS, {}, O);
    expect(s.provenance.find((p) => p.path === 'foot.road')).toMatchObject({ reliability: 'A', corridor: [22.5, 38.5] });
  });
});

describe('compileRules: выбор и расхождения', () => {
  it('два норматива на одну поправку — выбор по надёжности', () => {
    const es = [entry('e1', [fact(param('defense.prepared', { value: 1.4 }), 'C'), fact(param('defense.prepared', { value: 1.5 }), 'A')])];
    const r = compileRules(es, INPUTS, {}, O);
    expect(r.corridors.prepared.fact?.index).toBe(1);
    expect(r.corridors.prepared.range).toEqual([1.35, 1.65]);
    // коридоры пересекаются — расхождения нет
    expect(r.conflicts).toEqual([]);
  });
  it('непересекающиеся коридоры — расхождение; закрепление выбирает', () => {
    const es = [entry('e1', [fact(param('defense.prepared', { value: 1.1 }), 'A'), fact(param('defense.prepared', { value: 2.0 }), 'B')])];
    const r = compileRules(es, INPUTS, {}, O);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].path).toBe('defense.prepared');
    expect(r.conflicts[0].facts.map((f) => f.index).sort()).toEqual([0, 1]);
    expect(r.corridors.prepared.fact?.index).toBe(0);
    const pinned = compileRules(es, INPUTS, { [pinKey('param', 'defense.prepared', '')]: pinOf({ entry: 'e1', index: 1, fact: es[0].facts![1], updated: '' }) }, O);
    expect(pinned.corridors.prepared.fact?.index).toBe(1);
    expect(pinned.corridors.prepared.range).toEqual([1.6, 2.4]);
    expect(pinned.conflicts[0].pinned).toBe(true);
  });
  it('закрепление «не брать ничего» — прежние границы', () => {
    const es = [entry('e1', [fact(param('defense.prepared', { value: 1.5 }), 'B')])];
    const r = compileRules(es, INPUTS, { [pinKey('param', 'defense.prepared', '')]: 'none' }, O);
    expect(r.corridors.prepared).toEqual({ range: [1.0, 2.2], fact: null });
  });
  it('местность: коридор — пересечение по видам местности', () => {
    // лес 1,5: коридор [1,62; 1,98] → показатель [1,19; 1,68]; город 2: коридор [2,7; 3,3] → [1,43; 1,72]
    const es = [entry('e1', [fact(param('defense.terrain.forest', { value: 1.8 }), 'A'), fact(param('defense.terrain.urban', { value: 3 }), 'A')])];
    const r = compileRules(es, INPUTS, {}, O);
    const lo = Math.max(Math.log(2.7) / Math.log(2), Math.log(1.62) / Math.log(1.5)), hi = Math.min(Math.log(3.3) / Math.log(2), Math.log(1.98) / Math.log(1.5));
    expect(r.corridors.terrainExp.range[0]).toBeCloseTo(lo, 9);
    expect(r.corridors.terrainExp.range[1]).toBeCloseTo(hi, 9);
    expect(r.conflicts).toEqual([]);
  });
  it('местность: пересечение пусто — расхождение, коридор у выбранного по правилу (надёжность)', () => {
    // лес 1,2 (A) → показатель ~[0,19; 0,64]; город 4 (B) → [1,68; 2,26] — не пересекаются
    const es = [entry('e1', [fact(param('defense.terrain.forest', { value: 1.2 }), 'A'), fact(param('defense.terrain.urban', { value: 4 }), 'B')])];
    const r = compileRules(es, INPUTS, {}, O);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].path).toBe('terrainExp');
    expect(r.corridors.terrainExp.fact?.index).toBe(0);
    expect(r.corridors.terrainExp.range[0]).toBeCloseTo(Math.log(1.08) / Math.log(1.5), 9);
    expect(Number.isFinite(r.corridors.terrainExp.range[1])).toBe(true);
  });
  it('норматив на неизвестный путь — пропуск без исключения', () => {
    const es = [entry('e1', [fact(param('defense.prepard', { value: 1.5 }), 'B'), fact(param('corridor.tolerance', { why: 'допущение' }))])];
    expect(() => compileRules(es, INPUTS, {}, O)).not.toThrow();
    const r = compileRules(es, INPUTS, {}, O);
    expect(r.provenance.map((p) => p.path)).not.toContain('defense.prepard');
    expect(r.corridors.prepared.fact).toBeNull();
  });
});

describe('compileRules: происхождение и итоги', () => {
  it('происхождение у всех входов; допущение и без норматива — assumption', () => {
    const es = [entry('e1', [
      fact(param('defense.prepared', { value: 1.5 }), 'B'),
      fact(param('pocket.capitulateHours', { why: 'нет журналов окружённых' })),
      fact(param('agents.combat.penetrationKmDay', { range: [15, 30] }), 'C'),
    ])];
    const r = compileRules(es, INPUTS, {}, O);
    expect(r.provenance.map((p) => p.path)).toEqual(INPUTS.map((i) => i.path));
    expect(r.provenance.find((p) => p.path === 'defense.prepared')).toMatchObject({ reliability: 'B', corridor: [1.2, 1.8], value: 1.35 });
    const cap = r.provenance.find((p) => p.path === 'pocket.capitulateHours')!;
    expect(cap.reliability).toBe('assumption');
    expect(cap.fact?.fact.claim).toMatchObject({ why: 'нет журналов окружённых' });
    expect(r.provenance.find((p) => p.path === 'riverCrossHours')).toMatchObject({ fact: null, reliability: 'assumption' });
    expect(r.provenance.find((p) => p.path === 'agents.combat.penetrationKmDay')).toMatchObject({ reliability: 'C' });
  });
  it('итоги — по операциям, по одному на итог (выбор по надёжности)', () => {
    const oc = (scenario: string, subject: string, range: [number, number]): Claim => ({ kind: 'outcome', measure: 'pace', scenario, subject, from: '1945-04-16T05:00', to: '1945-04-18T05:00', range, unit: 'км/сут' });
    const es = [entry('e1', [fact(oc('op-a', 'su_1', [3, 8]), 'B'), fact(oc('op-a', 'su_1', [4, 9]), 'A'), fact(oc('op-a', 'su_2', [1, 5]), 'B'), fact(oc('op-b', 'su_3', [5, 14]), 'C')])];
    const r = compileRules(es, INPUTS, {}, O);
    expect(r.outcomes).toHaveLength(3);
    const a = r.outcomes.filter((o) => o.claim.scenario === 'op-a');
    expect(a.map((o) => o.claim.subject).sort()).toEqual(['su_1', 'su_2']);
    expect(a.find((o) => o.claim.subject === 'su_1')!.fact.fact.reliability).toBe('A');
    expect(r.outcomes.filter((o) => o.claim.scenario === 'op-b')).toHaveLength(1);
  });
});
