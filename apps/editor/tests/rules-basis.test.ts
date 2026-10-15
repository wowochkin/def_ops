import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CompiledRules, Entry, FactRef } from '@def-ops/knowledge';
import { CALIB_SPACE, mergeRules, RULE_INPUTS, ruleInputRefs, type Rules, type SideProfile } from '@def-ops/sim';
import { basisFrom } from '../src/sim/kb-rules';
import { calibMode, conflictTitle, relShare, rulesBasisSummary } from '../src/modeling/rules-basis';

const read = <T>(p: string) => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')) as T;
const seed = read<{ entries: Entry[] } | Entry[]>('packages/knowledge/data/seed.json');
const entries = Array.isArray(seed) ? seed : seed.entries;
const rules = (id: string): Rules => {
  const r = read<Rules>(`packages/sim/data/rules/${id}.json`);
  return r.extends ? mergeRules(rules(r.extends), r) : r;
};
const profiles: Record<string, SideProfile> = { 'rkka-1945': read('packages/sim/data/profiles/rkka-1945.json'), 'wehrmacht-1945': read('packages/sim/data/profiles/wehrmacht-1945.json') };
const agents = read<unknown>('packages/sim/data/rules/agents-v0.json');

const fact = (rel: 'A' | 'B' | 'C' | undefined, param: string): FactRef => ({
  entry: 'org:x', index: 0, updated: '', fact: { key: 'numbers', value: '', ...(rel ? { reliability: rel, source: 'src:X' } : {}), claim: { kind: 'param', param, value: 1 } },
});

/** Основа правил вручную: четыре входа армии (два подбираемых) и один агентной модели. */
function tiny(): CompiledRules {
  const p = (path: string, rel: 'A' | 'B' | 'C' | 'assumption', f: FactRef | null) => ({ path, fact: f, reliability: rel, value: 1, ...(f ? { corridor: [0.9, 1.1] as [number, number] } : {}) });
  return {
    corridors: { prepared: { range: [1.2, 1.8], fact: fact('B', 'defense.prepared') } },
    provenance: [
      p('contactKm', 'A', fact('A', 'contactKm')),
      p('defense.prepared', 'B', fact('B', 'defense.prepared')),
      p('advanceMax', 'assumption', null),
      p('noise', 'C', fact('C', 'noise')),
      p('agents.combat.armorFactor', 'B', fact('B', 'agents.combat.armorFactor')),
    ],
    outcomes: [],
    conflicts: [],
  };
}

describe('сводка «Основа правил»', () => {
  it('доли A/B/C/допущений по входам набора; агентная модель — отдельно, в итог не входит', () => {
    const s = rulesBasisSummary(tiny());
    expect(s.total).toEqual({ A: 1, B: 1, C: 1, assumption: 1, total: 4 });
    expect(s.agents).toEqual({ A: 0, B: 1, C: 0, assumption: 0, total: 1 });
  });
  it('отдельно — подбираемые калибровкой (у входа есть множитель)', () => {
    const s = rulesBasisSummary(tiny());
    expect(s.calib).toEqual({ A: 0, B: 1, C: 0, assumption: 1, total: 2 });
  });
  it('доля на источниках — в процентах, без входов — null', () => {
    expect(relShare({ A: 1, B: 1, C: 1, assumption: 1, total: 4 })).toBe(75);
    expect(relShare({ A: 0, B: 0, C: 0, assumption: 0, total: 0 })).toBeNull();
  });
  it('группы — в порядке перечня входов; у строки название, единица, множитель', () => {
    const s = rulesBasisSummary(tiny());
    expect(s.groups.map((g) => g.group)).toEqual(['бой', 'оборона и местность', 'агентная модель']);
    const prep = s.groups[1].rows[0];
    expect(prep).toMatchObject({ path: 'defense.prepared', title: 'Подготовленная оборона', unit: '×', calib: 'prepared', reliability: 'B', corridor: [0.9, 1.1] });
    expect(s.groups[0].rows.map((r) => r.path)).toEqual(['contactKm', 'advanceMax', 'noise']);
  });
  it('откалиброванный: исходное значение и множитель у входа, «упирается» по коридору множителя', () => {
    const s = rulesBasisSummary(tiny(), { baseValues: { 'defense.prepared': 1.25 }, multipliers: { prepared: 1.79, advance: 1.159 } });
    const prep = s.groups[1].rows[0];
    expect(prep.base).toBe(1.25);
    expect(prep.multiplier).toBe(1.79);
    // подготовленная оборона подбирается значением (не множителем к исходному), местность — степенью
    expect(prep.mode).toBe('set');
    expect(calibMode('advance')).toBe('scale');
    expect(calibMode('terrainExp')).toBe('power');
    expect(calibMode('terrMobile')).toBe('set');
    const k = s.keys.find((x) => x.key === 'prepared')!;
    expect(k).toMatchObject({ range: [1.2, 1.8], multiplier: 1.79, edge: 'high' });
    // без коридора базы — прежние границы
    expect(s.keys.find((x) => x.key === 'advance')!.range).toEqual([...CALIB_SPACE.advance]);
    // неоткалиброванный — без исходного значения и множителя
    const plain = rulesBasisSummary(tiny()).groups[1].rows[0];
    expect(plain.base).toBeUndefined();
    expect(plain.multiplier).toBeUndefined();
  });
  it('коридоры, по которым подбирался набор, — раньше нынешних', () => {
    const s = rulesBasisSummary(tiny(), { multipliers: { prepared: 1.5 }, fitted: { prepared: { range: [1.0, 1.5] } } });
    expect(s.keys.find((x) => x.key === 'prepared')).toMatchObject({ range: [1.0, 1.5], edge: 'high', fitted: true });
  });
  it('название расхождения: вход, множитель или итог', () => {
    expect(conflictTitle('defense.prepared')).toBe('Подготовленная оборона');
    expect(conflictTitle('terrainExp')).toMatch(/Влияние местности/);
    expect(conflictTitle('outcome:berlin-1945-tasks:pace:1gta::1945-04-16–1945-04-18')).toMatch(/^итог/);
  });
});

describe('сводка по встроенной базе', () => {
  const cal = rules('ww2-berlin-cal'), base = rules('ww2-draft');
  const b = basisFrom(entries, {}, cal, base, profiles, agents);
  const baseValues = Object.fromEntries(ruleInputRefs(base, profiles, agents).map((r) => [r.path, r.value]));
  const s = rulesBasisSummary(b, { baseValues, multipliers: (cal as Rules & { calibration: { multipliers: Record<string, number> } }).calibration.multipliers });
  it('все входы армии — в итоге и в группах', () => {
    const army = RULE_INPUTS.filter((i) => i.engine === 'army').length;
    expect(s.total.total).toBe(army);
    expect(s.groups.flatMap((g) => g.rows).length).toBe(RULE_INPUTS.length);
    expect(s.calib.total).toBe(RULE_INPUTS.filter((i) => i.engine === 'army' && i.calib).length);
    expect(s.total.A + s.total.B + s.total.C).toBeGreaterThan(0);
  });
  it('все множители калибровки — с коридором и множителем набора', () => {
    expect(s.keys.map((k) => k.key).sort()).toEqual(Object.keys(CALIB_SPACE).sort());
    for (const k of s.keys) expect(typeof k.multiplier).toBe('number');
  });
  it('итоги — по операциям', () => {
    const berlin = s.outcomes.find((o) => o.scenario === 'berlin-1945-tasks');
    expect(berlin?.items.length).toBeGreaterThanOrEqual(3);
  });
});
