import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { doctrineFor, type Entry } from '@def-ops/knowledge';
import { AGENT_TRIGGERS, agentDoctrine, agentRules } from '../src/sim/kb-doctrine';

const read = <T>(p: string) => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')) as T;
const seed = read<{ entries: Entry[] } | Entry[]>('packages/knowledge/data/seed.json');
const entries = Array.isArray(seed) ? seed : seed.entries;

describe('доктрина из базы для штабов агентной модели', () => {
  it('триггеры сторон', () => {
    expect(AGENT_TRIGGERS).toEqual({ de: ['penetration', 'pressure', 'encircled'], su: ['attack', 'encircled'] });
  });

  it('по сиду: тексты обеих сторон, не длиннее 4000 знаков, у немецкой — без правил фронта', () => {
    const d = agentDoctrine(entries, {});
    expect(d.de?.startsWith('- Доктрина (нем.,')).toBe(true);
    expect(d.su?.startsWith('- Доктрина (сов.,')).toBe(true);
    expect(d.de!.length).toBeLessThanOrEqual(4000);
    expect(d.su!.length).toBeLessThanOrEqual(4000);
    expect(d.de).not.toContain('(нем., фронт,');
    expect(d.su).not.toContain('(сов., фронт,');
    expect(d.su).not.toContain('(сов., дивизия,');
  });

  it('закрепление «нет» на первое правило — его строки нет', () => {
    const first = doctrineFor(entries, {}, 'de', AGENT_TRIGGERS.de, '', { levels: ['army', 'corps', 'division'] }).rules[0];
    expect(agentDoctrine(entries, {}).de).toContain(first.line);
    const d = agentDoctrine(entries, { [first.key]: 'none' });
    expect(d.de).not.toContain(first.line);
  });

  it('группы по кругу: у немцев — и контратаки, и резервы, и отход; у советских — и обход', () => {
    const groups = (side: 'su' | 'de') => new Set(agentRules(entries, {})[side].map((r) => r.claim.group));
    for (const g of ['counterattack', 'reserves', 'withdrawal', 'layout']) expect(groups('de'), g).toContain(g);
    for (const g of ['echelons', 'commit', 'bypass']) expect(groups('su'), g).toContain(g);
  });

  it('момент: правила с датой позже не берутся (сценарий с 16.04 — без приказов после 16.04)', () => {
    const rules = (moment?: string) => agentRules(entries, {}, moment).su.map((r) => r.claim.rule);
    const late = (rs: string[]) => rs.filter((r) => /dir-0056|17-apr|19-apr/.test(r));
    expect(late(rules('1945-04-16T05:00'))).toEqual([]);
    for (const r of agentDoctrine(entries, {}, '1945-04-16T05:00').su!.split('\n')) expect(r).not.toMatch(/(1[7-9]|2\d|30)\.04\.1945/);
  });

  it('правил стороны нет — без ключа', () => {
    expect(agentDoctrine([], {})).toEqual({});
  });
});
