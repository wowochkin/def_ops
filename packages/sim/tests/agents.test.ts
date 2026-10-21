import { describe, expect, it } from 'vitest';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../src/data';
import { contextFrom } from '../src/source';
import { agentKindOf, agentsHistory, agentsStateAt, agentsToRun, postureOf, type AgentTrace } from '../src/agents';
import { unitReports } from '../src/reports';
import { checkEvents, compareWithHistory } from '../src/history';
import { medianXY, runToDocument } from '../src/publish';

const get = (kind: string, file: string) => {
  const id = file.replace(/\.json$/, '');
  if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
  if (kind === 'theatres') return loadTheatre(id);
  if (kind === 'profiles') return loadProfile(id);
  return loadRules(id);
};

/** Ход на 12 ч: советская дивизия идёт на запад, немецкая обороняется и к 7-му часу небоеспособна, третья не введена. */
function trace(): AgentTrace {
  const row = (lng: number, state: string, pers: number, enc = 0) => [lng, 52.5, state, pers, 10, 50, 2, 1, 0.1, 0.9, enc];
  const frames = Array.from({ length: 13 }, (_, h) => [
    row(14.6 - h * 0.01, h < 2 ? 'резерв' : 'наступление: атака', 9000),
    row(14.3, h < 7 ? 'оборона: подготовленная' : 'небоеспособна', 6000 - h * 300, h >= 4 ? 3 : 0),
    row(14.0, h < 6 ? 'не введена в операцию' : 'марш: по дороге', 7000),
  ]);
  return {
    scenario: 'test', name: 'проба', start: '1945-04-16T05:00', hours: 12, seed: 3,
    fields: ['lng', 'lat', 'state', 'personnel', 'tanks', 'guns', 'ammo', 'fuel', 'fatigue', 'cohesion', 'encircled'],
    divisions: [
      { id: 'su_x', name: '1-я стрелковая дивизия', side: 'su', hq: 'su_8gva', kind: 'sd', mobility: 'foot', size: 'rifle', quality: 1 },
      { id: 'de_y', name: '9-я парашютная дивизия', side: 'de', hq: 'de_9a', kind: 'div', mobility: 'foot', size: 'inf', quality: 1 },
      { id: 'de_z', name: 'Танковая дивизия «Мюнхеберг»', side: 'de', hq: 'de_9a', kind: 'div', mobility: 'tracked', size: 'pz', quality: 1 },
    ],
    hqs: [
      { id: 'su_1bf', name: '1-й Белорусский фронт', side: 'su', echelon: 'front', parent: null },
      { id: 'su_8gva', name: '8-я гвардейская армия', side: 'su', echelon: 'army', parent: 'su_1bf' },
      { id: 'de_9a', name: '9-я армия', side: 'de', echelon: 'army', parent: null },
    ],
    frames, journal: [],
  };
}

