import { describe, expect, it } from 'vitest';
import type { AgentCommander, AgentCommanderOption, AgentTrace } from '@def-ops/sim';
import { answer, commanderOf, decisionRibbon, hqCentroid, MOTIVE_RU, rivalrySeries, SUGGESTIONS, TRAIT_RU, viewAt, moodWords } from '../src/commander-view';

const parts = (o: Partial<Record<string, number>>) => ({ task: 0, rival: 0, preserve: 0, noEncircle: 0, destroy: 0, hold: 0, save: 0, ...o });
const opt = (kind: string, label: string, total: number, p: Partial<Record<string, number>> = {}, mind: AgentCommanderOption['mind'] = null): AgentCommanderOption =>
  ({ kind, label, rule: `ПУ-43: правило «${label}»`, target: null, parts: parts(p), penalty: 0.1, bonus: 0.05, total, mind });
const trait = (value: number) => ({ value, range: [0.3, 1] as [number, number], source: 'мемуары', confidence: 'low' });
const snap = (tick: number, conf: number, stress: number, advance: number, strength: number, flanks: string[] = [], rival: AgentCommander['snapshots'][0]['picture']['rival'] = { hq: 'su_1uf', toObjectiveKm: 110, asOf: tick - 12 }) => ({
  tick, motives: parts({ task: 0.8, rival: 0.4 + tick / 100, preserve: 0.3 }), mood: { confidence: conf, stress }, intent: 'Продолжать по плану',
  picture: { armies: [{ hq: 'su_8gva', advanceKm: advance, strength, enemyEst: 12.4, enemyTrue: 30, toObjectiveKm: 60, brokeThrough: false }],
    rival, openFlanks: flanks, pockets: [], enemyReserves: [], toObjectiveKm: 90 - tick },
});
const zhukov: AgentCommander = {
  hq: 'su_1bf', profile: 'zhukov', name: 'Жуков Г. К.', side: 'su',
  traits: { risk: trait(0.8), persistence: trait(0.85), ambition: trait(0.75), lossTolerance: trait(0.78), obedience: trait(0.6) },
  baseMotives: parts({ task: 0.8, rival: 0.4, preserve: 0.3 }), rival: 'konev', objective: 'berlin',
  snapshots: [snap(0, 0.5, 0.2, 0, 1), snap(6, 0.7, 0.3, 8, 0.98), snap(12, 0.3, 0.7, 12, 0.9, ['su_5ua', 'su_8gva'])],
  decisions: [
    { tick: 6, trigger: 'цикл', chosen: 0, why: 'Продолжать по плану: перевес 0,13', options: [opt('continue', 'Продолжать по плану', 0.27, { task: 0.08 }), opt('waitMobile', 'Не вводить подвижную группу', -0.26, { preserve: 0.12 }, { hours: 24, advanceKm: 4, losses: 0.1, encircled: 0 })] },
    { tick: 12, trigger: 'прорыв', chosen: 1, why: 'Ввести ТА: главная полоса не прорвана', options: [opt('continue', 'Продолжать по плану', 0.2), opt('commitMobile', 'Ввести 1 гв. ТА в прорыв', 0.71, { task: 0.4 }, { hours: 24, advanceKm: 11, losses: 0.2, encircled: 0 })] },
  ],
};
const gerBase = (hq: string, name: string, kinds: [number, string][]): AgentCommander => ({
  ...zhukov, hq, name, side: 'de', rival: null, objective: null,
  snapshots: [snap(0, 0.5, 0.5, 0, 1)].map((s) => ({ ...s, picture: { ...s.picture, toObjectiveKm: null, rival: null } })),
  decisions: kinds.map(([tick, kind]) => ({ tick, trigger: 'цикл', chosen: 0, why: kind, options: [opt(kind, kind === 'hold' ? 'Держаться' : kind === 'relief' ? 'Деблокировать' : 'Отходить', 0.1)] })),
});
const konev: AgentCommander = { ...zhukov, hq: 'su_1uf', name: 'Конев И. С.', rival: 'zhukov' };
const trace = (commanders?: AgentCommander[]): AgentTrace => ({
  scenario: 's', name: 'S', start: '1945-04-16T05:00', hours: 20, seed: 1, fields: [], divisions: [], hqs: [], frames: [], journal: [], ...(commanders ? { commanders } : {}),
});
const names = { su_8gva: '8 гв. А', su_1uf: '1-й Украинский фронт' };

