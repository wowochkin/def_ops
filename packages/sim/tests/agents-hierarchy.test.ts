import { describe, expect, it } from 'vitest';
import { hierarchyProblems, HIGH_COMMAND, type ScenHq } from '../tools/agents/hierarchy';

const chain: ScenHq[] = [
  { id: 'su_stavka', name: 'Ставка ВГК', side: 'su', echelon: 'high_command', parent: null },
  { id: 'su_f', name: 'фронт', side: 'su', echelon: 'front', parent: 'su_stavka' },
  { id: 'su_a', name: 'армия', side: 'su', echelon: 'army', parent: 'su_f' },
  { id: 'su_k', name: 'корпус', side: 'su', echelon: 'corps', parent: 'su_a' },
];
const divs = [{ id: 'su_d', side: 'su', hq: 'su_k' }];

describe('иерархия штабов агентной модели', () => {
  it('верхние инстанции сторон', () => {
    expect(HIGH_COMMAND.su.id).toBe('su_stavka');
    expect(HIGH_COMMAND.de.id).toBe('de_hc');
  });
  it('полная цепочка — без замечаний', () => {
    expect(hierarchyProblems(chain, divs)).toEqual([]);
  });
  it('армия без старшего — обрыв цепочки', () => {
    const hqs = chain.map((h) => (h.id === 'su_a' ? { ...h, parent: null } : h));
    const p = hierarchyProblems(hqs, divs);
    expect(p.some((x) => x.includes('su_a'))).toBe(true);
  });
  it('цикл', () => {
    const hqs = chain.map((h) => (h.id === 'su_f' ? { ...h, parent: 'su_k' } : h));
    expect(hierarchyProblems(hqs, divs).some((x) => x.includes('цикл'))).toBe(true);
  });
  it('старший не старше по ступени', () => {
    const hqs = [...chain, { id: 'su_a2', name: 'армия 2', side: 'su' as const, echelon: 'army' as const, parent: 'su_k' }];
    expect(hierarchyProblems(hqs, [{ id: 'su_d2', side: 'su', hq: 'su_a2' }]).some((x) => x.includes('su_a2') && x.includes('ступен'))).toBe(true);
  });
  it('дивизия под штабом другой стороны', () => {
    expect(hierarchyProblems(chain, [{ id: 'de_x', side: 'de', hq: 'su_k' }]).some((x) => x.includes('de_x') && x.includes('другой стороны'))).toBe(true);
  });
  it('неизвестный штаб дивизии и старший другой стороны', () => {
    expect(hierarchyProblems(chain, [{ id: 'su_x', side: 'su', hq: 'nope' }]).some((x) => x.includes('su_x'))).toBe(true);
    const hqs = [...chain, { id: 'de_hc', name: 'ОКХ', side: 'de' as const, echelon: 'high_command' as const, parent: null }, { id: 'de_a', name: 'армия', side: 'de' as const, echelon: 'army' as const, parent: 'su_f' }];
    expect(hierarchyProblems(hqs, divs).some((x) => x.includes('de_a') && x.includes('сторон'))).toBe(true);
  });
});

// ---------- сценарии агентной модели ----------
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rd = <T>(p: string): T => JSON.parse(readFileSync(resolve(__dirname, '../../..', p), 'utf8')) as T;
interface Scen { hqs: ScenHq[]; divisions: { id: string; side: string; hq: string; kind: string }[] }
interface Sub { date: string; army?: string | null; corps?: string | null }
const registry = rd<{ divisions: { id: string; type: string; subordination: Sub[] }[] }>('docs/sources/berlin-1945-divisions.json');
const subAt = (subs: Sub[], day: string) => { const by = [...subs].sort((a, b) => a.date.localeCompare(b.date)); return by.filter((s) => s.date <= day).pop() ?? by[0]; };

