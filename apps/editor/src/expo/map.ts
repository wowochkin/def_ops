/**
 * История операции для стенда: пункты, армии по суткам истории и события (`bank-data/*.armies.json`, готовит
 * `npm run expo:history`), положения армий по ходу ядра сеанса (среднее дивизий армии в кадре).
 */
import raw from './bank-data/berlin-1945.armies.json';
import type { FrontId } from './settings';

export type LL = [number, number];
export interface ExpoMapData {
  bbox: [number, number, number, number];
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

/** Исторические пути армий фронта (по суткам истории) — полой стрелкой на итоге. */
export function historyPaths(front: string, until?: string): Record<string, LL[]> {
  const out: Record<string, LL[]> = {};
  for (const a of MAP.armies.filter((x) => x.front === front)) {
    const l = a.track.filter((p, i): p is LL => !!p && (!until || MAP.days[i] <= until));
    if (l.length > 1) out[a.id] = l;
  }
  return out;
}
