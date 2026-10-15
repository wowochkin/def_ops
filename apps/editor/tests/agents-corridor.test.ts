import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Entry } from '@def-ops/knowledge';
import { mergeRules, type Rules, type SideProfile } from '@def-ops/sim';
import { basisFrom } from '../src/sim/kb-rules';
import { agentRanges, startMultipliers, trialMultipliers } from '../src/sim/agents-corridor';

const read = <T>(p: string) => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')) as T;
const rules = (id: string): Rules => {
  const r = read<Rules>(`packages/sim/data/rules/${id}.json`);
  return r.extends ? mergeRules(rules(r.extends), r) : r;
};
const profiles: Record<string, SideProfile> = { 'rkka-1945': read('packages/sim/data/profiles/rkka-1945.json'), 'wehrmacht-1945': read('packages/sim/data/profiles/wehrmacht-1945.json') };
const agents = read<{ combat: { penetrationKmDay: { value: number } | number } }>('packages/sim/data/rules/agents-v0.json');
const pen = (() => { const v = agents.combat.penetrationKmDay; return typeof v === 'number' ? v : v.value; })();

const entryWith = (value: number): Entry => ({
  id: 'org:test-agents', category: 'organization', title: 'проба', status: 'checked',
  facts: [{ key: 'numbers', value: `темп в прорыве ${value} км/сут`, reliability: 'B', source: 'src:x', claim: { kind: 'param', param: 'agents.combat.penetrationKmDay', value, unit: 'км/сут' } }],
} as Entry);
const ranges = (value: number) => agentRanges(['combat.penetrationKmDay', 'combat.armorFactor', 'march.kmh.tracked'], basisFrom([entryWith(value)], {}, rules('ww2-draft'), rules('ww2-draft'), profiles, agents));

describe('агентная калибровка в коридорах нормативов', () => {
  it('коридор множителя — коридор норматива / исходное значение; без норматива — нет коридора', () => {
    const r = ranges(pen);
    expect(r['combat.penetrationKmDay'][0]).toBeCloseTo(0.8, 9);
    expect(r['combat.penetrationKmDay'][1]).toBeCloseTo(1.2, 9);
    expect(r['combat.armorFactor']).toBeUndefined();
    expect(r['march.kmh.tracked']).toBeUndefined();
  });

  it('множители вне коридора не пробуются', () => {
    const r = ranges(pen)['combat.penetrationKmDay'];
    expect(trialMultipliers(1, [0.7, 0.85, 1.15, 1.3], r)).toEqual({ tries: [0.85, 1.15], skipped: [0.7, 1.3] });
    // без коридора — все
    expect(trialMultipliers(1, [0.7, 1.3])).toEqual({ tries: [0.7, 1.3], skipped: [] });
  });

  it('исходное значение вне коридора: старт переносится к краю коридора', () => {
    const r = ranges(2 * pen);
    expect(startMultipliers(['combat.penetrationKmDay', 'combat.armorFactor'], r)).toEqual({ 'combat.penetrationKmDay': r['combat.penetrationKmDay'][0] });
    expect(r['combat.penetrationKmDay'][0]).toBeCloseTo(1.6, 9);
    // внутри коридора — старт прежний (без поправок)
    expect(startMultipliers(['combat.penetrationKmDay'], ranges(pen))).toEqual({});
  });
});
