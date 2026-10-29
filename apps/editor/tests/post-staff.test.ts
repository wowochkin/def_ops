import { describe, expect, it } from 'vitest';
import type { TurnView } from '../src/sim/game-protocol';
import type { LevelId } from '../src/map-level-scale';
import type { StaffAction } from '@def-ops/sim';
import { mergePriority, ordersSubs, postBases, postBridges, postSupply, priorityLimit, staffDeny, staffScope } from '../src/post-staff';

// Ставка → фронт f1 → армии a1, a2 → корпус k1 (a1) → дивизии d1 (k1), d2 (a2); база b1 у d1, b2 у d2, b3 далеко
const div = (id: string, parent: string, at: [number, number], o: object = {}) => ({ id, name: id, parent, echelon: 'division', status: 'active', at, place: 'у X', posture: 'наступает', task: null, target: null,
  orderSource: null, personnel: 10000, tanks: 0, guns: 100, strength: 0.9, ammo: 1, fuel: 1, fatigue: 0.2, cutOff: false, movedKm: 0, combats: [], pending: [], ...o });
const v = {
  own: [div('d1', 'k1', [14, 52.5]), div('d2', 'a2', [14.5, 52.5])],
  command: { hqs: {
    top: { name: 'Ставка', echelon: 'high_command', parent: null, side: 'su' }, f1: { name: '1 БФ', echelon: 'front', parent: 'top', side: 'su' },
    a1: { name: '8 гв. А', echelon: 'army', parent: 'f1', side: 'su' }, a2: { name: '5 уд. А', echelon: 'army', parent: 'f1', side: 'su' },
    k1: { name: '4 гв. ск', echelon: 'corps', parent: 'a1', side: 'su' },
  } },
  bases: [{ id: 'b1', name: 'Б1', at: [13.95, 52.5], state: 'active', activeFrom: null }, { id: 'b2', name: 'Б2', at: [14.55, 52.5], state: 'active', activeFrom: null }, { id: 'b3', name: 'Б3', at: [20, 50], state: 'active', activeFrom: null }],
  bridges: [{ id: 'm1', name: 'М1', at: [14.05, 52.5], openFrom: null, building: false }, { id: 'm2', name: 'М2', at: [18, 52], openFrom: null, building: false }],
  supplyHours: { d1: 5, d2: null }, priority: [], rangeHours: 24, terms: { topGen: 'Ставки' },
} as unknown as TurnView;

