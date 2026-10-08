/**
 * Нормативы против модели: опыт войны из базы знаний (data/rules/norms.json — темпы, потери, переправы,
 * задержки приказов, ширина полос) сравнивается с тем, что даёт арбитр — прогоном сценариев по
 * историческим приказам или прямо по правилам. Показывает, какие правила расходятся с опытом и в какую
 * сторону; правила не меняет (изменение проверяется калибровкой и контрольной операцией).
 *
 *   npm run sim:norms -- [--seeds 3] [--out evals-out/norms] [--doc docs/norms-check.md]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContext } from '../../src/data';
import { dist } from '../../src/geo';
import { interp } from '../../src/rules';
import { runScenario } from '../../src/history';
import { ENGINEERING } from '../../src/staff';
import { profileOf, type SimContext } from '../../src/step';
import type { RunResult } from '../../src/types';

interface Norm {
  id: string; title: string; kb: string; source: string; reliability: string; historical: string;
  measure: { kind: 'pace'; scenario: string; formation: string; from: string; to: string }
    | { kind: 'loss'; scenario: string; parent: string; from: string; to: string }
    | { kind: 'param'; expr: string }
    | { kind: 'frontage'; scenario: string; side: string; echelon: string }
    | { kind: 'unmodelled'; why: string };
  expect?: [number, number]; unit?: string; rules: string[]; note?: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const seeds = Number(opt('seeds', '3'));
const out = resolve(opt('out', 'evals-out/norms')!);
const docOut = opt('doc');
const table = JSON.parse(readFileSync(join(HERE, '../../data/rules/norms.json'), 'utf8')) as { norms: Norm[]; findings?: string[] };
const norms = table.norms;

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
const snapAt = (r: RunResult, t: string) => r.snapshots.find((s) => s.time >= t) ?? r.snapshots[r.snapshots.length - 1];
const days = (a: string, b: string) => (Date.parse(b + 'Z') - Date.parse(a + 'Z')) / 86_400_000;

/** Темп: смещение формирования между двумя моментами, км/сут (по прямой — как в источниках). */
function pace(m: Extract<Norm['measure'], { kind: 'pace' }>): number[] {
  const ctx = ctxOf(m.scenario);
  return runsOf(m.scenario).map((r) => {
    const a = snapAt(r, m.from).units.find((u) => u.id === m.formation);
    const b = snapAt(r, m.to).units.find((u) => u.id === m.formation);
    if (!a || !b) return NaN;
    return dist(ctx.theatre.proj.toXY(a.at), ctx.theatre.proj.toXY(b.at)) / days(m.from, m.to);
  });
}

/** Потери подчинённых соединений (по цепочке подчинённости) за период, % численности. */
function loss(m: Extract<Norm['measure'], { kind: 'loss' }>): number[] {
  const ctx = ctxOf(m.scenario);
  const parent = new Map(ctx.scenario.formations.map((f) => [f.id, f.parent ?? null]));
  const under = (id: string): boolean => { for (let p = parent.get(id); p; p = parent.get(p)) if (p === m.parent) return true; return false; };
  return runsOf(m.scenario).map((r) => {
    const inWin = r.snapshots.filter((s) => s.time >= m.from && s.time <= m.to);
    let start = 0, end = 0;
    for (const id of new Set(inWin.flatMap((s) => s.units.map((u) => u.id)))) {
      if (!under(id)) continue;
      const seen = inWin.filter((s) => s.units.some((u) => u.id === id));
      const p0 = seen[0].units.find((u) => u.id === id)!.personnel;
      const p1 = seen[seen.length - 1].units.find((u) => u.id === id)!.personnel;
      start += p0; end += Math.min(p0, p1);
    }
    return start ? ((start - end) / start) * 100 : NaN;
  });
}

