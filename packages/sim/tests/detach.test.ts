import { describe, expect, it } from 'vitest';
import { loadContext } from '../src/data';
import { runScenario } from '../src/history';

describe('выделение корпуса и передового отряда из армии (detachFrom)', () => {
  const ctx = loadContext('vistula-oder-1945');
  const run = runScenario(ctx, 1);
  const at = (time: string, id: string) => run.snapshots.find((s) => s.time >= time)!.units.find((u) => u.id === id)!;

  it('в момент выделения корпус появляется у армии и забирает долю её сил', () => {
    const j = run.final.journal.find((x) => x.kind === 'detached' && x.formation === 'su_29gsk_vo');
    expect(j && j.kind === 'detached' && j.from).toBe('su_8gva_vo');
    const before = run.snapshots.filter((s) => s.time < j!.time).pop()!.units.find((u) => u.id === 'su_8gva_vo')!;
    const corps = run.final.formations.find((f) => f.id === 'su_29gsk_vo')!;
    expect(corps.initial.personnel / before.personnel).toBeGreaterThan(0.3);
    expect(corps.initial.personnel / before.personnel).toBeLessThan(0.36);
  });

  it('передовой отряд забирает заданные числа и идёт впереди армии к Одеру', () => {
    const j = run.final.journal.find((x) => x.kind === 'detached' && x.formation === 'su_5ua_apo_vo');
    expect(j && j.kind === 'detached' && [j.personnel, j.tanks, j.guns]).toEqual([2500, 65, 30]);
    // к 31.01 отряд западнее главных сил армии
    expect(at('1945-01-31T05:00', 'su_5ua_apo_vo').at[0]).toBeLessThan(at('1945-01-31T05:00', 'su_5ua_vo').at[0]);
  });

  it('до выделения корпуса на карте нет', () => {
    expect(run.snapshots[0].units.find((u) => u.id === 'su_29gsk_vo')).toBeUndefined();
    expect(run.final.journal.some((x) => x.kind === 'move' && x.formation === 'su_29gsk_vo' && x.time < '1945-01-25')).toBe(false);
  });
}, 120000);
