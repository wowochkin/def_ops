import { describe, expect, it } from 'vitest';
import { fingerprint, type CompileConflict, type Entry, type FactRef, type Provenance } from '@def-ops/knowledge';
import { basisSummary, claimText, factUse, opTitle } from '../src/modeling/basis';
import { originOf } from '../src/kb/fact-form';

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
      strength: { A: 1, B: 2, C: 1, assumption: 1, human: 0, auto: 0, seed: 4, legacy: 0 },
      parent: { A: 1, B: 0, C: 1, assumption: 1, human: 0, auto: 0, seed: 2, legacy: 0 },
      position: { A: 1, B: 0, C: 1, assumption: 0, human: 0, auto: 0, seed: 2, legacy: 0 },
      boundary: { A: 0, B: 1, C: 0, assumption: 0, human: 0, auto: 0, seed: 1, legacy: 0 },
      crossing: { A: 1, B: 0, C: 0, assumption: 0, human: 0, auto: 0, seed: 1, legacy: 0 },
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
    expect(s.strength).toEqual({ A: 1, B: 1, C: 0, assumption: 1, human: 0, auto: 0, seed: 2, legacy: 0 });
    expect(s.parent).toEqual({ A: 0, B: 0, C: 1, assumption: 0, human: 0, auto: 0, seed: 1, legacy: 0 });
  });
  it('пусто — нули по всем видам', () => {
    expect(basisSummary([]).strength).toEqual({ A: 0, B: 0, C: 0, assumption: 0, human: 0, auto: 0, seed: 0, legacy: 0 });
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
    expect(s.strength).toEqual({ A: 1, B: 1, C: 2, assumption: 1, human: 1, auto: 2, seed: 1, legacy: 0 });
    expect(s.parent).toEqual({ A: 1, B: 0, C: 0, assumption: 0, human: 1, auto: 0, seed: 0, legacy: 0 });
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
  it('значение правила — названием входа (без пути), стороной, масштабом; допущение', () => {
    expect(claimText({ kind: 'param', param: 'defense.prepared', range: [1.3, 1.5], unit: '×' })).toBe('значение правила «Подготовленная оборона»: 1,3–1,5 ×');
    expect(claimText({ kind: 'param', param: 'stockDays.fortress', value: 30, unit: 'сут', side: 'de' })).toBe('значение правила «Запасы крепости», Германия: 30 сут');
    expect(claimText({ kind: 'param', param: 'riverCrossHours', value: 2, unit: 'ч', scale: 3 })).toBe('значение правила «Река без моста для пехоты»: 2 ч на 1/3');
    expect(claimText({ kind: 'param', param: 'x.unknown', why: 'нет данных' })).toBe('значение правила x.unknown: допущение — нет данных');
  });
  it('итог прогона — мерой по-русски, соединением, названием операции', () => {
    expect(claimText({ kind: 'outcome', measure: 'pace', scenario: 'berlin-1945-tasks', subject: 'su_1gta', from: '1945-04-17', to: '1945-04-18', range: [1, 5], unit: 'км/сут' }, (id) => (id === 'su_1gta' ? '1 гв. ТА' : id)))
      .toBe('итог прогона: темп 1 гв. ТА, Берлинская операция, 17.04.1945 — 18.04.1945: 1–5 км/сут');
    expect(claimText({ kind: 'outcome', measure: 'frontage', scenario: 'berlin-1945-tasks', from: '1945-04-16', to: '1945-04-16', range: [4, 8], unit: 'км', side: 'su', echelon: 'division' }))
      .toBe('итог прогона: ширина полосы (СССР, дивизия), Берлинская операция, 16.04.1945 — 16.04.1945: 4–8 км');
    // своя операция — названием из переданного каталога, неизвестная — как есть
    expect(claimText({ kind: 'outcome', measure: 'loss', scenario: 'user-op', from: '1945-04-16', to: '1945-04-16', range: [1, 2], unit: '%' }, undefined, (id) => (id === 'user-op' ? 'Моя операция' : undefined)))
      .toBe('итог прогона: потери, Моя операция, 16.04.1945 — 16.04.1945: 1–2 %');
    expect(opTitle('нет-такой')).toBe('нет-такой');
  });
});

describe('originOf: как принят факт', () => {
  const seedFact = ref('s', 0, 'A');
  const seed = new Map<string, Entry>([['s', { id: 's', category: 'formations', title: 'S', summary: '', status: 'checked', facts: [seedFact.fact] } as Entry]]);
  it('человек, авто — по check; встроенный — та же запись, номер и отпечаток, что в сиде; иначе «ваш, без проверки»', () => {
    expect(originOf({ ...seedFact, fact: { ...seedFact.fact, check: { by: 'human', at: '', results: [] } } }, seed)).toBe('human');
    expect(originOf({ ...seedFact, fact: { ...seedFact.fact, check: { by: 'auto', at: '', results: [] } } }, seed)).toBe('auto');
    expect(originOf(seedFact, seed)).toBe('seed');
    expect(originOf({ ...seedFact, index: 1 }, seed)).toBe('legacy');
    expect(originOf({ ...seedFact, fact: { ...seedFact.fact, value: 'другое' } }, seed)).toBe('legacy');
    expect(fingerprint(seedFact.fact)).toBeTruthy();
    // без сида — факт без отметки считается встроенным
    expect(originOf(ref('x', 5), null)).toBe('seed');
  });
  it('basisSummary с сидом: ваш факт без проверки — legacy, встроенный — seed', () => {
    const s = basisSummary([p('su_61a.personnel', seedFact), p('su_61a.tanks', ref('u', 0, 'B'))], undefined, seed);
    expect(s.strength).toMatchObject({ seed: 1, legacy: 1, human: 0, auto: 0 });
  });
});
