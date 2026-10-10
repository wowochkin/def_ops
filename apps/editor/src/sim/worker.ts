/**
 * Расчёт переигровки в фоновом потоке браузера: пакеты данных движка подгружаются
 * модулями сборки (packages/sim/data), прогон и сравнение с историей — тем же кодом,
 * что и в npm run sim:history. Сервер не нужен.
 */
import { analyze, contextFrom, reportMarkdown, runToDocument, summaryToDocument, type DataKind } from '@def-ops/sim';
import type { SimRequest, SimResponse } from './protocol';
import { getData } from './userdata';

// встроенные данные и свои (правила, загруженные операции)
const get = (kind: DataKind, file: string) => getData(kind, file);

const post = (m: SimResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<SimRequest>) => {
  const q = e.data;
  try {
    post({ kind: 'progress', text: 'загрузка данных…' });
    const { ctx, history } = await contextFrom(get, q.scenario, q.rules);
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
        report: reportMarkdown(ctx, a), doc, summary,
      },
    });
  } catch (err) {
    post({ kind: 'error', message: (err as Error).message ?? String(err) });
  }
};
