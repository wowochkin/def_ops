import { describe, expect, it } from 'vitest';
import { loadContext } from '../src/data';
import { runScenario } from '../src/history';

describe('путь за ход в снимке', () => {
  const ctx = loadContext('berlin-1945-tasks');
  const run = runScenario(ctx, 1, 10);
  const T = ctx.theatre;
  const km = (a: [number, number], b: [number, number]) => { const p = T.proj.toXY(a), q = T.proj.toXY(b); return Math.hypot(p[0] - q[0], p[1] - q[1]); };

  it('начинается там, где соединение стояло утром, и кончается там, где стоит сейчас — только этот ход, без прошлых', () => {
    let checked = 0;
    for (let i = 1; i < run.snapshots.length; i++) {
      for (const u of run.snapshots[i].units) {
        const was = run.snapshots[i - 1].units.find((x) => x.id === u.id);
        if (!u.path || !was) continue;
        expect(km(u.path[0], was.at), `${u.id}, ${run.snapshots[i].time}`).toBeLessThan(1);
        expect(km(u.path[u.path.length - 1], u.at), `${u.id}, ${run.snapshots[i].time}`).toBeLessThan(1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('у соединения, не двигавшегося за ход, пути нет', () => {
    for (let i = 1; i < run.snapshots.length; i++) for (const u of run.snapshots[i].units) {
      const was = run.snapshots[i - 1].units.find((x) => x.id === u.id);
      if (was && was.at[0] === u.at[0] && was.at[1] === u.at[1]) expect(u.path, `${u.id}, ${run.snapshots[i].time}`).toBeUndefined();
    }
  });
}, 120000);
