/**
 * Расчёт переигровки в фоновом потоке браузера: пакеты данных движка подгружаются
 * модулями сборки (packages/sim/data), прогон и сравнение с историей — тем же кодом,
 * что и в npm run sim:history. Сервер не нужен.
 */
import { analyze, contextFrom, reportMarkdown, runToDocument, type DataKind } from '@def-ops/sim';
import type { SimRequest, SimResponse } from './protocol';

const files = import.meta.glob('../../../../packages/sim/data/{scenarios,theatres,profiles,rules}/*.json', { import: 'default' });
const get = async (kind: DataKind, file: string) => {
  const load = files[`../../../../packages/sim/data/${kind}/${file}`];
  if (!load) throw new Error(`нет файла данных ${kind}/${file}`);
  return load();
};

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
    const all = a.eventsBySeed.flatMap((x) => x.days);
    post({
      kind: 'done',
      result: {
        scenario: q.scenario, rules: ctx.rules.id, seed: q.seed, runs: a.spread.length, ms: a.ms,
        within: a.summary.within, n: a.summary.n, medianExcessKm: a.summary.medianExcessKm,
        spread: a.spread.map((s) => s.within),
        events: a.eventsBySeed.map((x) => ({ title: x.title, historical: x.historical, simulated: a.events.find((y) => y.id === x.id)?.simulated ?? null, days: x.days })),
        eventsHit: all.filter((d) => d != null && Math.abs(d) <= 2).length, eventsTotal: all.length,
        report: reportMarkdown(ctx, a), doc,
      },
    });
  } catch (err) {
    post({ kind: 'error', message: (err as Error).message ?? String(err) });
  }
};
