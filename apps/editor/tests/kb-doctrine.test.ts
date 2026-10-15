import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { doctrineFor, type Entry } from '@def-ops/knowledge';
import { AGENT_TRIGGERS, agentDoctrine } from '../src/sim/kb-doctrine';

const read = <T>(p: string) => JSON.parse(readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8')) as T;
const seed = read<{ entries: Entry[] } | Entry[]>('packages/knowledge/data/seed.json');
const entries = Array.isArray(seed) ? seed : seed.entries;

describe('доктрина из базы для штабов агентной модели', () => {
  it('триггеры сторон', () => {
    expect(AGENT_TRIGGERS).toEqual({ de: ['penetration', 'pressure', 'encircled'], su: ['attack'] });
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

  it('правил стороны нет — без ключа', () => {
    expect(agentDoctrine([], {})).toEqual({});
  });
});
