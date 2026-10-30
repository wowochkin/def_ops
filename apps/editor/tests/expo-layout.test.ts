import { describe, expect, it } from 'vitest';
import { EXPO_DEFAULTS, type Role } from '../src/expo/settings';
import { initialState, type Phase } from '../src/expo/director';
import { effectiveCount, layoutFor, panoramaPart, sceneOf, type Scene } from '../src/expo/layout';
import { memoryBus, type BusMsg } from '../src/expo/bus';

const ROLES: Role[] = ['ai', 'map', 'progress'];

describe('раскладки экранов', () => {
  it('layouts by count', () => {
    expect(layoutFor(3)).toEqual([
      { window: 0, roles: ['ai'] },
      { window: 1, roles: ['map'] },
      { window: 2, roles: ['progress'] },
    ]);
    expect(layoutFor(2)).toEqual([
      { window: 0, roles: ['map'] },
      { window: 1, roles: ['ai', 'progress'] },
    ]);
    expect(layoutFor(1)).toEqual([{ window: 0, roles: ['map', 'ai', 'progress'] }]);
    for (const n of [1, 2, 3] as const) {
      const all = layoutFor(n).flatMap((s) => s.roles);
      expect(all.length).toBe(ROLES.length);
      for (const r of ROLES) expect(all.filter((x) => x === r).length).toBe(1);
      expect(layoutFor(n).map((s) => s.window)).toEqual([...Array(n).keys()]);
    }
  });

  it('layout shrinks keeps phase', () => {
    expect(effectiveCount(3, 2)).toBe(2);
    expect(effectiveCount(3, 0)).toBe(1);
    expect(effectiveCount(2, 5)).toBe(2);
    expect(effectiveCount(1, 3)).toBe(1);
    expect(effectiveCount(3, 3)).toBe(3);

    const state = { ...initialState(0), phase: { kind: 'briefing' } as Phase };
    const [main, view] = memoryBus();
    const got: BusMsg[] = [];
    view.on((m) => got.push(m));
    main.send({ k: 'state', state, settings: EXPO_DEFAULTS, count: 3 });
    main.send({ k: 'state', state, settings: EXPO_DEFAULTS, count: effectiveCount(3, 2) });
    const states = got.filter((m): m is Extract<BusMsg, { k: 'state' }> => m.k === 'state');
    expect(states.map((m) => m.count)).toEqual([3, 2]);
    expect(states.map((m) => m.state.phase)).toEqual([{ kind: 'briefing' }, { kind: 'briefing' }]);
    expect(layoutFor(states[1].count)).toHaveLength(2);
  });

  it('scenes by phase', () => {
    const cases: [Phase, Scene][] = [
      [{ kind: 'startup' }, 'startup'],
      [{ kind: 'attract' }, 'panorama'],
      [{ kind: 'welcome' }, 'panorama'],
      [{ kind: 'briefing' }, 'map-wide'],
      [{ kind: 'turn', n: 1, step: 'choose', deadline: null, warned: false, offered: false, choice: null, replacements: 0 }, 'roles'],
      [{ kind: 'result' }, 'result-wide'],
    ];
    for (const [p, s] of cases) expect(sceneOf(p)).toBe(s);
  });

  it('panorama parts cover width', () => {
    for (const n of [1, 2, 3]) {
      const parts = [...Array(n).keys()].map((w) => panoramaPart(w, n));
      expect(parts[0].from).toBe(0);
      expect(parts[n - 1].to).toBe(1);
      for (let i = 1; i < n; i++) expect(parts[i].from).toBe(parts[i - 1].to);
      for (const p of parts) expect(p.to - p.from).toBeCloseTo(1 / n);
    }
  });

  it('memory bus delivers both ways', () => {
    const [a, b] = memoryBus();
    const atA: BusMsg[] = [];
    const atB: BusMsg[] = [];
    const offA = a.on((m) => atA.push(m));
    b.on((m) => atB.push(m));
    a.send({ k: 'input', ev: { t: 'touch' } });
    expect(atB).toEqual([{ k: 'input', ev: { t: 'touch' } }]);
    expect(atA).toEqual([]);
    b.send({ k: 'hello', window: 1 });
    expect(atA).toEqual([{ k: 'hello', window: 1 }]);
    offA();
    b.send({ k: 'beat', window: 1, at: 5 });
    expect(atA).toHaveLength(1);
    b.close();
    a.send({ k: 'input', ev: { t: 'next' } });
    expect(atB).toHaveLength(1);
  });
});
