// Варианты советника по правилам и дополнение вариантов модели (plan-rules): всем подчинённым пункта, тыл и переправы,
// на карте, без модели и при её отказе, предупреждение «история как замысел».
import { describe, expect, it } from 'vitest';
import type { LngLat } from '@def-ops/core';
import type { PlanVariantView, TurnView } from '../src/sim/game-protocol';
import type { DraftScope } from '../src/decision-drafts';
import { staffScope } from '../src/post-staff';
import { completeVariant, dirDraftOf, fromCore, historyLoss, majorRivers, planFallback, riverFeature, RULES_MARK, ruleActs, variantFeatures, type CoreOrder, type CoreVariant } from '../src/plan-rules';

const hq = (id: string, name: string, echelon: string, parent: string | null, control = 'agent') => [id, { control, led: false, name, echelon, parent }] as const;
const rep = (id: string, name: string, echelon: string, parent: string, at: LngLat, x: object = {}) => ({
  id, name, echelon, parent, status: 'active', at, place: 'у Зелова', posture: 'наступает', task: 'наступать', target: 'на Берлин', personnel: 8000, tanks: 10, guns: 100,
  strength: 0.8, ammo: 1, fuel: 1, fatigue: 0.2, cutOff: false, movedKm: 0, combats: [], pending: [], ...x,
});
/** Пункт фронта: 1-й Белорусский, армии 8 гв. и 1 гв. ТА; река по долготе 14,4; база далеко за войсками. */
const view = (over: Partial<TurnView> & { mode?: string; ctl?: Record<string, string> } = {}): TurnView => ({
  start: '1945-04-16T05:00', time: '1945-04-17T05:00', turnHours: 24, human: { id: 'su', name: 'СССР' }, battles: [], events: [], journal: [],
  own: [
    rep('su_8gva', '8-я гв. армия', 'army', 'su_1bf', [14.5, 52.6]),
    rep('su_1gta', '1-я гв. танковая армия', 'army', 'su_1bf', [14.5, 52.4]),
    rep('su_d1', '35 гв. сд', 'division', 'su_4gsk', [14.5, 52.62]),
    rep('su_d9', '1 тбр', 'division', 'su_8gva', [14.52, 52.58]),
    rep('su_d5', '11 гв. тк', 'division', 'su_1gta', [14.5, 52.4]),
    rep('su_dz', 'выбыла', 'division', 'su_1bf', [14.6, 52.5], { status: 'destroyed' }),
  ],
  intel: [{ id: 'de_ci', name: 'CI армейский корпус', at: [14.2, 52.6], place: 'у Зелова', posture: 'обороняется', estimate: '', fresh: false, nearest: null }],
  places: [{ id: 'p_kus', title: 'Кюстрин (Küstrin)', at: [14.65, 52.59] }, { id: 'p_zel', title: 'Зелов (Seelow)', at: [14.38, 52.6] }, { id: 'p_far', title: 'Далёкий', at: [16.5, 52.0] }],
  command: { mode: over.mode ?? 'agents', led: [], requests: [], historical: [], documents: [], hqs: Object.fromEntries([
    hq('su_stavka', 'Ставка ВГК', 'high_command', null, 'player'),
    hq('su_1bf', '1-й Белорусский фронт', 'front', 'su_stavka'),
    hq('su_1uf', '1-й Украинский фронт', 'front', 'su_stavka'),
    hq('su_8gva', '8-я гв. армия', 'army', 'su_1bf'),
    hq('su_1gta', '1-я гв. танковая армия', 'army', 'su_1bf'),
    hq('su_4gsk', '4-й гв. ск', 'corps', 'su_8gva'),
  ].map(([id, h]) => [id, over.ctl?.[id] ? { ...h, control: over.ctl[id] } : h])) },
  bases: [{ id: 'b1', name: 'Ландсберг', at: [14.95, 52.6], state: 'active', activeFrom: null }],
  priority: [], priorityMax: 2, supplyHours: { su_d1: 30, su_d9: 20, su_d5: 12 }, rangeHours: 24,
  bridges: [], parks: 2, parksBy: { su_1bf: { allot: 2, own: 2, busy: 0 } },
  // реки — слоем карты «rivers» (большие — толще), отдельного поля в виде нет
  doc: { layers: [], features: [riverFeature({ name: 'Одер', major: true, line: [[14.4, 52.3], [14.4, 52.9]] }), riverFeature({ name: 'ручей', major: false, line: [[14.45, 52.3], [14.45, 52.9]] })] },
  crossings: [],
  ...over,
} as unknown as TurnView);

