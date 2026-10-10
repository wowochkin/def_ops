/**
 * Где живёт ошибка: превышение отклонения положений над неопределённостью — по режимам боя. Режим формирования
 * на момент исторического положения: застройка (клетка городская), укреплённая полоса (клетка полосы), бой на
 * открытой местности, марш/преследование (движется без боя), стоит; в городском сценарии — бой, марш, стоит.
 * Показывает, какой режим даёт основную ошибку и не нужен ли ему отдельный набор правил (раздел 21).
 *
 *   npm run sim:regimes [-- --seeds 3 --out evals-out/regimes]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadContext, loadHistory } from '../../src/data';
import { runScenario } from '../../src/history';
import { dist } from '../../src/geo';
import { TERRAIN_CLASSES } from '../../src/types';
const OUT = resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'evals-out/regimes');
const L: string[] = ['# Ошибка по режимам боя', '', 'Превышение отклонения положений над неопределённостью, км; прогонов на сценарий — по числу seed.', ''];
const si = process.argv.indexOf('--seeds');
const NS = si >= 0 ? Number(process.argv[si + 1]) : 3;
const TOL: Record<string, number> = { 'berlin-1945-tasks': 10, 'berlin-city-1945': 2, 'vistula-oder-1945': 10 };
for (const id of Object.keys(TOL)) {
  const ctx = loadContext(id), hist = loadHistory(id), T = ctx.theatre;
  const agg = new Map<string, { n: number; sum: number; within: number; lag: number[] }>();
  for (const seed of Array.from({ length: NS }, (_, k) => k + 1)) {
    const run = runScenario(ctx, seed);
    const J = run.final.journal;
    for (const h of hist.positions) {
      if (h.time <= ctx.scenario.start) continue;
      const s = run.snapshots.find((x) => x.time >= h.time); const u = s?.units.find((x) => x.id === h.formation);
      if (!s || !u || u.destroyed) continue;
      const side = ctx.scenario.formations.find((f) => f.id === h.formation)?.side;
      const prevT = run.snapshots[run.snapshots.indexOf(s) - 1]?.time ?? ctx.scenario.start;
      const inCombat = J.some((j) => j.kind === 'combat' && j.time >= prevT && j.time <= s.time && (j.attackers.includes(h.formation) || j.defenders.includes(h.formation)));
      const moved = J.some((j) => j.kind === 'move' && j.formation === h.formation && j.time >= prevT && j.time <= s.time);
      const i = T.indexOf(u.at);
      const urban = i >= 0 && TERRAIN_CLASSES[T.terrain[i]] === 'urban';
      const belt = i >= 0 && T.fort[i] > 0;
      const regime = id === 'berlin-city-1945' ? (inCombat ? 'город: бой' : moved ? 'город: марш' : 'город: стоит') : urban ? 'застройка' : belt ? 'укреплённая полоса' : inCombat ? 'бой на открытой' : moved ? 'марш/преследование' : 'стоит';
      const km = dist(T.proj.toXY(u.at), T.proj.toXY(h.at)), ex = Math.max(0, km - h.approxKm);
      const k = `${side}:${regime}`;
      const a = agg.get(k) ?? { n: 0, sum: 0, within: 0, lag: [] };
      a.n++; a.sum += ex; if (ex <= TOL[id]) a.within++;
      agg.set(k, a);
    }
  }
  console.log('\n' + id, `(допуск ${TOL[id]} км)`);
  L.push(`## ${id} (допуск ${TOL[id]} км)`, '', '| Сторона: режим | Записей | Среднее превышение, км | В допуске | Вклад в общее превышение |', '|---|---|---|---|---|');
  for (const [k, a] of [...agg].sort((x, y) => y[1].sum - x[1].sum)) {
    console.log('  ', k.padEnd(32), 'n', String(a.n).padStart(4), 'среднее превышение', (a.sum / a.n).toFixed(1).padStart(6), 'км; в допуске', (100 * a.within / a.n).toFixed(0).padStart(3), '%; вклад', a.sum.toFixed(0));
    L.push(`| ${k} | ${a.n} | ${(a.sum / a.n).toFixed(1)} | ${(100 * a.within / a.n).toFixed(0)} % | ${a.sum.toFixed(0)} |`);
  }
  L.push('');
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'report.md'), L.join('\n'));
console.log('отчёт:', join(OUT, 'report.md'));
