#!/usr/bin/env node
/**
 * Показ симуляции одной командой: исторические прогоны трёх сценариев и сводка.
 *
 *   npm run sim:demo                         # все три сценария, по 5 прогонов
 *   npm run sim:demo -- --only berlin        # только Берлинская операция
 *   npm run sim:demo -- --runs 1             # быстрее: один прогон на сценарий
 *   npm run sim:demo -- --publish http://localhost:8080   # ещё и сохранить карты в запущенную платформу
 *
 * Результат — в evals-out/demo/<сценарий>/: report.md (сравнение с историей: события,
 * положения по дням и формированиям, бои) и map.json (карта для редактора:
 * «Открыть / импорт…»; ползунок времени — ход операции по часам).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const runs = opt('runs', '5');
const only = opt('only');
const publish = opt('publish');
const outRoot = resolve(opt('out', 'evals-out/demo'));

const SCENARIOS = [
  { key: 'berlin', id: 'berlin-1945-tasks', title: 'Берлинская операция, 16.04–2.05.1945 (армии и корпуса; на Зееловских высотах — дивизии)', tolerance: '10',
    note: 'правила откалиброваны на этой операции (обучение — по 25.04, проверка — после)' },
  { key: 'city', id: 'berlin-city-1945', title: 'Бой в Берлине, 24.04–2.05.1945 (корпуса и гарнизоны секторов, клетка 250 м)', tolerance: '2',
    note: 'городские правила откалиброваны по дням до 28.04, проверка — 29.04–2.05' },
  { key: 'vistula', id: 'vistula-oder-1945', title: 'Висло-Одерская операция, 12.01–3.02.1945 — контрольная', tolerance: '10',
    note: 'правила Берлинской операции без подгонки: проверка модели на чужой операции' },
].filter((s) => !only || only.split(',').includes(s.key));

const isWin = process.platform === 'win32';
const summary = [];
for (const s of SCENARIOS) {
  const out = join(outRoot, s.id);
  mkdirSync(out, { recursive: true });
  console.log(`\n▶ ${s.title}\n  ${s.note}`);
  const a = ['tsx', 'packages/sim/tools/run/history.ts', '--scenario', s.id, '--runs', runs, '--tolerance', s.tolerance, '--out', out];
  if (publish) a.push('--publish', publish);
  const t0 = Date.now();
  const r = spawnSync('npx', a, { encoding: 'utf8', shell: isWin, maxBuffer: 64 << 20 });
  if (r.status !== 0) { console.error(r.stdout, r.stderr); process.exit(r.status ?? 1); }
  const lines = r.stdout.split('\n');
  for (const l of lines) if (/история .*, расчёт|в допуске|по seed|отчёт:|карта:|опубликовано|документ/.test(l)) console.log('  ' + l.trim());
  const within = /в допуске (\d+) %/.exec(r.stdout)?.[1];
  const events = lines.filter((l) => /история .*, расчёт/.test(l));
  const hit = events.filter((l) => { const m = /история (\d\d)-(\d\d), расчёт (\d\d)-(\d\d)/.exec(l); return m && Math.abs((+m[3] - +m[1]) * 31 + (+m[4] - +m[2])) <= 2; }).length;
  summary.push({ title: s.title, within, events: `${hit} из ${events.length}`, tolerance: s.tolerance, out, sec: ((Date.now() - t0) / 1000).toFixed(0) });
}

console.log('\n══ Сводка ══');
for (const x of summary) console.log(`• ${x.title}\n    положения в допуске ±${x.tolerance} км: ${x.within} %; ключевые события ±2 сут: ${x.events}; ${x.sec} с\n    ${x.out}`);
writeFileSync(join(outRoot, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(`
Посмотреть на карте:
  1) npm run dev            → http://localhost:5173/
  2) «Открыть / импорт…» → <папка сценария>/map.json
  3) ползунок времени внизу — ход операции; слои: расчёт, история (призраки), линии фронта, бои
Отчёт о сравнении с историей — <папка сценария>/report.md`);
