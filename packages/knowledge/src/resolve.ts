/**
 * Выбор одного факта из нескольких об одном: закрепление → надёжность (A > B > C) → близость даты
 * к нужному моменту → более свежий документ → проверка (человек и факт без проверки выше авто). У состояния (подчинённость, переправа) — сначала последнее
 * действующее на момент (позднее начало), надёжность — только среди фактов с тем же началом.
 * Чистая функция, без обращения к хранилищу.
 */
import type { Claim, Entry, Fact } from './schema';

/** Факт с адресом (запись, номер в ней) и датой записи (для выбора более свежего документа). */
export interface FactRef { entry: string; index: number; fact: Fact; updated: string }

/**
 * Закрепления: ключ pinKey → факт или 'none' (не брать ничего). Факт — по адресу (запись, номер) и отпечатку fp
 * (формальная часть и значение): вставка фактов сдвигает номера, по отпечатку сдвиг виден — закрепление не действует.
 * Прежние закрепления без отпечатка — только по адресу.
 */
export type Pins = Record<string, { entry: string; index: number; fp?: string } | 'none'>;

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
/** Только проверенный автоматически факт проигрывает при прочем равном. */
const autoRank = (r: FactRef) => r.fact.check?.by === 'auto' ? 1 : 0;
const time = (s: string) => Date.parse(s);

/**
 * О ком факт: subject, id события или пара объединений линии; у значения правила — путь параметра (с '@su'/'@de',
 * если норматив одной стороны); у итога — 'outcome:сценарий:мера:соединение[:сторона/ступень/район]:с–по'.
 */
export const subjectOf = (c: Claim): string => c.kind === 'boundary' ? c.between.join('|') : c.kind === 'event' ? c.id
  : c.kind === 'param' ? (c.side ? `${c.param}@${c.side}` : c.param)
  : c.kind === 'outcome' ? `outcome:${c.scenario}:${c.measure}:${c.subject ?? ''}${c.side || c.echelon || c.near ? `:${c.side ?? ''}/${c.echelon ?? ''}/${c.near ?? ''}` : ''}:${c.from}–${c.to}` : c.subject;

/** Дата факта для близости к моменту: at, иначе from; у потерь и итога — конец периода; у значения правила даты нет (''). */
export const dateOf = (c: Claim): string => c.kind === 'losses' || c.kind === 'outcome' ? c.to : c.kind === 'param' ? '' : 'at' in c ? c.at : c.from;

/** Состояние, действующее с from до смены: берётся последнее действующее на момент. Значение правила без даты — тоже «всегда». */
const isState = (k: Claim['kind']) => k === 'parent' || k === 'crossing' || k === 'param';

/** Порог существенного расхождения чисел по полю (как в сверке, sync.ts): люди 500, танки 5, орудия 20. */
const FLOOR: Record<string, number> = { personnel: 500, killed: 500, wounded: 500, missing: 500, total: 500, tanks: 5, guns: 20 };
const NUMS = Object.keys(FLOOR);
const isNumeric = (k: Claim['kind']) => k === 'strength' || k === 'reinforce' || k === 'losses';
/** Существенно ли различаются два числа поля: больше 5 % и больше порога поля. */
export const differsNum = (field: string, u: number, v: number): boolean =>
  Math.abs(u - v) > Math.max(FLOOR[field] ?? 0, 0.05 * Math.max(Math.abs(u), Math.abs(v)));

