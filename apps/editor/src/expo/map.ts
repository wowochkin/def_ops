/**
 * Карта стенда без тайлов: подложка (реки, рубежи, пункты, армии по истории — `bank-data/*.map.json`, готовит
 * `npm run expo:map`) и положения армий по ходу ядра сеанса (среднее дивизий армии в кадре).
 */
import raw from './bank-data/berlin-1945.map.json';
import type { FrontId } from './settings';

export type LL = [number, number];
export interface ExpoMapData {
  bbox: [number, number, number, number];
  rivers: LL[][];
  lines: { side: string; line: LL[] }[];
  cities: { name: string; at: LL; capital: boolean }[];
  /** Сутки истории (ISO), к ним — положения армий в `track` (null — положения нет). */
  days: string[];
  armies: { id: string; label: string; side: 'su' | 'de'; front: FrontId | null; track: (LL | null)[] }[];
  events: { id: string; title: string; date: string; at: LL }[];
}
export const MAP = raw as unknown as ExpoMapData;

export interface ArmyPos { id: string; label: string; side: 'su' | 'de'; front: FrontId | null; at: LL }
export interface Arrow { army: string; from: LL; to: LL; kind: string }

/** «8-я гвардейская армия» → «8 гв. А», «1-я гвардейская танковая армия» → «1 гв. ТА». */
export function shortArmy(name: string): string {
  const n = name.match(/^(\d+)/)?.[1];
  if (!n) return name;
  const gv = /гвардейск/.test(name) ? 'гв. ' : /ударн/.test(name) ? 'уд. ' : '';
  const kind = /танков/.test(name) ? 'ТА' : 'А';
  return `${n} ${gv}${kind}${/Польск/.test(name) ? ' ВП' : ''}`;
}

/** Упрощение линии (Дуглас — Пекер), допуск в градусах. */
export function simplify(line: LL[], tol: number): LL[] {
  if (line.length < 3) return line;
  const [a, b] = [line[0], line[line.length - 1]];
  let best = -1, at = 0;
  for (let i = 1; i < line.length - 1; i++) {
    const p = line[i], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1e-9;
    const d = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > best) [best, at] = [d, i];
  }
  if (best <= tol) return [a, b];
  return [...simplify(line.slice(0, at + 1), tol).slice(0, -1), ...simplify(line.slice(at), tol)];
}

/** Проекция рамки в координаты рисунка шириной 1000 (высота — по широте середины). */
export function projection(bbox: ExpoMapData['bbox']) {
  const [w, s, e, n] = bbox;
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const width = 1000, height = Math.round((width * (n - s)) / ((e - w) * k));
  return { width, height, xy: ([lng, lat]: LL): LL => [((lng - w) / (e - w)) * width, ((n - lat) / (n - s)) * height] };
}

const lerp = (a: LL, b: LL, t: number): LL => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Армии по истории на момент `iso`: между сутками — по прямой; нет положения — ближайшее известное. */
export function historyAt(iso: string, data: ExpoMapData = MAP): ArmyPos[] {
  const t = Date.parse(`${iso.slice(0, 16)}:00Z`);
  const ts = data.days.map((d) => Date.parse(`${d}:00Z`));
  return data.armies.flatMap((a) => {
    const known = a.track.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
    if (!known.length) return [];
    const after = known.find((i) => ts[i] >= t) ?? known[known.length - 1];
    const before = [...known].reverse().find((i) => ts[i] <= t) ?? after;
    const f = after === before ? 0 : (t - ts[before]) / (ts[after] - ts[before]);
    return [{ id: a.id, label: a.label, side: a.side, front: a.front, at: lerp(a.track[before]!, a.track[after]!, f) }];
  });
}

type Trace = { divisions: { hq: string }[]; hqs: { id: string; parent: string | null; echelon: string }[]; frames: unknown[][][] };

/** Армии по кадру хода ядра: среднее положений дивизий армии (по цепочке подчинения); подписи — из подложки. */
export function traceArmies(t: Trace, frame = t.frames.length - 1, data: ExpoMapData = MAP): ArmyPos[] {
  const hq = new Map(t.hqs.map((h) => [h.id, h]));
  const armyOf = (id: string) => {
    for (let h = hq.get(id), i = 0; h && i < 8; h = h.parent ? hq.get(h.parent) : undefined, i++) if (h.echelon === 'army') return h.id;
    return null;
  };
  const sum = new Map<string, [number, number, number]>();
  (t.frames[frame] ?? []).forEach((row, i) => {
    const a = armyOf(t.divisions[i]?.hq ?? '');
    const [lng, lat] = row as number[];
    if (!a || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
    const s = sum.get(a) ?? [0, 0, 0];
    sum.set(a, [s[0] + lng, s[1] + lat, s[2] + 1]);
  });
  return data.armies.flatMap((a) => {
    const s = sum.get(a.id);
    return s ? [{ id: a.id, label: a.label, side: a.side, front: a.front, at: [s[0] / s[2], s[1] / s[2]] as LL }] : [];
  });
}

/** Стрелки распоряжений карточки: от армии к объекту театра (без объекта или армии — нет стрелки). */
export function cardArrows(orders: { army: string; kind: string; place: string | null }[], armies: ArmyPos[], placeAt: (p: string) => LL | null): Arrow[] {
  return orders.flatMap((o) => {
    const from = armies.find((a) => a.id === o.army)?.at;
    const to = o.place ? placeAt(o.place) : null;
    return from && to ? [{ army: o.army, from, to, kind: o.kind }] : [];
  });
}

/** Промежуточное положение армий между двумя снимками (t от 0 до 1); новые армии — сразу на месте. */
export function between(a: ArmyPos[], b: ArmyPos[], t: number): ArmyPos[] {
  return b.map((x) => {
    const y = a.find((p) => p.id === x.id);
    return y ? { ...x, at: lerp(y.at, x.at, t) } : x;
  });
}

/** Пути армий, прошедших дальше всех (не больше `n`): на итоге видны главные удары, а не все армии фронта. */
export function mainPaths(paths: Record<string, LL[]>, n = 4): Record<string, LL[]> {
  const km = (l: LL[]) => l.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0);
  return Object.fromEntries(Object.entries(paths).filter(([, l]) => l.length > 1).sort((a, b) => km(b[1]) - km(a[1])).slice(0, n));
}
