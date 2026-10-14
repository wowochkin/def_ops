import { describe, expect, it } from 'vitest';
import { pinKey, type Claim, type Entry } from '@def-ops/knowledge';
import { takeoverText, takeoverState, toCoreTakeover } from '../src/sim/takeover-state';

const moment = '1945-04-17T12:00';
const entry = (id: string, claims: [Claim, 'A' | 'B' | 'C'][], updatedAt = '2026-01-01'): Entry => ({
  id, category: 'formations', title: id, summary: '', status: 'checked', updatedAt,
  facts: claims.map(([claim, reliability]) => ({ key: claim.kind, value: '', reliability, claim })),
});
const ids = [{ id: 'su_8ga', echelon: 'army' }, { id: 'su_d1', echelon: 'division' }, { id: 'su_c1', echelon: 'corps' }];

describe('takeoverState: состояние при передаче командования по фактам', () => {
  it('численность старше суток не берётся; в пределах суток — берётся', () => {
    const r = takeoverState([entry('e1', [[{ kind: 'strength', subject: 'su_8ga', at: '1945-04-16', personnel: 50000 }, 'A']])], {}, ids, moment);
    expect(r.state.su_8ga).toBeUndefined();
    const r2 = takeoverState([entry('e1', [[{ kind: 'strength', subject: 'su_8ga', at: '1945-04-17', personnel: 50000, tanks: 100 }, 'B']])], {}, ids, moment);
    expect(r2.state.su_8ga).toEqual({ personnel: 50000, tanks: 100 });
    expect(r2.summary.strength).toBe(1);
  });

  it('факт позже момента передачи не берётся', () => {
    const r = takeoverState([entry('e1', [[{ kind: 'strength', subject: 'su_8ga', at: '1945-04-18', personnel: 1 }, 'A']])], {}, ids, moment);
    expect(r.state.su_8ga).toBeUndefined();
  });

  it('положение: допуск по ступени — армия 20 км не берётся, дивизия 4 км берётся', () => {
    const r = takeoverState([entry('e1', [
      [{ kind: 'position', subject: 'su_8ga', at: '1945-04-17T06:00', lngLat: [14.5, 52.5], uncertaintyKm: 20 }, 'A'],
      [{ kind: 'position', subject: 'su_d1', at: '1945-04-17T06:00', lngLat: [14.6, 52.4], uncertaintyKm: 4 }, 'B'],
    ])], {}, ids, moment);
    expect(r.state.su_8ga).toBeUndefined();
    expect(r.state.su_d1).toEqual({ position: [14.6, 52.4] });
    expect(r.summary).toMatchObject({ strength: 0, position: 1, parent: 0, corrected: 1, assumed: 2 });
  });

  it('положение только с названием места (без координат) — не берётся, соединение на допущениях', () => {
    const r = takeoverState([entry('e1', [[{ kind: 'position', subject: 'su_d1', at: '1945-04-17', place: 'Зелов' }, 'A']])], {}, ids, moment);
    expect(r.state).toEqual({});
    expect(r.summary.assumed).toBe(3);
  });

  it('выбор: надёжность важнее близости; закрепление важнее надёжности', () => {
    const facts = entry('e1', [
      [{ kind: 'strength', subject: 'su_8ga', at: '1945-04-17T11:00', personnel: 1000 }, 'C'],
      [{ kind: 'strength', subject: 'su_8ga', at: '1945-04-17T00:00', personnel: 2000 }, 'A'],
    ]);
    expect(takeoverState([facts], {}, ids, moment).state.su_8ga.personnel).toBe(2000);
    const pins = { [pinKey('strength', 'su_8ga', moment)]: { entry: 'e1', index: 0 } };
    expect(takeoverState([facts], pins, ids, moment).state.su_8ga.personnel).toBe(1000);
    expect(takeoverState([facts], { [pinKey('strength', 'su_8ga', moment)]: 'none' }, ids, moment).state.su_8ga).toBeUndefined();
  });

  it('подчинённость — последнее действующее на момент', () => {
    const r = takeoverState([entry('e1', [
      [{ kind: 'parent', subject: 'su_d1', from: '1945-04-01', parent: 'su_c1' }, 'A'],
      [{ kind: 'parent', subject: 'su_d1', from: '1945-04-15', parent: 'su_c2' }, 'A'],
      [{ kind: 'parent', subject: 'su_d1', from: '1945-04-20', parent: 'su_c3' }, 'A'],
    ])], {}, ids, moment);
    expect(r.state.su_d1).toEqual({ parent: 'su_c2' });
    expect(r.summary).toMatchObject({ parent: 1, corrected: 1, assumed: 2 });
  });

  it('для ядра: только дивизии, parent → hq (если такой штаб есть)', () => {
    const core = toCoreTakeover({ su_d1: { personnel: 9000, position: [14, 52], parent: 'su_c1' }, su_d2: { parent: 'nope' }, su_8ga: { personnel: 1 } }, new Set(['su_d1', 'su_d2']), new Set(['su_c1']));
    expect(core).toEqual({ divisions: { su_d1: { personnel: 9000, pos: [14, 52], hq: 'su_c1' } } });
  });

  it('текст сводки', () => {
    expect(takeoverText({ strength: 2, position: 1, parent: 0, corrected: 3, assumed: 5 }))
      .toBe('по фактам поправлено 3 соединений (численность 2, положение 1, подчинённость 0); на допущениях — 5');
  });
});
