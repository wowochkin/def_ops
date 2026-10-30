import { describe, expect, it } from 'vitest';
import type { LngLat } from '@def-ops/core';
import { blankDir } from '../src/command-post';
import { applyObject, findObjects, labelAt, objectiveMark, postObjects, theatreObjects, type PostObject } from '../src/post-objects';

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
  it('свои в резерве и прибывающие — тоже объекты (как получатели и щелчок по знаку); выбывшие — нет', () => {
    const w = { ...(v as object), own: [
      { id: 'su_r', name: 'резервная армия', echelon: 'army', parent: 'su_1bf', status: 'reserve', at: [14.0, 52.4] },
      { id: 'su_a', name: 'прибывающая армия', echelon: 'army', parent: 'su_1bf', status: 'arriving', at: [14.0, 52.3] },
      { id: 'su_dx', name: 'выбыла', echelon: 'division', parent: 'su_8gva', status: 'destroyed', at: [14.6, 52.5] },
    ] } as never;
    const l = postObjects(w);
    expect(l.filter((o) => o.kind === 'own').map((o) => o.id)).toEqual(['su_r', 'su_a']);
    expect(applyObject(blankDir('su_1bf', 'stavka'), 'mainBlow', by(l, 'su_r'), null).mainBlow).toEqual(['su_r']);
  });
  it('объекты театра в виде хода: рубежи и мосты, не разрушенные к ходу; рек нет (геометрия — не каждый ход)', () => {
    const data = {
      lines: [{ id: 'l1', name: 'Рубеж', line: [[14, 52], [14.1, 52.1]] as LngLat[], fortification: 2 }],
      bridges: [{ id: 'b1', at: [14, 52] as LngLat, name: 'Мост A' }, { id: 'b2', at: [14.2, 52] as LngLat, destroyedAt: '1945-04-16T00:00' }, { id: 'b3', at: [14.3, 52] as LngLat, kind: 'ferry' }],
      rivers: [{ name: 'Одер', line: [[14, 52], [14, 53]] as LngLat[], major: true }],
    };
    const o = theatreObjects(data, '1945-04-17T05:00', () => 'у Зелова');
    expect(Object.keys(o).sort()).toEqual(['crossings', 'lines']);
    expect(o.lines).toEqual([{ id: 'l1', name: 'Рубеж', line: [[14, 52], [14.1, 52.1]] }]);
    expect(o.crossings.map((b) => b.name)).toEqual(['Мост A', 'Переправа у Зелова']);
  });
});

describe('подпись точки цели — сдвиг в пикселях', () => {
  it('над точкой на 26 пикселей при любом масштабе: на шаг масштаба крупнее — вдвое меньше градусов', () => {
    const at: LngLat = [14.5, 52.5];
    const k = Math.cos((52.5 * Math.PI) / 180);
    const d8 = labelAt(at, 8)[1] - at[1], d9 = labelAt(at, 9)[1] - at[1];
    expect(d8 / d9).toBeCloseTo(2, 5);
    // 26 пикселей при 512 пикселях на мир на масштабе 0 (по широте — с поправкой на широту)
    expect(d8 * (512 * 2 ** 8) / 360 / k).toBeCloseTo(26, 5);
    expect(labelAt(at, 8)[0]).toBe(at[0]);
  });
});