/** Нормализованная запись значения: порядок ключей объекта не влияет. */
const norm = (v: unknown): string => Array.isArray(v) ? `[${v.map(norm).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${norm((v as Record<string, unknown>)[k])}`).join(',')}}`
  : JSON.stringify(v) ?? 'null';
const deepEqual = (a: unknown, b: unknown): boolean => norm(a) === norm(b);

/** Отпечаток факта для закрепления: нормализованная формальная часть и значение. */
export const fingerprint = (f: Fact): string => `${norm(f.claim ?? null)}|${f.value.trim()}`;
/** Закрепление факта: адрес и отпечаток. */
export const pinOf = (f: FactRef): { entry: string; index: number; fp: string } => ({ entry: f.entry, index: f.index, fp: fingerprint(f.fact) });

/** Различаются ли значения двух утверждений (числа — больше 5 % и больше порога поля, остальное — не равно). */
function differ(a: Claim, b: Claim): boolean {
  // значение правила и итог — по числам: единица, пояснение и сведения норматива не различают
  if (a.kind === 'param' && b.kind === 'param') return !deepEqual([a.value, a.range], [b.value, b.range]);
  if (a.kind === 'outcome' && b.kind === 'outcome') return !deepEqual(a.range, b.range);
  if (isNumeric(a.kind)) {
    const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
    for (const f of NUMS) {
      const u = x[f], v = y[f];
      if (typeof u === 'number' && typeof v === 'number' && differsNum(f, u, v)) return true;
    }
    return false;
  }
  return !deepEqual(a, b);
}

export function resolve(
  facts: FactRef[], kind: Claim['kind'], subject: string, moment: string, pins: Pins,
  o: { window?: number } = {},
): {
  chosen: FactRef | null; candidates: FactRef[]; conflict: boolean; pinMissing?: boolean;
  /** Закрепление по ключу: действует на факт, 'none' — не брать ничего, 'missing' — закреплённого факта нет (удалён, изменён, сдвинут). */
  pin?: 'fact' | 'none' | 'missing';
} {
  const window = o.window ?? 0;
  const t = time(moment);
  const same = facts.filter((f) => f.fact.claim && f.fact.claim.kind === kind && subjectOf(f.fact.claim) === subject);
  const state = isState(kind);
  const candidates = same.filter((f) => {
    const d = time(dateOf(f.fact.claim!));
    if (kind === 'param') return true;
    if (state || window === 0) return d <= t;
    return Math.abs(d - t) <= window * DAY;
  });
  // расхождение — среди кандидатов на тот же момент, что и выбранный; надёжность не фильтрует
  const conflictOf = (chosen: FactRef | null): boolean => {
    const group = window > 0 || kind === 'param' ? candidates
      : chosen ? candidates.filter((f) => time(dateOf(f.fact.claim!)) === time(dateOf(chosen.fact.claim!))) : [];
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) if (differ(group[i].fact.claim!, group[j].fact.claim!)) return true;
    return false;
  };

  const pin = pins[pinKey(kind, subject, moment)];
  if (pin === 'none') return { chosen: null, candidates, conflict: window > 0 && conflictOf(null), pin: 'none' };
  let pinMissing: true | undefined;
  if (pin) {
    // закрепление действует, только если факт того же вида и о том же и (при отпечатке) тот же самый
    const hit = facts.find((f) => f.fact.claim && f.entry === pin.entry && f.index === pin.index
      && f.fact.claim.kind === kind && subjectOf(f.fact.claim) === subject && (pin.fp == null || fingerprint(f.fact) === pin.fp));
    if (hit) return { chosen: hit, candidates, conflict: conflictOf(hit), pin: 'fact' };
    pinMissing = true;
  }
  const d = (f: FactRef) => time(dateOf(f.fact.claim!)) || 0;
  const sorted = [...candidates].sort((a, b) =>
    // состояние: сначала последнее действующее (позднее начало), надёжность — среди одного начала
    (state ? d(b) - d(a) : 0)
    || rank(a) - rank(b)
    // прочее: ближайшее к моменту
    || (state ? 0 : Math.abs(d(a) - t) - Math.abs(d(b) - t))
    || (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0)
    // последнее звено: проверенное автоматически уступает проверенному человеком и факту без проверки (сид, прежний пользовательский)
    || autoRank(a) - autoRank(b));
  const chosen = sorted[0] ?? null;
  return { chosen, candidates, conflict: conflictOf(chosen), ...(pinMissing ? { pinMissing, pin: 'missing' as const } : {}) };
}
