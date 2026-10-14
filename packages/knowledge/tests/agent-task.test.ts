import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compileOperation, agentTask, operationGaps, type CompileInput, type Entry } from '../src';

const root = new URL('../../../', import.meta.url);
const json = <T,>(p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;

describe('задание для агента: Берлинская операция из сида', () => {
  const seed = json<{ entries: Entry[] }>('packages/knowledge/data/seed.json');
  const sc = json<{ id: string; start: string; end: string; formations: CompileInput['formations'] }>('packages/sim/data/scenarios/berlin-1945-tasks.json');
  const ag = json<{ divisions: { id: string; name: string; side: string; hq: string; personnel?: number; tanks?: number; guns?: number; enterAt?: string }[] }>('packages/sim/data/scenarios/agents/berlin-1945.json');
  const input: CompileInput = {
    id: sc.id, start: sc.start, end: sc.end,
    formations: sc.formations.map(({ id, name, side, echelon, parent, personnel, tanks, guns, enterAt }) => ({ id, name, side, echelon, parent, personnel, tanks, guns, enterAt })),
    divisions: ag.divisions.map((d) => ({ id: d.id, name: d.name, side: d.side, echelon: 'division', parent: d.hq, personnel: d.personnel, tanks: d.tanks, guns: d.guns, enterAt: d.enterAt ?? null })),
  };
  const compiled = compileOperation(seed.entries, input, {});
  const names = new Map(sc.formations.filter((f) => f.echelon === 'army').map((f) => [f.id, f.name]));
  const gaps = operationGaps(compiled, names);
  const md = agentTask({ id: sc.id, title: 'Берлинская операция', start: '1945-04-16', end: '1945-05-02' }, gaps, []);

  it('разделы, название операции и формат ответа', () => {
    for (const h of ['## Зачем', '## Что найти', '## Где искать', '## Общие правила', '## Формат ответа']) expect(md).toContain(h);
    expect(md).toContain('Берлинская операция');
    expect(md).toContain('"format": "def-ops-facts"');
  });

  it('8-я гв. армия — с потерями', () => {
    const g = gaps.find((x) => /8-я гв/i.test(x.name) || /8 гв/i.test(x.name));
    expect(g, JSON.stringify([...names.values()])).toBeTruthy();
    expect(g!.kinds).toContain('losses');
    expect(md).toMatch(new RegExp(`\\| ${g!.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|[^\\n]*потери`));
  });

  it('в разделе «Что найти» нет дат и нет текста книг', () => {
    const sec = md.split('## Что найти')[1].split('## Где искать')[0];
    expect(sec).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4}|\b19\d\d\b/);
  });
});
