/**
 * Время на карте: какие знаки присутствуют на момент t и где они находятся.
 *
 *  - feature.time — период присутствия знака [from, to);
 *  - feature.keyframes — геометрия знака с момента t (ступенчато: действует последний
 *    кадр с t ≤ момента; до первого кадра — основная геометрия знака).
 *
 * documentAt(doc, t) возвращает документ «на момент t»: невидимые в этот момент знаки
 * убраны, геометрия остальных подставлена из ключевых кадров. Поверх него работают
 * обычные отрисовка, привязка хвостов стрелок к линиям и экспорт — они о времени не знают.
 */
import type { Feature, Keyframe, MapDocument, Motion, TimeInstant, TimeSpan } from './model';
import type { LngLat } from './geo';

/** Момент в миллисекундах. Дата без времени — полночь; без часового пояса — UTC. */
export function toTime(s: TimeInstant): number {
  const v = s.trim();
  if (/^-?\d{4,6}-\d{2}-\d{2}$/.test(v)) return Date.parse(`${v}T00:00:00Z`);
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) return Date.parse(v);
  return Date.parse(`${v}${v.length === 16 ? ':00' : ''}Z`);
}

/** Корректная ли строка момента времени. */
export function isTime(s: unknown): s is TimeInstant {
  return typeof s === 'string' && s.length >= 10 && Number.isFinite(toTime(s));
}

/** Попадает ли момент t в период [from, to). */
export function inSpan(span: TimeSpan | null | undefined, t: TimeInstant): boolean {
  if (!span) return true;
  const x = toTime(t);
  if (span.from && x < toTime(span.from)) return false;
  if (span.to && x >= toTime(span.to)) return false;
  return true;
}

/** Ключевые кадры по возрастанию времени. */
export function sortedKeyframes(f: Feature): Keyframe[] {
  return [...(f.keyframes ?? [])].sort((a, b) => toTime(a.t) - toTime(b.t));
}

/** Действующий на момент t ключевой кадр (или null — действует основная геометрия). */
export function keyframeAt(f: Feature, t: TimeInstant): Keyframe | null {
  const x = toTime(t);
  let cur: Keyframe | null = null;
  for (const k of sortedKeyframes(f)) if (toTime(k.t) <= x) cur = k; else break;
  return cur;
}

/** Состояние геометрии на момент: момент (мс) и геометрия; base — основная геометрия знака. */
interface Stop { ms: number; g: Omit<Keyframe, 't'>; key: TimeInstant | null }

/**
 * Опорные положения знака по времени. Основная геометрия участвует в плавном
 * движении, только если у знака задано начало периода (time.from): тогда она —
 * положение на этот момент. Иначе до первого кадра знак стоит в основном положении.
 */
function stops(f: Feature): Stop[] {
  const out: Stop[] = sortedKeyframes(f).map((k) => ({ ms: toTime(k.t), g: k, key: k.t }));
  const from = f.time?.from;
  const baseTimed = !!from && (!out.length || toTime(from) < out[0].ms);
  if (baseTimed) out.unshift({ ms: toTime(from!), g: geometryOf(f), key: null });
  return out;
}

/** Режим перехода для знака: его собственный или по умолчанию для карты. */
export function motionOf(f: Feature, fallback: Motion = 'smooth'): Motion {
  return f.motion ?? fallback;
}

/**
 * Геометрия знака на момент t. Плавно — линейно между соседними положениями
 * (линии и районы с разным числом точек предварительно приводятся к одному числу
 * точек по длине); скачком — последнее положение с t ≤ момента.
 * interpolated — показано промежуточное положение, которого нет среди сохранённых.
 */
export function geometryAt(f: Feature, t: TimeInstant, motion: Motion = 'smooth'): { g: Omit<Keyframe, 't'> | null; interpolated: boolean; key: TimeInstant | null } {
  const x = toTime(t);
  const list = stops(f);
  if (!list.length || x < list[0].ms) return { g: null, interpolated: false, key: null };
  let i = 0;
  while (i + 1 < list.length && list[i + 1].ms <= x) i++;
  const a = list[i], b = list[i + 1];
  if (motion === 'step' || !b || x === a.ms) return { g: a.key === null ? null : a.g, interpolated: false, key: a.key };
  const u = (x - a.ms) / (b.ms - a.ms);
  return { g: lerpGeometry(a.g, b.g, u), interpolated: true, key: a.key };
}

/** Знак на момент t: null — отсутствует, иначе копия с геометрией на этот момент. */
export function featureAt<F extends Feature>(f: F, t: TimeInstant, motion: Motion = motionOf(f)): F | null {
  if (!inSpan(f.time, t)) return null;
  const { g: k } = geometryAt(f, t, motionOf(f, motion));
  if (!k) return f;
  const g = structuredClone(f) as F & Record<string, unknown>;
  if ('points' in g && k.points) g.points = structuredClone(k.points);
  if ('at' in g && k.at) g.at = [...k.at] as typeof g.at;
  if ('rotation' in g && k.rotation !== undefined) g.rotation = k.rotation;
  if (g.kind === 'label' && k.path !== undefined) g.path = k.path ? structuredClone(k.path) : null;
  return g;
}

