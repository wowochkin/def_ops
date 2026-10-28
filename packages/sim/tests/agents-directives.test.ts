import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rd = <T>(p: string): T => JSON.parse(readFileSync(resolve(__dirname, '../../..', p), 'utf8')) as T;
interface Line { line: string[]; by: string | null }
interface Directive {
  id: string; number: string | null; date: string; from: string; to: string[]; form: string; goal: string;
  mainBlow: { armies: string[]; axis: string[] } | null; immediate: Line | null; subsequent: Line | null;
  boundaries: { with: string; line: string[]; from: string | null; responsible: string | null }[];
  reserves: { formation: string; task: string }[]; source: string; reliability: string; note: string;
}
interface File { meta: { note: string; neighbours?: Record<string, string> }; directives: Directive[]; places: Record<string, { at?: [number, number]; line?: [number, number][]; source: string }> }

/** Реки и озёра — названиями, без координат. */
const WATER = new Set(['Одер', 'Нейсе', 'Эльба', 'Шпрее', 'Висла', 'Пилица']);
const water = (p: string) => WATER.has(p) || /^(р\.|оз\.|устье р\.) /.test(p);

const CASES = [
  { name: 'Берлинская операция', file: 'docs/sources/berlin-1945-directives.json', scen: 'packages/sim/data/scenarios/agents/berlin-1945.json', from: '1945-04-01', to: '1945-05-08' },
  { name: 'Висло-Одерская операция', file: 'docs/sources/vistula-oder-1945-directives.json', scen: 'packages/sim/data/scenarios/agents/vistula-oder-1945.json', from: '1944-11-01', to: '1945-02-05' },
];

describe.each(CASES)('исторические директивы: $name', ({ file, scen, from, to }) => {
  const f = rd<File>(file);
  const s = rd<{ hqs: { id: string }[] }>(scen);
  const known = new Set([...s.hqs.map((h) => h.id), ...Object.keys(f.meta.neighbours ?? {})]);
  it('штабы — из сценария (или названные соседи)', () => {
    for (const d of f.directives) {
      const ids = [d.from, ...d.to, ...(d.mainBlow?.armies ?? []), ...d.boundaries.flatMap((b) => [b.with, b.responsible ?? d.from]), ...d.reserves.map((r) => r.formation)];
      for (const id of ids) expect(known.has(id), `${d.id}: ${id}`).toBe(true);
    }
  });
  it('пункты — с координатами на театре или реки и озёра', () => {
    for (const d of f.directives) {
      const pts = [...(d.mainBlow?.axis ?? []), ...(d.immediate?.line ?? []), ...(d.subsequent?.line ?? []), ...d.boundaries.flatMap((b) => b.line)];
      for (const p of pts) expect(water(p) || p in f.places, `${d.id}: ${p}`).toBe(true);
    }
    for (const [n, p] of Object.entries(f.places)) {
      // река — линией (рубеж «выйти на Эльбу»), остальные пункты — точкой
      for (const q of p.line ?? [p.at!]) expect(q[0] >= 10 && q[0] <= 23 && q[1] >= 49 && q[1] <= 55, n).toBe(true);
      expect(p.source.length, n).toBeGreaterThan(0);
    }
  });
  it('даты — в пределах операции и подготовки к ней, источник и достоверность', () => {
    for (const d of f.directives) {
      expect(d.date.slice(0, 10) >= from && d.date.slice(0, 10) <= to, `${d.id}: ${d.date}`).toBe(true);
      expect(d.source.length, d.id).toBeGreaterThan(0);
      expect(['A', 'B', 'C'], d.id).toContain(d.reliability);
    }
    expect(new Set(f.directives.map((d) => d.id)).size).toBe(f.directives.length);
  });
});

describe('исторические директивы в сценариях агентной модели', () => {
  const scen = (n: string) => rd<{ hqs: { id: string }[]; directives?: { id: string; from: string; to: string[]; axis: number[][]; immediate: { line: number[][] } | null; boundaries: { line: number[][] }[] }[] }>(`packages/sim/data/scenarios/agents/${n}.json`);
  const finite = (ps: number[][]) => ps.every((p) => p.length === 2 && p.every(Number.isFinite));
  it.each([['berlin-1945', 23], ['vistula-oder-1945', 15], ['seelow-1945', -1]] as const)('%s', (n, count) => {
    const s = scen(n);
    const ids = new Set(s.hqs.map((h) => h.id));
    expect(s.directives, n).toBeDefined();
    if (count >= 0) expect(s.directives!.length).toBe(count);
    else expect(s.directives!.length).toBeGreaterThan(0);
    for (const d of s.directives!) {
      expect(ids.has(d.from), `${d.id}: ${d.from}`).toBe(true);
      for (const t of d.to) expect(ids.has(t), `${d.id}: ${t}`).toBe(true);
      expect(finite(d.axis) && finite(d.immediate?.line ?? []) && d.boundaries.every((b) => finite(b.line)), d.id).toBe(true);
    }
  });
});
