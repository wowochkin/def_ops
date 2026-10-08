/**
 * Нормативы против модели: опыт войны из базы знаний (data/rules/norms.json — темпы, потери, переправы,
 * задержки приказов, ширина полос) сравнивается с тем, что даёт арбитр — прогоном сценариев по
 * историческим приказам или прямо по правилам. Показывает, какие правила расходятся с опытом и в какую
 * сторону; правила не меняет (изменение проверяется калибровкой и контрольной операцией).
 *
 *   npm run sim:norms -- [--seeds 3] [--out evals-out/norms] [--doc docs/norms-check.md]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadContext, loadNorms } from '../../src/data';
import { runScenario, type RunResult } from '../../src/history';
import { evaluateNorms, NORM_MARK, fmtNorm as fmt } from '../../src/norms';
import type { SimContext } from '../../src/step';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const seeds = Number(opt('seeds', '3'));
const out = resolve(opt('out', 'evals-out/norms')!);
const docOut = opt('doc');
const table = loadNorms();

const ctxs = new Map<string, SimContext>();
const runs = new Map<string, RunResult[]>();
const ctxOf = (id: string) => { if (!ctxs.has(id)) ctxs.set(id, loadContext(id)); return ctxs.get(id)!; };
function runsOf(id: string): RunResult[] {
  if (!runs.has(id)) {
    const t0 = Date.now();
    runs.set(id, Array.from({ length: seeds }, (_, i) => runScenario(ctxOf(id), i + 1)));
    console.log(`  ${id}: ${seeds} прогон(а), ${Math.round((Date.now() - t0) / 1000)} с`);
  }
  return runs.get(id)!;
}

console.log(`Нормативы против модели (${table.norms.length}), прогонов на сценарий: ${seeds}`);
const rows = evaluateNorms(table, ctxOf, runsOf);
const L: string[] = [
  '# Нормативы опыта войны против модели',
  '',
  `Собрано \`npm run sim:norms\` (${new Date().toISOString().slice(0, 10)}): прогоны сценариев по историческим приказам (seed 1–${seeds}) и правила арбитра`,
  'против нормативов из базы знаний (раздел «Знания», рубрика 3.4 «Нормативы и опыт»; таблица — `packages/sim/data/rules/norms.json`).',
  'Правила не подгоняются под каждую строку: расхождение — повод для изменения, которое затем проверяется калибровкой',
  'и контрольной Висло-Одерской операцией.',
  '',
  '| Норматив | По опыту (источник, достоверность) | Ожидаемо | Модель | Итог | Правила |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.norm.title} | ${r.norm.historical} (${r.norm.source}, ${r.norm.reliability}) | ${r.norm.expect ? `${fmt(r.norm.expect[0])}–${fmt(r.norm.expect[1])} ${r.norm.unit}` : '—'} | ${r.text}${r.norm.note ? ` — ${r.norm.note}` : ''} | ${NORM_MARK[r.verdict]} | ${r.norm.rules.map((x) => `\`${x}\``).join(', ')} |`),
  '',
  `Итого: в пределах ${rows.filter((r) => r.verdict === 'ok').length} из ${rows.filter((r) => r.verdict !== 'none').length} измеримых; ниже — ${rows.filter((r) => r.verdict === 'low').length}, выше — ${rows.filter((r) => r.verdict === 'high').length}, не моделируется — ${rows.filter((r) => r.verdict === 'none').length}.`,
  '',
  ...(table.findings?.length ? ['## Выводы и пробы', '', ...table.findings.map((f) => `- ${f}`), ''] : []),
];
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.md'), L.join('\n'));
writeFileSync(join(out, 'norms.json'), JSON.stringify(rows.map((r) => ({ id: r.norm.id, verdict: r.verdict, values: r.values.map((v) => +v.toFixed(2)), text: r.text })), null, 1));
if (docOut) writeFileSync(resolve(docOut), L.join('\n'));
for (const r of rows) console.log(`  ${NORM_MARK[r.verdict].padEnd(18)} ${r.norm.id.padEnd(22)} ${r.text}  [ожидаемо ${r.norm.expect ? r.norm.expect.join('–') : '—'}]`);
console.log(`отчёт: ${join(out, 'report.md')}`);