function param(expr: string): number {
  const ctx = ctxOf('berlin-1945-tasks');
  const R = ctx.rules, su = profileOf(ctx, 'su');
  const eng = su.engineering ?? ENGINEERING;
  switch (expr) {
    case 'advanceMax': return interp(R.advance, 10);
    case 'riverCrossHours': return R.riverCrossHours;
    case 'riverCrossHours/3': return R.riverCrossHours / 3;
    case 'bridgeHoursMajor': return eng.bridgeHoursMajor;
    case 'bridgeHoursMinor': return eng.bridgeHoursMinor;
    default: {
      const d = /^orderDelay\.(\w+)$/.exec(expr);
      if (d) return (su.orderDelayHours as Record<string, number>)[d[1]] ?? NaN;
      throw new Error(`неизвестное выражение ${expr}`);
    }
  }
}

function frontage(m: Extract<Norm['measure'], { kind: 'frontage' }>): number[] {
  const ctx = ctxOf(m.scenario);
  const P = profileOf(ctx, m.side);
  return ctx.scenario.formations.filter((f) => f.side === m.side && f.echelon === m.echelon).map((f) => P.unitTypes[f.type]?.frontageKm ?? NaN).filter(Number.isFinite);
}

interface Row { n: Norm; values: number[]; verdict: 'ok' | 'low' | 'high' | 'none' | 'error'; text: string }
const fmt = (x: number) => (Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(1)).replace('.', ',');
const rows: Row[] = [];
console.log(`Нормативы против модели (${norms.length}), прогонов на сценарий: ${seeds}`);
for (const n of norms) {
  const m = n.measure;
  let values: number[] = [];
  try {
    if (m.kind === 'unmodelled') { rows.push({ n, values, verdict: 'none', text: `не моделируется: ${m.why}` }); continue; }
    values = m.kind === 'pace' ? pace(m) : m.kind === 'loss' ? loss(m) : m.kind === 'frontage' ? frontage(m) : [param(m.expr)];
  } catch (e) { rows.push({ n, values, verdict: 'error', text: (e as Error).message }); continue; }
  const ok = values.filter(Number.isFinite);
  if (!ok.length) { rows.push({ n, values, verdict: 'error', text: 'нет данных (формирования нет на карте в эти дни)' }); continue; }
  const mean = ok.reduce((a, b) => a + b, 0) / ok.length;
  const [lo, hi] = n.expect!;
  const verdict = mean < lo ? 'low' : mean > hi ? 'high' : 'ok';
  const spread = ok.length > 1 ? ` (${fmt(Math.min(...ok))}–${fmt(Math.max(...ok))})` : '';
  rows.push({ n, values: ok, verdict, text: `${fmt(mean)}${spread} ${n.unit}` });
}

const MARK = { ok: '✓ в пределах', low: '↓ ниже опыта', high: '↑ выше опыта', none: '— не моделируется', error: '? нет данных' } as const;
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
  ...rows.map((r) => `| ${r.n.title} | ${r.n.historical} (${r.n.source}, ${r.n.reliability}) | ${r.n.expect ? `${fmt(r.n.expect[0])}–${fmt(r.n.expect[1])} ${r.n.unit}` : '—'} | ${r.text}${r.n.note ? ` — ${r.n.note}` : ''} | ${MARK[r.verdict]} | ${r.n.rules.map((x) => `\`${x}\``).join(', ')} |`),
  '',
  `Итого: в пределах ${rows.filter((r) => r.verdict === 'ok').length} из ${rows.filter((r) => r.verdict !== 'none').length} измеримых; ниже — ${rows.filter((r) => r.verdict === 'low').length}, выше — ${rows.filter((r) => r.verdict === 'high').length}, не моделируется — ${rows.filter((r) => r.verdict === 'none').length}.`,
  '',
  ...(table.findings?.length ? ['## Выводы и пробы', '', ...table.findings.map((f) => `- ${f}`), ''] : []),
];
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'report.md'), L.join('\n'));
writeFileSync(join(out, 'norms.json'), JSON.stringify(rows.map((r) => ({ id: r.n.id, verdict: r.verdict, values: r.values.map((v) => +v.toFixed(2)), text: r.text })), null, 1));
if (docOut) writeFileSync(resolve(docOut), L.join('\n'));
for (const r of rows) console.log(`  ${MARK[r.verdict].padEnd(18)} ${r.n.id.padEnd(22)} ${r.text}  [ожидаемо ${r.n.expect ? r.n.expect.join('–') : '—'}]`);
console.log(`отчёт: ${join(out, 'report.md')}`);
