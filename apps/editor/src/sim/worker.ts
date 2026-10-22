/**
 * Расчёт переигровки в фоновом потоке браузера: пакеты данных движка подгружаются
 * модулями сборки (packages/sim/data), прогон и сравнение с историей — тем же кодом,
 * что и в npm run sim:history. Сервер не нужен.
 */
import { agentsHistory, agentsToRun, analyze, checkEvents, compareWithHistory, contextFrom, reportMarkdown, runToDocument, summarize, summaryToDocument, type DataKind, type History, type SimContext } from '@def-ops/sim';
import type { SimRequest, SimResponse } from './protocol';
import { getData } from './userdata';
import { replayUnits } from '../formation-card';
import { kbStamp, withKbStamp, type KbStamp } from './kb-stamp';

// встроенные данные и свои (правила, загруженные операции)
const get = (kind: DataKind, file: string) => getData(kind, file);

const post = (m: SimResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<SimRequest>) => {
  const q = e.data;
  try {
    post({ kind: 'progress', text: 'загрузка данных…' });
    // отметка сборки из базы — по тем же правкам операции, что и данные (окно дождалось сборки до запуска)
    const [{ ctx, history }, kb] = await Promise.all([contextFrom(get, q.scenario, q.rules), kbStamp(q.scenario)]);
    if (q.agents) return agents(q, ctx, history, kb);
    const a = analyze(ctx, history, {
      seed: q.seed, runs: q.runs, toleranceKm: q.toleranceKm,
      onRun: (k, n) => post({ kind: 'progress', text: n > 1 ? `прогон ${k} из ${n}…` : 'расчёт…' }),
    });
    post({ kind: 'progress', text: 'карта…' });
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
        report: withKbStamp(reportMarkdown(ctx, a), kb), doc, summary, units: replayUnits(ctx, a.run), kb,
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
  post({ kind: 'progress', text: 'карта…' });
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
      report: withKbStamp(report, kb), doc, summary, units: replayUnits(ctx, run), kb,
    },
  });
}
