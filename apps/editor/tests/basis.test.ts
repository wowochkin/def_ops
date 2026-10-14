import { describe, expect, it } from 'vitest';
import type { CompileConflict, FactRef, Provenance } from '@def-ops/knowledge';
import { basisSummary, claimText, factUse } from '../src/modeling/basis';

const ref = (entry: string, index: number, reliability: 'A' | 'B' | 'C' = 'B', kind: 'strength' | 'parent' = 'strength'): FactRef => ({
  entry, index, updated: '',
  fact: { key: 'k', value: 'v', reliability, claim: kind === 'parent' ? { kind: 'parent', subject: 'x', from: '1945-04-20', parent: 'y' } : { kind: 'strength', subject: 'x', at: '1945-04-16', personnel: 1 } },
});
const p = (input: string, fact: FactRef | null): Provenance => ({ input, fact, reliability: fact ? fact.fact.reliability ?? 'C' : 'assumption' });

describe('basisSummary: доли входов по видам и надёжности', () => {
  it('поля формирования, изменения, точки, положения, линии, переправы; события и ввод не считаются', () => {
    const s = basisSummary([
      p('su_61a.personnel', ref('a', 0, 'A')),
      p('su_61a.tanks', ref('a', 1, 'B')),
      p('su_61a.guns', null),
      p('su_61a.parent', ref('a', 2, 'C', 'parent')),
      p('de_9a.parent', null),
      p('su_61a.enterAt', ref('a', 3, 'A')),
      p('change:0', ref('b', 0, 'B')),
      p('change:1', ref('b', 1, 'A', 'parent')),
      p('checkpoint:0', ref('c', 0, 'C')),
      p('position:0', ref('d', 0, 'A')),
      p('position:1', ref('d', 1, 'C')),
      p('boundary:0', ref('e', 0, 'B')),
      p('crossing:0', ref('f', 0, 'A')),
      p('event:0', ref('g', 0, 'A')),
    ]);
    expect(s).toEqual({
      strength: { A: 1, B: 2, C: 1, assumption: 1, human: 0, auto: 0, seed: 4 },
      parent: { A: 1, B: 0, C: 1, assumption: 1, human: 0, auto: 0, seed: 2 },
      position: { A: 1, B: 0, C: 1, assumption: 0, human: 0, auto: 0, seed: 2 },
      boundary: { A: 0, B: 1, C: 0, assumption: 0, human: 0, auto: 0, seed: 1 },
      crossing: { A: 1, B: 0, C: 0, assumption: 0, human: 0, auto: 0, seed: 1 },
    });
  });
  it('isInput: поля штабов и фронтов (факт и допущение) не считаются, изменения и точки — считаются', () => {
    const s = basisSummary([
      p('su_1bf.personnel', ref('h', 0, 'A')),
      p('su_1bf.tanks', null),
      p('su_1bf.parent', null),
      p('su_61a.personnel', ref('a', 0, 'B')),
      p('su_61a.guns', null),
      p('su_61a.parent', ref('a', 1, 'C', 'parent')),
      p('checkpoint:0', ref('c', 0, 'A')),
    ], (id) => id !== 'su_1bf');
    expect(s.strength).toEqual({ A: 1, B: 1, C: 0, assumption: 1, human: 0, auto: 0, seed: 2 });
    expect(s.parent).toEqual({ A: 0, B: 0, C: 1, assumption: 0, human: 0, auto: 0, seed: 1 });
  });
  it('пусто — нули по всем видам', () => {
    expect(basisSummary([]).strength).toEqual({ A: 0, B: 0, C: 0, assumption: 0, human: 0, auto: 0, seed: 0 });
  });
  it('кем проверены факты: человек, автоматически, встроенный (без отметки); допущения — ни в одну', () => {
    const by = (r: FactRef, who: 'human' | 'auto'): FactRef => ({ ...r, fact: { ...r.fact, check: { by: who, at: '', results: [] } } });
    const s = basisSummary([
      p('su_61a.personnel', by(ref('a', 0, 'A'), 'human')),
      p('su_61a.tanks', by(ref('a', 1, 'B'), 'auto')),
      p('su_61a.guns', ref('a', 2, 'C')),
      p('checkpoint:0', by(ref('c', 0, 'C'), 'auto')),
      p('su_5a.personnel', null),
      p('su_61a.parent', by(ref('a', 3, 'A', 'parent'), 'human')),
    ]);
    expect(s.strength).toEqual({ A: 1, B: 1, C: 2, assumption: 1, human: 1, auto: 2, seed: 1 });
    expect(s.parent).toEqual({ A: 1, B: 0, C: 0, assumption: 0, human: 1, auto: 0, seed: 0 });
  });
});

describe('factUse: используется ли факт записи в модели', () => {
  const a = ref('e1', 0, 'A'), b = ref('e2', 3, 'C');
  const conflicts: CompileConflict[] = [{ key: 'strength|x|1945-04-16', candidates: [a, b], chosen: a }];
  const compiled = { provenance: [p('x.personnel', a)], conflicts };
  it('факт держит вход — used', () => expect(factUse('e1', 0, compiled)).toBe('used'));
  it('кандидат расхождения, выбран другой — перекрыт', () => expect(factUse('e2', 3, compiled)).toEqual({ overriddenBy: a }));
  it('иначе — unused', () => {
    expect(factUse('e2', 4, compiled)).toBe('unused');
    expect(factUse('e2', 3, { provenance: [], conflicts: [{ key: 'k', candidates: [b], chosen: null }] })).toBe('unused');
  });
});

describe('claimText: формальная часть по-русски', () => {
  it('численность и подчинённость', () => {
    expect(claimText({ kind: 'strength', subject: 'su_61a', at: '1945-04-16', personnel: 54000, tanks: 10 })).toBe('численность на 16.04.1945: людей 54000, танков 10');
    expect(claimText({ kind: 'parent', subject: 'su_3gta', from: '1945-04-20T06:00', parent: 'su_1uf' }, (id) => (id === 'su_1uf' ? '1-й Украинский фронт' : id))).toBe('подчинён 1-й Украинский фронт с 20.04.1945 06:00');
  });
});
