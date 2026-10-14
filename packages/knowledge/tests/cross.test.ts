import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { toCandidates, crossCompare, crossMessages, CROSS_SCHEMA, matchFormation, type CrossAnswer, type ExtractedClaim } from '../src';

const fx = <T>(n: string) => JSON.parse(readFileSync(new URL(`./fixtures/llm/${n}.json`, import.meta.url), 'utf8')) as T;
const formations = [{ id: 'su_8gva', name: '8 гв. А' }, { id: 'su_1gta', name: '1 гв. ТА' }, { id: 'de_9a', name: '9. Armee' }];
const match = (n: string) => matchFormation(n, formations, []);
const base: ExtractedClaim = { kind: 'losses', subject: '8 гв. А', parent: null, place: null, between: null, points: null, inclusive: null, title: null, date: '1945-04-16', dateTo: '1945-04-19', personnel: null, tanks: null, guns: null, killed: 1200, wounded: null, missing: null, total: null, state: null, lat: null, lon: null, approxKm: null, quote: 'уничтожено до 1 200 солдат противника' };
const cand = (over: Partial<ExtractedClaim> = {}) => {
  const [c] = toCandidates([{ ...base, ...over }], { id: 'd1', name: 'Д', reliability: 'B' }, { chunk: 0 }, 'text');
  (c.claim as { subject: string }).subject = 'su_8gva';
  return c;
};

describe('перекрёстное прочтение', () => {
  it('«уничтожено до 1 200 солдат противника» для su_8gva: сторона enemy — doubt', () => {
    const r = crossCompare(cand(), fx<CrossAnswer>('cross-enemy'), match);
    expect(r.check).toBe('cross');
    expect(r.level).toBe('doubt');
    expect(r.why).toContain('противник');
    expect(r.why).toContain('Модель: уничтожено до 1 200 солдат противника');
  });
  it('план — doubt', () => {
    const r = crossCompare(cand(), fx<CrossAnswer>('cross-plan'), match);
    expect(r.level).toBe('doubt');
    expect(r.why).toContain('план');
  });
  it('совпадение (название армии иначе, но то же соединение) — ok', () => {
    const c = cand({ wounded: 3400, quote: 'убитыми 1 200, ранеными 3 400' });
    expect(crossCompare(c, fx<CrossAnswer>('cross-match'), match)).toEqual({ check: 'cross', level: 'ok' });
  });
  it('другое соединение после сопоставления — doubt', () => {
    const a = { ...fx<CrossAnswer>('cross-match'), subject: '1 гв. ТА' };
    expect(crossCompare(cand(), a, match).level).toBe('doubt');
  });
  it('несопоставленное название не считается расхождением', () => {
    const a = { ...fx<CrossAnswer>('cross-match'), subject: 'группа Хеннинга' };
    expect(crossCompare(cand(), a, match).level).toBe('ok');
  });
  it('другой смысл числа — doubt', () => {
    const a: CrossAnswer = { ...fx<CrossAnswer>('cross-match'), numbers: [{ value: 1200, meaning: 'personnel' }] };
    const r = crossCompare(cand(), a, match);
    expect(r.level).toBe('doubt');
    expect(r.why).toContain('1200');
  });
  it('запрос содержит только цитату', () => {
    const m = crossMessages('убито 5');
    expect(m[1].content).toContain('убито 5');
    expect(CROSS_SCHEMA.required).toContain('plan');
  });

  const de = () => {
    const c = cand({ subject: 'Armee', date: '1945-04-17', dateTo: '1945-04-17', killed: 800, quote: 'наши потери за 17.04 — 800 убитыми' });
    (c.claim as { subject: string }).subject = 'de_9a';
    return c;
  };
  it('выписка с точки зрения немцев, сторона unknown, de_-соединение — без сомнения', () => {
    expect(crossCompare(de(), fx<CrossAnswer>('cross-unknown-side'), match)).toEqual({ check: 'cross', level: 'ok' });
  });
  it('сторона: переданная sideOf важнее префикса id, без стороны — сравнение пропускается', () => {
    const a = { ...fx<CrossAnswer>('cross-match'), subject: '' };
    expect(crossCompare(cand({ wounded: 3400 }), a, match, () => 'de').level).toBe('doubt');
    expect(crossCompare(cand({ wounded: 3400 }), a, match, () => null).level).toBe('ok');
    expect(crossCompare(cand({ wounded: 3400 }), a, match).level).toBe('ok');
    const x = cand({ wounded: 3400 });
    (x.claim as { subject: string }).subject = 'zz_unknown';
    expect(crossCompare(x, { ...a, side: 'enemy' }, match).level).toBe('ok');
  });
  it('период: другой день или сутки вместо периода — doubt', () => {
    const c = cand({ wounded: 3400 });
    const a = fx<CrossAnswer>('cross-match');
    expect(crossCompare(c, { ...a, dateTo: null }, match)).toMatchObject({ level: 'doubt', why: expect.stringContaining('период не совпадает') });
    expect(crossCompare(c, { ...a, date: '1945-04-17' }, match).level).toBe('doubt');
    expect(crossCompare(c, { ...a, date: '' }, match).level).toBe('ok');
  });
  it('число, которого нет в ответе — doubt', () => {
    const a = { ...fx<CrossAnswer>('cross-match'), numbers: [{ value: 3400, meaning: 'wounded' as const }] };
    expect(crossCompare(cand({ wounded: 3400 }), a, match)).toMatchObject({ level: 'doubt', why: expect.stringContaining('число 1200 при повторном прочтении не найдено') });
  });
  it('промпт: сторона по словам «наши/противник» только при признаках в выписке', () => {
    expect(crossMessages('x')[0].content).toContain('ТОЛЬКО');
  });
});
