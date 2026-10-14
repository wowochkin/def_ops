/**
 * Выбор одного факта из нескольких об одном: закрепление → надёжность (A > B > C) → близость даты
 * к нужному моменту → более свежий документ. Чистая функция, без обращения к хранилищу.
 */
import type { Claim, Entry, Fact } from './schema';

/** Факт с адресом (запись, номер в ней) и датой записи (для выбора более свежего документа). */
export interface FactRef { entry: string; index: number; fact: Fact; updated: string }

/** Закрепления: ключ pinKey → факт или 'none' (не брать ничего). */
export type Pins = Record<string, { entry: string; index: number } | 'none'>;

export const pinKey = (kind: Claim['kind'], subject: string, moment: string): string => `${kind}|${subject}|${moment}`;

/** Все факты с формальной частью. */
export function claimFacts(entries: Entry[]): FactRef[] {
  const out: FactRef[] = [];
  for (const e of entries) (e.facts ?? []).forEach((fact, index) => { if (fact.claim) out.push({ entry: e.id, index, fact, updated: e.updatedAt ?? '' }); });
  return out;
}

const DAY = 86400000;
const RANK = { A: 0, B: 1, C: 2 } as const;
const rank = (r: FactRef) => RANK[r.fact.reliability ?? 'C'];
const time = (s: string) => Date.parse(s);

/** О ком факт: subject, id события или пара объединений линии. */
const subjectOf = (c: Claim): string => c.kind === 'boundary' ? c.between.join('|') : c.kind === 'event' ? c.id : c.subject;

/** Дата факта для близости к моменту: at, иначе from; у потерь — конец периода. */
const dateOf = (c: Claim): string => c.kind === 'losses' ? c.to : 'at' in c ? c.at : c.from;

/** Состояние, действующее с from до смены: берётся последнее действующее на момент. */
const isState = (k: Claim['kind']) => k === 'parent' || k === 'crossing';

const NUMS: (keyof Extract<Claim, { kind: 'losses' }> | 'personnel' | 'guns')[] = ['personnel', 'tanks', 'guns', 'killed', 'wounded', 'missing'];
const isNumeric = (k: Claim['kind']) => k === 'strength' || k === 'reinforce' || k === 'losses';

const deepEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Различаются ли значения двух утверждений (числа — больше чем на 5 %, остальное — не равно). */
function differ(a: Claim, b: Claim): boolean {
  if (isNumeric(a.kind)) {
    const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
    for (const f of NUMS) {
      const u = x[f], v = y[f];
      if (typeof u !== 'number' || typeof v !== 'number') continue;
      const m = Math.max(Math.abs(u), Math.abs(v));
      if (m > 0 && Math.abs(u - v) / m > 0.05) return true;
    }
    return false;
  }
  return !deepEqual(a, b);
}

export function resolve(
  facts: FactRef[], kind: Claim['kind'], subject: string, moment: string, pins: Pins,
  o: { window?: number } = {},
): { chosen: FactRef | null; candidates: FactRef[]; conflict: boolean; pinMissing?: boolean } {
  const window = o.window ?? 0;
  const t = time(moment);
  const same = facts.filter((f) => f.fact.claim && f.fact.claim.kind === kind && subjectOf(f.fact.claim) === subject);
  const state = isState(kind);
  const candidates = same.filter((f) => {
    const d = time(dateOf(f.fact.claim!));
    if (state || window === 0) return d <= t;
    return Math.abs(d - t) <= window * DAY;
  });
  let conflict = false;
  for (let i = 0; i < candidates.length && !conflict; i++)
    for (let j = i + 1; j < candidates.length; j++) if (differ(candidates[i].fact.claim!, candidates[j].fact.claim!)) { conflict = true; break; }

  const pin = pins[pinKey(kind, subject, moment)];
  if (pin === 'none') return { chosen: null, candidates, conflict };
  let pinMissing: true | undefined;
  if (pin) {
    const hit = facts.find((f) => f.fact.claim && f.entry === pin.entry && f.index === pin.index);
    if (hit) return { chosen: hit, candidates, conflict };
    pinMissing = true;
  }
  const d = (f: FactRef) => time(dateOf(f.fact.claim!));
  const sorted = [...candidates].sort((a, b) =>
    rank(a) - rank(b)
    // состояние: последнее действующее; прочее: ближайшее к моменту
    || (state ? d(b) - d(a) : Math.abs(d(a) - t) - Math.abs(d(b) - t))
    || (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
  return { chosen: sorted[0] ?? null, candidates, conflict, ...(pinMissing ? { pinMissing } : {}) };
}
