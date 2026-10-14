import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Entry } from '@def-ops/knowledge';
import { CALIB_SPACE, mergeRules, RULE_INPUTS, ruleInput, type Rules, type SideProfile } from '@def-ops/sim';
import { basisFrom, baseRulesId, inputSide, rulesDigest } from '../src/sim/kb-rules';

const read = <T>(p: string) => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')) as T;
const seed = read<{ entries: Entry[] } | Entry[]>('packages/knowledge/data/seed.json');
const entries = Array.isArray(seed) ? seed : seed.entries;
const rules = (id: string): Rules => {
  const r = read<Rules>(`packages/sim/data/rules/${id}.json`);
  return r.extends ? mergeRules(rules(r.extends), r) : r;
};
const profiles: Record<string, SideProfile> = { 'rkka-1945': read('packages/sim/data/profiles/rkka-1945.json'), 'wehrmacht-1945': read('packages/sim/data/profiles/wehrmacht-1945.json') };
const agents = read<unknown>('packages/sim/data/rules/agents-v0.json');

describe('основа правил из встроенной базы', () => {
  const cal = rules('ww2-berlin-cal');
  it('откалиброванный набор: коридоры — от исходного (calibration.from)', () => {
    expect(baseRulesId(cal)).toBe('ww2-draft');
    expect(baseRulesId(rules('ww2-draft'))).toBeNull();
  });
  const b = basisFrom(entries, {}, cal, rules('ww2-draft'), profiles, agents);
  it('происхождение у каждого входа перечня', () => {
    expect(b.provenance.map((p) => p.path)).toEqual(RULE_INPUTS.map((i) => i.path));
    for (const p of b.provenance) expect(['A', 'B', 'C', 'assumption']).toContain(p.reliability);
  });
  it('значение входа — из набора правил (не исходного)', () => {
    expect(b.provenance.find((p) => p.path === 'defense.prepared')!.value).toBe(cal.defense.prepared);
  });
  it('коридор advance — из норматива advanceMax 25–45 (B), относительно исходной таблицы', () => {
    const c = b.corridors.advance;
    expect(c.fact?.fact.claim).toMatchObject({ kind: 'param', param: 'advanceMax' });
    const max = ruleInput('advanceMax')!.read(rules('ww2-draft'), profiles)!;
    expect(c.range[0]).toBeCloseTo(20 / max, 9);
    expect(c.range[1]).toBeCloseTo(54 / max, 9);
  });
  it('без норматива — прежние границы; все ключи множителей', () => {
    expect(Object.keys(b.corridors).sort()).toEqual(Object.keys(CALIB_SPACE).sort());
    expect(b.corridors.prepared).toEqual({ range: [...CALIB_SPACE.prepared], fact: null });
  });
  it('сторона: темп марша советских (A) — у foot.road; запасы крепости — норматив de', () => {
    expect(inputSide('foot.road')).toBe('su');
    expect(inputSide('stockDays.fortress')).toBe('de');
    expect(inputSide('profiles.de.quality')).toBe('de');
    expect(inputSide('advanceMax')).toBeUndefined();
    expect(b.provenance.find((p) => p.path === 'foot.road')!.reliability).toBe('A');
    expect(b.provenance.find((p) => p.path === 'stockDays.fortress')!.reliability).toBe('B');
  });
  it('масштаб: riverCrossHours/3 — коридор ×3', () => {
    const p = b.provenance.find((x) => x.path === 'riverCrossHours')!;
    expect(p.corridor![0]).toBeGreaterThanOrEqual(4.8 - 1e-9);
  });
  it('итоги — нормативы-итоги базы по операциям', () => {
    expect(b.outcomes.filter((o) => o.claim.scenario === 'berlin-1945-tasks').length).toBeGreaterThanOrEqual(3);
  });
  it('отпечаток: коридоры и итоги операции; другая операция — без её итогов', () => {
    const d = rulesDigest(b, 'berlin-1945-tasks');
    expect(Object.keys(d.corridors)).toContain('advance');
    expect(d.outcomes.length).toBe(b.outcomes.filter((o) => o.claim.scenario === 'berlin-1945-tasks').length);
    expect(rulesDigest(b, 'нет-такой').outcomes).toEqual([]);
  });
  it('сторона по сегменту пути: agents.doctrine.su.* — su, …Km.de — de; норматив de на вход su не берётся', () => {
    expect(inputSide('agents.doctrine.su.firstEchelonShare')).toBe('su');
    expect(inputSide('agents.combat.attackFrontageKm.de')).toBe('de');
    expect(inputSide('agents.combat.penetrationKmDay')).toBeUndefined();
    const de: Entry = { id: 'u:x', category: 'organization', title: 'x', summary: '', status: 'checked', facts: [{ key: 'numbers', value: 'v', source: 's', reliability: 'A', claim: { kind: 'param', param: 'agents.doctrine.su.firstEchelonShare', value: 0.6, side: 'de' } }] };
    const r = basisFrom([de], {}, cal, rules('ww2-draft'), profiles, agents);
    expect(r.provenance.find((p) => p.path === 'agents.doctrine.su.firstEchelonShare')!.fact).toBeNull();
  });
  it('отпечаток итога: сторона, ступень, район (ширина полосы)', () => {
    const d = rulesDigest(b, 'berlin-1945-tasks');
    expect(d.outcomes.some((o) => /frontage/.test(o) && /de/.test(o) && /division/.test(o) && /Зееловские высоты/.test(o))).toBe(true);
  });
});
