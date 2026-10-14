import { describe, expect, it } from 'vitest';
import { loadContext } from '@def-ops/sim/data';
import { agentsStateAt, agentsToRun, NOT_COMMITTED, places, prepareTakeover, type AgentTrace } from '@def-ops/sim';
import { actionsToStaff, rearText, situationParts, type Situation } from '../src/live';

/** Ход ядра на 12 ч: две дивизии 8 гв. А на плацдарме, две дивизии 28 А ещё не введены (резерв Ставки), немецкая дивизия. */
function trace(): AgentTrace {
  const row = (lng: number, state: string) => [lng, 52.55, state, 5000, 0, 150, 2, 1, 0.1, 0.9, 0];
  const frames = Array.from({ length: 13 }, () => [
    row(14.55, 'наступление: атака'), row(14.5, 'наступление: атака'),
    row(15.2, 'не введена в операцию'), row(15.25, 'не введена в операцию'),
    row(14.4, 'оборона: подготовленная'),
  ]);
  const d = (id: string, name: string, side: string, hq: string) => ({ id, name, side, hq, kind: 'sd', mobility: 'foot', size: 'rifle', quality: 1 });
  return {
    scenario: 'test', name: 'проба', start: '1945-04-16T05:00', hours: 12, seed: 1,
    fields: ['lng', 'lat', 'state', 'personnel', 'tanks', 'guns', 'ammo', 'fuel', 'fatigue', 'cohesion', 'encircled'],
    divisions: [d('su_a1', '79-я гвардейская стрелковая дивизия', 'su', 'su_8gva'), d('su_a2', '27-я гвардейская стрелковая дивизия', 'su', 'su_8gva'),
      d('su_r1', '50-я гвардейская стрелковая дивизия', 'su', 'su_28a'), d('su_r2', '54-я гвардейская стрелковая дивизия', 'su', 'su_28a'),
      d('de_x', '20-я моторизованная дивизия', 'de', 'de_9a')],
    hqs: [
      { id: 'su_1bf', name: '1-й Белорусский фронт', side: 'su', echelon: 'front', parent: null },
      { id: 'su_8gva', name: '8-я гвардейская армия', side: 'su', echelon: 'army', parent: 'su_1bf' },
      { id: 'su_28a', name: '28-я армия', side: 'su', echelon: 'army', parent: 'su_1bf' },
      { id: 'de_9a', name: '9-я армия', side: 'de', echelon: 'army', parent: null },
    ],
    frames, journal: [],
  };
}

describe('штаб и советник на агентной модели', () => {
  const t = trace();
  const { ctx } = agentsToRun(loadContext('berlin-1945-tasks'), t, 1);
  const s0 = agentsStateAt(ctx, t, 12);
  // резерв стороны игрока ждёт ввода (как в игре: ввод — по распоряжению)
  // территория: всё восточнее 14,45° — своя (как её дало бы ядро)
  const T = ctx.theatre, n = T.data.terrainGrid ? (T.data.terrainGrid as { cols: number; rows: number }).cols * (T.data.terrainGrid as { cols: number; rows: number }).rows : 0;
  const territory = Array.from({ length: n }, () => 1);
  for (let lng = 14.46; lng < 15.6; lng += 0.01) for (let lat = 52.2; lat < 52.9; lat += 0.01) { const i = T.indexOf([lng, lat]); if (i >= 0) territory[i] = 0; }
  const state = { ...s0, territory, logistics: prepareTakeover(ctx, s0, 'su').logistics, formations: s0.formations.map((f) => (f.id.startsWith('su_r') ? { ...f, reserveFrom: '1945-04-16T17:00', enterAt: NOT_COMMITTED } : f)) };
  const g = { state, prev: null, snapshots: [] };

  it('в обстановке — армии сводкой по дивизиям и подчинение дивизий, резервы — по армиям', () => {
    expect(ctx.agentModel).toBe(true);
    const p = situationParts(ctx, g, { side: 'su', anchor: '', anchorName: '' });
    expect(p.vars.own_forces).toMatch(/- 8-я гвардейская армия \(армия, соединений: 2\)/);
    expect(p.vars.own_forces).toMatch(/Приказ армии или корпусу ядро доводит до всех их соединений/);
    // дивизии без боя — коротко под своей армией
    expect(p.vars.own_forces).toMatch(/Остальные дивизии.*8-я гвардейская армия: .*79/);
    expect(p.vars.own_forces).toMatch(/50-я гвардейская стрелковая дивизия \[в составе: 28-я армия\] — резерв Ставки/);
    expect(p.formations.some((f) => f.id === 'su_8gva')).toBe(true);
    expect(rearText(ctx, g, 'su')).toMatch(/Резервы Ставки, не введённые в сражение: 28-я армия — 2 соед\.: 50-я гвардейская стрелковая дивизия, 54-я.*Объединение вводится целиком/);
  });

  it('ввод резервной армии целиком — распоряжение на каждое её соединение, в один район', () => {
    const p = situationParts(ctx, g, { side: 'su', anchor: '', anchorName: '' });
    const sit: Situation = { messages: [], time: state.time, areas: p.areas, allAreas: p.allAreas, enemies: p.enemies, formations: p.formations,
      staff: { side: 'su', bases: [], reserves: state.formations.filter((f) => f.reserveFrom).map((f) => ({ id: f.id, name: f.name })) } };
    // район в своём тылу — восточнее Одера
    const area = places(ctx.theatre).find((a) => a.at[0] > 14.5 && a.at[0] < 15.5 && a.at[1] > 52.25 && a.at[1] < 52.85)!.title;
    const r = actionsToStaff(ctx, g, sit, [{ kind: 'commit', subject: '28-я армия', area, formations: [] }]);
    expect(r.actions.map((a) => a.kind === 'commit' && a.formation).sort()).toEqual(['su_r1', 'su_r2']);
    expect(r.applied.every((x) => x.action && x.given.subject === '28-я армия')).toBe(true);
    const [a, b] = r.actions as Extract<(typeof r.actions)[number], { kind: 'commit' }>[];
    expect(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1])).toBeGreaterThan(0.01);
  });
});
