import { describe, expect, it } from 'vitest';
import { loadContext, loadNorms, loadProfile, loadRules } from '../src/data';
import { baseParams, Calibrator, CALIB_KEYS } from '../src/calibrate';
import { CORRIDOR_TOL, measureParam } from '../src/norms';
import { corridorOf, RULE_INPUTS, ruleInput, toMultiplier, TOLERANCE } from '../src/rule-inputs';
import agentsV0 from '../data/rules/agents-v0.json';
import type { Rules } from '../src/types';

const profiles = { su: loadProfile('rkka-1945'), de: loadProfile('wehrmacht-1945') };
const near = (a: [number, number] | null, b: [number, number], d = 3) => {
  expect(a).not.toBeNull();
  expect(a![0]).toBeCloseTo(b[0], d);
  expect(a![1]).toBeCloseTo(b[1], d);
};

describe('перечень входов правил и пересчёт коридоров', () => {
  it('у каждого множителя калибровки есть вход; пути уникальны; значения читаются', () => {
    for (const k of CALIB_KEYS) expect(RULE_INPUTS.some((x) => x.calib === k), k).toBe(true);
    expect(new Set(RULE_INPUTS.map((x) => x.path)).size).toBe(RULE_INPUTS.length);
    expect(RULE_INPUTS.filter((x) => x.engine === 'army').length).toBeGreaterThanOrEqual(45);
    const r = loadRules('ww2-berlin-cal');
    for (const x of RULE_INPUTS.filter((i) => i.engine === 'army')) {
      const v = x.read(r, profiles);
      expect(v === null || Number.isFinite(v), x.path).toBe(true);
    }
    for (const x of RULE_INPUTS.filter((i) => i.engine === 'agents')) {
      expect(x.path.startsWith('agents.')).toBe(true);
      expect(Number.isFinite(x.read(r, profiles, agentsV0)), x.path).toBe(true);
      expect(x.read(r, profiles)).toBeNull();
    }
    expect(ruleInput('agents.combat.penetrationKmDay')?.read(r, profiles, agentsV0)).toBe(11.28);
    expect(ruleInput('defense.terrain.forest')?.read(r, profiles)).toBe(1.352);
    expect(ruleInput('нет.такого')).toBeUndefined();
    // профили можно передать и по id
    expect(ruleInput('orderDelay.army')?.read(r, { 'rkka-1945': profiles.su })).toBe(6);
  });

  it('пути нормативов-значений правил совпадают с входами и читаются как в отчёте нормативов', () => {
    const ctx = loadContext('berlin-1945-tasks', 'ww2-berlin-cal');
    const prof = { su: ctx.profiles['rkka-1945'], de: ctx.profiles['wehrmacht-1945'] };
    // commanders.* — допущения характера командующих (commanders.json), intent.* — пороги режима «История как замысел»,
    // establishment.* — штаты видов соединений (establishment.json, мерило докладов), agents.command.petitionMinShare —
    // порог рассмотрения ходатайства (правило игры, не калибруется): не входы перечня правил
    const meta = /^(strength|corridor|outcome|plausible|commanders|intent|agents\.intent|establishment)\.|^agents\.command\.petitionMinShare$/;
    for (const n of loadNorms().norms) {
      const m = n.measure;
      if (m.kind !== 'param' && m.kind !== 'assumption') continue;
      if (meta.test(m.expr)) continue;
      const path = m.expr.replace(/\/\d+$/, '').replace(/%$/, '');
      const scale = /\/(\d+)$/.exec(m.expr);
      const inp = ruleInput(path);
      expect(inp, n.id).toBeDefined();
      const v = inp!.read(ctx.rules, prof, agentsV0);
      const want = measureParam(ctx, m.expr, agentsV0);
      if (Number.isNaN(want)) expect(v, n.id).toBeNull();
      else expect(v! / (scale ? +scale[1] : 1), n.id).toBeCloseTo(want, 6);
    }
  });

  it('коридор по надёжности: значение и диапазон; допущение — без коридора', () => {
    expect(TOLERANCE).toBe(CORRIDOR_TOL);
    near(corridorOf({ value: 1.35 }, 'B'), [1.08, 1.62], 9);
    near(corridorOf({ range: [25, 45] }, 'C'), [16.25, 60.75], 9);
    near(corridorOf({ range: [45, 25] }, 'A'), [22.5, 49.5], 9);
    expect(corridorOf({ value: 1.35 }, undefined)).toBeNull();
    expect(corridorOf({}, 'A')).toBeNull();
  });

  it('пересчёт в множитель: прямой, через таблицу, показатель местности, марш', () => {
    const r = loadRules('ww2-draft'); // наибольший темп 30 км/сут, лес ×1,3
    expect(ruleInput('advanceMax')!.read(r, profiles)).toBe(30);
    near(toMultiplier('advance', [25, 45], r, profiles), [0.833, 1.5]);
    near(toMultiplier('prepared', [1.08, 1.62], r, profiles), [1.08, 1.62], 9);
    // потери: таблица при 3:1 — 1,5 %/сут
    near(toMultiplier('attackerLoss', [1.2, 3], r, profiles), [0.8, 2]);
    // местность: 1,3^e ∈ [1,3; 1,69] → e ∈ [1; 2]
    near(toMultiplier('terrainExp', [1.3, 1.69], r, profiles, 'defense.terrain.forest'), [1, 2]);
    near(toMultiplier('fortAdvance', [4, 12], r, profiles), [0.5, 1.5]);
    near(toMultiplier('movement', [15, 45], r, profiles, 'foot.road'), [0.5, 1.5]);
    near(toMultiplier('movement', [12.5, 25], r, profiles, 'foot.open'), [0.5, 1]);
  });

  it('нулевой знаменатель и ln 1 — без коридора, без NaN', () => {
    const r = loadRules('ww2-draft');
    // исходная поправка 1,0 (открытая местность): ln 1 = 0
    expect(toMultiplier('terrainExp', [0.9, 1.2], r, profiles, 'defense.terrain.open')).toBeNull();
    expect(toMultiplier('terrainExp', [0, 1.2], r, profiles, 'defense.terrain.forest')).toBeNull();
    const zero: Rules = { ...r, advance: [[1, 0], [10, 0]], attackerLoss: [[1, 0], [10, 0]], fortAdvanceKm: [99, 0, 0, 0] };
    expect(toMultiplier('advance', [25, 45], zero, profiles)).toBeNull();
    expect(toMultiplier('attackerLoss', [1, 2], zero, profiles)).toBeNull();
    expect(toMultiplier('fortAdvance', [4, 12], zero, profiles)).toBeNull();
    expect(toMultiplier('movement', [15, 45], r, {})).toBeNull();
  });

  it('калибратор с коридорами не выходит за них', () => {
    const r = loadRules('ww2-draft');
    const space = { advance: [0.8, 1.2] as [number, number], terrainExp: [1, 1.5] as [number, number] };
    const c = new Calibrator(baseParams(r), 60, 7, CALIB_KEYS, space);
    while (!c.done) {
      for (const p of c.next(5)) {
        expect(p.advance).toBeGreaterThanOrEqual(0.8); expect(p.advance).toBeLessThanOrEqual(1.2);
        expect(p.terrainExp).toBeGreaterThanOrEqual(1); expect(p.terrainExp).toBeLessThanOrEqual(1.5);
        // прочие множители — в прежних границах
        expect(p.prepared).toBeGreaterThanOrEqual(1.0); expect(p.prepared).toBeLessThanOrEqual(2.2);
        c.report(p, { total: Math.abs(p.advance - 1.1), train: 0, test: 0, within: 0, events: 0, detail: [] });
      }
    }
    expect(c.best!.p.advance).toBeGreaterThan(0.8);
  });
});
