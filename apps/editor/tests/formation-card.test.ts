import { describe, expect, it } from 'vitest';
import type { AgentTrace } from '@def-ops/sim';
import { agentHqCard, formationCard, parentsAt, snapshotAt, type ReplayUnits } from '../src/formation-card';

// фронт (штаб) → армии A1 (действующая) и A2 (штаб) → корпус K1 (действующий, в A2); 19.04 K1 переподчинён A1
const data: ReplayUnits = {
  sides: [{ id: 'su', name: 'Красная армия' }, { id: 'de', name: 'Вермахт' }],
  formations: [
    { id: 'F', name: '1-й Белорусский фронт', side: 'su', echelon: 'front', parent: null, acting: false, initial: { personnel: 0, tanks: 0 } },
    { id: 'A1', name: '8-я гвардейская армия', side: 'su', echelon: 'army', parent: 'F', acting: true, initial: { personnel: 80000, tanks: 200 } },
    { id: 'A2', name: '1-я гвардейская танковая армия', side: 'su', echelon: 'army', parent: 'F', acting: false, initial: { personnel: 0, tanks: 0 } },
    // 30 000 — с пополнением 5 000 и 20 танков 18.04
    { id: 'K1', name: '11-й гвардейский танковый корпус', side: 'su', echelon: 'corps', parent: 'A2', acting: true, initial: { personnel: 30000, tanks: 220 } },
    { id: 'R', name: '3-я ударная армия', side: 'su', echelon: 'army', parent: 'F', acting: true, initial: { personnel: 60000, tanks: 100 } },
    { id: 'E', name: '9-я армия', side: 'de', echelon: 'army', parent: null, acting: true, initial: { personnel: 50000, tanks: 300 } },
  ],
  changes: [
    { time: '1945-04-18T06:00', formation: 'K1', personnel: 5000, tanks: 20 },
    { time: '1945-04-19T06:00', formation: 'K1', to: 'A1' },
  ],
  snapshots: [
    { time: '1945-04-17T06:00', units: [['A1', 80000, 200, 'attack', 0, 0, 2], ['K1', 25000, 200, 'march', 0, 0, 2], ['E', 50000, 300, 'defend', 0, 0, 2]] },
    { time: '1945-04-19T06:00', units: [['A1', 60000, 150, 'attack', 0, 1, 1], ['K1', 27000, 180, 'attack', 0, 0, 1.5], ['E', 30000, 100, 'withdraw', 0, 0, 1]] },
    { time: '1945-04-20T06:00', units: [['A1', 55000, 120, 'attack', 0, 1, 0.5], ['K1', 26000, 170, 'attack', 0, 0, 1], ['E', 0, 0, 'withdraw', 1, 0, 0], ['R', 60000, 100, 'march', 0, 0, 2]] },
  ],
};