describe('агентная модель в «Переигровке»', () => {
  it('состояния агентов — положения соединений', () => {
    expect(postureOf('наступление: бой в глубине')).toBe('attack');
    expect(postureOf('оборона: поспешная')).toBe('defend');
    expect(postureOf('марш: затор')).toBe('march');
    expect(postureOf('остатки: выход из боя')).toBe('withdraw');
    expect(postureOf('небоеспособна')).toBe('destroyed');
    expect(postureOf('не введена в операцию')).toBeNull();
    expect(postureOf('сведена в другую дивизию')).toBeNull();
  });

  it('ход по часам — снимки через шаг, дивизии и штабы — формирования сценария; карта строится', async () => {
    const { ctx: base, history } = await contextFrom(get, 'berlin-1945-tasks');
    const { ctx, run } = agentsToRun(base, trace(), 3);
    expect(run.snapshots.map((s) => s.time)).toEqual(['1945-04-16T05:00', '1945-04-16T08:00', '1945-04-16T11:00', '1945-04-16T14:00', '1945-04-16T17:00']);
    expect(ctx.scenario.turnHours).toBe(3);
    expect(ctx.scenario.end).toBe('1945-04-16T17:00');
    expect(ctx.scenario.formations.find((f) => f.id === 'su_x')).toMatchObject({ echelon: 'division', parent: 'su_8gva', type: 'rifle_corps' });
    expect(ctx.scenario.formations.find((f) => f.id === 'de_z')?.type).toBe('pz_div');
    // не введённой дивизии нет в начальном снимке; вводится с первым снимком, где она есть
    expect(run.snapshots[0].units.map((u) => u.id)).toEqual(['su_x', 'de_y']);
    expect(run.final.formations.find((f) => f.id === 'de_z')?.enterAt).toBe('1945-04-16T11:00');
    // окружённая дивизия отрезана; небоеспособная — уничтожена и дальше не идёт
    expect(run.snapshots[2].units.find((u) => u.id === 'de_y')).toMatchObject({ destroyed: false, cutOff: true });
    expect(run.snapshots[3].units.find((u) => u.id === 'de_y')).toMatchObject({ destroyed: true });
    expect(run.snapshots[4].units.some((u) => u.id === 'de_y')).toBe(false);
    expect(run.final.formations.find((f) => f.id === 'de_y')?.destroyed).toBe(true);
    expect(run.snapshots[0].units.find((u) => u.id === 'su_x')?.posture).toBe('reserve');

    const h = agentsHistory({ divisions: [{ formation: 'su_x', time: '1945-04-16T11:00', at: [14.54, 52.5], approxKm: 3, reliability: 'B', set: 'tsamo-div' }], events: [] }, history);
    expect(compareWithHistory(ctx, run, h)).toHaveLength(1);
    expect(checkEvents(ctx, run, h)).toEqual([]);
    const doc = runToDocument(ctx, run, h, { name: 'проба' });
    expect(doc.features.filter((f) => f.layerId === 'sim-own').length).toBeGreaterThan(0);
    expect(doc.timeline?.end).toBe('1945-04-16T17:00');
  });

  it('состояние на час для игры: только дивизии, приказ ядра — задача, не введённые и выбывшие', async () => {
    const { ctx: base } = await contextFrom(get, 'berlin-1945-tasks');
    const t = { ...trace(), orders: [{ kind: 'attack' as const, target: [14.2, 52.5] as [number, number], from: 'su_8gva', issued: 10, arrives: 11, note: 'приказ игрока: на Зелов' }, null, null] };
    const { ctx } = agentsToRun(base, t, 6);
    const s4 = agentsStateAt(ctx, t, 4);
    expect(s4.time).toBe('1945-04-16T09:00');
    expect(s4.formations.map((f) => f.id)).toEqual(['su_x', 'de_y', 'de_z']);
    // не введённая к 4-му часу — вводится в 6-м; приказ известен только на последний кадр
    expect(s4.formations.find((f) => f.id === 'de_z')?.enterAt).toBe('1945-04-16T11:00');
    expect(s4.formations.find((f) => f.id === 'su_x')?.order).toBeNull();
    expect(s4.formations.find((f) => f.id === 'de_y')).toMatchObject({ cutOff: true, destroyed: false });
    const s12 = agentsStateAt(ctx, t, 12);
    expect(s12.formations.find((f) => f.id === 'su_x')?.order).toMatchObject({ task: 'attack', source: 'human', target: [14.2, 52.5], issuedAt: '1945-04-16T15:00' });
    expect(s12.formations.find((f) => f.id === 'de_y')?.destroyed).toBe(true);
    const own = unitReports(ctx, s12, 'su', agentsStateAt(ctx, t, 0));
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ id: 'su_x', status: 'active', personnel: 9000 });
    expect(['attack', 'counterattack', 'breakout'].map((x) => agentKindOf(x as never))).toEqual(['attack', 'attack', 'attack']);
    expect(agentKindOf('delay')).toBe('defend');
    expect(agentKindOf('regroup')).toBe('move');
  });

  it('ось танковой армии: медиана не тянется за отставшим, после перестановки армии — заново', async () => {
    // два корпуса вместе, третий меньше и отстал на 30 км: медиана — у двух, среднее отстаёт
    const m = medianXY([[0, 0], [0.5, 0], [30, 0]], [15000, 15000, 8000]);
    expect(Math.hypot(m[0], m[1])).toBeLessThan(1);

    // три корпуса идут на запад ~27 км/сут; в 60-м часу (передача командования) армию ставят на 40 км восточнее
    const { ctx: base } = await contextFrom(get, 'berlin-1945-tasks');
    const lng = (h: number) => (h < 60 ? 14.6 - (h * 0.4) / 24 : 14.6 - (60 * 0.4) / 24 + 0.6 - ((h - 60) * 0.4) / 24);
    const frames = Array.from({ length: 121 }, (_, h) => [51.8, 51.85, 51.9].map((lat) => [lng(h), lat, 'марш: по дороге', 15000, 150, 200, 2, 1, 0.1, 0.9, 0]));
    const t: AgentTrace = {
      ...trace(), hours: 120, frames,
      divisions: ['su_a1', 'su_a2', 'su_a3'].map((id, k) => ({ id, name: `${k + 6}-й танковый корпус`, side: 'su', hq: 'su_3gta', kind: 'tk', mobility: 'tracked', size: 'tank', quality: 1 })),
      hqs: [
        { id: 'su_1uf', name: '1-й Украинский фронт', side: 'su', echelon: 'front', parent: null },
        { id: 'su_3gta', name: '3-я гвардейская танковая армия', side: 'su', echelon: 'army', parent: 'su_1uf' },
      ],
    };
    const { ctx, run } = agentsToRun(base, t, 6);
    // снимок 60-го часа — перестановка всех трёх, остальные — ход
    expect(run.snapshots.filter((sn) => sn.jumped).map((sn) => [sn.time, sn.jumped!.length])).toEqual([['1945-04-18T17:00', 3]]);
    const axes = runToDocument(ctx, run, null, { name: 'проба' }).features.filter((f) => f.kind === 'arrow' && (f as { preset?: string }).preset === 'atlas.tankAxis');
    const last = axes[axes.length - 1] as unknown as { points: [number, number][]; name: string };
    // последняя ось — от места после перестановки на запад, без разворота назад через прежний путь
    expect(last.points[0][0]).toBeCloseTo(14.2, 1);
    for (let k = 1; k < last.points.length; k++) expect(last.points[k][0]).toBeLessThan(last.points[k - 1][0]);
    expect(last.name).toContain('с 18.4');
  });
});
