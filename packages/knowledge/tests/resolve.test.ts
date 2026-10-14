import { describe, it, expect } from 'vitest';
import { resolve, pinKey, claimFacts, type FactRef, type Fact, type Entry, type Claim } from '../src';

const ref = (index: number, claim: Claim, reliability: 'A' | 'B' | 'C' | undefined, updated = '', entry = 'e1'): FactRef => ({
  entry, index, updated, fact: { key: 'k', value: 'v', reliability, claim },
});
const str = (at: string, personnel: number, rel: 'A' | 'B' | 'C', i = 0, updated = ''): FactRef =>
  ref(i, { kind: 'strength', subject: 'su_61a', at, personnel }, rel, updated);

describe('выбор факта из нескольких', () => {
  it('надёжность важнее даты', () => {
    const a = str('1945-04-15', 6000, 'A', 0), b = str('1945-04-16', 6000, 'B', 1);
    const r = resolve([a, b], 'strength', 'su_61a', '1945-04-16', {}, { window: 2 });
    expect(r.chosen).toBe(a);
  });
  it('при равной надёжности — ближе к моменту', () => {
    const a = str('1945-04-14', 6000, 'B', 0), b = str('1945-04-16', 6000, 'B', 1);
    expect(resolve([a, b], 'strength', 'su_61a', '1945-04-16', {}, { window: 2 }).chosen).toBe(b);
  });
  it('при равной надёжности и дате — свежее', () => {
    const a = str('1945-04-16', 6000, 'B', 0, '2026-01'), b = str('1945-04-16', 6000, 'B', 1, '2026-05');
    expect(resolve([a, b], 'strength', 'su_61a', '1945-04-16', {}).chosen).toBe(b);
  });
  it('закрепление побеждает правило', () => {
    const a = str('1945-04-16', 6000, 'A', 0), c = str('1945-04-16', 6000, 'C', 1);
    const pins = { [pinKey('strength', 'su_61a', '1945-04-16')]: { entry: 'e1', index: 1 } };
    expect(resolve([a, c], 'strength', 'su_61a', '1945-04-16', pins).chosen).toBe(c);
  });
  it('закрепление на удалённый факт игнорируется', () => {
    const a = str('1945-04-16', 6000, 'A', 0);
    const pins = { [pinKey('strength', 'su_61a', '1945-04-16')]: { entry: 'e1', index: 9 } };
    const r = resolve([a], 'strength', 'su_61a', '1945-04-16', pins);
    expect(r.chosen).toBe(a);
    expect(r.pinMissing).toBe(true);
  });
  it("'none' — не брать ничего", () => {
    const a = str('1945-04-16', 6000, 'A', 0);
    const r = resolve([a], 'strength', 'su_61a', '1945-04-16', { [pinKey('strength', 'su_61a', '1945-04-16')]: 'none' });
    expect(r.chosen).toBeNull();
  });
  it('расхождение', () => {
    const m = '1945-04-16';
    expect(resolve([str(m, 6000, 'B', 0), str(m, 6400, 'B', 1)], 'strength', 'su_61a', m, {}).conflict).toBe(true);
    expect(resolve([str(m, 6000, 'B', 0), str(m, 6100, 'B', 1)], 'strength', 'su_61a', m, {}).conflict).toBe(false);
  });
  it('parent действует с from', () => {
    const p = (from: string, parent: string, i: number) => ref(i, { kind: 'parent', subject: 'su_x', from, parent }, 'B');
    const fs = [p('1945-04-16', 'su_8ga', 0), p('1945-04-24', 'su_5ua', 1)];
    expect(resolve(fs, 'parent', 'su_x', '1945-04-25', {}).chosen?.fact.claim).toMatchObject({ parent: 'su_5ua' });
    expect(resolve(fs, 'parent', 'su_x', '1945-04-20', {}).chosen?.fact.claim).toMatchObject({ parent: 'su_8ga' });
  });
  it('смена подчинённости не расхождение', () => {
    const p = (from: string, parent: string, i: number) => ref(i, { kind: 'parent', subject: 'su_x', from, parent }, 'B');
    const r = resolve([p('1945-04-16', 'su_8ga', 0), p('1945-04-24', 'su_5ua', 1)], 'parent', 'su_x', '1945-04-25', {});
    expect(r.conflict).toBe(false);
  });
  it('численность на разные даты при окне 0 — не расхождение', () => {
    const r = resolve([str('1945-04-15', 6000, 'B', 0), str('1945-04-16', 6400, 'B', 1)], 'strength', 'su_61a', '1945-04-16', {});
    expect(r.conflict).toBe(false);
  });
  it('A и B на одну дату с разными числами — расхождение, выбран A', () => {
    const a = str('1945-04-16', 6000, 'A', 0), b = str('1945-04-16', 6400, 'B', 1);
    const r = resolve([b, a], 'strength', 'su_61a', '1945-04-16', {});
    expect(r.conflict).toBe(true);
    expect(r.chosen).toBe(a);
  });
  it('закрепление на факт другого вида или объекта игнорируется', () => {
    const a = str('1945-04-16', 6000, 'A', 0);
    const other = ref(1, { kind: 'strength', subject: 'su_other', at: '1945-04-16', personnel: 1 }, 'C');
    const pins = { [pinKey('strength', 'su_61a', '1945-04-16')]: { entry: 'e1', index: 1 } };
    const r = resolve([a, other], 'strength', 'su_61a', '1945-04-16', pins);
    expect(r.chosen).toBe(a);
    expect(r.pinMissing).toBe(true);
  });
  it('порядок ключей в значении не создаёт расхождения', () => {
    const mk = (i: number, extra: object) => ref(i, { kind: 'position', subject: 's', at: '1945-04-16', ...extra } as Claim, 'B');
    const r = resolve([mk(0, { place: 'x', lngLat: [1, 2] }), mk(1, { lngLat: [1, 2], place: 'x' })], 'position', 's', '1945-04-16', {});
    expect(r.conflict).toBe(false);
  });
  it('claimFacts собирает только факты с claim', () => {
    const claim: Claim = { kind: 'enter', subject: 's', at: '1945-04-16' };
    const facts: Fact[] = [{ key: 'a', value: '1' }, { key: 'b', value: '2', claim }];
    const e = { id: 'x', facts, updatedAt: '2026-02' } as Entry;
    const r = claimFacts([e]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ entry: 'x', index: 1, updated: '2026-02' });
  });
});
