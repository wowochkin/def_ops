import { describe, expect, it } from 'vitest';
import { affectedArmies, berlinHour, berlinState, frontAdvance, idleMaxHours, reasonsShare, untouchedKm } from '../tools/agents/interventions';

// маленький фиктивный ход: фронт f — армии a (дивизия d1) и b (d2), немецкая армия g (d3)
const OUT = 'небоеспособна';
type Row = [number, number, string, number, number, number, number, number, number, number, number];
const row = (lng: number, lat = 52, state = 'оборона: поспешная', enc = 0): Row => [lng, lat, state, 9000, 0, 100, 2, 1, 0, 1, enc];
const make = (frames: Row[][], extra: Record<string, unknown> = {}) => ({
  scenario: 't', name: 't', start: '1945-04-16T05:00', hours: frames.length - 1, seed: 1,
  fields: ['lng', 'lat', 'state', 'personnel', 'tanks', 'guns', 'ammo', 'fuel', 'fatigue', 'cohesion', 'encircled'],
  divisions: [
    { id: 'd1', name: '1', side: 'su', hq: 'k', kind: 'sd', mobility: 'foot', size: 'rifle', quality: 1 },
    { id: 'd2', name: '2', side: 'su', hq: 'b', kind: 'sd', mobility: 'foot', size: 'rifle', quality: 1 },
    { id: 'd3', name: '3', side: 'de', hq: 'g', kind: 'id', mobility: 'foot', size: 'rifle', quality: 1 },
  ],
  hqs: [
    { id: 'f', name: 'фронт', side: 'su', echelon: 'front', parent: null },
    { id: 'a', name: 'армия А', side: 'su', echelon: 'army', parent: 'f' },
    { id: 'k', name: 'корпус', side: 'su', echelon: 'corps', parent: 'a' },
    { id: 'b', name: 'армия Б', side: 'su', echelon: 'army', parent: 'f' },
    { id: 'g', name: 'немецкая армия', side: 'de', echelon: 'army', parent: null },
  ],
  frames, journal: [], ...extra,
});
const still = (n: number) => Array.from({ length: n }, () => [row(14), row(15), row(14.5)]);
const doc = (tick: number, to: string, kind = 'instruction') => ({ tick, time: '', hq: 'f', kind, to: [to], text: '', rule: null });

