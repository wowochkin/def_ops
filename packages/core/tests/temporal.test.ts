import { describe, it, expect } from 'vitest';
import {
  emptyDocument, createFeature, documentAt, featureAt, setKeyframe, removeKeyframe, applyGeometryAt, toTime, inSpan,
  renderDocument, toGeoJSON, timelineRange, resample, geometryAt, toZoned, fromZoned, zoneOffset, offsetLabel, isZone, isDateOnly, MOSCOW_TZ, stateAt, attrHistory, validateAttrs, ENTITY_TYPE_BY_ID, formatAttr,
  type Entity, type Fact, type LngLat, type SymbolFeature, type LineFeature,
} from '@def-ops/core';

const A: LngLat = [13.3, 52.5], B: LngLat = [13.4, 52.52], C: LngLat = [13.5, 52.55];

describe('время на карте', () => {
  it('моменты: дата, дата-время, без пояса — UTC', () => {
    expect(toTime('1945-04-25')).toBe(Date.UTC(1945, 3, 25));
    expect(toTime('1945-04-25T06:30')).toBe(Date.UTC(1945, 3, 25, 6, 30));
    expect(toTime('1945-04-25T06:30:00+03:00')).toBe(Date.UTC(1945, 3, 25, 3, 30));
    expect(inSpan({ from: '1945-04-16', to: '1945-05-08' }, '1945-05-08')).toBe(false);
    expect(inSpan({ from: '1945-04-16', to: '1945-05-08' }, '1945-04-16')).toBe(true);
    expect(inSpan(null, '1900-01-01')).toBe(true);
  });

  it('знак вне периода скрыт, положение — по ключевым кадрам (ступенчато)', () => {
    let s = createFeature('symbol', 'rkka.hqDivision', { at: A }) as SymbolFeature;
    s = setKeyframe(s, '1945-04-20', { at: B });
    s = setKeyframe(s, '1945-04-25', { at: C });
    s = { ...s, time: { from: '1945-04-16', to: '1945-05-03' }, motion: 'step' };
    expect(featureAt(s, '1945-04-10')).toBeNull();
    expect(featureAt(s, '1945-04-18')!.at).toEqual(A);
    expect((featureAt(s, '1945-04-20') as typeof s).at).toEqual(B);
    expect((featureAt(s, '1945-04-30') as typeof s).at).toEqual(C);
    expect(featureAt(s, '1945-05-03')).toBeNull();
    // исходный объект не меняется
    expect(s.at).toEqual(A);
    // кадр на ту же дату заменяется, удаляется
    expect(setKeyframe(s, '1945-04-20', { at: A }).keyframes).toHaveLength(2);
    expect(removeKeyframe(s, '1945-04-20').keyframes!.map((k) => k.t)).toEqual(['1945-04-25']);
  });

  it('правка на выбранную дату меняет действующий кадр, а не основную геометрию', () => {
    let l = createFeature('line', 'std.frontLine', { points: [A, B] }) as LineFeature;
    l = setKeyframe(l, '1945-04-20', { points: [B, C] });
    const edited = { ...l, points: [A, C] as LngLat[] };
    const at22 = applyGeometryAt(l, '1945-04-22', edited);
    expect(at22.points).toEqual([A, B]);
    expect(at22.keyframes![0].points).toEqual([A, C]);
    const at10 = applyGeometryAt(l, '1945-04-10', edited);
    expect(at10.points).toEqual([A, C]);
    expect(at10.keyframes![0].points).toEqual([B, C]);
  });

  it('документ на момент: отрисовка и GeoJSON; привязка к отсутствующей линии снимается', () => {
    const doc = emptyDocument(A, 8);
    const front = { ...createFeature('line', 'std.frontLine', { points: [A, B, C] }), time: { from: '1945-04-20' } };
    const arrow = { ...createFeature('arrow', 'rkka.offensive', { points: [B, C] }), anchor: { featureId: front.id, t: 0.5 } };
    doc.features.push(front, arrow);
    const early = documentAt(doc, '1945-04-16');
    expect(early.features.map((f) => f.id)).toEqual([arrow.id]);
    expect(early.features[0].kind === 'arrow' && early.features[0].anchor).toBeNull();
    expect(documentAt(doc, null)).toBe(doc);
    expect(renderDocument(doc, { time: '1945-04-16' }).features).toHaveLength(1);
    expect(renderDocument(doc, { time: '1945-04-21' }).features).toHaveLength(2);
    const gj = toGeoJSON(doc, { time: '1945-04-16' });
    expect(gj.features).toHaveLength(1);
    expect(timelineRange(doc)).toEqual({ start: '1945-04-20', end: '1945-04-20' });
  });
});

