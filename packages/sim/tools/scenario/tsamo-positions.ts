/**
 * Положения из журналов боевых действий (выписки по схеме docs/tsamo-agent-task.md) — в историю сценария.
 *
 *   npx tsx packages/sim/tools/scenario/tsamo-positions.ts --scenario vistula-oder-1945 \
 *     --from docs/sources/vistula-oder-1945-tsamo-2/positions.json [--max-km 25] [--write]
 *
 * Берутся главные силы армий и отдельных корпусов (у корпусов — и «подвижная группа»), с координатами и
 * радиусом не больше --max-km. На формирование и день — запись с наименьшим радиусом. Если за этот день у
 * формирования уже есть запись надёжности A из документа ЦАМО, она остаётся (показывается расхождение); иначе
 * прежние записи этого формирования за этот день (в том числе книжные A) снимаются и вносится новая (A, вечер дня).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dist } from '../../src/geo';
import { loadContext } from '../../src/data';

interface TsamoPos {
  army: string; date: string | null; time: string | null; kind: string; unit: string; place: string;
  lat: number | null; lon: number | null; approxKm: number | null; action?: string; source: string; url?: string; note?: string | null;
}
interface HistPos { formation: string; time: string; at: [number, number]; approxKm: number; place: string; reliability: string; source: string }

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const scenarioId = opt('scenario', 'vistula-oder-1945')!;
const from = resolve(opt('from')!);
const maxKm = Number(opt('max-km', '25'));
const write = args.includes('--write');

/** «47-я армия» → «47 А», «1-я гвардейская танковая армия» → «1 гв. ТА», «11-й танковый корпус» → «11 тк». */
export function abbrev(name: string): string | null {
  const m = /^(\d+)-[яй]\s+(.*?)(?:\s*\(.*)?$/.exec(name.trim());
  if (!m) return null;
  const [, n, rest] = m;
  const gv = /гвардейск/.test(rest) ? 'гв. ' : '';
  const r = rest.replace(/гвардейск\S*\s*/, '');
  if (/Польск/.test(r)) return `${n} ПА`;
  if (/^ударная армия/.test(r)) return `${n} УА`;
  if (/^танковая армия/.test(r)) return `${n} ${gv}ТА`;
  if (/^армия/.test(r)) return `${n} ${gv}А`;
  if (/^танковый корпус/.test(r)) return `${n} ${gv}тк`;
  if (/^механизированный корпус/.test(r)) return `${n} ${gv}мк`;
  if (/^кавалерийский корпус/.test(r)) return `${n} ${gv}кк`;
  if (/^стрелковый корпус/.test(r)) return `${n} ${gv}ск`;
  return null;
}

const ctx = loadContext(scenarioId);
const P = ctx.theatre.proj;
const byName = new Map<string, string>();
for (const f of ctx.scenario.formations) { const a = f.side === 'su' ? abbrev(f.name) : null; if (a) byName.set(a, f.id); }

const histPath = resolve('packages/sim/data/scenarios', `${scenarioId}.history.json`);
const hist = JSON.parse(readFileSync(histPath, 'utf8')) as { note: string; positions: HistPos[] };
const recs = JSON.parse(readFileSync(from, 'utf8')) as TsamoPos[];

const best = new Map<string, { f: string; r: TsamoPos }>();
const skipped: Record<string, number> = {};
const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
for (const r of recs) {
  if (r.lat == null || r.lon == null || !r.date) { skip('нет координат или даты'); continue; }
  if (r.approxKm == null || r.approxKm > maxKm) { skip(`радиус больше ${maxKm} км`); continue; }
  // «армия», «армия (корпуса)» — положение армии; «2 АВП», «2 А ВП» — 2-я армия Войска Польского
  const army = /^армия/.test(r.unit);
  const name = (army ? r.army : r.unit).replace(/\s*А\s?ВП$/, ' ПА');
  const f = byName.get(name);
  if (!f) { skip(army ? `армии нет в сценарии (${name})` : 'корпус в составе армии, не отдельное формирование'); continue; }
  const corps = !army;
  if (!(r.kind === 'главные силы' || (corps && r.kind === 'подвижная группа'))) { skip(`вид «${r.kind}»`); continue; }
  const k = `${f}|${r.date}`;
  const cur = best.get(k);
  if (!cur || r.approxKm < cur.r.approxKm!) best.set(k, { f, r });
}

const day = (t: string) => t.slice(0, 10);
const agree: number[] = [];
let added = 0, removed = 0, removedBookA = 0;
const perFormation: Record<string, number> = {};
let positions = hist.positions;
for (const { f, r } of best.values()) {
  const same = positions.filter((p) => p.formation === f && day(p.time) === r.date);
  // остаётся только запись из первичного документа (ЦАМО); книжные записи A (официальные истории) уступают документу
  const a = same.find((p) => p.reliability === 'A' && /ЦАМО/.test(p.source));
  if (a) { agree.push(dist(P.toXY(a.at), P.toXY([r.lon!, r.lat!]))); continue; }
  removed += same.length; removedBookA += same.filter((p) => p.reliability === 'A').length;
  positions = positions.filter((p) => !same.includes(p));
  const hh = /^(\d{1,2})\.00$/.exec(r.time ?? '')?.[1];
  positions.push({
    formation: f, time: `${r.date}T${hh ? hh.padStart(2, '0') : '20'}:00`, at: [r.lon!, r.lat!], approxKm: r.approxKm!,
    place: r.place.length > 120 ? r.place.slice(0, 119) + '…' : r.place, reliability: 'A', source: r.source,
  });
  added++; perFormation[f] = (perFormation[f] ?? 0) + 1;
}
positions.sort((x, y) => (x.time < y.time ? -1 : x.time > y.time ? 1 : x.formation < y.formation ? -1 : 1));

agree.sort((x, y) => x - y);
console.log(`записей ${recs.length}; к внесению ${best.size} (формирование × день)`);
console.log('пропущено:', skipped);
console.log(`внесено ${added}, снято прежних ${removed} (из них книжных A — ${removedBookA}); по формированиям:`, perFormation);
if (agree.length) console.log(`уже есть запись A: ${agree.length}; расхождение с ней, км — медиана ${agree[agree.length >> 1].toFixed(1)}, 90 % ≤ ${agree[Math.floor(agree.length * 0.9)].toFixed(1)}`);
const rel = positions.reduce<Record<string, number>>((m, p) => ((m[p.reliability] = (m[p.reliability] ?? 0) + 1), m), {});
console.log('история после:', positions.length, rel);
if (write) { hist.positions = positions; writeFileSync(histPath, JSON.stringify(hist) + '\n'); console.log(`записано: ${histPath}`); }
