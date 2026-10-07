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
import { checkEvents, compareWithHistory, runScenario, summarize } from '../../src/history';
import { runToDocument, shortName } from '../../src/publish';

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

const t0 = Date.now();
const run = runScenario(ctx, seed);
const ms = Date.now() - t0;
const devs = compareWithHistory(ctx, run, history);
const sum = summarize(devs, tol);
const names = new Map(run.final.formations.map((f) => [f.id, shortName(f.name)]));

// разброс по seed
const spread: { seed: number; within: number; median: number }[] = [];
for (let k = 0; k < runs; k++) {
  const r = k === 0 ? run : runScenario(ctx, seed + k);
  const s = summarize(compareWithHistory(ctx, r, history), tol);
  spread.push({ seed: seed + k, within: s.within, median: s.medianExcessKm });
}

const L: string[] = [];
L.push(`# Исторический прогон: ${ctx.scenario.name}`, '');
L.push(`Сценарий \`${ctx.scenario.id}\`, правила \`${ctx.rules.id}\`, seed ${seed}; ходов ${run.final.turn} по ${ctx.scenario.turnHours} ч; расчёт ${ms} мс.`, '');
L.push('Обе стороны получают исторические приказы: идти к следующему известному положению (советские — наступать, немецкие — обороняться или отходить). Арбитр решает, успевают ли они и чем кончаются бои. Отклонение — расстояние от расчётного положения до исторического; «сверх» — за вычетом неопределённости исторического положения.', '');
L.push(`**В пределах ${tol} км сверх неопределённости: ${(sum.within * 100).toFixed(0)} %** положений (${sum.n}); медиана превышения ${sum.medianExcessKm} км.`, '');
if (runs > 1) {
  const w = spread.map((x) => x.within);
  L.push(`Разброс по ${runs} прогонам (seed ${seed}…${seed + runs - 1}): доля в допуске ${(Math.min(...w) * 100).toFixed(0)}–${(Math.max(...w) * 100).toFixed(0)} %.`, '');
}
const events = checkEvents(ctx, run, history);
if (events.length) {
  L.push('## Ключевые события', '', '| событие | история | расчёт | расхождение, сут |', '|---|---|---|---|');
  for (const e of events) L.push(`| ${e.title} | ${e.historical.slice(5)} | ${e.simulated?.slice(5) ?? 'не произошло'} | ${e.days == null ? '—' : e.days > 0 ? `+${e.days}` : e.days} |`);
  L.push('');
}
L.push('## По дням', '', '| день | положений | среднее отклонение, км | медиана сверх, км | в допуске |', '|---|---|---|---|---|');
for (const d of [...sum.byDay].sort((a, b) => a.key.localeCompare(b.key))) L.push(`| ${d.key} | ${d.n} | ${d.meanKm} | ${d.medianExcessKm} | ${(d.within * 100).toFixed(0)} % |`);
L.push('', '## По формированиям', '', '| формирование | положений | среднее, км | медиана сверх, км | в допуске |', '|---|---|---|---|---|');
for (const d of [...sum.byFormation].sort((a, b) => a.within - b.within)) L.push(`| ${names.get(d.key) ?? d.key} | ${d.n} | ${d.meanKm} | ${d.medianExcessKm} | ${(d.within * 100).toFixed(0)} % |`);
L.push('', '## Наибольшие расхождения', '', '| формирование | дата | историческое место | отклонение, км | сверх, км |', '|---|---|---|---|---|');
for (const d of [...devs].sort((a, b) => b.excessKm - a.excessKm).slice(0, 15)) L.push(`| ${names.get(d.formation)} | ${d.time.slice(0, 10)} | ${d.place} (${d.reliability}, ±${d.approxKm}) | ${d.km} | ${d.excessKm} |`);
L.push('', '## Бои', '', '| ход | наступающие | обороняющиеся | соотношение | исход | продвижение, км | потери наст./обор., % |', '|---|---|---|---|---|---|---|');
for (const j of run.final.journal) {
  if (j.kind !== 'combat') continue;
  L.push(`| ${j.time.slice(5, 10)} | ${j.attackers.map((x) => names.get(x)).join(', ')} | ${j.defenders.map((x) => names.get(x)).join(', ')} | ${j.ratio} | ${j.outcome} | ${j.advanceKm} | ${(j.attackerLoss * 100).toFixed(1)} / ${(j.defenderLoss * 100).toFixed(1)} |`);
}
L.push('', '## Итог по силам', '', '| формирование | люди (нач. → кон.) | танки (нач. → кон.) |', '|---|---|---|');
for (const f of run.final.formations) L.push(`| ${shortName(f.name)} | ${f.initial.personnel.toLocaleString('ru')} → ${f.personnel.toLocaleString('ru')}${f.destroyed ? ' (разгромлено)' : ''} | ${f.initial.tanks} → ${f.tanks} |`);
L.push('', '## Оговорки', '', '- Числа профилей и правил — черновик до калибровки (этап 2); снабжение без подвоза.', '- Приказы — к историческим положениям, поэтому прогон проверяет темпы и бои, а не замысел сторон.', '- Положения с достоверностью C — оценки составителя набора данных.');
writeFileSync(join(out, 'report.md'), L.join('\n'));
writeFileSync(join(out, 'deviations.json'), JSON.stringify({ summary: sum, spread, deviations: devs }, null, 1));

const doc = runToDocument(ctx, run, history, { name: `Переигровка (история): ${ctx.scenario.id}, seed ${seed}` });
writeFileSync(join(out, 'map.json'), JSON.stringify(doc));
for (const e of events) console.log(`  ${e.title}: история ${e.historical.slice(5)}, расчёт ${e.simulated?.slice(5) ?? '—'}`);
console.log(`ходов ${run.final.turn}, ${ms} мс; в допуске ${(sum.within * 100).toFixed(0)} % из ${sum.n}; медиана сверх ${sum.medianExcessKm} км`);
if (runs > 1) console.log('по seed:', spread.map((x) => `${x.seed}:${(x.within * 100).toFixed(0)}%`).join(' '));
console.log(`отчёт: ${join(out, 'report.md')}\nкарта: ${join(out, 'map.json')} (${doc.features.length} объектов)`);

if (publish) {
  const r = await fetch(`${publish.replace(/\/$/, '')}/api/documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) });
  if (!r.ok) console.error(`публикация не удалась: ${r.status} ${await r.text()}`);
  else console.log(`опубликовано: документ ${(await r.json()).id}`);
}