describe('распоряжения штаба по уровню пункта', () => {
  it('что штаб ведёт: тыл — фронт и армия, Ставка видит; переправы — фронт и армия; линии армий — фронт', () => {
    expect(staffScope(v, 'stavka', 'top')).toMatchObject({ bases: 'view', priority: true, bridges: 'view', allotParks: true, bounds: 'fronts' });
    expect(staffScope(v, 'front', 'f1')).toMatchObject({ bases: 'move', priority: true, bridges: 'build', bounds: 'armies' });
    expect(staffScope(v, 'army', 'a1')).toMatchObject({ bases: 'move', priority: true, bridges: 'build', bounds: 'own' });
    expect(staffScope(v, 'corps', 'k1')).toMatchObject({ bases: 'none', priority: false, bridges: 'build', allotParks: false, bounds: 'own' });
    expect(staffScope(v, 'division', 'k1')).toMatchObject({ bases: 'none', priority: false, bridges: 'build' });
  });
  it('танковый и механизированный корпус — свой тыл (подвоз между частями), стрелковый — нет; немецкий — нет', () => {
    const w = { ...v, command: { hqs: { ...v.command!.hqs, t9: { name: '9 тк', echelon: 'corps', parent: 'a1', side: 'su' }, m1: { name: '1-й механизированный корпус', echelon: 'corps', parent: 'a1', side: 'su' } } } } as unknown as TurnView;
    expect(staffScope(w, 'corps', 't9').priority).toBe(true);
    expect(staffScope(w, 'corps', 'm1').priority).toBe(true);
    expect(staffScope(w, 'corps', 'k1').priority).toBe(false);
    const de = { ...w, terms: { top: 'ОКХ' } } as unknown as TurnView;
    expect(staffScope(de, 'corps', 't9').priority).toBe(false);
  });
  it('базы и переправы пункта — питающие его войска и в его полосе', () => {
    expect(postBases(v, staffScope(v, 'army', 'a1')).map((b) => b.id)).toEqual(['b1']);
    expect(postBases(v, staffScope(v, 'front', 'f1')).map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(postBases(v, staffScope(v, 'stavka', 'top')).map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(postBridges(v, staffScope(v, 'army', 'a1')).map((b) => b.id)).toEqual(['m1']);
    expect(postBridges(v, staffScope(v, 'stavka', 'top')).map((b) => b.id)).toEqual(['m1', 'm2']);
  });
  it('подвоз подчинённых — худшее время по их дивизиям', () => {
    const rows = postSupply(v, staffScope(v, 'front', 'f1'));
    expect(rows.map((r) => [r.unit.id, r.hours])).toEqual([['a1', 5], ['a2', null]]);
  });
  it('приоритет: пункт правит только своих подчинённых, чужой приоритет остаётся', () => {
    expect(mergePriority(['a2', 'k9'], ['a1', 'a2'], ['a1'])).toEqual(['k9', 'a1']);
    expect(priorityLimit(2)).toBe(1);
    expect(priorityLimit(7)).toBe(3);
  });
  it('чужое распоряжение — с причиной', () => {
    const base = (b: string): StaffAction => ({ kind: 'base', side: 'su', base: b, to: [14, 52], issuedAt: '' });
    expect(staffDeny(v, staffScope(v, 'corps', 'k1'), base('b1'))).toContain('уровни «Фронт», «Армия»');
    expect(staffDeny(v, staffScope(v, 'army', 'a1'), base('b2'))).toContain('другого штаба');
    expect(staffDeny(v, staffScope(v, 'army', 'a1'), base('b1'))).toBeNull();
    const bridge = (at: [number, number]): StaffAction => ({ kind: 'bridge', side: 'su', at, issuedAt: '' });
    expect(staffDeny(v, staffScope(v, 'stavka', 'top'), bridge([14, 52.5]))).toContain('придаёт понтонные парки');
    expect(staffDeny(v, staffScope(v, 'corps', 'k1'), bridge([14.05, 52.5]))).toBeNull();
    expect(staffDeny(v, staffScope(v, 'corps', 'k1'), { kind: 'parks', side: 'su', hq: 'd1', n: 1, issuedAt: '' })).toContain('придают');
    expect(staffDeny(v, staffScope(v, 'front', 'f1'), { kind: 'parks', side: 'su', hq: 'a1', n: 1, issuedAt: '' })).toBeNull();
    expect(staffDeny(v, staffScope(v, 'front', 'f1'), { kind: 'parks', side: 'su', hq: 'k1', n: 1, issuedAt: '' })).toContain('своему подчинённому');
    expect(staffDeny(v, staffScope(v, 'army', 'a1'), bridge([18, 52]))).toContain('вне полосы');
    const line: StaffAction = { kind: 'boundary', side: 'su', a: 'a1', b: 'a2', line: [], issuedAt: '' };
    expect(staffDeny(v, staffScope(v, 'army', 'a1'), line)).toContain('штаб фронта');
    expect(staffDeny(v, staffScope(v, 'front', 'f1'), line)).toBeNull();
    expect(staffDeny(v, staffScope(v, 'corps', 'k1'), { kind: 'priority', side: 'su', formations: [], issuedAt: '' })).toContain('приоритет');
  });
  it('подвкладки «Приказов» по уровню: только с доступным действием, причина — словами', () => {
    const vr = { ...v, reserveGroups: [] } as TurnView;
    const at = (level: LevelId, issuer: string) => ordersSubs(vr, staffScope(vr, level, issuer));
    expect(at('front', 'f1')).toMatchObject({ units: true, rear: true, bridges: true, bounds: true });
    expect(at('stavka', 'top')).toMatchObject({ rear: true, bridges: true });
    const corps = at('corps', 'k1');
    expect(corps.units).toBe(true);
    expect(typeof corps.rear).toBe('string');
    expect(typeof corps.bounds).toBe('string');
    expect(corps.bridges).toBe(true);
    expect(typeof at('stavka', 'top').bounds).toBe('string');
    expect(typeof at('front', 'f1').reserves).toBe('string');
    expect(at('front', 'f1').reserves).toMatch(/резерв/);
    expect(Object.values(ordersSubs(vr, null)).every((x) => x === true)).toBe(true);
  });
});
