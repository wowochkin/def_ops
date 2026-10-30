import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentHistory, AgentTrace } from '../src/agents';
import { distanceSeries, divisionLoss, hasLosses, historicalLosses, lossSeries, LOSS_FIELDS, OBJECTIVE, operationSummary, type HistoricalLoss } from '../src/results';
import { agentsScore } from '../src/agents-score';
import { loadHistory, loadProfile, loadRules, loadScenario, loadTheatre } from '../src/data';
import { contextFrom } from '../src/source';

const ROOT = join(__dirname, '../../..');
const FIELDS11 = ['lng', 'lat', 'state', 'personnel', 'tanks', 'guns', 'ammo', 'fuel', 'fatigue', 'cohesion', 'encircled'];
const FIELDS16 = [...FIELDS11, ...LOSS_FIELDS];

type Row = { state?: string; pers: number; lost?: number; reinf?: number; captured?: number };
/**
 * Ход на 48 ч из трёх дивизий: su_x под армией su_8gva (фронт su_1bf), su_y — под фронтом напрямую, de_z — под de_9a.
 * f(k, h) — строка дивизии k на час h.
 */
function trace(f: (k: number, h: number) => Row, fields = FIELDS16): AgentTrace {
  const row = (r: Row) => {
    const base: unknown[] = [14.5, 52.5, r.state ?? 'оборона: подготовленная', r.pers, 10, 50, 2, 1, 0.1, 0.9, 0];
    return fields.length > 11 ? [...base, r.lost ?? 0, 0, 0, r.captured ?? 0, r.reinf ?? 0] : base;
  };
  return {
    scenario: 'test', name: 'проба', start: '1945-04-16T05:00', hours: 48, seed: 1, fields,
    divisions: [
      { id: 'su_x', name: '1-я стрелковая дивизия', side: 'su', hq: 'su_8gva', kind: 'sd', mobility: 'foot', size: 'rifle', quality: 1 },
      { id: 'su_y', name: '2-я стрелковая дивизия', side: 'su', hq: 'su_1bf', kind: 'sd', mobility: 'foot', size: 'rifle', quality: 1 },
      { id: 'de_z', name: '9-я парашютная дивизия', side: 'de', hq: 'de_9a', kind: 'div', mobility: 'foot', size: 'inf', quality: 1 },
    ],
    hqs: [
      { id: 'su_1bf', name: '1-й Белорусский фронт', side: 'su', echelon: 'front', parent: null },
      { id: 'su_8gva', name: '8-я гвардейская армия', side: 'su', echelon: 'army', parent: 'su_1bf' },
      { id: 'de_9a', name: '9-я армия', side: 'de', echelon: 'army', parent: null },
    ],
    frames: Array.from({ length: 49 }, (_, h) => [0, 1, 2].map((k) => row(f(k, h)))),
    journal: [],
  };
}

const steady = (k: number, h: number): Row => k === 0 ? { pers: 9000 - 100 * h, lost: 100 * h } : k === 1 ? { pers: 7000, lost: 0 } : { pers: 6000 - 50 * h, lost: 50 * h };

