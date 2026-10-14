import { describe, expect, it } from 'vitest';
import type { Candidate, Claim, Entry } from '@def-ops/knowledge';
import {
  applyFixes, assistMessages, docAccepted, docDropped, doubtKinds, filterQueue, numberParts, onlyDoubt, parseCount, reasonGroups, setClaimField, setSubject,
} from '../src/kb/queue';
import { textCandidateOf } from '../src/kb/candidates';

/** Кандидат из вымышленной выписки. */
function cand(id: string, claim: Claim, checks: Candidate['checks'], o: Partial<Candidate> = {}): Candidate {
  return {
    id, claim, names: { subject: '99-я армия' }, key: 'численность', value: id, source: 'doc:d1', pages: 'часть 1', reliability: 'B', origin: 'text',
    evidence: { kind: 'quote', doc: 'd1', chunk: 0, quote: `выписка ${id}` }, op: 'op1', checks, verdict: 'review', state: 'pending', ...o,
  };
}
const S = (subject: string, personnel = 1000): Claim => ({ kind: 'strength', subject, at: '1945-04-16', personnel });

const list: Candidate[] = [
  cand('a', S('su_99a'), [{ check: 'quote', level: 'ok' }, { check: 'cross', level: 'doubt', why: 'перекрёстная проверка выключена' }]),
  cand('b', S('su_99a'), [{ check: 'plausible', level: 'doubt', why: 'больше порога' }, { check: 'cross', level: 'doubt', why: 'другое число' }]),
  cand('c', { kind: 'losses', subject: '', from: '1945-04-16', to: '1945-04-17', total: 500 }, [{ check: 'subject', level: 'doubt', why: 'соединение не найдено' }],
    { names: { subject: '8-я гв. армия' }, evidence: { kind: 'row', doc: 'd2', row: 3, cells: { a: '1' } }, source: 'doc:d2' }),
  cand('d', { kind: 'boundary', between: ['su_99a', 'su_8ga'], from: '1945-04-16', points: ['А', 'Б'] }, [{ check: 'cross', level: 'doubt', why: 'x' }, { check: 'cross', level: 'doubt', why: 'y' }],
    { names: { between: ['99-я армия', '8-я гв. армия'] } }),
];

describe('причины сомнения', () => {
  it('doubtKinds: только doubt, без повторов, по порядку проверок', () => {
    expect(doubtKinds(list[0])).toEqual(['cross']);
    expect(doubtKinds(list[1])).toEqual(['plausible', 'cross']);
    expect(doubtKinds(list[3])).toEqual(['cross']);
    expect(doubtKinds(cand('x', S('a'), [{ check: 'numbers', level: 'fail' }]))).toEqual([]);
  });
  it('reasonGroups: сколько с причиной и сколько — только с ней', () => {
    expect(reasonGroups(list)).toEqual([
      { reason: 'cross', n: 3, only: 2 },
      { reason: 'subject', n: 1, only: 1 },
      { reason: 'plausible', n: 1, only: 0 },
    ]);
  });
  it('onlyDoubt: сомнение ровно одно и это оно', () => {
    expect(onlyDoubt(list, 'cross').map((c) => c.id)).toEqual(['a', 'd']);
    expect(onlyDoubt(list, 'plausible')).toEqual([]);
    expect(onlyDoubt(list, 'subject').map((c) => c.id)).toEqual(['c']);
  });
});

describe('фильтры очереди', () => {
  it('по документу (доказательство или источник), виду, причине', () => {
    expect(filterQueue(list, { doc: 'd2' }).map((c) => c.id)).toEqual(['c']);
    expect(filterQueue(list, { doc: 'd1' }).map((c) => c.id)).toEqual(['a', 'b', 'd']);
    expect(filterQueue(list, { kind: 'losses' }).map((c) => c.id)).toEqual(['c']);
    expect(filterQueue(list, { reason: 'plausible' }).map((c) => c.id)).toEqual(['b']);
    expect(filterQueue(list, { doc: 'd1', reason: 'cross' }).map((c) => c.id)).toEqual(['a', 'b', 'd']);
  });
  it('по соединению: id, любой из пары линии, название из источника', () => {
    expect(filterQueue(list, { subject: 'su_99a' }).map((c) => c.id)).toEqual(['a', 'b', 'd']);
    expect(filterQueue(list, { subject: 'su_8ga' }).map((c) => c.id)).toEqual(['d']);
    expect(filterQueue(list, { subject: '8-я гв. армия' }).map((c) => c.id)).toEqual(['c', 'd']);
  });
  it('предложения записей — вид «text»; операция', () => {
    const t = textCandidateOf({ id: 'p', doc: 'd1', chunk: 0, kind: 'new', entry: { id: 'x', category: 'formations', title: 'X', summary: '', status: 'extracted' }, facts: [], relations: [], status: 'pending' }, { id: 'p', state: 'pending' });
    const all = [...list, t];
    expect(filterQueue(all, { kind: 'text' }).map((c) => c.id)).toEqual(['p']);
    expect(filterQueue(all, { doc: 'd1', kind: 'strength' }).map((c) => c.id)).toEqual(['a', 'b']);
    expect(filterQueue(all, { op: 'op1' })).toHaveLength(4);
  });
});

