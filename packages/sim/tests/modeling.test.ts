import { describe, expect, it } from 'vitest';
import { loadContext, loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../src/data';
import { baseParams, Calibrator, CALIB_KEYS, calibratedRules, rulesWith, scoreRules } from '../src/calibrate';
import { describeProfile, describeRules, diffRules, rulesOrigin } from '../src/describe';
import { defaultCatalog, defaultLive, detectPart, validateOperation } from '../src/operation';

const known = { rules: ['ww2-draft', 'ww2-berlin-cal', 'ww2-berlin-city', 'ww2-berlin-city-cal', 'ww2-berlin-terr'], profiles: ['rkka-1945', 'wehrmacht-1945'] };

describe('моделирование: описание, сравнение, калибровка, подготовка операции', () => {
  it('правила и профили словами; разница наборов; откуда калибровка', () => {
    const cal = loadRules('ww2-berlin-cal'), draft = loadRules('ww2-draft');
    const rows = describeRules(cal);
    expect(rows.find((r) => r.key === 'advance3')?.value).toMatch(/км\/сут/);
    expect(diffRules(draft, cal).length).toBeGreaterThan(3);
    expect(rulesOrigin(cal).calibration?.scenario).toBe('berlin-1945-tasks');
    expect(describeProfile(loadProfile('rkka-1945')).find((r) => r.key === 'delay')?.value).toMatch(/армия — \d+ ч/);
  });

  it('множители 1 не меняют правила; подбор выдаёт кандидатов в границах и запоминает лучший', () => {
    const ctx = loadContext('berlin-city-1945');
    const p0 = baseParams(ctx.rules);
    expect(rulesWith(ctx.rules, p0).advance).toEqual(ctx.rules.advance);
    const c = new Calibrator(p0, 6);
    const batch = c.next(4);
    expect(batch.length).toBe(4);
    expect(c.next(10).length).toBe(2);
    expect(c.done).toBe(true);
    const s = scoreRules(ctx, rulesWith(ctx.rules, batch[0]), loadHistory('berlin-city-1945'), { seeds: 1 });
    expect(s.total).toBeGreaterThan(0);
    expect(c.report(batch[0], s)).toBe(true);
    const r = calibratedRules(ctx.rules, batch[0], { id: 'my-cal', scenario: 'berlin-city-1945', evals: 6, seeds: 1, trainUntil: '1945-04-28T23:59', before: s, after: s });
    expect(r.id).toBe('my-cal');
    expect(Object.keys((r.calibration as { multipliers: object }).multipliers)).toEqual(CALIB_KEYS);
  }, 60000);

  it('пакеты существующих операций проходят проверку без ошибок; части пакета узнаются по полям', () => {
    for (const id of ['berlin-1945-tasks', 'berlin-city-1945', 'vistula-oder-1945']) {
      const scenario = loadScenario(id);
      const pkg = { scenario, theatre: loadTheatre(scenario.theatre), history: loadHistory(id) };
      const errors = validateOperation(pkg, known).filter((i) => i.level === 'error');
      expect(errors, id).toEqual([]);
      expect(detectPart(pkg.scenario)).toBe('scenario');
      expect(detectPart(pkg.theatre)).toBe('theatre');
      expect(detectPart(pkg.history)).toBe('history');
      const cat = defaultCatalog(pkg);
      expect(cat.game?.victory.event).toBeTruthy();
      expect(defaultLive(pkg).anchor).toBeTruthy();
    }
  });

  it('ошибки пакета: чужой театр, неизвестные правила, событие у несуществующего района', () => {
    const scenario = loadScenario('berlin-city-1945');
    const history = loadHistory('berlin-city-1945');
    const bad = validateOperation({ scenario: { ...scenario, rules: 'nope', theatre: 'other' }, theatre: loadTheatre(scenario.theatre),
      history: { ...history, events: [{ id: 'x', title: 'X', date: '1945-04-30', kind: 'reach', side: 'su', place: 'NOWHERE', radiusKm: 1 }] } }, known);
    const t = bad.filter((i) => i.level === 'error').map((i) => i.text).join('\n');
    expect(t).toMatch(/правила «nope»/);
    expect(t).toMatch(/театр «other»/);
    expect(t).toMatch(/NOWHERE/);
  });
});
