import { describe, expect, it } from 'vitest';
import { loadContext, loadHistory } from '../src/data';
import { compareWithHistory, createState, onMap, runScenario, runToDocument, shortName, step, summarize, summaryToDocument, teethToward } from '../src';
import { beltHold } from '../src/publish';

describe('сценарий «Берлин-1945»', () => {
  const ctx = loadContext('berlin-1945');

  it('собирается: формирования на театре, приказы на известные цели', () => {
    const s = createState(ctx, 1);
    expect(s.formations.length).toBeGreaterThan(35);
    for (const f of s.formations) expect(ctx.theatre.indexOf(f.position)).toBeGreaterThanOrEqual(0);
    expect(s.pending.every((o) => s.formations.some((f) => f.id === o.formation))).toBe(true);
  });

  it('введённые позже формирования до срока не на карте и приказы их ждут', () => {
    let s = createState(ctx, 1);
    const f28 = s.formations.find((f) => f.id === 'su_28a')!;
    expect(onMap(f28, s.time)).toBe(false);
    const before = f28.position;
    s = step(s, ctx);
    expect(s.formations.find((f) => f.id === 'su_28a')!.position).toEqual(before);
    expect(s.pending.some((o) => o.formation === 'su_28a')).toBe(true);
  });

  it('детерминирован и сравним с историей', () => {
    const a = runScenario(ctx, 7, 4), b = runScenario(ctx, 7, 4);
    expect(a.final.formations.map((f) => f.position)).toEqual(b.final.formations.map((f) => f.position));
    const devs = compareWithHistory(ctx, a, loadHistory('berlin-1945'));
    expect(devs.length).toBeGreaterThan(20);
    const sum = summarize(devs);
    expect(sum.within).toBeGreaterThan(0.5);
  }, 30_000);

  it('публикуется картой со шкалой времени и ключевыми кадрами', () => {
    const run = runScenario(ctx, 1, 3);
    const doc = runToDocument(ctx, run, loadHistory('berlin-1945'));
    expect(doc.timeline?.start).toBe(ctx.scenario.start);
    const units = doc.features.filter((f) => f.layerId === 'sim-own' || f.layerId === 'sim-enemy');
    expect(units.length).toBeGreaterThan(30);
    expect(units.every((f) => (f.keyframes?.length ?? 0) >= 1)).toBe(true);
    expect(doc.features.some((f) => f.layerId === 'hist-units')).toBe(true);
    // уровень «Армия»: знаки корпусов (соединения без корпуса — под армией), слой скрыт до выбора уровня
    expect(doc.layers.find((l) => l.id === 'lvl-co-units')?.visible).toBe(false);
    const co = doc.features.filter((f) => f.layerId === 'lvl-co-units' && f.kind === 'symbol' && (f as { ref?: string }).ref) as { ref?: string }[];
    const ech = new Map(ctx.scenario.formations.map((f) => [f.id, f.echelon]));
    expect(co.some((f) => ech.get(f.ref!) === 'corps')).toBe(true);
    expect(co.every((f) => ['corps', 'army', 'front'].includes(ech.get(f.ref!) ?? ''))).toBe(true);
  }, 30_000);

  it('рубежи театра — знаком оборонительного рубежа, зубцы к противнику', () => {
    // знак ставит зубцы слева по ходу линии: противник на востоке — линия идёт с севера на юг
    expect(teethToward([[14, 52], [14, 53]], [[15, 52.5]])[0]).toEqual([14, 53]);
    expect(teethToward([[14, 53], [14, 52]], [[15, 52.5]])[0]).toEqual([14, 53]);
    // решает ближайший противник, а не дальние группировки
    expect(teethToward([[14, 53], [14, 52]], [[13.9, 52.5], [20, 52.5], [20, 52.6]])[0]).toEqual([14, 52]);
    const run = runScenario(ctx, 1, 1);
    const doc = runToDocument(ctx, run, null);
    const belts = doc.features.filter((f) => f.layerId === 'theatre');
    // за первые сутки ни одна полоса не взята целиком
    expect(ctx.theatre.data.lines.every((l) => belts.some((f) => f.name!.startsWith(l.name)))).toBe(true);
    expect(belts.every((f) => f.preset === 'atlas.defense')).toBe(true);
    const hkl = belts.find((f) => /Hauptkampflinie/.test(f.name ?? '')) as { points: [number, number][] };
    expect(hkl.points[0][1]).toBeGreaterThan(hkl.points[hkl.points.length - 1][1]);
  });

  it('участок полосы уходит с карты, когда противник за ним', () => {
    // полоса с севера на юг (зубцы — на восток), противник перед ней не берёт её, за ней (западнее) — берёт
    const line: [number, number][] = [[0, 30], [0, 0]];
    const pieces = beltHold(line, [[[5, 5]], [[5, 5]], [[-3, 5]], [[-3, 22]]], 2);
    expect(pieces.map((x) => x.until)).toEqual([3, 2]);
    expect(pieces[0].points[0]).toEqual([0, 30]);
    expect(pieces[1].points[pieces[1].points.length - 1]).toEqual([0, 0]);
    expect(beltHold(line, [[[5, 5]], [[1, 5]]], 2).map((x) => x.until)).toEqual([null]);
    // на прогоне Берлинской: главная полоса на Одере держится в начале и прорывается по ходу операции
    const tctx = loadContext('berlin-1945-tasks');
    const run = runScenario(tctx, 1, 8);
    const hkl = runToDocument(tctx, run, null).features.filter((f) => f.layerId === 'theatre' && /Hauptkampflinie/.test(f.name ?? ''));
    expect(hkl.length).toBeGreaterThan(0);
    expect(hkl.some((f) => f.time?.to != null)).toBe(true);
    expect(hkl.every((f) => f.time?.from === tctx.scenario.start && (f.time.to == null || f.time.to > tctx.scenario.start))).toBe(true);
  });

  it('графика атласа: исходный и вчерашний фронт, оси танковых армий с датами, черта и дата у остановленных ударов', () => {
    const tctx = loadContext('berlin-1945-tasks');
    const run = runScenario(tctx, 1, 8);
    const doc = runToDocument(tctx, run, loadHistory('berlin-1945-tasks'));
    const by = (layer: string) => doc.features.filter((f) => f.layerId === layer);
    expect(by('sim-front-start').length).toBeGreaterThan(0);
    expect(by('sim-front-start').every((f) => f.time?.to == null)).toBe(true);
    // вчерашний фронт — та же линия, сдвинутая на сутки
    const prev = by('sim-front-prev'), cur = by('sim-front');
    expect(prev.length).toBe(cur.length);
    expect(Date.parse(`${prev[0].time!.from}Z`) - Date.parse(`${cur[0].time!.from}Z`)).toBe(864e5);
    const axes = doc.features.filter((f) => f.kind === 'arrow' && f.preset === 'atlas.tankAxis');
    expect(axes.length).toBeGreaterThan(0);
    expect(by('lvl-op-moves').some((f) => f.kind === 'label' && /^\d+\.\d+$/.test((f as { text?: string }).text ?? ''))).toBe(true);
    // дата у острия — только у ударов с чертой «рубеж достигнут»
    const dated = doc.features.filter((f) => f.kind === 'arrow' && (f as { tipText?: string }).tipText);
    expect(dated.every((f) => (f as { style: { tip?: string } }).style.tip === 'bar')).toBe(true);
  }, 60000);

  it('сводная карта: этапы, линии фронта на их рубежах с датами, удары с датами, легенда; без шкалы времени', () => {
    const tctx = loadContext('berlin-1945-tasks');
    const run = runScenario(tctx, 1, 10);
    const doc = summaryToDocument(tctx, run, loadHistory('berlin-1945-tasks'), { stages: 2 });
    expect(doc.timeline).toBeUndefined();
    expect(doc.features.every((f) => !f.time && !f.keyframes)).toBe(true);
    const by = (layer: string) => doc.features.filter((f) => f.layerId === layer);
    // линии фронта: на начало (с подсветкой), к концу 1-го этапа и на конец — у каждой ровно одна дата
    const fronts = by('sum-front') as { preset?: string; style: { labels?: { text: string }[] } }[];
    expect(fronts.some((f) => f.preset === 'atlas.frontGlow')).toBe(true);
    const dates = fronts.flatMap((f) => f.style.labels?.map((l) => l.text) ?? []);
    expect(new Set(dates).size).toBe(3);
    expect(dates.length).toBe(3);
    // удары — стилем своего этапа, с датой у острия
    const moves = by('sum-moves') as { preset?: string; tipText?: string }[];
    expect(moves.length).toBeGreaterThan(5);
    expect(moves.filter((m) => m.preset === 'atlas.p1' || m.preset === 'atlas.p2').every((m) => m.tipText && dates.includes(m.tipText))).toBe(true);
    expect(by('sum-legend').some((f) => f.kind === 'label' && /сводная карта/.test((f as { text?: string }).text ?? ''))).toBe(true);
  }, 60000);

  it('короткие подписи', () => {
    expect(shortName('8-я гвардейская армия')).toBe('8 гв. А');
    expect(shortName('1-я гвардейская танковая армия')).toBe('1 гв. ТА');
    expect(shortName('3-я ударная армия')).toBe('3 УА');
    expect(shortName('XI танковый корпус СС')).toBe('XI тк СС');
    expect(shortName('Корпусная группа «Свинемюнде»')).toBe('«Свинемюнде»');
    // дивизии и корпуса — сокращениями штабных карт, без собственного имени номерной дивизии
    expect(shortName('11-я добровольческая танко-гренадерская дивизия СС «Нордланд»')).toBe('11 тгд СС');
    expect(shortName('309-я пехотная дивизия «Берлин»')).toBe('309 пд');
    expect(shortName('545-я народно-гренадерская дивизия')).toBe('545 нгд');
    expect(shortName('25-я моторизованная (танко-гренадерская) дивизия')).toBe('25 мд');
    expect(shortName('26-й гвардейский стрелковый корпус')).toBe('26 гв. ск');
    expect(shortName('7-й гвардейский кавалерийский корпус')).toBe('7 гв. кк');
    expect(shortName('Гарнизон крепости Штеттин (Festung Stettin)')).toBe('гарн. Штеттин');
    expect(shortName('1-й Белорусский фронт')).toBe('1 БФ');
  });
});

describe('панель «Переигровка»: загрузка данных без файловой системы и отчёт', () => {
  it('contextFrom даёт тот же расчёт, что loadContext; отчёт содержит события и бои', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { DATA_DIR, loadContext } = await import('../src/data');
    const { contextFrom, analyze, reportMarkdown, runScenario } = await import('../src');
    const get = (kind: string, file: string) => JSON.parse(readFileSync(join(DATA_DIR, kind, file), 'utf8'));
    const { ctx, history } = await contextFrom(get, 'berlin-city-1945');
    const ref = loadContext('berlin-city-1945');
    expect(ctx.rules).toEqual(ref.rules);
    const a = runScenario(ctx, 2), b = runScenario(ref, 2);
    expect(a.final.formations.map((f) => f.position)).toEqual(b.final.formations.map((f) => f.position));
    const an = analyze(ctx, history, { runs: 2, toleranceKm: 2 });
    expect(an.spread).toHaveLength(2);
    expect(an.eventsBySeed[0].days).toHaveLength(2);
    const md = reportMarkdown(ctx, an);
    expect(md).toContain('## Ключевые события');
    expect(md).toContain('## Бои');
  }, 60000);
});