describe('подписи', () => {
  it('мотивы и черты — как в ядре: «спасти армию», «послушание старшему» (у немцев старший — не Ставка)', () => {
    expect(MOTIVE_RU.save).toBe('спасти армию');
    expect(TRAIT_RU.find(([k]) => k === 'obedience')?.[1]).toBe('послушание старшему');
  });
});

describe('commanderOf', () => {
  it('находит командующего штаба; штаба без командующего нет', () => {
    const t = trace([zhukov, konev]);
    expect(commanderOf(t, 'su_1uf')?.name).toBe('Конев И. С.');
    expect(commanderOf(t, 'su_8gva')).toBeNull();
  });
  it('empty-commander: в ходе нет командующих — null, графика нет', () => {
    expect(commanderOf(trace(), 'su_1bf')).toBeNull();
    expect(rivalrySeries(trace())).toEqual([]);
  });
});

describe('viewAt', () => {
  it('берёт последние снимок и решение не позже часа', () => {
    const v = viewAt(zhukov, 9);
    expect(v.snapshot?.tick).toBe(6);
    expect(v.decision?.tick).toBe(6);
    expect(v.decisions.map((d) => d.tick)).toEqual([6]);
    const w = viewAt(zhukov, 12);
    expect(w.decision?.tick).toBe(12);
    expect(w.decisions.map((d) => d.tick)).toEqual([6, 12]);
  });
  it('до первого решения — решения нет, снимок есть; до первого снимка — ничего', () => {
    const v = viewAt(zhukov, 3);
    expect(v.decision).toBeNull();
    expect(v.decisions).toEqual([]);
    expect(v.snapshot?.tick).toBe(0);
    expect(viewAt({ ...zhukov, snapshots: [] }, 3).snapshot).toBeNull();
  });
});

describe('rivalrySeries', () => {
  it('расстояние по снимкам и метки решений; у немцев — держать/отходить 9 А и деблокирование 12 А', () => {
    // деблокирование — решение верхней инстанции (de_hc, вид relief), у которого армия-деблокатор — 12 А
    const relief = (tick: number, by: string) => ({ tick, trigger: 'цикл', chosen: 0, why: 'выручить', options: [{ ...opt('relief', 'Выручить 9-я армия ударом снаружи', 0.3), army: 'de_9a', by }] });
    const hitler: AgentCommander = { ...gerBase('de_hc', 'Гитлер', [[1, 'forbid']]), decisions: [...gerBase('de_hc', 'Гитлер', [[1, 'forbid']]).decisions, relief(20, 'de_12a'), relief(30, 'de_3pza')] };
    const t = trace([zhukov, konev, gerBase('de_9a', 'Буссе', [[1, 'hold'], [7, 'hold'], [13, 'withdraw']]), gerBase('de_12a', 'Венк', [[1, 'hold']]), gerBase('de_3pza', 'Мантейфель', [[1, 'withdraw']]), hitler]);
    const s = rivalrySeries(t);
    expect(s.map((x) => x.hq)).toEqual(['su_1bf', 'su_1uf', 'de_9a', 'de_12a']);
    expect(s[0].points).toEqual([[0, 90], [6, 84], [12, 78]]);
    expect(s[0].marks).toEqual([{ tick: 12, label: 'Ввести 1 гв. ТА в прорыв' }]);
    expect(s[2].points).toEqual([]);
    expect(s[2].marks.map((m) => [m.tick, m.label])).toEqual([[1, 'Держаться'], [13, 'Отходить']]);
    expect(s[3].marks).toEqual([{ tick: 20, label: 'Выручить 9-я армия ударом снаружи' }]);
  });
});

