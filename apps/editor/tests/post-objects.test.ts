import { describe, expect, it } from 'vitest';
import type { LngLat } from '@def-ops/core';
import { blankDir } from '../src/command-post';
import { applyObject, findObjects, objectiveMark, postObjects, type PostObject } from '../src/post-objects';

const ZEL: LngLat = [14.47, 52.52], MUN: LngLat = [14.13, 52.5];
const v = {
  places: [{ id: 'p_zel', title: 'Зелов', at: ZEL }, { id: 'p_mun', title: 'Мюнхеберг', at: MUN }],
  lines: [{ id: 'l_seelow', name: 'Зееловские высоты', line: [[14.4, 52.6], [14.6, 52.4]] as LngLat[] }],
  crossings: [{ id: 'b_k', name: 'Мост у Кюстрина', at: [14.64, 52.58] as LngLat }],
  own: [
    { id: 'su_8gva', name: '8-я гвардейская армия', echelon: 'army', parent: 'su_1bf', status: 'active', at: [14.6, 52.5] },
    { id: 'su_dx', name: 'выбыла', echelon: 'division', parent: 'su_8gva', status: 'destroyed', at: [14.6, 52.5] },
  ],
  intel: [{ id: 'de_ci', name: 'CI ак', at: [14.4, 52.5] }],
  command: { hqs: { su_8gva: { name: '8-я гвардейская армия', echelon: 'army', parent: 'su_1bf', control: 'agent' }, su_1bf: { name: '1-й Белорусский фронт', echelon: 'front', parent: null } } },
} as never;

const by = (l: PostObject[], id: string) => l.find((o) => o.id === id)!;

describe('объекты приказа', () => {
  it('объекты: пункты, рубежи, свои, противник, мосты', () => {
    const l = postObjects(v);
    expect([...new Set(l.map((o) => o.kind))].sort()).toEqual(['bridge', 'enemy', 'line', 'own', 'place']);
    const r = by(l, 'l_seelow');
    expect(r.line).toEqual([[14.4, 52.6], [14.6, 52.4]]);
    expect(r.at[0]).toBeCloseTo(14.5); expect(r.at[1]).toBeCloseTo(52.5);
    expect(l.filter((o) => o.id === 'su_8gva')).toHaveLength(1);
    expect(l.some((o) => o.id === 'su_dx')).toBe(false);
    expect(by(l, 'su_8gva').at).toEqual([14.6, 52.5]);
  });
  it('поиск по буквам и по удалению', () => {
    const l = postObjects(v);
    expect(findObjects(l, 'зел', null)[0].title).toBe('Зелов');
    expect(findObjects(l, 'ЗЕЕЛ', null)[0].title).toBe('Зееловские высоты');
    const near = findObjects(l, '', MUN);
    expect(near[0].title).toBe('Мюнхеберг');
    const km = near.map((o) => o.km!);
    expect([...km].sort((a, b) => a - b)).toEqual(km);
    expect(findObjects(l, '', null, 'bridge').map((o) => o.title)).toEqual(['Мост у Кюстрина']);
  });
  it('рубеж в ближайшую задачу — линией с названием', () => {
    const d = applyObject(blankDir('su_8gva', 'front'), 'immediate', by(postObjects(v), 'l_seelow'), null);
    expect(d.immediate).toEqual([[14.4, 52.6], [14.6, 52.4]]);
    expect(d.immediateTitle).toBe('Зееловские высоты');
  });
  it('пункт в ось — от места получателя', () => {
    const from: LngLat = [14.6, 52.5];
    const d = applyObject(blankDir('su_8gva', 'front'), 'axis', by(postObjects(v), 'p_zel'), from);
    expect(d.axis).toEqual([from, ZEL]);
    expect(d.axisTitle).toBe('Зелов');
  });
  it('рубеж в разграничительную линию — линией; пункт — точкой в конец', () => {
    const l = postObjects(v);
    let d = applyObject(blankDir('su_8gva', 'front'), 'boundaryR', by(l, 'l_seelow'), null);
    expect(d.boundaries[0]).toEqual([[14.4, 52.6], [14.6, 52.4]]);
    d = applyObject(d, 'boundaryL', by(l, 'p_zel'), null);
    d = applyObject(d, 'boundaryL', by(l, 'p_mun'), null);
    expect(d.boundaries[1]).toEqual([ZEL, MUN]);
  });
  it('свой штаб в главный удар — переключение', () => {
    const o = by(postObjects(v), 'su_8gva');
    const d0 = blankDir('su_1bf', 'stavka');
    const d1 = applyObject(d0, 'mainBlow', o, null);
    expect(d1.mainBlow).toEqual(['su_8gva']);
    expect(applyObject(d1, 'mainBlow', o, null).mainBlow).toEqual([]);
    expect(applyObject(d0, 'mainBlow', by(postObjects(v), 'p_zel'), null)).toBe(d0);
  });
  it('точка цели с подписью до отдачи', () => {
    expect(objectiveMark({ ...blankDir('su_8gva', 'front'), immediate: [ZEL], immediateTitle: 'Зелов' }, '8-я гвардейская армия')).toEqual({ at: ZEL, label: '8 гв. А: наступать — Зелов' });
    expect(objectiveMark(blankDir('su_8gva', 'front'), '8-я гвардейская армия')).toBeNull();
    const ax = objectiveMark({ ...blankDir('su_8gva', 'front'), axis: [[14.6, 52.5], MUN] }, '8-я гвардейская армия');
    expect(ax).toEqual({ at: MUN, label: '8 гв. А: наступать — указанная точка' });
  });
});
