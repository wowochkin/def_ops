import { describe, expect, it } from 'vitest';
import { loadContext } from '../src/data';
import { applyTakeoverState, startGame } from '../src';

describe('startGame: состояние соединений при передаче командования (по фактам)', () => {
  const ctx = loadContext('berlin-1945-tasks');
  const takeover = '1945-04-19T05:00';

  it('численность и положение — из переданного состояния; подчинение — только существующему штабу', () => {
    const base = startGame(ctx, 1, takeover, 'su');
    const f = base.state.formations.find((x) => x.id === 'su_8gva')!;
    const other = base.state.formations.find((x) => x.side === 'su' && x.echelon === 'army' && x.id !== f.id && x.parent)!;
    const g = startGame(ctx, 1, takeover, 'su', undefined, {
      su_8gva: { personnel: 51234, tanks: 77, position: [14.55, 52.55] },
      [other.id]: { parent: 'нет_такого' },
      нет_такого: { personnel: 1 },
    });
    const h = g.state.formations.find((x) => x.id === 'su_8gva')!;
    expect(h.personnel).toBe(51234);
    expect(h.tanks).toBe(77);
    expect(h.guns).toBe(f.guns);
    expect(h.position).toEqual([14.55, 52.55]);
    expect(g.state.formations.find((x) => x.id === other.id)!.parent).toBe(other.parent);
    expect(g.state.time).toBe(base.state.time);
    expect(g.snapshots.at(-1)!.units.find((u) => u.id === 'su_8gva')!.at).toEqual([14.55, 52.55]);
    const target = base.state.formations.find((x) => x.side === 'su' && x.id !== other.id && x.id !== other.parent)!;
    expect(startGame(ctx, 1, takeover, 'su', undefined, { [other.id]: { parent: target.id } }).state.formations.find((x) => x.id === other.id)!.parent).toBe(target.id);
  }, 60000);

  it('уничтоженному соединению численность и положение не ставятся', () => {
    const base = startGame(ctx, 1, takeover, 'su');
    const f = base.state.formations.find((x) => x.id === 'su_8gva')!;
    const s = { ...base.state, formations: base.state.formations.map((x) => (x.id === f.id ? { ...x, destroyed: true, personnel: 0 } : x)) };
    const r = applyTakeoverState(s, { su_8gva: { personnel: 51234, tanks: 77, position: [14.55, 52.55] } });
    const h = r.formations.find((x) => x.id === 'su_8gva')!;
    expect(h.personnel).toBe(0);
    expect(h.tanks).toBe(f.tanks);
    expect(h.position).toEqual(f.position);
  }, 60000);
});
