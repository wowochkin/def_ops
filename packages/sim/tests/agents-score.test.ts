import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../src/data';
import { contextFrom } from '../src/source';
import { agentsHistory, agentsToRun, type AgentHistory, type AgentTrace } from '../src/agents';
import { agentsEvents, agentsScore, SCORE_STEP_HOURS } from '../src/agents-score';
import type { History, StrengthCheckpoint } from '../src/history';

const get = (kind: string, file: string) => {
  const id = file.replace(/\.json$/, '');
  if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
  if (kind === 'theatres') return loadTheatre(id);
  if (kind === 'profiles') return loadProfile(id);
  return loadRules(id);
};

/** Ход на 12 ч из двух дивизий: численность известна по часам. */
function trace(): AgentTrace {
  const row = (lng: number, pers: number) => [lng, 52.5, 'оборона: подготовленная', pers, 10, 50, 2, 1, 0.1, 0.9, 0];
  const frames = Array.from({ length: 13 }, (_, h) => [row(14.6, 9000 - h * 100), row(14.3, 6000 - h * 50)]);
  return {
    scenario: 'test', name: 'проба', start: '1945-04-16T05:00', hours: 12, seed: 3,
    fields: ['lng', 'lat', 'state', 'personnel', 'tanks', 'guns', 'ammo', 'fuel', 'fatigue', 'cohesion', 'encircled'],
    divisions: [
      { id: 'su_x', name: '1-я стрелковая дивизия', side: 'su', hq: 'su_8gva', kind: 'sd', mobility: 'foot', size: 'rifle', quality: 1 },
      { id: 'de_y', name: '9-я парашютная дивизия', side: 'de', hq: 'de_9a', kind: 'div', mobility: 'foot', size: 'inf', quality: 1 },
    ],
    hqs: [
      { id: 'su_1bf', name: '1-й Белорусский фронт', side: 'su', echelon: 'front', parent: null },
      { id: 'su_8gva', name: '8-я гвардейская армия', side: 'su', echelon: 'army', parent: 'su_1bf' },
      { id: 'de_9a', name: '9-я армия', side: 'de', echelon: 'army', parent: null },
    ],
    frames, journal: [],
  };
}

describe('оценка агентной модели: контрольные точки численности', () => {
  it('agentsHistory переносит контрольные точки базовой истории', async () => {
    const { history } = await contextFrom(get, 'berlin-1945-tasks');
    const cps: StrengthCheckpoint[] = [{ at: '1945-04-16T11:00', formation: 'su_x', kind: 'strength', personnel: 100 }];
    expect(agentsHistory({ divisions: [], events: [] }, { ...history!, checkpoints: cps }).checkpoints).toEqual(cps);
  });

  it('10 точек на документе — strength.within = 1; удвоенные точки снижают итог', async () => {
    const { ctx: base, history } = await contextFrom(get, 'berlin-1945-tasks');
    const tr = trace();
    const { run } = agentsToRun(base, tr, 6);
    const at = (t: string, id: string) => run.snapshots.find((s) => s.time >= t)!.units.find((u) => u.id === id)!.personnel;
    const times = ['1945-04-16T08:00', '1945-04-16T09:00', '1945-04-16T10:00', '1945-04-16T11:00', '1945-04-16T17:00'];
    const exact: StrengthCheckpoint[] = times.flatMap((t) => ['su_x', 'de_y'].map((id): StrengthCheckpoint => ({ at: t, formation: id, kind: 'strength', personnel: at(t, id) })));
    expect(exact).toHaveLength(10);
    const doubled = exact.map((c) => ({ ...c, personnel: c.personnel! * 2 })) as StrengthCheckpoint[];
    const withCp = (cps: StrengthCheckpoint[]): History => ({ ...history!, checkpoints: cps });
    const hist = { divisions: [{ formation: 'su_x', time: '1945-04-16T11:00', at: [14.6, 52.5] as [number, number], approxKm: 3, reliability: 'B', set: 'x' }], events: [] };

    const none = agentsScore(base, tr, hist, history, 10, 6);
    expect(none.strength).toBeUndefined();
    const good = agentsScore(base, tr, hist, withCp(exact), 10, 6);
    const bad = agentsScore(base, tr, hist, withCp(doubled), 10, 6);
    expect(good.strength).toEqual({ n: 10, within: 1 });
    expect(bad.strength).toEqual({ n: 10, within: 0 });
    expect(good.score).toBeGreaterThan(bad.score);
  });

  it('меньше 10 точек — strength показывается, но в score не входит', async () => {
    const { ctx: base, history } = await contextFrom(get, 'berlin-1945-tasks');
    const tr = trace();
    const hist = { divisions: [], events: [] };
    const cps: StrengthCheckpoint[] = [{ at: '1945-04-16T17:00', formation: 'su_x', kind: 'strength', personnel: 1 }];
    const a = agentsScore(base, tr, hist, history, 10, 6);
    const b = agentsScore(base, tr, hist, { ...history!, checkpoints: cps }, 10, 6);
    expect(b.strength).toMatchObject({ n: 1, within: 0 });
    expect(b.score).toBe(a.score);
  });
});

