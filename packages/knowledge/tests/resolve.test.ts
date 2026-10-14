import { describe, it, expect } from 'vitest';
import { resolve, pinKey, pinOf, claimFacts, type FactRef, type Fact, type Entry, type Claim } from '../src';

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
    expect(resolve([str(m, 6000, 'B', 0), str(m, 6600, 'B', 1)], 'strength', 'su_61a', m, {}).conflict).toBe(true);
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
    const a = str('1945-04-16', 6000, 'A', 0), b = str('1945-04-16', 6600, 'B', 1);
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

  it('состояние: более позднее начало важнее надёжности (старый A против поздней смены B)', () => {
    // как su_3gkd: A — в 1 БФ с 01.04, B — в 33 А с 16.04
    const a = ref(0, { kind: 'parent', subject: 'su_3gkd', from: '1945-04-01', parent: 'su_1bf' }, 'A');
    const b = ref(1, { kind: 'parent', subject: 'su_3gkd', from: '1945-04-16', parent: 'su_33a' }, 'B');
    expect(resolve([a, b], 'parent', 'su_3gkd', '1945-04-20', {}).chosen).toBe(b);
    expect(resolve([a, b], 'parent', 'su_3gkd', '1945-04-10', {}).chosen).toBe(a);
  });
  it('состояние: надёжность — только среди фактов с тем же началом', () => {
    const a = ref(0, { kind: 'parent', subject: 'su_x', from: '1945-04-16', parent: 'su_33a' }, 'B');
    const b = ref(1, { kind: 'parent', subject: 'su_x', from: '1945-04-16', parent: 'su_69a' }, 'A');
    const r = resolve([a, b], 'parent', 'su_x', '1945-04-20', {});
    expect(r.chosen).toBe(b);
    expect(r.conflict).toBe(true);
  });
  it('закрепление с отпечатком: факт сдвинулся по номеру — закрепление не действует', () => {
    const a = str('1945-04-16', 6000, 'A', 0), c = str('1945-04-16', 6400, 'C', 1);
    const key = pinKey('strength', 'su_61a', '1945-04-16');
    const pins = { [key]: pinOf(c) };
    expect(resolve([a, c], 'strength', 'su_61a', '1945-04-16', pins).chosen).toBe(c);
    // перед закреплённым вставлен факт: на месте 1 теперь другой (6200 C)
    const ins = str('1945-04-16', 6200, 'C', 1);
    const r = resolve([a, ins, { ...c, index: 2 }], 'strength', 'su_61a', '1945-04-16', pins);
    expect(r.chosen).toBe(a);
    expect(r.pinMissing).toBe(true);
    expect(r.pin).toBe('missing');
  });
  it('закрепление без отпечатка (прежнее) — по номеру, как раньше', () => {
    const a = str('1945-04-16', 6000, 'A', 0), c = str('1945-04-16', 6400, 'C', 1);
    const pins = { [pinKey('strength', 'su_61a', '1945-04-16')]: { entry: 'e1', index: 1 } };
    const r = resolve([a, c], 'strength', 'su_61a', '1945-04-16', pins);
    expect(r.chosen).toBe(c);
    expect(r.pin).toBe('fact');
  });
  it("закрепление 'none' — видно в результате", () => {
    const a = str('1945-04-16', 6000, 'A', 0);
    expect(resolve([a], 'strength', 'su_61a', '1945-04-16', { [pinKey('strength', 'su_61a', '1945-04-16')]: 'none' }).pin).toBe('none');
    expect(resolve([a], 'strength', 'su_61a', '1945-04-16', {}).pin).toBeUndefined();
  });
  it('расхождение чисел — больше 5 % и выше порога (люди 500, танки 5, орудия 20)', () => {
    const m = '1945-04-16';
    const s = (i: number, c: object) => ref(i, { kind: 'strength', subject: 'd', at: m, ...c } as Claim, 'B');
    // 6 000 и 6 400: 6,25 %, 400 < 500 — не расхождение
    expect(resolve([s(0, { personnel: 6000 }), s(1, { personnel: 6400 })], 'strength', 'd', m, {}).conflict).toBe(false);
    expect(resolve([s(0, { personnel: 6000 }), s(1, { personnel: 6600 })], 'strength', 'd', m, {}).conflict).toBe(true);
    // танки 40 и 44: 9 %, но 4 ≤ 5
    expect(resolve([s(0, { tanks: 40 }), s(1, { tanks: 44 })], 'strength', 'd', m, {}).conflict).toBe(false);
    expect(resolve([s(0, { tanks: 40 }), s(1, { tanks: 46 })], 'strength', 'd', m, {}).conflict).toBe(true);
    // орудия 100 и 115: 13 %, 15 ≤ 20
    expect(resolve([s(0, { guns: 100 }), s(1, { guns: 115 })], 'strength', 'd', m, {}).conflict).toBe(false);
    expect(resolve([s(0, { guns: 100 }), s(1, { guns: 125 })], 'strength', 'd', m, {}).conflict).toBe(true);
  });
  it('расхождение потерь — с порогом людей, и по общему числу', () => {
    const l = (i: number, c: object) => ref(i, { kind: 'losses', subject: 'd', from: '1945-04-16', to: '1945-04-18', ...c } as Claim, 'B');
    expect(resolve([l(0, { killed: 300 }), l(1, { killed: 400 })], 'losses', 'd', '1945-04-18', {}).conflict).toBe(false);
    expect(resolve([l(0, { total: 3000 }), l(1, { total: 4000 })], 'losses', 'd', '1945-04-18', {}).conflict).toBe(true);
  });
});

describe('последнее звено: проверка', () => {
  const withCheck = (r: FactRef, by?: 'auto' | 'human'): FactRef =>
    by ? { ...r, fact: { ...r.fact, check: { by, at: '2026-10-14', results: [] } } } : r;
  const pick = (a: FactRef, b: FactRef) => resolve([a, b], 'strength', 'su_61a', '1945-04-16', {}).chosen;
  it('человек побеждает авто', () => {
    const auto = withCheck(str('1945-04-16', 6000, 'B', 0), 'auto'), human = withCheck(str('1945-04-16', 6100, 'B', 1), 'human');
    expect(pick(auto, human)).toBe(human);
    expect(pick(human, auto)).toBe(human);
  });
  it('факт без проверки (сид, прежний пользовательский) побеждает авто', () => {
    const auto = withCheck(str('1945-04-16', 6000, 'B', 0), 'auto'), plain = str('1945-04-16', 6100, 'B', 1);
    expect(pick(auto, plain)).toBe(plain);
    expect(pick(plain, auto)).toBe(plain);
  });
  it('человек и факт без проверки равны — порядок прежний', () => {
    const human = withCheck(str('1945-04-16', 6000, 'B', 0), 'human'), plain = str('1945-04-16', 6100, 'B', 1);
    expect(pick(human, plain)).toBe(human);
    expect(pick(plain, human)).toBe(plain);
  });
  it('звено последнее: свежее авто-факт побеждает старый человеческий', () => {
    const human = withCheck(str('1945-04-16', 6000, 'B', 0, '2026-01'), 'human'), auto = withCheck(str('1945-04-16', 6100, 'B', 1, '2026-05'), 'auto');
    expect(pick(human, auto)).toBe(auto);
  });
});