describe('часовые пояса (исторические правила)', () => {
  it('московское и местное время', () => {
    const t = '1945-04-25T03:00';
    expect(toZoned(t, MOSCOW_TZ)).toBe('1945-04-25T06:00');
    expect(toZoned(t, 'Europe/Berlin')).toBe('1945-04-25T05:00');
    expect(offsetLabel(zoneOffset(toTime('1945-06-01T03:00'), 'Europe/Berlin'))).toBe('UTC+3'); // Берлин по московскому с 24.05.1945
    expect(offsetLabel(zoneOffset(toTime('1942-11-19T03:00'), 'Europe/Volgograd'))).toBe('UTC+4');
    expect(fromZoned('1945-04-25T06:00', MOSCOW_TZ)).toBe('1945-04-25T03:00');
    expect(fromZoned('1945-04-25T03:00', MOSCOW_TZ)).toBe('1945-04-25');
    expect(fromZoned('1945-04-25T05:00', 'Europe/Berlin')).toBe('1945-04-25T03:00');
    expect(isZone('Europe/Berlin')).toBe(true);
    expect(isZone('Mars/Olympus')).toBe(false);
    expect(isDateOnly('1945-04-25')).toBe(true);
    expect(offsetLabel(330)).toBe('UTC+5:30');
  });
});

describe('плавное движение', () => {
  it('знак движется между положениями; основная геометрия — на начало периода', () => {
    let s = createFeature('symbol', 'rkka.hqDivision', { at: [13, 52] }) as SymbolFeature;
    s = { ...s, time: { from: '1945-04-16' }, rotation: 350 };
    s = setKeyframe(s, '1945-04-20', { at: [14, 53], rotation: 10 });
    const mid = featureAt(s, '1945-04-18')!;
    expect(mid.at[0]).toBeCloseTo(13.5); expect(mid.at[1]).toBeCloseTo(52.5);
    expect(mid.rotation).toBeCloseTo(360); // по кратчайшему пути через 0
    expect(featureAt(s, '1945-04-18T12:00')!.at[0]).toBeCloseTo(13.625);
    expect(featureAt(s, '1945-04-25')!.at).toEqual([14, 53]); // после последнего — стоит
    expect(featureAt({ ...s, motion: 'step' }, '1945-04-18')!.at).toEqual([13, 52]);
    // без начала периода до первого кадра — стоит в основном положении
    const noFrom = { ...s, time: null };
    expect(featureAt(noFrom, '1945-04-18')!.at).toEqual([13, 52]);
  });
  it('линии с разным числом точек приводятся к одной длине', () => {
    let l = createFeature('line', 'std.frontLine', { points: [[13, 52], [14, 52]] }) as LineFeature;
    l = setKeyframe(l, '1945-04-16', { points: [[13, 52], [14, 52]] });
    l = setKeyframe(l, '1945-04-20', { points: [[13, 53], [13.5, 53.2], [14, 53]] });
    const mid = featureAt(l, '1945-04-18')!;
    expect(mid.points.length).toBe(8);
    expect(mid.points[0][1]).toBeCloseTo(52.5);
    expect(featureAt(l, '1945-04-20')!.points).toHaveLength(3);
    expect(resample([[0, 0], [10, 0]], 3)).toEqual([[0, 0], [5, 0], [10, 0]]);
  });
  it('правка в промежуточный момент создаёт новое положение, в момент кадра — правит его', () => {
    let s = createFeature('symbol', 'rkka.hqDivision', { at: [13, 52] }) as SymbolFeature;
    s = { ...s, time: { from: '1945-04-16' } };
    s = setKeyframe(s, '1945-04-20', { at: [14, 53] });
    const moved = { ...s, at: [13.6, 52.4] as LngLat };
    const r1 = applyGeometryAt(s, '1945-04-18', moved);
    expect(r1.keyframes!.map((k) => k.t)).toEqual(['1945-04-18', '1945-04-20']);
    expect(r1.at).toEqual([13, 52]);
    const r2 = applyGeometryAt(s, '1945-04-20', moved);
    expect(r2.keyframes).toHaveLength(1);
    expect(r2.keyframes![0].at).toEqual([13.6, 52.4]);
    const r3 = applyGeometryAt(s, '1945-04-16', moved);
    expect(r3.at).toEqual([13.6, 52.4]);
    expect(geometryAt(s, '1945-04-18').interpolated).toBe(true);
    // документ задаёт режим по умолчанию
    const doc = emptyDocument([13, 52], 8);
    doc.features.push(s);
    doc.timeline = { start: '1945-04-16', end: '1945-04-20', motion: 'step' };
    expect((documentAt(doc, '1945-04-18').features[0] as SymbolFeature).at).toEqual([13, 52]);
  });
});