/** Документ на момент t (t не задан — документ без изменений, все знаки сразу). */
export function documentAt(doc: MapDocument, t?: TimeInstant | null): MapDocument {
  if (!t) return doc;
  const motion = doc.timeline?.motion ?? 'smooth';
  const features: Feature[] = [];
  for (const f of doc.features) {
    const g = featureAt(f, t, motionOf(f, motion));
    if (g) features.push(g);
  }
  // стрелка, привязанная к знаку, которого в этот момент нет, теряет привязку (рисуется по своим точкам)
  const present = new Set(features.map((f) => f.id));
  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    if (f.kind === 'arrow' && f.anchor && !present.has(f.anchor.featureId)) features[i] = { ...f, anchor: null };
  }
  return { ...doc, features };
}

/* ------------------------------ интерполяция ------------------------------ */

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpLL = (a: LngLat, b: LngLat, u: number): LngLat => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];

/** Угол — по кратчайшему пути. */
function lerpAngle(a: number, b: number, u: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * u;
}

/** Ломаная из n точек, равномерно по длине (длина — с поправкой на широту). */
export function resample(pts: LngLat[], n: number): LngLat[] {
  if (pts.length === n) return pts.map((p) => [p[0], p[1]] as LngLat);
  if (pts.length < 2) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]] as LngLat);
  const k = Math.cos((pts[0][1] * Math.PI) / 180);
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot((pts[i][0] - pts[i - 1][0]) * k, pts[i][1] - pts[i - 1][1]);
    seg.push(d); total += d;
  }
  const out: LngLat[] = [];
  let j = 0, acc = 0;
  for (let i = 0; i < n; i++) {
    const s = (total * i) / (n - 1);
    while (j < seg.length - 1 && acc + seg[j] < s) { acc += seg[j]; j++; }
    const u = seg[j] ? Math.min(1, Math.max(0, (s - acc) / seg[j])) : 0;
    out.push(lerpLL(pts[j], pts[j + 1], u));
  }
  return out;
}

function lerpPoints(a: LngLat[], b: LngLat[], u: number): LngLat[] {
  if (a.length === b.length) return a.map((p, i) => lerpLL(p, b[i], u));
  const n = Math.max(a.length, b.length, 8);
  const ra = resample(a, n), rb = resample(b, n);
  // в конце перехода — точно конечная геометрия (с её числом точек)
  if (u >= 1) return b.map((p) => [p[0], p[1]] as LngLat);
  return ra.map((p, i) => lerpLL(p, rb[i], u));
}

/** Промежуточная геометрия между a и b (u = 0..1). */
export function lerpGeometry(a: Omit<Keyframe, 't'>, b: Omit<Keyframe, 't'>, u: number): Omit<Keyframe, 't'> {
  const out: Omit<Keyframe, 't'> = {};
  if (a.points && b.points) out.points = lerpPoints(a.points, b.points, u);
  else if (b.points) out.points = b.points;
  if (a.at && b.at) out.at = lerpLL(a.at, b.at, u);
  else if (b.at) out.at = b.at;
  if (a.rotation !== undefined && b.rotation !== undefined) out.rotation = lerpAngle(a.rotation, b.rotation, u);
  else if (b.rotation !== undefined) out.rotation = b.rotation;
  if (a.path && b.path) out.path = lerpPoints(a.path, b.path, u);
  else if (b.path !== undefined) out.path = u < 0.5 ? a.path ?? null : b.path;
  return out;
}

/** Текущая геометрия знака в виде ключевого кадра (для записи положения на момент t). */
export function geometryOf(f: Feature): Omit<Keyframe, 't'> {
  if (f.kind === 'symbol') return { at: [...f.at] as Keyframe['at'], rotation: f.rotation };
  if (f.kind === 'label') return { at: [...f.at] as Keyframe['at'], rotation: f.rotation, path: f.path ? structuredClone(f.path) : null };
  return { points: structuredClone(f.points) };
}

/**
 * Записать положение знака на момент t: добавить (или заменить) ключевой кадр
 * с геометрией geom. Возвращает новый объект; исходный не меняется.
 */
export function setKeyframe<F extends Feature>(f: F, t: TimeInstant, geom: Omit<Keyframe, 't'> = geometryOf(f)): F {
  const x = toTime(t);
  const rest = (f.keyframes ?? []).filter((k) => toTime(k.t) !== x);
  return { ...f, keyframes: [...rest, { t, ...structuredClone(geom) }].sort((a, b) => toTime(a.t) - toTime(b.t)) };
}

