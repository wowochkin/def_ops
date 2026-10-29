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
  it('idleMaxHours: наибольший промежуток между документами армии после часа вмешательства; выбывшие не считаются', () => {
    const documents = [doc(0, 'a'), doc(12, 'a'), doc(30, 'a'), doc(5, 'b'), doc(20, 'b', 'notice'), doc(38, 'b')];
    const t = make(still(41), { documents });
    // a: 10→12→30→40: 18; b: 10→38→40: 28 (извещение не задача)
    expect(idleMaxHours(t as never, 10)).toEqual({ hours: 28, army: 'b' });
    const dead = still(41); dead[40][1] = row(15, 52, OUT);
    expect(idleMaxHours(make(dead, { documents }) as never, 10)).toEqual({ hours: 18, army: 'a' });
    // армия без единого документа: в общем счёте — весь отрезок, среди армий с задачами — не считается
    expect(idleMaxHours(make(still(41), { documents: documents.filter((d) => d.to[0] === 'a') }) as never, 10)).toEqual({ hours: 30, army: 'b' });
    expect(idleMaxHours(make(still(41), { documents: documents.filter((d) => d.to[0] === 'a') }) as never, 10, true)).toEqual({ hours: 18, army: 'a' });
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
