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
import type { Feature, Keyframe, MapDocument, TimeInstant, TimeSpan } from './model';

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

/** Знак на момент t: null — отсутствует, иначе копия с геометрией на этот момент. */
export function featureAt<F extends Feature>(f: F, t: TimeInstant): F | null {
  if (!inSpan(f.time, t)) return null;
  const k = keyframeAt(f, t);
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
  const features: Feature[] = [];
  for (const f of doc.features) {
    const g = featureAt(f, t);
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
export function applyGeometryAt<F extends Feature>(f: F, t: TimeInstant | null | undefined, edited: F): F {
  const k = t ? keyframeAt(f, t) : null;
  if (!k) {
    // основная геометрия: переносим из отредактированного
    const g = geometryOf(edited);
    const out = { ...f } as F & Record<string, unknown>;
    if (g.points) out.points = g.points;
    if (g.at) out.at = g.at;
    if (g.rotation !== undefined && 'rotation' in out) out.rotation = g.rotation;
    if (out.kind === 'label' && 'path' in g) out.path = g.path ?? null;
    return out;
  }
  return setKeyframe(f, k.t, { ...geometryOf(edited), note: k.note });
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
