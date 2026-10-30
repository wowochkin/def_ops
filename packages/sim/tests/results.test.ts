import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentHistory, AgentTrace } from '../src/agents';
import { divisionLoss, hasLosses, historicalLosses, lossSeries, LOSS_FIELDS, type HistoricalLoss } from '../src/results';

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