describe('formationCard: карточка соединения нынешней модели', () => {
  it('снимок на момент — последний не позже момента; вышестоящий — с переподчинениями, вступившими до снимка', () => {
    expect(snapshotAt(data, '1945-04-19T12:00')!.time).toBe('1945-04-19T06:00');
    expect(snapshotAt(data, '1945-04-16T00:00')!.time).toBe('1945-04-17T06:00');
    // журнал хода 19.04 06:00 отражён в снимке после него
    expect(parentsAt(data, '1945-04-19T06:00').get('K1')).toBe('A2');
    expect(parentsAt(data, '1945-04-20T06:00').get('K1')).toBe('A1');
    expect(formationCard(data, 'K1', '1945-04-19T08:00')!.parent).toEqual({ id: 'A2', name: '1-я гвардейская танковая армия' });
    expect(formationCard(data, 'K1', '1945-04-20T08:00')!.parent).toEqual({ id: 'A1', name: '8-я гвардейская армия' });
  });

  it('действующее соединение: силы, доля от исходных на момент (без будущих пополнений), положение, отрезано, боеприпасы', () => {
    const c0 = formationCard(data, 'K1', '1945-04-17T06:00')!;
    // пополнение 18.04 ещё не пришло: исходные 25 000 и 200
    expect(c0.initial).toEqual({ personnel: 25000, tanks: 200 });
    expect(c0.share.personnel).toBe(1);
    expect(c0.posture).toBe('на марше');
    const c = formationCard(data, 'A1', '1945-04-19T06:00')!;
    expect(c).toMatchObject({ name: '8-я гвардейская армия', sideName: 'Красная армия', echelon: 'армия', status: 'active', personnel: 60000, tanks: 150, posture: 'наступает', ammo: 1, hq: false, cutOff: { n: 1, of: 1 } });
    expect(c.share.personnel).toBeCloseTo(0.75);
    expect(c.share.tanks).toBeCloseTo(0.75);
  });

  it('штаб — сумма действующих подчинённых; подчинённые списком (по ступени, введённые раньше, по названию); не введённое и уничтоженное', () => {
    const f = formationCard(data, 'F', '1945-04-19T06:00')!;
    expect(f).toMatchObject({ hq: true, personnel: 87000, tanks: 330, members: 2, cutOff: { n: 1, of: 2 }, posture: 'наступает' });
    // 3-я ударная ещё не введена: ни в силах, ни в исходных
    expect(f.initial).toEqual({ personnel: 110000, tanks: 420 });
    expect(f.children.map((k) => [k.id, k.state])).toEqual([['A2', 'наступает'], ['A1', 'наступает'], ['R', 'не введено']]);
    expect(f.children.find((k) => k.id === 'A2')).toMatchObject({ hq: true, personnel: 27000, out: false });
    // после переподчинения корпуса у танковой армии нет войск — в подчинённых фронта её нет, а корпус — у 8 гв. А
    const f2 = formationCard(data, 'F', '1945-04-20T06:00')!;
    expect(f2.children.map((k) => k.id)).toEqual(['R', 'A1']);
    expect(formationCard(data, 'A1', '1945-04-20T06:00')!.children.map((k) => k.id)).toEqual(['K1']);
    const e = formationCard(data, 'E', '1945-04-20T06:00')!;
    expect(e).toMatchObject({ status: 'destroyed', posture: null, sideName: 'Вермахт' });
    expect(formationCard(data, 'R', '1945-04-17T06:00')).toMatchObject({ status: 'pending', initial: { personnel: 60000, tanks: 100 } });
    expect(formationCard(data, 'нет', '1945-04-17T06:00')).toBeNull();
  });
});

describe('agentHqCard: карточка штаба агентной модели', () => {
  const row = (state: string, p: number, t: number, ammo = 1, pocket = 0) => [14, 52, state, p, t, 0, ammo, 1, 0, 1, pocket];
  const trace = {
    scenario: 's', name: 's', start: '1945-04-16T03:00', hours: 1, seed: 1, fields: [],
    hqs: [{ id: 'A', name: '8 гв. А', side: 'su', echelon: 'army', parent: null }, { id: 'K', name: '4 гв. ск', side: 'su', echelon: 'corps', parent: 'A' }],
    divisions: [
      { id: 'd1', name: '35 гв. сд', side: 'su', hq: 'K', kind: 'rifle', mobility: '', size: '', quality: 1 },
      { id: 'd2', name: '47 гв. сд', side: 'su', hq: 'K', kind: 'rifle', mobility: '', size: '', quality: 1 },
      { id: 'd3', name: '82 гв. сд', side: 'su', hq: 'A', kind: 'rifle', mobility: '', size: '', quality: 1 },
    ],
    frames: [
      [row('оборона: подготовленная', 7000, 10), row('оборона: подготовленная', 6000, 0), row('не введена в операцию', 6500, 0)],
      [row('наступление: атака', 6000, 8, 0.5, 2), row('наступление: атака', 5000, 0, 1), row('не введена в операцию', 6500, 0)],
    ],
    journal: [],
  } as unknown as AgentTrace;

  it('дивизии штаба вниз по штабам: сумма введённых, доля от них же на начало, положение и подчинённые', () => {
    const c = agentHqCard(trace, 'A', 1)!;
    expect(c).toMatchObject({ name: '8 гв. А', echelon: 'армия', hq: true, personnel: 11000, tanks: 8, initial: { personnel: 13000, tanks: 10 }, posture: 'наступает', cutOff: { n: 1, of: 2 }, time: '1945-04-16T04:00' });
    expect(c.share.personnel).toBeCloseTo(11000 / 13000);
    expect(c.children.map((k) => [k.id, k.hq, k.out])).toEqual([['K', true, false], ['d3', false, true]]);
    expect(agentHqCard(trace, 'K', 0)).toMatchObject({ parent: { id: 'A', name: '8 гв. А' }, posture: 'обороняется' });
    expect(agentHqCard(trace, 'нет', 0)).toBeNull();
  });
});