describe('потери сторон по ходу ядра', () => {
  it('lossSeries totals and days', () => {
    const t = trace(steady);
    expect(hasLosses(t)).toBe(true);
    const s = lossSeries(t);
    expect(s.exact).toBe(true);
    expect(s.upTo).toBe(48);
    expect(s.days).toEqual(['1945-04-16', '1945-04-17']);
    const su = s.rows.find((r) => r.id === 'su')!;
    expect(su.total.personnel).toBe(4800);
    expect(su.byDay).toHaveLength(2);
    expect(su.byDay[0].personnel).toBe(2400);
    expect(s.rows.find((r) => r.id === 'de')!.total.personnel).toBe(2400);
    const army = s.rows.find((r) => r.id === 'su_8gva')!;
    expect(army).toMatchObject({ echelon: 'army', parent: 'su_1bf', side: 'su' });
    expect(army.total.personnel).toBe(4800);
    expect(s.rows.find((r) => r.id === 'su_1bf')).toMatchObject({ echelon: 'front', parent: 'su' });
    // su_y — только во фронте: армии у неё нет
    expect(s.rows.filter((r) => r.echelon === 'army').map((r) => r.id).sort()).toEqual(['de_9a', 'su_8gva']);
    // немецкая армия без фронта — прямо под стороной
    expect(s.rows.find((r) => r.id === 'de_9a')!.parent).toBe('de');
    // часть хода: сутки — до upTo
    const half = lossSeries(t, 30);
    expect(half.days).toHaveLength(2);
    expect(half.rows.find((r) => r.id === 'su')!.byDay[1].personnel).toBe(600);
  });

  it('reinforcement is not netted', () => {
    const t = trace((k, h) => k === 0 ? { pers: 9000 - 100 * h + (h >= 10 ? 1000 : 0), lost: 100 * h, reinf: h >= 10 ? 1000 : 0 } : steady(k, h));
    const s = lossSeries(t);
    const su = s.rows.find((r) => r.id === 'su')!;
    expect(su.total.personnel).toBe(4800);
    expect(su.reinforced).toBe(1000);
    expect(divisionLoss(t, 0, 48)).toMatchObject({ personnel: 4800, reinforced: 1000 });
  });

  it('old trace estimate', () => {
    const t = trace((k, h) => k === 0 ? { pers: 9000 - 100 * h + (h >= 10 ? 1000 : 0) } : steady(k, h), FIELDS11);
    expect(hasLosses(t)).toBe(false);
    const s = lossSeries(t);
    expect(s.exact).toBe(false);
    // сумма часовых убылей (47 × 100), а не «начало − конец» (3800)
    expect(s.rows.find((r) => r.id === 'su_8gva')!.total.personnel).toBe(4700);
    expect(divisionLoss(t, 0, 48)).toMatchObject({ personnel: 4700, captured: 0, reinforced: 0 });
  });

  it('removed army is not a loss', () => {
    // su_x снята с операции на часе 20 (вмешательство remove): «не введена», численность — 0
    const removed = (k: number, h: number): Row => k === 0 && h >= 20 ? { state: 'не введена в операцию', pers: 0, lost: 100 * 19 } : steady(k, h);
    const exact = lossSeries(trace(removed));
    expect(exact.rows.find((r) => r.id === 'su_8gva')!.total.personnel).toBe(1900);
    expect(exact.rows.find((r) => r.id === 'su')!.total.personnel).toBe(1900);
    // и в оценке по убыли: уход с карты — не убыль
    const est = lossSeries(trace((k, h) => { const r = removed(k, h); return { state: r.state, pers: r.pers }; }, FIELDS11));
    expect(est.rows.find((r) => r.id === 'su')!.total.personnel).toBe(1900);
  });

  it('historicalLosses', () => {
    const h: AgentHistory = {
      divisions: [],
      losses: [{ formation: 'su_8gva', until: '1945-05-01T20:00', value: 24484, source: 'ЦАМО', reliability: 'B' }],
      operationLosses: [{ scope: 'su', from: '1945-04-16', to: '1945-05-08', total: 352475, source: 'Кривошеев', reliability: 'A' }],
    };
    const r = historicalLosses(h);
    expect(r).toHaveLength(2);
    expect(r).toContainEqual({ scope: 'su_8gva', to: '1945-05-01T20:00', total: 24484, source: 'ЦАМО', reliability: 'B' });
    expect(r[0].scope).toBe('su');
    expect(historicalLosses({ divisions: [] })).toEqual([]);
  });

  it('operationLosses come from the knowledge base', () => {
    const hist = JSON.parse(readFileSync(join(ROOT, 'packages/sim/data/scenarios/agents/berlin-1945.history.json'), 'utf8')) as AgentHistory;
    const seed = JSON.parse(readFileSync(join(ROOT, 'packages/knowledge/data/seed.json'), 'utf8')) as { entries: { id: string; facts?: { key: string; value: unknown }[] }[] };
    const rows = hist.operationLosses ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const squeeze = (s: string) => s.replace(/[\s  ]/g, '');
    const NUM: (keyof HistoricalLoss)[] = ['irrecoverable', 'sanitary', 'total', 'killed', 'captured', 'tanks', 'guns', 'perDay'];
    for (const r of rows) {
      const e = seed.entries.find((x) => x.id === r.kb);
      expect(e, `${r.kb}`).toBeTruthy();
      const text = squeeze((e!.facts ?? []).filter((f) => f.key === 'losses').map((f) => String(f.value)).join('|'));
      for (const k of NUM) if (r[k] != null) expect(text, `${r.scope} ${k}`).toContain(String(r[k]));
    }
    // Висло-Одерская: потерь операции в базе знаний нет — поля нет
    const vo = JSON.parse(readFileSync(join(ROOT, 'packages/sim/data/scenarios/agents/vistula-oder-1945.history.json'), 'utf8')) as AgentHistory;
    expect(vo.operationLosses).toBeUndefined();
  });
});

