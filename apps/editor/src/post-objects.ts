/**
 * Объекты для приказов пункта управления: населённые пункты, рубежи театра, свои армии и соединения, противник (по
 * разведке), мосты. Объект ставится в задачу, ось или разграничительную линию проекта вместо щелчков по карте;
 * точка цели проекта — с подписью на карте до отдачи. Без React.
 */
import type { LngLat } from '@def-ops/core';
import type { TurnView } from './sim/game-protocol';
import { DIR_TASK_RU, type DirDraft, type DirPick } from './command-post';

export type ObjKind = 'place' | 'line' | 'own' | 'enemy' | 'bridge';
export const OBJ_KIND_RU: Record<ObjKind, string> = { place: 'Пункты', line: 'Рубежи', own: 'Свои', enemy: 'Противник', bridge: 'Мосты' };

/** Объект выбора: at — точка (у рубежа — середина линии), line — линия рубежа; parent — начальник своего формирования. */
export interface PostObject { kind: ObjKind; id: string; title: string; at: LngLat; line?: LngLat[]; parent?: string | null }

/** Расстояние, км (сфера). */
export function km(a: LngLat, b: LngLat): number {
  const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Середина линии по длине. */
export function midpoint(line: LngLat[]): LngLat {
  if (line.length < 2) return line[0];
  const seg = line.slice(1).map((p, i) => km(line[i], p));
  let half = seg.reduce((s, x) => s + x, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, half / seg[i]) : 0, a = line[i], b = line[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    half -= seg[i];
  }
  return line[line.length - 1];
}

/** Сокращение названия для плашки и подписи: «8-я гвардейская армия» → «8 гв. А». */
export const shortName = (n: string) => n.replace(/(\d+)-[яйе]\s/, '$1 ').replace(/гвардейск\p{L}*/u, 'гв.').replace(/ударн\p{L}*\s+армия/u, 'уд. А').replace(/танков\p{L}*\s+армия/u, 'ТА').replace(/армия Войска Польского/u, 'А ВП').replace(/\sармия$/u, ' А');

/** Все объекты выбора по виду хода: свои — в строю, противник — что видит разведка, мосты — не разрушенные к ходу. */
export function postObjects(v: TurnView): PostObject[] {
  const hqs = v.command?.hqs ?? {};
  return [
    ...(v.places ?? []).map((p) => ({ kind: 'place' as const, id: p.id, title: p.title, at: p.at })),
    ...(v.lines ?? []).filter((l) => l.line.length > 0).map((l) => ({ kind: 'line' as const, id: l.id, title: l.name, at: midpoint(l.line), line: l.line })),
    ...(v.own ?? []).filter((u) => u.status === 'active').map((u) => ({ kind: 'own' as const, id: u.id, title: hqs[u.id]?.name ?? u.name, at: u.at, parent: hqs[u.id]?.parent ?? u.parent })),
    ...(v.intel ?? []).map((e) => ({ kind: 'enemy' as const, id: e.id, title: e.name, at: e.at })),
    ...(v.crossings ?? []).map((b) => ({ kind: 'bridge' as const, id: b.id, title: b.name, at: b.at })),
  ];
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Поиск: подстрока без учёта регистра и «ё» (начало названия — выше); без запроса — ближайшие к from. */
export function findObjects(list: PostObject[], q: string, from: LngLat | null, kind?: ObjKind, limit = 12): (PostObject & { km: number | null })[] {
  const n = norm(q.trim());
  const rows = list.filter((o) => (!kind || o.kind === kind) && (!n || norm(o.title).includes(n)))
    .map((o) => ({ ...o, km: from ? Math.round(km(from, o.at)) : null }));
  const rank = (o: PostObject) => (n && norm(o.title).startsWith(n) ? 0 : 1);
  return rows.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o) - rank(b.o) || (a.o.km ?? 0) - (b.o.km ?? 0) || a.i - b.i).slice(0, limit).map((x) => x.o);
}

/** Объект в поле проекта: рубеж — линией, иное — точкой; ось — от места получателя (from) к объекту. */
export function applyObject(d: DirDraft, field: DirPick, o: PostObject, from: LngLat | null): DirDraft {
  const pts = o.line && o.line.length > 1 ? o.line : [o.at];
  switch (field) {
    case 'immediate': return { ...d, immediate: pts, immediateTitle: o.title };
    case 'subsequent': return { ...d, subsequent: pts, subsequentTitle: o.title };
    case 'axis': return { ...d, axis: [from ?? o.at, o.at], axisTitle: o.title };
    case 'boundaryR': return { ...d, boundaries: [o.line && o.line.length > 1 ? o.line : [...d.boundaries[0], o.at], d.boundaries[1]] };
    case 'boundaryL': return { ...d, boundaries: [d.boundaries[0], o.line && o.line.length > 1 ? o.line : [...d.boundaries[1], o.at]] };
    case 'mainBlow':
      if (o.kind !== 'own' || o.parent !== d.to) return d;
      return { ...d, mainBlow: d.mainBlow.includes(o.id) ? d.mainBlow.filter((x) => x !== o.id) : [...d.mainBlow, o.id] };
  }
}

/** Точка цели проекта с подписью: пункт ближайшей задачи, середина её рубежа, иначе конец оси; нет ни того ни другого — null. */
export function objectiveMark(d: DirDraft, name: string): { at: LngLat; label: string } | null {
  const what = (t?: string) => `${shortName(name)}: ${DIR_TASK_RU[d.task]} — ${t ?? 'указанная точка'}`;
  if (d.immediate.length) return { at: d.immediate.length === 1 ? d.immediate[0] : midpoint(d.immediate), label: what(d.immediateTitle ?? (d.immediate.length > 1 ? 'указанный рубеж' : undefined)) };
  if (d.axis.length >= 2) return { at: d.axis[d.axis.length - 1], label: what(d.axisTitle) };
  return null;
}
