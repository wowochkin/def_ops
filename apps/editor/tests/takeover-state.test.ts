import { describe, expect, it } from 'vitest';
import { pinKey, type Claim, type Entry } from '@def-ops/knowledge';
import { parentsAt, takeoverText, takeoverState, toCoreTakeover } from '../src/sim/takeover-state';

const moment = '1945-04-17T12:00';
const entry = (id: string, claims: [Claim, 'A' | 'B' | 'C'][], updatedAt = '2026-01-01'): Entry => ({
  id, category: 'formations', title: id, summary: '', status: 'checked', updatedAt,
  facts: claims.map(([claim, reliability]) => ({ key: claim.kind, value: '', reliability, claim })),
});
const ids = [{ id: 'su_8ga', echelon: 'army' }, { id: 'su_d1', echelon: 'division' }, { id: 'su_c1', echelon: 'corps' }];

describe('takeoverState: состояние при передаче командования по фактам', () => {
  it('численность старше суток не берётся; в пределах суток — берётся; дата без времени — к исходу дня', () => {
    // 15.04 без времени — конец дня 15.04 (16.04 00:00): 36 ч до момента — старше суток
    const r = takeoverState([entry('e1', [[{ kind: 'strength', subject: 'su_8ga', at: '1945-04-15', personnel: 50000 }, 'A']])], {}, ids, moment);
    expect(r.state.su_8ga).toBeUndefined();
    // 16.04 без времени — конец дня 16.04 (17.04 00:00): 12 ч до момента — берётся
    const r2 = takeoverState([entry('e1', [[{ kind: 'strength', subject: 'su_8ga', at: '1945-04-16', personnel: 50000, tanks: 100 }, 'B']])], {}, ids, moment);
    expect(r2.state.su_8ga).toEqual({ personnel: 50000, tanks: 100 });
    expect(r2.summary.strength).toBe(1);
    // 17.04 без времени — к исходу 17.04, позже момента 17.04 12:00 — не берётся
    const r3 = takeoverState([entry('e1', [[{ kind: 'strength', subject: 'su_8ga', at: '1945-04-17', personnel: 1 }, 'A']])], {}, ids, moment);
    expect(r3.state.su_8ga).toBeUndefined();
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
    const core = toCoreTakeover({ su_d1: { personnel: 9000, position: [14, 52], parent: 'su_c1' }, su_d2: { parent: 'nope' }, su_8ga: { personnel: 1 } },
      new Map([['su_d1', 'su_c2'], ['su_d2', 'su_c2']]), new Map([['su_c1', null], ['su_c2', null]]));
    expect(core).toEqual({ divisions: { su_d1: { personnel: 9000, pos: [14, 52], hq: 'su_c1' } } });
  });

  it('для ядра: штаб выше нынешнего (фронт над армией) — не поправка', () => {
    // кавалерийская дивизия у 33 А; факт — у 1 БФ, фронта над 33 А
    const hqs = new Map<string, string | null>([['su_33a', 'su_1bf'], ['su_69a', 'su_1bf'], ['su_1bf', null]]);
    const core = toCoreTakeover({ su_3gkd: { parent: 'su_1bf', personnel: 4000 }, su_x: { parent: 'su_69a' } }, new Map([['su_3gkd', 'su_33a'], ['su_x', 'su_33a']]), hqs);
    expect(core).toEqual({ divisions: { su_3gkd: { personnel: 4000 }, su_x: { hq: 'su_69a' } } });
  });

  it('подчинённость: та же, что сейчас, — не поправка и не считается', () => {
    const fs = [entry('e1', [[{ kind: 'parent', subject: 'su_d1', from: '1945-04-01', parent: 'su_c1' }, 'A']])];
    const r = takeoverState(fs, {}, [{ id: 'su_d1', echelon: 'division', parent: 'su_c1' }], moment);
    expect(r.state).toEqual({});
    expect(r.summary).toMatchObject({ parent: 0, corrected: 0, assumed: 1 });
    const r2 = takeoverState(fs, {}, [{ id: 'su_d1', echelon: 'division', parent: 'su_c9' }], moment);
    expect(r2.state).toEqual({ su_d1: { parent: 'su_c1' } });
    expect(r2.summary.parent).toBe(1);
  });

  it('подчинённость: старший над нынешним штабом — не поправка', () => {
    const fs = [entry('e1', [[{ kind: 'parent', subject: 'su_d1', from: '1945-04-01', parent: 'su_f' }, 'A']])];
    const hqs = new Map<string, string | null>([['su_c1', 'su_a'], ['su_a', 'su_f'], ['su_f', null]]);
    const r = takeoverState(fs, {}, [{ id: 'su_d1', echelon: 'division', parent: 'su_c1' }], moment, hqs);
    expect(r.state).toEqual({});
    expect(r.summary.parent).toBe(0);
  });

  it('численность и положение, совпадающие с нынешними, — не поправка', () => {
    const fs = [entry('e1', [
      [{ kind: 'strength', subject: 'su_d1', at: '1945-04-17T06:00', personnel: 9000, tanks: 10 }, 'A'],
      [{ kind: 'position', subject: 'su_d1', at: '1945-04-17T06:00', lngLat: [14.6, 52.4], uncertaintyKm: 4 }, 'B'],
    ])];
    const same = takeoverState(fs, {}, [{ id: 'su_d1', echelon: 'division', personnel: 9000, tanks: 10, position: [14.6, 52.4] }], moment);
    expect(same.state).toEqual({});
    expect(same.summary).toMatchObject({ strength: 0, position: 0, corrected: 0 });
    const part = takeoverState(fs, {}, [{ id: 'su_d1', echelon: 'division', personnel: 9000, tanks: 12 }], moment);
    expect(part.state).toEqual({ su_d1: { tanks: 10, position: [14.6, 52.4] } });
    expect(part.summary).toMatchObject({ strength: 1, position: 1, corrected: 1 });
  });

  it('нынешняя подчинённость на момент: исходная и переподчинения не позже момента', () => {
    const p = parentsAt(new Map([['d1', 'a1'], ['d2', 'a1']]), [
      { at: '1945-04-17', formation: 'd1', kind: 'resubordinate', parent: 'a2' },
      { at: '1945-04-18', formation: 'd2', kind: 'resubordinate', parent: 'a3' },
      { at: '1945-04-17', formation: 'd2', kind: 'reinforce', personnel: 1 },
    ], moment);
    expect(Object.fromEntries(p)).toEqual({ d1: 'a2', d2: 'a1' });
  });

  it('текст сводки', () => {
    expect(takeoverText({ strength: 2, position: 1, parent: 0, corrected: 3, assumed: 5 }))
      .toBe('по фактам поправлено соединений: 3 (численность 2, положение 1, подчинённость 0); на допущениях — 5');
  });
});
