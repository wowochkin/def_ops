/**
 * Расчёт переигровки в фоновом потоке браузера: пакеты данных движка подгружаются
 * модулями сборки (packages/sim/data), прогон и сравнение с историей — тем же кодом,
 * что и в npm run sim:history. Сервер не нужен.
 */
import { agentsHistory, agentsToRun, analyze, checkEvents, operationSummary, compareWithHistory, contextFrom, reportMarkdown, runToDocument, snapshotZones, summarize, summaryToDocument, type DataKind, type History, type RunResult, type ZoneGrid, type SimContext } from '@def-ops/sim';
import type { SimRequest, SimResponse, SimResult } from './protocol';
import { getData } from './userdata';
import { replayUnits } from '../formation-card';
import { kbStamp, withKbStamp, type KbStamp } from './kb-stamp';
import { replayDebriefs, summaryReply } from './replay-debrief';

// встроенные данные и свои (правила, загруженные операции)
const get = (kind: DataKind, file: string) => getData(kind, file);

const post = (m: SimResponse) => (self as unknown as Worker).postMessage(m);

/**
 * Зоны влияния для карты «Переигровки»: снимки через сутки от начала (ближайший не раньше) и последний; сторона —
 * советская. Ошибка расчёта — зон нет (карта без них).
 */
/** Значения зоны −100…100 — в Int8Array: в пять раз меньше при передаче и сохранении. */
const packZone = (z: ZoneGrid): ZoneGrid => ({ ...z, v: Int8Array.from(z.v) });

function zonesOf(ctx: SimContext, run: RunResult): SimResult['zones'] {
  try {
    const sn = run.snapshots;
    if (!sn.length) return undefined;
    const side = (ctx.scenario.sides.find((x) => x.id === 'su') ?? ctx.scenario.sides[0]).id;
    const t0 = Date.parse(`${ctx.scenario.start}Z`);
    const picked: typeof sn = [];
    for (let k = 0; ; k++) {
      const at = t0 + k * 86400000;
      const s = sn.find((x) => Date.parse(`${x.time}Z`) >= at);
      if (!s) break;
      if (!picked.includes(s)) picked.push(s);
    }
    const last = sn[sn.length - 1];
    if (!picked.includes(last)) picked.push(last);
    return { side, frames: picked.map((s) => ({ time: s.time, grid: packZone(snapshotZones(ctx, s, side)) })) };
  } catch { return undefined; }
}

self.onmessage = async (e: MessageEvent<SimRequest>) => {
  const q = e.data;
  try {
    post({ kind: 'progress', text: 'загрузка данных…' });
    // отметка сборки из базы — по тем же правкам операции, что и данные (окно дождалось сборки до запуска)
    const [{ ctx, history }, kb] = await Promise.all([contextFrom(get, q.scenario, q.rules), kbStamp(q.scenario)]);
    if (q.agents && q.summaryOnly) {
      const A = q.agents;
      // разбор хода упал — сводка всё равно уходит (без разбора)
      return post(summaryReply(() => operationSummary(ctx, A.trace, A.history, history), () => replayDebriefs(ctx, A.trace, A.history, history), !!q.debriefs));
    }
    if (q.agents) return agents(q, ctx, history, kb);
    const a = analyze(ctx, history, {
      seed: q.seed, runs: q.runs, toleranceKm: q.toleranceKm,
      onRun: (k, n) => post({ kind: 'progress', text: n > 1 ? `прогон ${k} из ${n}…` : 'расчёт…' }),
    });
    post({ kind: 'progress', text: 'карта…' });
    const zones = zonesOf(ctx, a.run);
    const doc = runToDocument(ctx, a.run, history, { name: `Переигровка: ${ctx.scenario.name} (правила ${ctx.rules.id}, seed ${q.seed})` });
    const summary = summaryToDocument(ctx, a.run, history, { base: doc, name: `Сводная карта: ${ctx.scenario.name.split(':')[0]} (правила ${ctx.rules.id}, seed ${q.seed})` });
    const all = a.eventsBySeed.flatMap((x) => x.days);
    post({
      kind: 'done',
      result: {
        scenario: q.scenario, rules: ctx.rules.id, seed: q.seed, runs: a.spread.length, ms: a.ms,
        start: ctx.scenario.start, end: ctx.scenario.end, turnHours: ctx.scenario.turnHours, scenarioName: ctx.scenario.name,
        within: a.summary.within, n: a.summary.n, medianExcessKm: a.summary.medianExcessKm,
        spread: a.spread.map((s) => s.within),
        events: a.eventsBySeed.map((x) => {
          const first = a.events.find((y) => y.id === x.id);
          const ev = history.events?.find((y) => y.id === x.id);
          const place = ev && 'place' in ev ? ctx.theatre.area(ev.place)?.center ?? null : null;
          return { title: x.title, historical: x.historical, simulated: first?.simulated ?? null, days: x.days, at: first?.at ?? null, place, marker: !!ev?.marker };
        }),
        eventsHit: all.filter((d) => d != null && Math.abs(d) <= 2).length, eventsTotal: all.length,
        report: withKbStamp(reportMarkdown(ctx, a), kb), doc, summary, units: replayUnits(ctx, a.run), kb, ...(zones ? { zones } : {}),
      },
    });
  } catch (err) {
    post({ kind: 'error', message: (err as Error).message ?? String(err) });
  }
};