describe('подчинение на дату', () => {
  it('две записи: действует последняя не позже дня, в любом порядке записей; до первой — первая', () => {
    const subs: Sub[] = [{ date: '1945-04-20', corps: 'su_b' }, { date: '1945-04-01', corps: 'su_a' }];
    expect(subAt(subs, '1945-04-16')?.corps).toBe('su_a');
    expect(subAt(subs, '1945-04-21')?.corps).toBe('su_b');
    expect(subAt(subs, '1945-03-01')?.corps).toBe('su_a');
  });
});

/** Полная цепочка и ровно одна верхняя инстанция на сторону. */
function checkChain(file: string) {
  const s = rd<Scen>(file);
  expect(hierarchyProblems(s.hqs, s.divisions)).toEqual([]);
  for (const side of ['su', 'de'] as const) expect(s.hqs.filter((h) => h.side === side && h.echelon === 'high_command').map((h) => h.id)).toEqual([HIGH_COMMAND[side].id]);
  return s;
}

/** Советские стрелковые дивизии с корпусом в реестре на начало операции — под этим корпусом, корпус — под армией из реестра. */
function checkRegistryCorps(s: Scen) {
  const by = new Map(s.hqs.map((h) => [h.id, h]));
  let n = 0;
  for (const d of s.divisions.filter((x) => x.side === 'su' && x.kind === 'sd')) {
    const r = registry.divisions.find((x) => x.id === d.id);
    const sub = r && subAt(r.subordination, '1945-04-16');
    if (!sub?.corps) continue;
    n++;
    expect(d.hq, d.id).toBe(sub.corps);
    expect(by.get(sub.corps)?.echelon, sub.corps).toBe('corps');
    expect(by.get(sub.corps)?.parent, sub.corps).toBe(sub.army);
  }
  expect(n).toBeGreaterThan(0);
}

describe('сценарии агентной модели: цепочка штабов', () => {
  it('Берлинская операция', () => { checkRegistryCorps(checkChain('packages/sim/data/scenarios/agents/berlin-1945.json')); });
  it('Зееловская операция', () => { checkRegistryCorps(checkChain('packages/sim/data/scenarios/agents/seelow-1945.json')); });
});

describe('Висло-Одерская операция: корпуса по «Боевому составу» на 1.01.1945', () => {
  const file = 'packages/sim/data/scenarios/agents/vistula-oder-1945.json';
  const s = rd<{ hqs: ScenHq[]; divisions: (Scen['divisions'][number] & { personnel: number })[] }>(file);
  it('цепочка штабов', () => { checkChain(file); });
  const comp = rd<{ armies: { army: string; corps: { id: string; kind: string }[]; directDivisions?: number }[] }>('docs/sources/vistula-oder-1945-su-corps.json');
  const ts = rd<{ formations: { id: string; echelon: string; side: string; type?: string; personnel?: number }[] }>('packages/sim/data/scenarios/vistula-oder-1945.json');
  const by = new Map(s.hqs.map((h) => [h.id, h]));
  it('стрелковые корпуса армии — из источника, под своей армией', () => {
    for (const a of comp.armies) {
      const rifle = a.corps.filter((c) => c.kind === 'rifle').map((c) => c.id);
      for (const c of rifle) { expect(by.get(c)?.echelon, c).toBe('corps'); expect(by.get(c)?.parent, c).toBe(a.army); }
      if (a.directDivisions) expect(s.divisions.filter((d) => d.hq === a.army && d.kind === 'sd').length, a.army).toBe(a.directDivisions);
    }
  });
  it('численность общевойсковой армии — как в сценарии нынешней модели', () => {
    const under = (hq: string, army: string) => { for (let x: string | null | undefined = hq, n = 0; x && n < 8; x = by.get(x)?.parent, n++) if (x === army) return true; return false; };
    for (const a of ts.formations.filter((f) => f.side === 'su' && f.echelon === 'army' && f.type !== 'tank_army' && f.personnel)) {
      const own = s.divisions.filter((d) => d.kind === 'sd' && under(d.hq, a.id) && d.id.startsWith(`${a.id}_d`));
      const sum = own.reduce((x, d) => x + d.personnel, 0);
      expect(Math.abs(sum - a.personnel!), a.id).toBeLessThanOrEqual(own.length);
    }
  });
});