describe('answer', () => {
  const ask = (q: string, tick = 12) => answer(zhukov, tick, q, names);
  it('почему — обоснование и правило выбранного варианта', () => {
    const a = ask(SUGGESTIONS[0]);
    expect(a).toContain('главная полоса не прорвана');
    expect(a).toContain('ПУ-43: правило «Ввести 1 гв. ТА в прорыв»');
  });
  it('противник — оценка по армиям, истину не раскрывает', () => {
    const a = ask(SUGGESTIONS[1]);
    expect(a).toContain('8 гв. А');
    expect(a).toContain('12,4');
    expect(a).not.toContain('30');
    expect(a).not.toMatch(/на самом деле|в действительности/);
  });
  it('сосед — соперник с задержкой сводки', () => {
    const a = ask(SUGGESTIONS[2]);
    expect(a).toContain('1-й Украинский фронт');
    expect(a).toContain('110');
    expect(a).toContain('12 ч');
  });
  it('другой вариант — второй по итогу и разница итогов', () => {
    const a = ask(SUGGESTIONS[3]);
    expect(a).toContain('Продолжать по плану');
    expect(a).toContain('0,51');
  });
  it('другой вариант, когда выбранный — не лучший по уму: называет лучший из прочих', () => {
    expect(answer(zhukov, 6, 'почему не выбрал другой вариант?', names)).toContain('Не вводить подвижную группу');
  });
  it('хочешь — мотивы сейчас против начала', () => {
    const a = ask(SUGGESTIONS[4]);
    expect(a).toContain(MOTIVE_RU.rival);
    expect(a).toContain('0,52');
    expect(a).toContain('0,40');
  });
  it('положение — состояние словами и что его изменило', () => {
    const a = ask(SUGGESTIONS[5]);
    expect(a).toContain('неуверен');
    expect(a).toContain('под сильным давлением');
    expect(a).toMatch(/потер|фланг/);
  });
  it('моё положение на подъёме — «уверен», без давления', () => {
    expect(answer(zhukov, 6, 'как оцениваешь положение?', names)).toMatch(/(^|\s)уверен/);
    expect(answer(zhukov, 6, 'как оцениваешь положение?', names)).not.toContain('под сильным давлением');
  });
  it('час до первого решения — «ещё не принимал»', () => {
    expect(ask('почему так решил?', 3)).toBe('Я ещё не принимал решений к этому часу.');
    expect(ask('почему не выбрал другой вариант?', 3)).toBe('Я ещё не принимал решений к этому часу.');
  });
  it('непонятный вопрос — чего командующий не знает', () => {
    expect(ask('какая погода?')).toBe('Об этом мне нечего сказать: спросите о решении, противнике, соседе или моих целях.');
  });
  it('без имён армий — по идентификатору штаба', () => {
    expect(answer(zhukov, 12, 'что знал о противнике?')).toContain('su_8gva');
  });
});

describe('moodWords', () => {
  it('пороги', () => {
    expect(moodWords({ confidence: 0.7, stress: 0.2 })).toMatch(/уверен/);
    expect(moodWords({ confidence: 0.2, stress: 0.8 })).toMatch(/неуверен.*под сильным давлением/);
    expect(moodWords({ confidence: 0.5, stress: 0.5 })).not.toMatch(/неуверен|под сильным/);
  });
});

describe('decisionRibbon', () => {
  it('лента: решения до часа и ближайшие после, повторы подряд сворачиваются, текущее отмечено', () => {
    const c: AgentCommander = { ...zhukov, decisions: [6, 7, 8, 9, 10, 11, 12].map((tick) => ({ tick, trigger: tick === 12 ? 'прорыв' : 'цикл решения 6 ч', chosen: 0, why: '', options: [opt(tick === 12 ? 'commitMobile' : 'continue', tick === 12 ? 'Ввести ТА' : 'Продолжать по плану', 0.1)] })) };
    const r = decisionRibbon(c, 9);
    expect(r.filter((x) => x.current).map((x) => x.tick)).toEqual([9]);
    expect(r.some((x) => x.future)).toBe(true);
    // подряд идущие «Продолжать по плану» по циклу — одной отметкой (первой из серии)
    expect(r.filter((x) => x.label === 'Продолжать по плану').map((x) => x.tick)).toEqual([6, 9]);
  });
});

describe('hqCentroid', () => {
  const t: AgentTrace = {
    ...trace(), hqs: [{ id: 'su_1bf', name: '1 БФ', side: 'su', echelon: 'front', parent: null }, { id: 'su_8gva', name: '8 гв. А', side: 'su', echelon: 'army', parent: 'su_1bf' }],
    divisions: [{ id: 'a', name: 'a', side: 'su', hq: 'su_8gva', kind: 'rifle', mobility: 'foot', size: 'division', quality: 1 }, { id: 'b', name: 'b', side: 'su', hq: 'su_1bf', kind: 'rifle', mobility: 'foot', size: 'division', quality: 1 },
      { id: 'c', name: 'c', side: 'su', hq: 'su_1bf', kind: 'rifle', mobility: 'foot', size: 'division', quality: 1 }],
    frames: [[[10, 50, 'наступление: атака'], [12, 52, 'оборона: поспешная'], [99, 99, 'не введена в операцию']]],
  };
  it('среднее положение действующих соединений под штабом, не введённые не считаются', () => {
    expect(hqCentroid(t, 'su_1bf', 0)).toEqual([11, 51]);
    expect(hqCentroid(t, 'su_8gva', 0)).toEqual([10, 50]);
    expect(hqCentroid(t, 'de_x', 0)).toBeNull();
  });
});
