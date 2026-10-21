/**
 * Разбор расхождений агентной модели с историей по армиям (спецификация, раздел 7): для армии вне допуска — первый
 * час, когда медиана превышения её дивизий над неопределённостью источника больше допуска; документы её штаба и его
 * старших за ±12 ч; директивы верхних инстанций того же дня.
 *
 *   npx tsx packages/sim/tools/agents/divergence.ts --scenario berlin --trace evals-out/agents/x/trace.json --out evals-out/agents/divergence.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type LngLat = [number, number];
interface Doc { tick: number; time: string; hq: string; kind: string; to: string[]; text: string; rule: string | null }
interface Trace {
  start: string; fields: string[]; frames: unknown[][][];
  divisions: { id: string; hq: string }[]; hqs: { id: string; name: string; echelon: string; parent: string | null }[];
  documents?: Doc[];
}
interface History { divisions: { formation: string; time: string; at: LngLat; approxKm: number }[] }
export interface Row { army: string; name: string; firstOutAt: string; deviationKm: number; documents: Doc[]; historical: string[] }

const km = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), (a[1] - b[1]) * 110.57);
const hourOf = (start: string, t: string) => Math.round((Date.parse(`${t}:00Z`) - Date.parse(`${start}:00Z`)) / 3600e3);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

export function divergence(trace: Trace, history: History, toleranceKm = 10, directives: { id: string; date: string; goal: string }[] = []): Row[] {
  const hq = new Map(trace.hqs.map((h) => [h.id, h]));
  const armyOf = (id: string) => { for (let x = hq.get(id), n = 0; x && n < 8; x = x.parent ? hq.get(x.parent) : undefined, n++) if (x.echelon === 'army') return x.id; return id; };
  const chain = (id: string) => { const out = new Set<string>(); for (let x = hq.get(id), n = 0; x && n < 8; x = x.parent ? hq.get(x.parent) : undefined, n++) out.add(x.id); return out; };
  const idx = new Map(trace.divisions.map((d, i) => [d.id, i]));
  const [iLng, iLat] = ['lng', 'lat'].map((k) => trace.fields.indexOf(k));
  // превышение по армиям и часам
  const ex = new Map<string, Map<number, number[]>>();
  for (const p of history.divisions) {
    const i = idx.get(p.formation);
    const h = hourOf(trace.start, p.time);
    if (i === undefined || h < 0 || h >= trace.frames.length) continue;
    const r = trace.frames[h][i] as unknown[];
    const e = Math.max(0, km([r[iLng] as number, r[iLat] as number], p.at) - p.approxKm);
    const a = armyOf(trace.divisions[i].hq);
    const m = ex.get(a) ?? new Map<number, number[]>();
    m.set(h, [...(m.get(h) ?? []), e]);
    ex.set(a, m);
  }
  const rows: Row[] = [];
  for (const [army, m] of ex) {
    const out = [...m.entries()].sort((a, b) => a[0] - b[0]).find(([, xs]) => median(xs) > toleranceKm);
    if (!out) continue;
    const [h, xs] = out;
    const at = new Date(Date.parse(`${trace.start}:00Z`) + h * 3600e3).toISOString().slice(0, 16);
    const mine = chain(army);
    rows.push({
      army, name: hq.get(army)?.name ?? army, firstOutAt: at, deviationKm: +median(xs).toFixed(1),
      documents: (trace.documents ?? []).filter((d) => mine.has(d.hq) && Math.abs(d.tick - h) <= 12),
      historical: directives.filter((d) => d.date.slice(0, 10) === at.slice(0, 10)).map((d) => `${d.id}: ${d.goal}`),
    });
  }
  return rows.sort((a, b) => a.firstOutAt.localeCompare(b.firstOutAt));
}

// ---------- командная строка ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const args = process.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const scen = opt('scenario') ?? 'berlin';
  const rd = <T>(p: string): T => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as T;
  const trace = rd<Trace>(opt('trace') ?? `evals-out/agents/${scen}/trace.json`);
  const history = rd<History>(`packages/sim/data/scenarios/agents/${scen}-1945.history.json`);
  const src = scen === 'vistula-oder' ? 'vistula-oder' : 'berlin';
  const dirs = rd<{ directives: { id: string; date: string; goal: string }[] }>(`docs/sources/${src}-1945-directives.json`).directives;
  const rows = divergence(trace, history, Number(opt('tolerance') ?? 10), dirs);
  const md = ['# Расхождения агентной модели по армиям', '', `Сценарий: ${scen}; допуск ${opt('tolerance') ?? 10} км сверх неопределённости источника.`, '',
    ...rows.flatMap((r) => [`## ${r.name} — с ${r.firstOutAt.replace('T', ' ')}, медиана превышения ${r.deviationKm} км`, '',
      ...(r.historical.length ? ['Директивы того дня: ' + r.historical.join('; '), ''] : []),
      ...r.documents.map((d) => `- ${d.time.replace('T', ' ')} ${d.hq} (${d.kind}): ${d.text}${d.rule ? ` — ${d.rule}` : ''}`), ''])].join('\n');
  const out = opt('out') ?? 'evals-out/agents/divergence.md';
  writeFileSync(resolve(ROOT, out), md);
  console.log(`армий вне допуска: ${rows.length}; ${out}`);
}