describe('реестр: характеристики во времени', () => {
  const div: Entity = { id: 'e1', type: 'formation', name: '150-я стрелковая дивизия', shortName: '150 сд', attrs: { number: '150', echelon: 'division', branch: 'rifle' }, existence: { from: '1941-09-01' } };
  const facts: Fact[] = [
    { id: 'f1', entityId: 'e1', validFrom: '1945-04-01', attrs: { commander: 'В. М. Шатилов', personnel: 7000, parent: 'e79sk' } },
    { id: 'f2', entityId: 'e1', validFrom: '1945-04-25', attrs: { personnel: 5600, status: 'offensive' }, geometry: { type: 'Point', coordinates: [13.37, 52.52] } },
    { id: 'f3', entityId: 'e1', validFrom: '1945-04-29', validTo: '1945-05-02', attrs: { status: 'encircled' } },
  ];
  it('состояние на дату: постоянные + действующие факты, поздний перекрывает ранний', () => {
    const s = stateAt(div, facts, '1945-04-26');
    expect(s.attrs).toMatchObject({ number: '150', commander: 'В. М. Шатилов', personnel: 5600, status: 'offensive' });
    expect(s.from.personnel).toBe('f2');
    expect(s.geometry).toEqual({ type: 'Point', coordinates: [13.37, 52.52] });
    expect(stateAt(div, facts, '1945-04-30').attrs.status).toBe('encircled');
    // факт с validTo перестаёт действовать — возвращается предыдущее значение
    expect(stateAt(div, facts, '1945-05-02').attrs.status).toBe('offensive');
    expect(stateAt(div, facts, '1945-03-01').attrs.personnel).toBeUndefined();
    expect(stateAt(div, facts, '1941-01-01').exists).toBe(false);
  });
  it('null в факте снимает значение; история характеристики', () => {
    const more = [...facts, { id: 'f4', entityId: 'e1', validFrom: '1945-05-09', attrs: { commander: null } }];
    expect(stateAt(div, more, '1945-05-10').attrs.commander).toBeUndefined();
    expect(attrHistory(more, 'personnel').map((h) => h.value)).toEqual([7000, 5600]);
  });
  it('проверка по схеме типа', () => {
    const t = ENTITY_TYPE_BY_ID.get('formation')!;
    expect(validateAttrs(t, { number: '150', echelon: 'division' }, 'static')).toEqual([]);
    expect(validateAttrs(t, { echelon: 'division' }, 'static').join()).toMatch(/Номер/);
    expect(validateAttrs(t, { number: '1', echelon: 'xx' }, 'static').join()).toMatch(/недопустимое/);
    expect(validateAttrs(t, { number: '1', echelon: 'army', personnel: 5 }, 'static').join()).toMatch(/меняется во времени/);
    expect(validateAttrs(t, { personnel: 5.5 }, 'temporal').join()).toMatch(/целое/);
    expect(validateAttrs(t, { personnel: 5000, myField: 'x' }, 'temporal')).toEqual([]);
    expect(formatAttr(t.fields.find((f) => f.key === 'personnel'), 5600)).toBe('5 600 чел.');
  });
});