describe('агентная модель на карте: верхние инстанции', () => {
  it('Ставка и верховное командование не становятся «армией»; фронт — без старшего, как прежде', async () => {
    const { ctx: base } = await contextFrom(get, 'berlin-1945-tasks');
    const t = trace();
    t.hqs = [
      { id: 'su_stavka', name: 'Ставка ВГК', side: 'su', echelon: 'high_command', parent: null },
      { id: 'su_1bf', name: '1-й Белорусский фронт', side: 'su', echelon: 'front', parent: 'su_stavka' },
      { id: 'su_8gva', name: '8-я гвардейская армия', side: 'su', echelon: 'army', parent: 'su_1bf' },
      { id: 'de_hc', name: 'ОКХ', side: 'de', echelon: 'high_command', parent: null },
      { id: 'de_9a', name: '9-я армия', side: 'de', echelon: 'army', parent: 'de_hc' },
    ];
    const { ctx } = agentsToRun(base, t, 6);
    const f = new Map(ctx.scenario.formations.map((x) => [x.id, x]));
    expect(f.has('su_stavka')).toBe(false);
    expect(f.has('de_hc')).toBe(false);
    expect(f.get('su_1bf')?.parent ?? null).toBe(null);
    expect(f.get('de_9a')?.parent ?? null).toBe(null);
    expect(f.get('su_8gva')?.parent).toBe('su_1bf');
  });
});

describe('события операции: одно определение на мерило и сравнение', () => {
  it('agentsScore events = agentsEvents', async () => {
    const { ctx: base, history } = await contextFrom(get, 'berlin-1945-tasks');
    const tr = trace();
    const c = base.theatre.area('Muencheberg')!.center!;
    // su_x у Мюнхеберга с часа 6
    tr.frames = tr.frames.map((f, h) => h >= 6 ? [[c[0], c[1], ...f[0].slice(2)], f[1]] : f);
    const hist = { divisions: [], events: (JSON.parse(readFileSync(join(__dirname, '../data/scenarios/agents/berlin-1945.history.json'), 'utf8')) as AgentHistory).events };
    const ev = agentsEvents(base, tr, hist, history);
    const sc = agentsScore(base, tr, hist, history, 10, SCORE_STEP_HOURS);
    expect(SCORE_STEP_HOURS).toBe(6);
    expect(ev.length).toBeGreaterThan(0);
    expect(sc.events.map((e) => [e.id, e.days])).toEqual(ev.map((e) => [e.id, e.days]));
    expect(ev.find((e) => e.id === 'seelow')?.simulated).not.toBeNull();
  });
});