const ord = (to: string, task: string, axis: LngLat[], x: Partial<CoreOrder> = {}): CoreOrder => ({
  to, task, form: 'order', axis, immediate: [axis[axis.length - 1]], subsequent: [], right: [[14.7, 52.65], [14.2, 52.65]], left: [[14.7, 52.5], [14.2, 52.5]], note: '', ...x,
});
const core = (kind = 'breakthrough', label = 'Прорыв на Зелов'): CoreVariant => ({
  kind, label, rule: 'Главный удар — 8 гв. армией на Зелов, танковая армия — в прорыв.', score: 0.7, axis: [[14.6, 52.6], [14.2, 52.6]], mainBlow: ['su_8gva'],
  orders: [ord('su_8gva', 'attack', [[14.6, 52.6], [14.3, 52.6]]), ord('su_1gta', 'defend', [[14.55, 52.4], [14.5, 52.4]], { right: [[14.7, 52.5], [14.2, 52.5]], left: [[14.7, 52.3], [14.2, 52.3]] })],
});
const scope0: DraftScope = { who: '1-й Белорусский фронт', own: [], intel: [], plans: [] };
const sc = (v: TurnView) => staffScope(v, 'front', 'su_1bf');

describe('варианты по правилам', () => {
  it('варианты по правилам — всем подчинённым, с пометкой', () => {
    const v = view();
    const p = fromCore(v, scope0, 'su_1bf', core(), sc(v));
    expect(p.source).toBe('rules');
    expect(p.title).toBe('Прорыв на Зелов');
    expect(p.dirs!.map((d) => d.to)).toEqual(['su_8gva', 'su_1gta']);
    for (const d of p.dirs!) { expect(d.right.length).toBeGreaterThan(1); expect(d.left.length).toBeGreaterThan(1); }
    expect(p.decision.intent.startsWith('Прорыв на Зелов')).toBe(true);
    expect(p.decision.intent).toContain('8 гв. А — наступать: Зелов');
    expect(p.orders).toEqual([]);
    expect(RULES_MARK).toBe('по правилам, без модели');
  });
  it('проект документа по приказу варианта: задача, ось, линии; указания составятся', () => {
    const d = fromCore(view(), scope0, 'su_1bf', core(), null).dirs![0];
    const x = dirDraftOf(d, 'front');
    expect(x).toMatchObject({ to: 'su_8gva', level: 'front', task: 'attack', axis: d.axis, boundaries: [d.right, d.left], noteAuto: true });
  });
  it('тыл и переправы по правилам', () => {
    const v = view();
    const acts = ruleActs(v, sc(v), fromCore(v, scope0, 'su_1bf', core(), sc(v)).dirs!);
    const base = acts.find((a) => a.key.startsWith('base:'))!;
    expect(base.key).toBe('base:b1');
    expect(base.action).toMatchObject({ kind: 'base', base: 'b1', to: [14.65, 52.59] });
    const br = acts.find((a) => a.key === 'bridge:rule0')!;
    expect(br.action).toMatchObject({ kind: 'bridge', by: 'su_1bf' });
    expect(br.at![0]).toBeCloseTo(14.4, 5);
    expect(br.at![1]).toBeCloseTo(52.6, 5);
    const pr = acts.find((a) => a.key === 'priority')!;
    expect(pr.action).toMatchObject({ kind: 'priority', formations: ['su_8gva'] });
    // мост рядом — переправа не нужна; парков нет — тоже
    expect(ruleActs(view({ crossings: [{ id: 'x', name: 'мост', at: [14.41, 52.6] }] }), sc(v), fromCore(v, scope0, 'su_1bf', core(), null).dirs!).some((a) => a.key.startsWith('bridge:'))).toBe(false);
    const busy = view({ parksBy: { su_1bf: { allot: 2, own: 2, busy: 2 } } });
    expect(ruleActs(busy, sc(busy), fromCore(v, scope0, 'su_1bf', core(), null).dirs!).some((a) => a.key.startsWith('bridge:'))).toBe(false);
  });
  it('на карте — ось, линии, точка цели', () => {
    const v = view();
    const p = fromCore(v, scope0, 'su_1bf', core(), sc(v));
    const NM: Record<string, string> = { su_8gva: '8-я гв. армия', su_1gta: '1-я гв. танковая армия' };
    const fs = variantFeatures(p, (id) => NM[id] ?? id);
    for (const d of p.dirs!) {
      const mine = fs.filter((f) => f.name.includes(NM[d.to]));
      expect(mine.filter((f) => f.kind === 'arrow')).toHaveLength(1);
      expect(mine.filter((f) => f.kind === 'line')).toHaveLength(2);
      expect(mine.some((f) => f.kind === 'point')).toBe(true);
    }
    expect(fs.some((f) => f.kind === 'point' && /переправа/i.test(f.name))).toBe(true);
  });
});