/** Удалить ключевой кадр на момент t. */
export function removeKeyframe<F extends Feature>(f: F, t: TimeInstant): F {
  const x = toTime(t);
  const kf = (f.keyframes ?? []).filter((k) => toTime(k.t) !== x);
  return { ...f, keyframes: kf.length ? kf : undefined };
}

/**
 * Изменение геометрии знака, показанного на момент t: правится действующий кадр
 * (или основная геометрия, если кадров до t нет). Так правка на карте при
 * выбранном моменте не затрагивает положение в другие даты.
 */
export function applyGeometryAt<F extends Feature>(f: F, t: TimeInstant | null | undefined, edited: F, motion: Motion = motionOf(f)): F {
  if (t && inSpan(f.time, t)) {
    const at = geometryAt(f, t, motionOf(f, motion));
    // показано промежуточное положение — правка создаёт новое положение на этот момент
    if (at.interpolated) return setKeyframe(f, t, geometryOf(edited));
    if (at.key) {
      const k = (f.keyframes ?? []).find((q) => q.t === at.key);
      return setKeyframe(f, at.key, { ...geometryOf(edited), note: k?.note });
    }
  }
  // основная геометрия: переносим из отредактированного
  const g = geometryOf(edited);
  const out = { ...f } as F & Record<string, unknown>;
  if (g.points) out.points = g.points;
  if (g.at) out.at = g.at;
  if (g.rotation !== undefined && 'rotation' in out) out.rotation = g.rotation;
  if (out.kind === 'label' && 'path' in g) out.path = g.path ?? null;
  return out;
}

/** Все моменты, упомянутые в документе (кадры, границы периодов) — по возрастанию, без повторов. */
export function documentMoments(doc: MapDocument): TimeInstant[] {
  const all = new Map<number, TimeInstant>();
  const add = (s?: TimeInstant | null) => { if (s && isTime(s)) all.set(toTime(s), s); };
  for (const f of doc.features) {
    add(f.time?.from); add(f.time?.to);
    for (const k of f.keyframes ?? []) add(k.t);
  }
  return [...all.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}

/** Период для шкалы времени: заданный в документе или охватывающий все моменты. */
export function timelineRange(doc: MapDocument): { start: TimeInstant; end: TimeInstant } | null {
  if (doc.timeline?.start && doc.timeline?.end) return { start: doc.timeline.start, end: doc.timeline.end };
  const m = documentMoments(doc);
  return m.length ? { start: m[0], end: m[m.length - 1] } : null;
}

/* ------------------------------ часовые пояса ------------------------------ */
/*
 * Момент хранится в UTC (строка без пояса). Показывается в московском времени
 * (так датированы советские боевые документы) и в местном — по поясу места
 * событий. Пояса берутся из базы IANA через Intl с историческими правилами:
 * Москва в 1930–1981 гг. — UTC+3, Берлин в апреле 1945 г. — UTC+2,
 * с 24 мая 1945 г. — московское время, и т.п.
 */

export const MOSCOW_TZ = 'Europe/Moscow';

const dtf = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, zone: string): number[] {
  let f = dtf.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    dtf.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return [+p.year, +p.month, +p.day, +p.hour % 24, +p.minute, +p.second];
}

/** Существует ли такой часовой пояс IANA. */
export function isZone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

/** Смещение пояса от UTC в минутах на момент ms (с историческими правилами). */
export function zoneOffset(ms: number, zone: string): number {
  const [y, mo, d, h, mi, s] = parts(ms, zone);
  return Math.round((Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(ms / 1000) * 1000) / 60000);
}

/** «UTC+3», «UTC+5:30». */
export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? '−' : '+';
  const a = Math.abs(minutes);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Момент в поясе zone: «1945-04-25T06:00». */
export function toZoned(t: TimeInstant, zone: string): string {
  const [y, mo, d, h, mi] = parts(toTime(t), zone);
  return `${String(y).padStart(4, '0')}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}`;
}

/** Момент из местного времени пояса zone («1945-04-25T06:00» мск → «1945-04-25T03:00» UTC). */
export function fromZoned(local: string, zone: string): TimeInstant {
  const m = local.match(/^(-?\d{4,6})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) throw new Error(`Неверный момент: ${local}`);
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  // смещение берём на сам момент; при переводе часов уточняем вторым шагом
  let ms = naive - zoneOffset(naive, zone) * 60000;
  ms = naive - zoneOffset(ms, zone) * 60000;
  const d = new Date(ms);
  const date = `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  return d.getUTCHours() || d.getUTCMinutes() ? `${date}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}` : date;
}

/** Задан ли момент только датой (без времени суток). */
export function isDateOnly(t: TimeInstant): boolean {
  return /^-?\d{4,6}-\d{2}-\d{2}$/.test(t.trim());
}