/**
 * Агентная модель: ход по часам уже посчитан ядром (команда run_scenario настольного приложения); здесь — снимки
 * через stepHours, сверка с историей дивизий и та же карта, что у нынешней модели.
 */
function agents(q: SimRequest, base: SimContext, baseHistory: History, kb: KbStamp | null) {
  const A = q.agents!;
  const t0 = Date.now();
  post({ kind: 'progress', text: 'сверка с историей…' });
  const { ctx, run } = agentsToRun(base, A.trace, A.stepHours);
  const history = agentsHistory(A.history, baseHistory);
  const s = summarize(compareWithHistory(ctx, run, history), q.toleranceKm);
  const events = checkEvents(ctx, run, history);
  // итоги: потери сторон по всему ходу рядом с историческими; ошибка — переигровка без итогов
  let operation: SimResult['operation'];
  try { operation = operationSummary(base, A.trace, A.history, baseHistory); } catch (e) { console.warn('итоги операции не посчитаны:', e); }
  // разбор хода по суткам — те же правила, что в игре; ошибка — переигровка без разбора
  post({ kind: 'progress', text: 'разбор хода…' });
  let debriefs: SimResult['debriefs'];
  try { debriefs = replayDebriefs(base, A.trace, A.history, baseHistory); } catch (e) { console.warn('разбор хода не посчитан:', e); }
  post({ kind: 'progress', text: 'карта…' });
  const zones = zonesOf(ctx, run);
  const name = `${A.title} — агентная модель (seed ${q.seed})`;
  const doc = runToDocument(ctx, run, history, { name: `Переигровка: ${name}`, frontCombine: 'max' });
  const summary = summaryToDocument(ctx, run, history, { base: doc, name: `Сводная карта: ${name}` });
  const ev = history.events ?? [];
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  const report = [
    `# ${name}`, '',
    `Расчёт — агентная модель (дивизии, шаг 1 ч; на карте — каждые ${A.stepHours} ч), источники решений штабов: ${(A.trace.sources ?? []).join(', ') || '—'}.`, '',
    `Положений дивизий в допуске ±${q.toleranceKm} км сверх неопределённости источника: **${pct(s.within)}** из ${s.n}, медиана превышения ${s.medianExcessKm} км.`, '',
    '| Событие | История | Расчёт | Сутки |', '|---|---|---|---|',
    ...events.map((e) => `| ${e.title} | ${e.historical} | ${e.simulated ?? '—'} | ${e.days ?? '—'} |`),
  ].join('\n');
  post({
    kind: 'done',
    result: {
      scenario: q.scenario, rules: ctx.rules.id, seed: q.seed, runs: 1, ms: Date.now() - t0, engine: 'agents',
      start: ctx.scenario.start, end: ctx.scenario.end, turnHours: A.stepHours, scenarioName: name,
      within: s.within, n: s.n, medianExcessKm: s.medianExcessKm, spread: [s.within],
      events: events.map((e) => {
        const h = ev.find((y) => y.id === e.id);
        const place = h && 'place' in h ? ctx.theatre.area(h.place)?.center ?? null : null;
        return { title: e.title, historical: e.historical, simulated: e.simulated, days: [e.days], at: e.at, place, marker: !!h?.marker };
      }),
      eventsHit: events.filter((e) => e.days != null && Math.abs(e.days) <= 2).length, eventsTotal: events.length,
      report: withKbStamp(report, kb), doc, summary, units: replayUnits(ctx, run), kb, ...(zones ? { zones } : {}), ...(operation ? { operation } : {}), ...(debriefs ? { debriefs } : {}),
    },
  });
}
