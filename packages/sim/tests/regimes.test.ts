import { describe, expect, it } from 'vitest';
import { loadContext, loadHistory } from '../src/data';
import { runScenario } from '../src/history';
import { regimeDeviations } from '../src/regimes';
import { COMBAT_REGIMES, REGIMES } from '../src/types';

describe('режимы боевых действий в одном движке (rules.regimes)', () => {
  const ctx = loadContext('berlin-1945-tasks');
  const until = (rules: typeof ctx.rules) => runScenario({ ...ctx, rules }, 1, 4);

  it('бой и движение помечены режимом; записи истории раскладываются по режимам', () => {
    const run = until({ ...ctx.rules, regimes: ctx.rules.regimes ?? {} });
    const J = run.final.journal;
    const combat = J.filter((j) => j.kind === 'combat');
    expect(combat.length).toBeGreaterThan(0);
    for (const j of combat) expect(COMBAT_REGIMES).toContain(j.kind === 'combat' && j.regime);
    expect(J.some((j) => j.kind === 'move' && (j.regime === 'pursuitMobile' || j.regime === 'pursuitFoot'))).toBe(true);
    const devs = regimeDeviations({ ...ctx, rules: { ...ctx.rules, regimes: {} } }, run, loadHistory('berlin-1945-tasks'));
    expect(devs.length).toBeGreaterThan(0);
    for (const d of devs) expect([...REGIMES, 'stand']).toContain(d.regime);
  }, 60000);

  it('множитель режима действует только в своём режиме', () => {
    const km = (rules: typeof ctx.rules, regime: string) => until(rules).final.journal
      .filter((j) => j.kind === 'move' && j.regime === regime).reduce((a, j) => a + (j as { km: number }).km, 0);
    const base = { ...ctx.rules, regimes: {} };
    // преследование пешими быстрее — их путь вне боя длиннее, а путь подвижных соединений в первые ходы почти тот же
    expect(km({ ...base, regimes: { pursuitFoot: { speed: 1.5 } } }, 'pursuitFoot')).toBeGreaterThan(km(base, 'pursuitFoot'));
    // темп боя в полосе ниже — продвижение в боях в полосе меньше, бой на открытой местности в первые ходы не затронут
    const adv = (rules: typeof ctx.rules) => until(rules).final.journal.filter((j) => j.kind === 'combat' && j.regime === 'belt').reduce((a, j) => a + (j as { advanceKm: number }).advanceKm, 0);
    expect(adv({ ...base, regimes: { belt: { advance: 0.5 } } })).toBeLessThan(adv(base));
  }, 120000);
});