const get = (kind: string, file: string) => {
  const id = file.replace(/\.json$/, '');
  if (kind === 'scenarios') return id.endsWith('.history') ? loadHistory(id.replace('.history', '')) : loadScenario(id);
  if (kind === 'theatres') return loadTheatre(id);
  if (kind === 'profiles') return loadProfile(id);
  return loadRules(id);
};
const BERLIN = JSON.parse(readFileSync(join(ROOT, 'packages/sim/data/scenarios/agents/berlin-1945.history.json'), 'utf8')) as AgentHistory;
/** Точка в km к востоку от lngLat (на той же широте). */
const east = (p: [number, number], km: number): [number, number] => [p[0] + km / (111.32 * Math.cos((p[1] * Math.PI) / 180)), p[1]];
/** Ход на 96 ч: su_x до часа 80 в 60 км восточнее, с часа 80 — у Мюнхеберга; su_y и de_z — на месте. */
function longTrace(c: [number, number]): AgentTrace {
  const t = trace(steady);
  const far = east(c, 60);
  t.hours = 96;
  t.frames = Array.from({ length: 97 }, (_, h) => [0, 1, 2].map((k) => {
    const r = [...t.frames[Math.min(h, 48)][k]];
    if (k === 0) { const at = h >= 80 ? c : far; r[0] = at[0]; r[1] = at[1]; }
    return r;
  }));
  return t;
}

describe('итоги: события и удаление от объекта', () => {
  it('summary events are the score events', async () => {
    const { ctx: base, history } = await contextFrom(get, 'berlin-1945-tasks');
    const c = base.theatre.area('Muencheberg')!.center! as [number, number];
    const t = longTrace(c);
    const h: AgentHistory = { divisions: [], events: BERLIN.events };
    const s = operationSummary(base, t, h, history);
    const sc = agentsScore(base, t, h, history);
    expect(s.events.map((e) => [e.id, e.days])).toEqual(sc.events.map((e) => [e.id, e.days]));
    const seelow = s.events.find((e) => e.id === 'seelow')!;
    expect(seelow.simulated).not.toBeNull();
    expect(s.over).toBe(true);
  });

  it('summary up to hour', async () => {
    const { ctx: base, history } = await contextFrom(get, 'berlin-1945-tasks');
    const c = base.theatre.area('Muencheberg')!.center! as [number, number];
    const t = longTrace(c);
    const s = operationSummary(base, t, { divisions: [], events: BERLIN.events }, history, { upTo: 24, over: false });
    expect(s.over).toBe(false);
    expect(s.events.find((e) => e.id === 'seelow')!.simulated).toBeNull();
    expect(s.distance.rows[0].game[1]).not.toBeNull();
    expect(s.distance.rows[0].game[2]).toBeNull();
  });

  it('distanceSeries', () => {
    const t = trace(steady);
    const p = east(OBJECTIVE, 50);
    t.frames.forEach((f) => { f[0][0] = p[0]; f[0][1] = p[1]; f[1][0] = p[0]; f[1][1] = p[1]; });
    const h: AgentHistory = {
      divisions: [],
      armies: [
        { formation: 'su_8gva', time: '1945-04-16T20:00', at: east(OBJECTIVE, 40), approxKm: 5 },
        { formation: 'su_5ua', time: '1945-04-16T20:00', at: east(OBJECTIVE, 60), approxKm: 5 },
      ],
    };
    t.hqs.push({ id: 'su_5ua', name: '5-я ударная армия', side: 'su', echelon: 'army', parent: 'su_1bf' });
    const d = distanceSeries(t, h);
    expect(d.days).toEqual(['1945-04-16', '1945-04-17', '1945-04-18']);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ hq: 'su_1bf', name: '1-й Белорусский фронт' });
    expect(Math.abs(d.rows[0].game[0]! - 50)).toBeLessThanOrEqual(0.5);
    // история фронта из двух армий — среднее положений (40 и 60 км к востоку)
    expect(Math.abs(d.rows[0].history[0]! - 50)).toBeLessThanOrEqual(0.5);
    expect(d.rows[0].history[1]).toBeNull();
  });

  it('sides divisions and strength', async () => {
    const { ctx: base, history } = await contextFrom(get, 'berlin-1945-tasks');
    // su_y введена только с часа 30
    const t = trace((k, h) => k === 1 && h < 30 ? { state: 'не введена в операцию', pers: 7000 } : steady(k, h));
    const s = operationSummary(base, t, { divisions: [] }, history);
    expect(s.sides.su.strength0).toBe(9000);
    expect(s.sides.su.divisions).toEqual([1, 1, 2]);
    expect(s.sides.su.strength[1]).toBe(9000 - 2400);
    expect(s.sides.su.strength[0]).toBe(9000);
    expect(s.sides.su.strength[2]).toBe(9000 - 4800 + 7000);
    expect(s.sides.de.divisions[0]).toBe(1);
    expect(s.sides.su.manningFromTable === null || s.sides.su.manningFromTable.length === 3).toBe(true);
  });
});
