/**
 * Исторический прогон сценария: обе стороны действуют по историческим приказам,
 * арбитр считает движение и бои; результат сравнивается с историей.
 *
 *   npm run sim:history -- [--scenario berlin-1945] [--rules ww2-berlin-cal] [--seed 1] [--runs 20] [--out evals-out/sim]
 *                          [--publish http://localhost:8080]
 *
 * Пишет в каталог: report.md (отклонения по дням и формированиям, бои),
 * map.json (карта для редактора: «Файл → Открыть»), deviations.json.
 * --runs N — N прогонов с разными seed: разброс отклонений (чувствительность к случайности).
 * --publish URL — сохранить карту в сервис документов через шлюз (POST /api/documents).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadContext, loadHistory } from '../../src/data';
import { runToDocument } from '../../src/publish';
import { analyze, reportMarkdown } from '../../src/report';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const scenarioId = opt('scenario', 'berlin-1945')!;
const seed = Number(opt('seed', '1'));
const runs = Number(opt('runs', '1'));
const out = resolve(opt('out', `evals-out/sim/${scenarioId}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`)!);
const publish = opt('publish');
const tol = Number(opt('tolerance', '10'));

const ctx = loadContext(scenarioId, opt('rules'));
const history = loadHistory(scenarioId);
mkdirSync(out, { recursive: true });

const a = analyze(ctx, history, { seed, runs, toleranceKm: tol });
const { run, summary: sum, spread, events } = a;
writeFileSync(join(out, 'report.md'), reportMarkdown(ctx, a));
writeFileSync(join(out, 'deviations.json'), JSON.stringify({ summary: sum, spread, deviations: a.deviations, eventsBySeed: a.eventsBySeed }, null, 1));

const doc = runToDocument(ctx, run, history, { name: `Переигровка (история): ${ctx.scenario.id}, seed ${seed}` });
writeFileSync(join(out, 'map.json'), JSON.stringify(doc));
for (const e of events) console.log(`  ${e.title}: история ${e.historical.slice(5)}, расчёт ${e.simulated?.slice(5) ?? '—'}`);
console.log(`ходов ${run.final.turn}, ${a.ms} мс; в допуске ${(sum.within * 100).toFixed(0)} % из ${sum.n}; медиана сверх ${sum.medianExcessKm} км`);
if (runs > 1) console.log('по seed:', spread.map((x) => `${x.seed}:${(x.within * 100).toFixed(0)}%`).join(' '));
console.log(`отчёт: ${join(out, 'report.md')}\nкарта: ${join(out, 'map.json')} (${doc.features.length} объектов)`);

if (publish) {
  const r = await fetch(`${publish.replace(/\/$/, '')}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) });
  if (!r.ok) console.error(`публикация не удалась: ${r.status} ${await r.text()}`);
  else console.log(`опубликовано: документ ${(await r.json()).id}`);
}