describe('правка на месте', () => {
  it('числа «4 910», «4.910», «4910»; пустое — поле убирается; не число — без изменения', () => {
    expect(parseCount('4 910')).toBe(4910);
    expect(parseCount('4.910')).toBe(4910);
    expect(parseCount('4910')).toBe(4910);
    const c = S('su_99a', 1000);
    expect(setClaimField(c, 'personnel', '4 910')).toEqual({ ...c, personnel: 4910 });
    expect(setClaimField(c, 'tanks', '12')).toEqual({ ...c, tanks: 12 });
    expect('personnel' in setClaimField(c, 'personnel', '')).toBe(false);
    expect(setClaimField(c, 'personnel', 'много')).toBe(c);
  });
  it('пункты линии через тире; состояние переправы; соединение и пара линии', () => {
    const b = list[3].claim;
    expect(setClaimField(b, 'points', 'Губен — Люббен – Барут')).toMatchObject({ points: ['Губен', 'Люббен', 'Барут'] });
    const x: Claim = { kind: 'crossing', subject: 'мост у Кюстрина', from: '1945-04-16', state: 'open' };
    expect(setClaimField(x, 'state', 'destroyed')).toMatchObject({ state: 'destroyed' });
    expect(setClaimField(x, 'state', 'сломан')).toBe(x);
    expect(setSubject(b, 'su_3a', 1)).toMatchObject({ between: ['su_99a', 'su_3a'] });
    expect(setSubject(S(''), 'su_3a')).toMatchObject({ subject: 'su_3a' });
  });
});

describe('подсказка модели', () => {
  it('запрос: кандидат, доказательство, причины; поля вида', () => {
    const m = assistMessages(list[1], 'fix', 'Цитата из документа: «выписка b»');
    expect(m[0].content).toContain('Предложите исправление');
    expect(m[0].content).toContain('personnel');
    expect(m[1].content).toContain('выписка b');
    expect(m[1].content).toContain('правдоподобие (сомнение): больше порога');
    expect(assistMessages(list[1], 'why', '')[0].content).toContain('Объясните');
  });
  it('правки → поля формальной части; соединение по названию; чужие поля пропускаются', () => {
    const match = (n: string) => (n === '8-я гв. армия' ? 'su_8ga' : null);
    const r = applyFixes(list[1], [{ field: 'personnel', value: '4910' }, { field: 'subject', value: '8-я гв. армия' }, { field: 'kind', value: 'losses' }, { field: 'between1', value: 'x' }], match);
    expect(r.claim).toEqual({ kind: 'strength', subject: 'su_8ga', at: '1945-04-16', personnel: 4910 });
    expect(r.names?.subject).toBe('8-я гв. армия');
    const l = applyFixes(list[3], [{ field: 'between1', value: '3-я армия' }], match);
    expect(l.claim).toMatchObject({ between: ['su_99a', ''] });
    expect(l.names?.between).toEqual(['99-я армия', '3-я армия']);
    expect(applyFixes(list[0], [], match)).toEqual({});
    const par = cand('p', { kind: 'parent', subject: 'su_99a', from: '1945-04-16', parent: 'su_1bf' }, []);
    const pf = applyFixes(par, [{ field: 'parent', value: '8-я гв. армия' }], match);
    expect(pf.claim).toMatchObject({ parent: 'su_8ga' });
    expect(pf.names?.parent).toBe('8-я гв. армия');
    const pu = applyFixes(par, [{ field: 'parent', value: 'Неизвестный фронт' }], match);
    expect(pu.claim).toMatchObject({ parent: '' });
    expect(pu.names?.parent).toBe('Неизвестный фронт');
  });
});

describe('итоги документа', () => {
  it('принятое — факты с проверкой из документа; отброшенное — отклонённые кандидаты документа', () => {
    const e: Entry = { id: 'e', category: 'formations', title: 'E', summary: '', status: 'checked', facts: [
      { key: 'a', value: '1', source: 'doc:d1', check: { by: 'auto', at: '', results: [] } },
      { key: 'b', value: '2', source: 'doc:d1' },
      { key: 'c', value: '3', source: 'doc:d2', evidence: { kind: 'row', doc: 'd2', row: 1, cells: {} }, check: { by: 'human', at: '', results: [] } },
    ] };
    expect(docAccepted([e], 'd1').map((x) => x.index)).toEqual([0]);
    expect(docAccepted([e], 'd2').map((x) => x.fact.key)).toEqual(['c']);
    const dropped = [cand('z', S('a'), [{ check: 'numbers', level: 'fail', why: 'нет числа' }], { state: 'rejected', verdict: 'drop' }), ...list];
    expect(docDropped(dropped, 'd1').map((c) => c.id)).toEqual(['z']);
  });
  it('подсветка чисел: разряды — одно число', () => {
    expect(numberParts('к 16.04 было 4 910 чел.').filter((p) => p.num).map((p) => p.t)).toEqual(['16.04', '4 910']);
  });
});
