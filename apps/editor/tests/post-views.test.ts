import { describe, expect, it } from 'vitest';
import { postDocs, postIntel, postReports, postReserves } from '../src/post-views';

const u = (id: string, parent: string, at: [number, number], personnel = 8000, extra = {}) => ({ id, name: id, parent, echelon: 'division', status: 'active', at, place: '', posture: 'обороняется', task: 'оборонять', target: null, orderSource: null, personnel, tanks: 10, guns: 100, strength: 0.8, ammo: 1, fuel: 1, fatigue: 0.2, cutOff: false, movedKm: 0, combats: [], pending: [], ...extra });
const hq = (name: string, echelon: string, parent: string | null) => ({ control: 'agent', led: false, name, echelon, parent });
const v = {
  time: '1945-04-17T05:00',
  own: [
    u('d1', 'k1', [14.5, 52.6]), u('d2', 'k1', [14.52, 52.58]), u('d3', 'a2', [14.0, 52.0]),
    { ...u('a1', 'f1', [14.51, 52.59], 16000), echelon: 'army', name: '8 гв. А' },
    { ...u('k1', 'a1', [14.51, 52.59], 16000), echelon: 'corps', name: '4 гв. ск' },
  ],
  intel: [
    { id: 'e1', name: '303 пд', at: [14.6, 52.6], place: '', posture: 'обороняется', estimate: 'около 6 000 чел.', nearest: { name: 'd1', km: 7 }, fresh: false },
    { id: 'e2', name: '9 пдд', at: [14.62, 52.62], place: '', posture: 'обороняется', estimate: 'около 4 000 чел.', nearest: { name: 'd1', km: 9 }, fresh: true },
    { id: 'e3', name: '342 пд', at: [13.0, 51.5], place: '', posture: 'на марше', estimate: 'около 5 000 чел.', nearest: { name: 'd3', km: 80 }, fresh: false },
  ],
  command: {
    mode: 'agents', led: [], requests: [], historical: [],
    hqs: { s: hq('Ставка ВГК', 'high_command', null), f1: hq('1-й Белорусский фронт', 'front', 's'), a1: hq('8 гв. А', 'army', 'f1'), a2: hq('33 А', 'army', 'f1'), k1: hq('4 гв. ск', 'corps', 'a1') },
    documents: [
      { time: '17.04 02:00', hq: 'k1', hqName: '4 гв. ск', kind: 'order', to: ['d1'], text: 'наступать', rule: null },
      { time: '17.04 03:00', hq: 'a1', hqName: '8 гв. А', kind: 'order', to: ['k1'], text: 'наступать', rule: null },
      { time: '17.04 04:00', hq: 'a2', hqName: '33 А', kind: 'order', to: [], text: 'чужое', rule: null },
    ],
    enemy: { hqs: { hg: { name: 'ГА «Висла»', echelon: 'front', parent: null }, a9: { name: '9 А', echelon: 'army', parent: 'hg' }, k101: { name: 'CI ак', echelon: 'corps', parent: 'a9' }, k5: { name: 'V ак', echelon: 'corps', parent: 'a9' } },
      divisions: { e1: 'k101', e2: 'k101', e3: 'k5' } },
  },
} as never;

describe('вкладки по уровню пункта управления', () => {
  it('доклады — подчинённые штаба; фронт без своего доклада — сводкой по его дивизиям', () => {
    expect(postReports(v, 'a1').map((x) => x.id)).toEqual(['k1']);
    expect(postReports(v, 'k1').map((x) => x.id)).toEqual(['d1', 'd2']);
    const f = postReports(v, 's');
    expect(f.map((x) => [x.id, x.echelon, x.personnel])).toEqual([['f1', 'front', 24000]]);
  });
  it('разведка — противник ступенью ниже по штабам, в полосе пункта', () => {
    const army = postIntel(v, 'army', 'a1');
    expect(army.map((g) => [g.id, g.name, g.members.length])).toEqual([['k101', 'CI ак', 2]]);
    const stavka = postIntel(v, 'stavka', 's');
    expect(stavka.map((g) => [g.id, g.members.length])).toEqual([['hg', 3]]);
    expect(postIntel(v, 'corps', 'k1').map((g) => g.id)).toEqual(['e1', 'e2']);
  });
  it('документы — штаба и его подчинённых', () => {
    expect(postDocs(v, 'a1').map((d) => d.hq)).toEqual(['k1', 'a1']);
  });
});

describe('резервы пункта', () => {
  it('Ставка — все; фронт — его; армия — где её соединения', () => {
    const w = { ...(v as object), reserveGroups: [
      { id: 'r1', name: '3 гв. А', status: 'reserve', front: 'f1', members: ['d1'] },
      { id: 'r2', name: '28 А', status: 'arriving', front: 'f2', members: ['dz'] },
    ] } as never;
    expect(postReserves(w, 's').map((g) => g.id)).toEqual(['r1', 'r2']);
    expect(postReserves(w, 'f1').map((g) => g.id)).toEqual(['r1']);
    expect(postReserves(w, 'a1').map((g) => g.id)).toEqual(['r1']);
    expect(postReserves(w, 'a2').map((g) => g.id)).toEqual([]);
  });
});
