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
  const src = JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')) as { directives: SrcDirective[]; places: Record<string, { at: LngLat }> };
  const pts = (names: string[]) => names.map((n) => src.places[n]?.at).filter((p): p is LngLat => !!p);
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
