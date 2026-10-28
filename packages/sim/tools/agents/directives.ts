/**
 * Исторические директивы верхних инстанций (docs/sources/*-directives.json) — в поле `directives` сценария агентной
 * модели: пункты — координатами из справочника `places` файла (реки и озёра без координат пропускаются), штабы — только
 * те, что есть в сценарии; дата раньше начала сценария — начало.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
type LngLat = [number, number];
interface Line { line: string[]; by: string | null }
interface SrcDirective {
  id: string; date: string; from: string; to: string[]; form: string; goal: string;
  mainBlow: { armies: string[]; axis: string[] } | null; immediate: Line | null; subsequent: Line | null;
  boundaries: { with: string | null; line: string[] }[]; reserves: { formation: string }[]; note: string;
}

/** «1945-04-20T24:00» → «1945-04-21T00:00»; дата без часа — начало суток. */
function norm(t: string): string {
  const [d, h = '00:00'] = t.split('T');
  if (h !== '24:00') return `${d}T${h}`;
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return `${x.toISOString().slice(0, 10)}T00:00`;
}

export function scenarioDirectives(file: string, hqIds: Set<string>, start: string): unknown[] {
  const src = JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')) as { directives: SrcDirective[]; places: Record<string, { at?: LngLat; line?: LngLat[] }> };
  // река — линией, только когда рубеж назван ею одной («выйти на Эльбу»); в перечне пунктов она пропускается
  const pts = (names: string[]): LngLat[] => names.length === 1 && src.places[names[0]]?.line ? src.places[names[0]].line!
    : names.map((n) => src.places[n]?.at).filter((p): p is LngLat => !!p);
  const line = (l: Line | null) => (l ? { line: pts(l.line), by: l.by ? `${l.by.slice(0, 10)}T23:00` : null } : null);
  const out: unknown[] = [];
  for (const d of src.directives) {
    const to = d.to.filter((x) => hqIds.has(x));
    if (!to.length || !hqIds.has(d.from)) continue;
    const at = norm(d.date) < start ? start : norm(d.date);
    // советские — наступление; немецкие «держать» — оборона, остальные немецкие решения — удар
    const task = d.from.startsWith('su_') ? 'attack' : /держ|Halten/i.test(d.goal) ? 'defend' : 'attack';
    out.push({
      id: d.id, at, from: d.from, to, form: d.form === 'instruction' ? 'instruction' : 'order', task,
      axis: pts(d.mainBlow?.axis ?? []), immediate: line(d.immediate), subsequent: line(d.subsequent),
      boundaries: d.boundaries.map((b) => ({ with: b.with && hqIds.has(b.with) ? b.with : null, line: pts(b.line) })).filter((b) => b.line.length >= 2),
      mainBlow: (d.mainBlow?.armies ?? []).filter((x) => hqIds.has(x)), reserves: d.reserves.map((r) => r.formation).filter((x) => hqIds.has(x)),
      note: d.goal,
    });
  }
  return out;
}

type LngLatT = [number, number];
type Target = string | LngLatT | { formation: string } | null;
/** Распоряжение фронта армии (поле сценария frontDirectives; прогон «фронты по истории», agents-run --below front). */
export interface FrontDirective { id: string; at: string; from: string; to: string[]; form: string; task: string; immediate?: { line: LngLatT[]; by: string | null }; note: string }
const FRONT_TASK: Record<string, string> = { attack: 'attack', counterattack: 'attack', breakout: 'attack', defend: 'defend', hold: 'defend', withdraw: 'withdraw', regroup: 'move', reserve: 'reserve' };

/**
 * Задачи армий в сценарии нынешней модели — распоряжения фронтов по документам (журналы фронтов, директивы,
 * исследования): армии — к району или точке; «вместе с …» — к цели того соединения на тот час. Ось достраивает ядро в
 * час подачи — от места армии к цели. До начала — подготовленный приказ (доведён к началу); в ходе операции — боевое
 * распоряжение: армия действует в те же сутки (3 А: распоряжение 20.04 в 12.00 — «с рассветом 21.04 выступить»).
 */
export function frontDirectives(orders: { id: string; formation: string; task: string; target: Target; issuedAt: string; note?: string }[],
  hqs: { id: string; side: string; echelon: string; parent: string | null }[], targetOf: (t: Target) => LngLatT | null, start: string, end: string): FrontDirective[] {
  const hq = new Map(hqs.map((h) => [h.id, h]));
  const r4 = (p: LngLatT): LngLatT => [+p[0].toFixed(4), +p[1].toFixed(4)];
  const goalAt = (formation: string, t: string, seen = 0): LngLatT | null => {
    const o = orders.filter((x) => x.formation === formation && x.issuedAt <= t && x.target).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)).pop();
    if (!o) return null;
    const g = o.target!;
    return typeof g === 'object' && !Array.isArray(g) ? (seen < 3 ? goalAt(g.formation, t, seen + 1) : null) : targetOf(g);
  };
  return orders.filter((o) => {
    const a = hq.get(o.formation), f = a?.parent ? hq.get(a.parent) : undefined;
    return a?.side === 'su' && a.echelon === 'army' && f?.echelon === 'front' && o.issuedAt < end && FRONT_TASK[o.task];
  }).map((o) => {
    const g = o.target && typeof o.target === 'object' && !Array.isArray(o.target) ? goalAt(o.target.formation, o.issuedAt) : targetOf(o.target);
    return { id: o.id, at: o.issuedAt < start ? start : o.issuedAt, from: hq.get(o.formation)!.parent!, to: [o.formation], form: o.issuedAt <= start ? 'order' : 'instruction', task: FRONT_TASK[o.task],
      ...(g ? { immediate: { line: [r4(g)], by: null } } : {}), note: `${o.note ?? ''} [${o.id}]`.trim() };
  }).sort((a, b) => a.at.localeCompare(b.at));
}
