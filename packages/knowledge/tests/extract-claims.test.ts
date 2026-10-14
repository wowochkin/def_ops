import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { toCandidates, runChecks, EXTRACT_SCHEMA, OPERATION_EXTRACT_SCHEMA, extractMessages, type ExtractedClaim, type CheckCtx } from '../src';

const fx = <T>(n: string) => JSON.parse(readFileSync(new URL(`./fixtures/llm/${n}.json`, import.meta.url), 'utf8')) as T;
const doc = { id: 'd1', name: 'Выписка', reliability: 'B' as const, operation: 'berlin' };
const TEXT = 'Сводка. С 16 по 19.04 8 гв. А потеряла убитыми 1 200, ранеными 3 400 человек. Мост у Лебуса противник взорвал 18 апреля.';
const ctx = (over: Partial<CheckCtx> = {}): CheckCtx => ({ formations: [{ id: 'su_8gva', name: '8 гв. А', echelon: 'army', personnel: 60000 }], entries: [], strengthOf: () => null, existing: [], text: TEXT, ...over });

describe('claims из текста', () => {
  const ans = fx<{ claims: ExtractedClaim[] }>('extract-losses');
  const cs = toCandidates(ans.claims, doc, { chunk: 2 }, 'text');
  it('потери: subject пуст, имя — в names, доказательство — цитата', () => {
    const l = cs[0];
    expect(l.claim).toMatchObject({ kind: 'losses', subject: '', from: '1945-04-16', to: '1945-04-19', killed: 1200, wounded: 3400 });
    expect(l.names.subject).toBe('8 гв. А');
    expect(l.evidence).toMatchObject({ kind: 'quote', doc: 'd1', chunk: 2 });
    expect(l).toMatchObject({ origin: 'text', source: 'doc:d1', op: 'berlin', pages: 'часть 3', state: 'pending', checks: [] });
  });
  it('переправа без состояния пропускается', () => {
    expect(cs).toHaveLength(1);
  });
  it('проверки: цитата найдена, числа в цитате', () => {
    const r = runChecks(cs[0], ctx());
    expect(r.find((x) => x.check === 'quote')?.level).toBe('ok');
    expect(r.find((x) => x.check === 'numbers')?.level).toBe('ok');
  });
  it('схемы: claims есть, positions и boundaries убраны', () => {
    expect(Object.keys(EXTRACT_SCHEMA.properties)).toContain('claims');
    const p = Object.keys(OPERATION_EXTRACT_SCHEMA.properties);
    expect(p).toEqual(expect.arrayContaining(['items', 'claims', 'infrastructure']));
    expect(p).not.toContain('positions');
    expect(p).not.toContain('boundaries');
    expect(OPERATION_EXTRACT_SCHEMA.properties.infrastructure.items.properties.kind.enum).not.toContain('bridge');
  });
  it('промпт описывает claims', () => {
    expect(extractMessages('текст', 'Д')[0].content).toContain('losses');
  });
  it('переправа, позиция и подчинённость собираются', () => {
    const base = { subject: null, parent: null, place: null, between: null, points: null, inclusive: null, title: null, date: '1945-04-18', dateTo: null, personnel: null, tanks: null, guns: null, killed: null, wounded: null, missing: null, total: null, state: null, lat: null, lon: null, approxKm: null, quote: 'цитата' } as const;
    const out = toCandidates([
      { ...base, kind: 'crossing', subject: 'мост', state: 'destroyed' },
      { ...base, kind: 'position', subject: '8 гв. А', place: 'Зеелов', lat: 52.5, lon: 14.4, approxKm: 3 },
      { ...base, kind: 'parent', subject: '8 гв. А', parent: '1 БФ' },
      { ...base, kind: 'boundary', between: ['1 БФ', '1 УФ'], points: ['Люббен', 'Котбус'] },
    ], doc, { chunk: 0 }, 'text');
    expect(out.map((c) => c.claim.kind)).toEqual(['crossing', 'position', 'parent', 'boundary']);
    expect(out[1].claim).toMatchObject({ lngLat: [14.4, 52.5], uncertaintyKm: 3 });
    expect(out[2].names.parent).toBe('1 БФ');
    expect(out[3].names.between).toEqual(['1 БФ', '1 УФ']);
  });
});

describe('нормативы модели из текста: param и outcome', () => {
  const base = { subject: null, parent: null, place: null, between: null, points: null, inclusive: null, title: null, date: null, dateTo: null, personnel: null, tanks: null, guns: null, killed: null, wounded: null, missing: null, total: null, state: null, lat: null, lon: null, approxKm: null, quote: 'цитата' } as const;
  const opDoc = { ...doc, operation: 'berlin-1945-tasks' };
  it('param: путь, значение или диапазон, единица, сторона', () => {
    const out = toCandidates([
      { ...base, kind: 'param', param: 'advanceMax', range: [25, 45], unit: 'км/сут', side: null },
      { ...base, kind: 'param', param: 'foot.road', value: 30, unit: 'км/сут', side: 'su' },
      { ...base, kind: 'param', param: null, value: 3 },
      { ...base, kind: 'param', param: 'advanceMax' },
    ], opDoc, { chunk: 0 }, 'text');
    expect(out.map((c) => c.claim)).toEqual([
      { kind: 'param', param: 'advanceMax', range: [25, 45], unit: 'км/сут' },
      { kind: 'param', param: 'foot.road', value: 30, unit: 'км/сут', side: 'su' },
    ]);
    expect(out[0].key).toBe('numbers');
  });
  it('outcome: операция документа, соединение — в names, период и диапазон', () => {
    const out = toCandidates([
      { ...base, kind: 'outcome', measure: 'pace', subject: '5 уд. А', date: '1945-04-17', dateTo: '1945-04-18', range: [5, 14], unit: 'км/сут' },
    ], opDoc, { chunk: 0 }, 'text');
    expect(out[0].claim).toEqual({ kind: 'outcome', measure: 'pace', scenario: 'berlin-1945-tasks', subject: '', from: '1945-04-17', to: '1945-04-18', range: [5, 14], unit: 'км/сут' });
    expect(out[0].names.subject).toBe('5 уд. А');
  });
  it('схема и промпт знают нормативы; перечень параметров — в промпте', () => {
    expect(EXTRACT_SCHEMA.properties.claims.items.properties.kind.enum).toEqual(expect.arrayContaining(['param', 'outcome']));
    const p = extractMessages('текст', 'Д', undefined, [{ path: 'advanceMax', title: 'Наибольший темп', unit: 'км/сут' }])[0].content;
    expect(p).toContain('param');
    expect(p).toContain('advanceMax — Наибольший темп');
  });
});
