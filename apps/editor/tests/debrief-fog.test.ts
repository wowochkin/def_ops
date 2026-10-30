// Туман разбора хода в игре: видимость берётся по снимку игры, построенному из хода ядра, — по тем же id дивизий, что
// у хода ядра (turnEvents спрашивает seen(id дивизии ядра)).
import { describe, expect, it } from 'vitest';
import { contextFrom, LOSS_FIELDS, type AgentTrace } from '@def-ops/sim';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../../../packages/sim/src/data';
import { agentGame, fogOf } from '../src/sim/agents-game';
import { replayDebriefAt, replayWindows } from '../src/sim/replay-debrief';

const get = (kind: string, file: string) => {
  const id = file.replace(/\.json$/, '');
  if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
  if (kind === 'theatres') return loadTheatre(id);
  if (kind === 'profiles') return loadProfile(id);
  return loadRules(id);
};
const FIELDS = ['lng', 'lat', 'state', 'personnel', 'tanks', 'guns', 'ammo', 'fuel', 'fatigue', 'cohesion', 'encircled', ...LOSS_FIELDS];
const AT: Record<string, [number, number]> = { su_a: [14.6, 52.5], su_b: [14.6, 52.55], de_near: [14.55, 52.5], de_far: [13.3, 52.5] };
const trace = (): AgentTrace => ({
  scenario: 'test', name: 'проба', start: '1945-04-16T05:00', hours: 24, seed: 1, fields: FIELDS,
  divisions: Object.keys(AT).map((id) => ({ id, name: id, side: id.slice(0, 2), hq: id.startsWith('su') ? 'su_8gva' : 'de_9a', kind: 'sd', mobility: 'foot', size: 'rifle', quality: 1 })),
  hqs: [
    { id: 'su_stavka', name: 'Ставка ВГК', side: 'su', echelon: 'high_command', parent: null },
    { id: 'su_8gva', name: '8 гв. А', side: 'su', echelon: 'army', parent: 'su_stavka' },
    { id: 'de_9a', name: '9. Armee', side: 'de', echelon: 'army', parent: null },
  ],
  frames: Array.from({ length: 25 }, () => Object.values(AT).map((p) => [p[0], p[1], 'оборона: подготовленная', 8000, 10, 50, 2, 1, 0.1, 0.9, 0, ...LOSS_FIELDS.map(() => 0)])),
  journal: [],
});

describe('туман разбора хода — id хода ядра', () => {
  it('fog ids match core trace', async () => {
    const { ctx: base } = await contextFrom(get as never, 'berlin-1945-tasks');
    const t = trace();
    const { ctx, g } = agentGame(base, t, 12);
    const sn = g.snapshots[g.snapshots.length - 1];
    // снимок игры — на последний кадр хода ядра, его войска — дивизии ядра под теми же id
    expect(sn.units.map((u) => u.id)).toEqual(expect.arrayContaining(t.divisions.map((d) => d.id)));
    expect(sn.time.slice(0, 16)).toBe('1945-04-17T05:00');
    const seen = fogOf(ctx, g.state.formations, 'su');
    expect(seen('su_a', sn)).toBe(true);
    expect(seen('de_near', sn)).toBe(true);
    expect(seen('de_far', sn)).toBe(false);
    expect(fogOf(ctx, g.state.formations, 'de')('su_a', sn)).toBe(true);
  });

  it('replay windows by day', () => {
    expect(replayWindows(25)).toEqual([{ from: 0, to: 24 }]);
    expect(replayWindows(50)).toEqual([{ from: 0, to: 24 }, { from: 24, to: 48 }, { from: 48, to: 49 }]);
    const d = { terms: {} as never, turns: [{ time: '1945-04-17T05:00' }, { time: '1945-04-18T05:00' }] as never };
    expect(replayDebriefAt(d, '1945-04-16T10:00')).toBe(0);
    expect(replayDebriefAt(d, '1945-04-17T06:00')).toBe(1);
    expect(replayDebriefAt(d, '1945-04-20T06:00')).toBe(1);
    expect(replayDebriefAt(undefined, '1945-04-20T06:00')).toBe(-1);
  });
});
