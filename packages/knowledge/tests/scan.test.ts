import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { toCandidates, runChecks, verdictOf, stripes, scanMessages, boxOnPage, SCAN_SCHEMA, type ExtractedClaim, type CheckCtx } from '../src';

const fx = <T>(n: string) => JSON.parse(readFileSync(new URL(`./fixtures/llm/${n}.json`, import.meta.url), 'utf8')) as T;
const doc = { id: 'd2', name: 'Донесение (скан)', reliability: 'A' as const, operation: 'berlin' };
const ctx = (transcript: string): CheckCtx => ({ formations: [{ id: 'su_8gva', name: '8 гв. А', echelon: 'army' }], entries: [], strengthOf: () => null, existing: [], transcript });

describe('скан', () => {
  const ans = fx<{ transcript: string; claims: ExtractedClaim[] }>('scan-page');
  it('кандидат: доказательство — скан с местом на странице', () => {
    const [c] = toCandidates(ans.claims, doc, { page: 3 }, 'scan');
    expect(c.evidence).toEqual({ kind: 'scan', doc: 'd2', page: 3, quote: 'За 17.04 убито 2 300, ранено 1 500', box: [0.08, 0.12, 0.9, 0.16] });
    expect(c.origin).toBe('scan');
    expect(c.pages).toBe('стр. 3');
  });
  it('цитата, которой нет в расшифровке (модель «исправила» цифры) — quote: fail', () => {
    const [c] = toCandidates(ans.claims, doc, { page: 3 }, 'scan');
    const r = runChecks(c, ctx(ans.transcript));
    expect(r.find((x) => x.check === 'quote')?.level).toBe('fail');
    expect(verdictOf(r)).toBe('drop');
  });
  it('цитата из расшифровки с «?» в числе — doubt', () => {
    const [c] = toCandidates([{ ...ans.claims[0], quote: 'За 17.04 убито 2 3?0, ранено 1 500' }], doc, { page: 1 }, 'scan');
    expect(runChecks(c, ctx(ans.transcript)).find((x) => x.check === 'quote')?.level).toBe('doubt');
  });
  it('запрос: изображение и правило «дословно, ?»', () => {
    const m = scanMessages('data:image/png;base64,AAAA', 'Д');
    expect(m[0].content).toContain('ДОСЛОВНО');
    expect(m[0].content).toContain('«?»');
    expect(m[1].content).toEqual([expect.objectContaining({ type: 'text' }), { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }]);
    expect(SCAN_SCHEMA.required).toEqual(['transcript', 'claims']);
  });
});

describe('полосы', () => {
  it('невысокая страница — одна полоса', () => {
    expect(stripes(1000, 1400)).toEqual([{ y: 0, h: 1400 }]);
    expect(stripes(1000, 1600)).toHaveLength(1);
  });
  it('высокая страница: 3 полосы с перекрытием не меньше 10 %, охват всей высоты', () => {
    const s = stripes(1000, 3000);
    expect(s).toHaveLength(3);
    for (let i = 0; i < s.length - 1; i++) expect(s[i].y + s[i].h - s[i + 1].y).toBeGreaterThanOrEqual(0.1 * s[i].h);
    expect(s[0].y).toBe(0);
    expect(s[2].y + s[2].h).toBe(3000);
  });
  it('число полос от 2 до 4', () => {
    expect(stripes(1000, 1700)).toHaveLength(2);
    expect(stripes(1000, 9000)).toHaveLength(4);
    for (const h of [1700, 2500, 3999, 9000]) {
      const s = stripes(1000, h);
      expect(s[s.length - 1].y + s[s.length - 1].h).toBe(h);
      for (let i = 0; i < s.length - 1; i++) expect(s[i].y + s[i].h - s[i + 1].y).toBeGreaterThanOrEqual(0.1 * s[i].h);
    }
  });
  it('место на полосе → место на странице', () => {
    expect(boxOnPage([0.1, 0.5, 0.9, 1], { y: 1000, h: 1000 }, 4000)).toEqual([0.1, 0.375, 0.9, 0.5]);
  });
});
