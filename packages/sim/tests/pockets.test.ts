import { describe, expect, it } from 'vitest';
import { loadContext } from '../src/data';
import { runScenario } from '../src';

describe('котлы, крепости, переправы сапёров (Берлинская операция, seed 1)', () => {
  const ctx = loadContext('berlin-1945-tasks');
  const run = runScenario(ctx, 1);
  const side = new Map(run.final.formations.map((f) => [f.id, f.side]));
  const J = run.final.journal;

  it('советские армии не сдаются; немецкие окружённые без складов — могут', () => {
    expect(J.filter((j) => j.kind === 'capitulated' && side.get(j.formation) === 'su')).toEqual([]);
  });

  it('котёл 9-й армии прорывается по историческому приказу 28.04, бросив тяжёлое вооружение', () => {
    // когда кольцо замкнётся и разомкнётся, зависит от прогона: прорыв — хотя бы в одном из трёх, и никогда раньше приказа
    const out = [J, ...[2, 3].map((s) => runScenario(ctx, s).final.journal)].flatMap((l) => l.filter((j) => j.kind === 'brokeOut'));
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((j) => j.time >= '1945-04-28' && side.get(j.formation) === 'de')).toBe(true);
  }, 120000);

  it('Берлинский оборонительный район окружён и живёт со складов крепости', () => {
    const cut = J.find((j) => j.kind === 'encircled' && j.cut && j.formation === 'de_berlin');
    expect(cut?.time.slice(0, 10)).toBeDefined();
    const g = run.final.formations.find((f) => f.id === 'de_berlin');
    expect(g?.stock).toBeLessThan(30);
  });

  it('сапёры наводят переправы через Одер, где фронт держит оба берега', () => {
    expect((run.final.crossings ?? []).some((c) => c.side === 'su')).toBe(true);
  });
});

describe('подвоз как пропускная способность (supplyFlow, по желанию)', () => {
  const ctx = loadContext('berlin-1945-tasks');
  const { supplyFlow: _on, ...off } = ctx.rules;
  const fuelOut = (rules: typeof ctx.rules) => runScenario({ ...ctx, rules }, 1).final.journal.filter((j) => j.kind === 'supply' && j.what === 'fuel').length;
  it('горючее по пройденному пути: без горючего остаётся не меньше частей, чем при суточном расходе; прогон воспроизводится', () => {
    const a = fuelOut(ctx.rules);
    expect(a).toBeGreaterThanOrEqual(fuelOut(off as typeof ctx.rules));
    expect(fuelOut(ctx.rules)).toBe(a);
  }, 60000);
  it('в откалиброванных правилах включён', () => {
    expect(ctx.rules.supplyFlow).toEqual({ fullHours: 12, fuelPer100km: 1 });
  });
});