describe('признаки правдоподобия', () => {
  it('idleMaxHours: только часы армии «сам» (или под «самим» старшим) без действующей задачи (нет директивы, цель достигнута); оборона — задача', () => {
    // a: с истории в 10 ч; задача наступать к 14,5 (армия у 14 — не достигнута) с 12 ч, в 20 ч армия у цели, в 30 ч — «оборонять»
    const fr = still(41).map((f, h) => [row(h >= 20 ? 14.5 : 14), f[1], f[2]]);
    const at = (tick: number, text: string) => ({ ...doc(tick, 'a'), text });
    const documents = [at(12, 'наступать; ближайшая задача — рубеж у 52.00, 14.50'), at(30, 'оборонять; ближайшая задача — рубеж у 52.00, 14.50'), doc(15, 'b', 'notice')];
    const intent = [
      { hq: 'a', changes: [{ tick: 0, status: 'history', reason: null }, { tick: 10, status: 'own', reason: 'x' }] },
      { hq: 'b', changes: [{ tick: 0, status: 'history', reason: null }] },
    ];
    // a: 10–11 без задачи (2 ч), 12–19 задача, 20–29 цель достигнута (10 ч), с 30 — оборона; b на истории — не в счёт
    expect(idleMaxHours(make(fr, { documents, intent }) as never, 0, 4)).toEqual({ hours: 10, army: 'a' });
    // b «со сдвигом» (ведёт цепочка, ждёт часа задачи) — не в счёт: у a с 25 ч — 5 ч (25–29)
    const b = (status: string) => [intent[0], { hq: 'b', changes: [{ tick: 0, status: 'history', reason: null }, { tick: 35, status, reason: 'y' }] }];
    expect(idleMaxHours(make(fr, { documents, intent: b('shifted') }) as never, 25, 4)).toEqual({ hours: 5, army: 'a' });
    // b «сам» без единого документа с 35 ч — 6 ч (35–40)
    expect(idleMaxHours(make(fr, { documents, intent: b('own') }) as never, 25, 4)).toEqual({ hours: 6, army: 'b' });
    // «сам» старший (фронт) — армия вне истории, как off_history
    const front = [{ hq: 'f', changes: [{ tick: 0, status: 'history', reason: null }, { tick: 35, status: 'own', reason: 'z' }] }, intent[0], { hq: 'b', changes: [{ tick: 0, status: 'history', reason: null }] }];
    expect(idleMaxHours(make(fr, { documents, intent: front }) as never, 25, 4)).toEqual({ hours: 6, army: 'b' });
    // выбывшая к концу армия — не в счёт
    const dead = fr.map((f, h) => (h === 40 ? [row(14.5, 52, OUT), f[1], f[2]] : f));
    expect(idleMaxHours(make(dead, { documents, intent }) as never, 0, 4)).toEqual({ hours: 0, army: null });
  });
  it('frontAdvance: смещение центра фронта и к Берлину', () => {
    const fr = still(3); fr[2] = [row(14.5), row(15.5), row(14.5)];
    const [r] = frontAdvance(make(fr) as never, [16, 52]);
    expect(r.front).toBe('f');
    expect(r.km).toBeCloseTo(0.5 * 111.32 * Math.cos((52 * Math.PI) / 180), 0);
    expect(r.towardKm).toBeCloseTo(r.km, 1);
  });
  it('berlinState: взят, окружён, нет', () => {
    const center: [number, number][] = [[14.9, 51.9], [15.1, 51.9], [15.1, 52.1], [14.9, 52.1]];
    const city: [number, number][] = [[14.4, 51.8], [15.2, 51.8], [15.2, 52.2], [14.4, 52.2]];
    expect(berlinState(make(still(2)) as never, center, city)).toBe('взят');
    const away = [[row(13), row(13), row(14.5, 52, 'оборона: поспешная', 1)]] as Row[][];
    expect(berlinState(make(away) as never, center, city)).toBe('окружён');
    const open = [[row(13), row(13), row(14.5)]] as Row[][];
    expect(berlinState(make(open) as never, center, city)).toBe('нет');
    expect(berlinHour(make([...open, ...still(2)]) as never, center)).toBe(1);
    expect(berlinHour(make(open) as never, center)).toBeNull();
  });
  it('untouchedKm: средняя разница центров армий за [t0, t0+48] против прогона без вмешательства', () => {
    const base = make(still(60));
    const fr = still(60).map((f, h) => [row(14 + (h >= 10 ? 0.1 : 0)), f[1], f[2]]);
    const c = make(fr);
    const skip = new Set(['a']);
    expect(untouchedKm(c as never, base as never, 0, skip)).toBe(0);
    const all = untouchedKm(c as never, base as never, 0, new Set());
    // a сдвинута на 0,1° с 10-го часа: 39 из 49 часов; армий три
    expect(all).toBeCloseTo((0.1 * 111.32 * Math.cos((52 * Math.PI) / 180) * 39) / 49 / 3, 1);
  });
  it('affectedArmies: штаб действия и его поддерево, для разрешения — армия', () => {
    const t = make(still(1));
    expect([...affectedArmies(t as never, [{ hold: { hq: 'f' } }])].sort()).toEqual(['a', 'b']);
    expect([...affectedArmies(t as never, [{ drop: { to: 'a' } }])]).toEqual(['a']);
    expect([...affectedArmies(t as never, [{ permit: { army: 'g' } }])]).toEqual(['g']);
  });
  it('reasonsShare: доля уходов с истории с причиной', () => {
    const intent = [{ hq: 'a', changes: [{ tick: 0, status: 'history', reason: null }, { tick: 5, status: 'own', reason: 'x' }, { tick: 9, status: 'shifted', reason: null }] }];
    expect(reasonsShare(make(still(1), { intent }) as never)).toBe(0.5);
    expect(reasonsShare(make(still(1), { intent: [] }) as never)).toBe(1);
  });
});