describe('варианты модели — дополнение правилом', () => {
  const llm = (orders: PlanVariantView['orders']): PlanVariantView => ({ title: 'Удар модели', idea: 'суть', decision: { assessment: 'a', enemyIntent: 'e', intent: 'i', report: 'r', risks: 'k' }, orders, acts: [] });
  const sug = (formation: string, name: string, at: LngLat | null = [14.3, 52.6]) => ({ formation, name, task: 'attack' as const, target: null, targetText: 'Зелов', at, why: 'главный удар', ok: true });
  it('дополнение варианта модели правилом', () => {
    const p = completeVariant(view(), 'su_1bf', llm([sug('su_8gva', '8-я гв. армия', [14.33, 52.61])]), core('continue', 'Продолжать'));
    expect(p.source).toBe('llm');
    expect(p.dirs!.map((d) => d.to)).toEqual(['su_8gva', 'su_1gta']);
    const [a, b] = p.dirs!;
    expect(a.task).toBe('attack');
    expect(a.immediate).toEqual([[14.33, 52.61]]);
    expect(a.note).toBe('главный удар');
    expect(a.right).toEqual(core().orders[0].right);
    expect(a.filled).toBeFalsy();
    expect(b.filled).toBe(true);
    expect(b.task).toBe('defend');
    expect(p.filled).toEqual(['1-я гв. танковая армия']);
  });
  it('приказ выбывшему — снят с пометкой', () => {
    const p = completeVariant(view(), 'su_1bf', llm([sug('su_8gva', '8-я гв. армия'), sug('su_dz', 'выбыла')]), core('continue', 'Продолжать'));
    expect(p.dirs!.some((d) => d.to === 'su_dz')).toBe(false);
    const o = p.orders.find((x) => x.formation === 'su_dz')!;
    expect(o.ok).toBe(false);
    expect(o.issue).toBe('выбыл или не в подчинении');
  });
  it('нынешняя модель — без новых приказов названы', () => {
    const v = view({ own: [rep('a1', '3-я армия', 'army', 'f', [14, 52]), rep('a2', '5-я армия', 'army', 'f', [14, 52]), rep('a3', '8-я армия', 'army', 'f', [14, 52]), rep('a4', 'выбывшая', 'army', 'f', [14, 52], { status: 'destroyed' })] as never, command: undefined });
    const p = completeVariant(v, null, llm([sug('a2', '5-я армия')]), null);
    expect(p.kept).toEqual(['3-я армия', '8-я армия']);
    expect(p.dirs).toBeUndefined();
  });
});

describe('история как замысел и отказ модели', () => {
  const dirs = fromCore(view(), scope0, 'su_stavka', { ...core(), orders: [ord('su_1bf', 'attack', [[14.6, 52.6], [14.2, 52.6]]), ord('su_1uf', 'attack', [[14.6, 52.0], [14.2, 52.0]])] }, null).dirs!;
  it('historyLoss: получатели по истории названы', () => {
    expect(historyLoss(view({ mode: 'intent', ctl: { su_1bf: 'player', su_1uf: 'script' } }), dirs)).toEqual(['1-й Украинский фронт']);
    expect(historyLoss(view({ mode: 'intent', ctl: { su_1bf: 'player', su_1uf: 'player' } }), dirs)).toEqual([]);
    expect(historyLoss(view({ ctl: { su_1uf: 'script' } }), dirs)).toEqual([]);
  });
  const rules = [fromCore(view(), scope0, 'su_1bf', core(), null)];
  it('без модели — варианты по правилам с пометкой', () => {
    const r = planFallback(rules, { done: false, ok: false, count: 0 });
    expect(r.variants).toBe(rules);
    expect(r.variants[0].source).toBe('rules');
    expect(r.warning).toBeUndefined();
  });
  it('модель не ответила — варианты по правилам с предупреждением', () => {
    const r = planFallback(rules, { done: true, ok: false, error: 'таймаут', count: 0 });
    expect(r.variants).toBe(rules);
    expect(r.warning).toBe('Советник не ответил (таймаут) — показаны варианты по правилам.');
    expect(planFallback(rules, { done: true, ok: true, count: 2 }).variants).toEqual([]);
  });
});

describe('реки для переправ — из слоя карты', () => {
  it('большие реки берутся из знаков слоя «rivers»; поля rivers в виде нет', () => {
    expect(majorRivers(view())).toEqual([{ name: 'Одер', line: [[14.4, 52.3], [14.4, 52.9]] }]);
    // @ts-expect-error — реки идут слоем карты, а не полем вида (каждый ход — десятки килобайт)
    const r: TurnView['rivers'] = undefined;
    expect(r).toBeUndefined();
  });
});
