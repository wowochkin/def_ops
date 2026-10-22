/**
 * Вкладки экрана командования по уровню пункта управления (агентная модель): доклады — подчинённых штаба пункта,
 * разведка — противник ступенью, как у пункта (у Ставки — группы армий, у фронта — армии, у армии — корпуса, у корпуса
 * и дивизии — дивизии), в полосе пункта; документы — штаба и его подчинённых. Без React.
 */
import type { IntelReport, UnitReport } from '@def-ops/sim';
import type { LngLat } from '@def-ops/core';
import type { TurnView } from './sim/game-protocol';
import type { LevelId } from './map-level-scale';
import { recipients } from './command-post';

const km = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), (a[1] - b[1]) * 110.57);

/** Предки (по подчинённости своих штабов и докладов). */
function ancestry(v: TurnView, id: string): string[] {
  const hqs = v.command?.hqs ?? {};
  const out: string[] = [];
  for (let x = hqs[id]?.parent ?? v.own.find((u) => u.id === id)?.parent ?? null, n = 0; x && n < 8; x = hqs[x]?.parent ?? null, n++) out.push(x);
  return out;
}

/** Действующие дивизии в подчинении штаба (на любую глубину). */
export function divisionsUnder(v: TurnView, hq: string): UnitReport[] {
  return v.own.filter((u) => u.echelon === 'division' && u.status === 'active' && ancestry(v, u.id).includes(hq));
}

/** Сводный доклад штаба по его дивизиям (у фронтов своего доклада нет): по численности, как у армий и корпусов. */
function aggregate(id: string, name: string, echelon: string, parent: string | null, l: UnitReport[]): UnitReport | null {
  if (!l.length) return null;
  const P = l.reduce((s, u) => s + u.personnel, 0) || 1;
  const w = (k: (u: UnitReport) => number) => l.reduce((s, u) => s + k(u) * u.personnel, 0) / P;
  const most = (k: (u: UnitReport) => string | null) => { const m = new Map<string, number>(); for (const u of l) { const x = k(u); if (x) m.set(x, (m.get(x) ?? 0) + u.personnel); } return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
  const task = most((u) => u.task);
  return {
    id, name, parent, echelon: echelon as UnitReport['echelon'], status: 'active', at: [w((u) => u.at[0]), w((u) => u.at[1])], place: most((u) => u.place) ?? '',
    posture: most((u) => u.posture) ?? '', task, target: task ? most((u) => (u.task === task ? u.target : null)) : null, orderSource: most((u) => u.orderSource),
    personnel: Math.round(P), tanks: l.reduce((s, u) => s + u.tanks, 0), guns: l.reduce((s, u) => s + u.guns, 0),
    strength: w((u) => u.strength), ammo: +w((u) => u.ammo).toFixed(2), fuel: +w((u) => u.fuel).toFixed(2), fatigue: +w((u) => u.fatigue).toFixed(2),
    cutOff: l.some((u) => u.cutOff), movedKm: +w((u) => u.movedKm).toFixed(1), combats: [], pending: [],
  };
}

/** Доклады подчинённых штаба пункта: свой доклад, если есть, иначе — сводка по дивизиям. */
export function postReports(v: TurnView, issuer: string): UnitReport[] {
  return recipients(v, issuer).map((x) => v.own.find((u) => u.id === x.id) ?? aggregate(x.id, x.name, x.echelon, x.parent, divisionsUnder(v, x.id)))
    .filter((x): x is UnitReport => !!x);
}

/** Ступень противника, по которой собирается разведсводка пункта. */
const ENEMY_ECHELON: Record<LevelId, string> = { stavka: 'front', front: 'army', army: 'corps', corps: 'division', division: 'division' };
/** Полоса пункта для разведки: противник не дальше этого от своих дивизий штаба, км (Ставка — весь театр). */
const REACH_KM: Record<LevelId, number> = { stavka: Infinity, front: 60, army: 30, corps: 20, division: 15 };
const RANK: Record<string, number> = { division: 0, corps: 1, army: 2, front: 3, high_command: 4 };

export interface IntelGroup { id: string; name: string; echelon: string; at: LngLat; members: IntelReport[]; fresh: boolean; nearestKm: number | null }

/** Разведсводка пункта: обнаруженный противник, собранный по его штабам ступени пункта, в полосе пункта. */
export function postIntel(v: TurnView, level: LevelId, issuer: string): IntelGroup[] {
  const e = v.command?.enemy;
  const want = ENEMY_ECHELON[level];
  const mine = divisionsUnder(v, issuer).map((u) => u.at);
  const near = (p: LngLat) => REACH_KM[level] === Infinity || mine.some((q) => km(p, q) <= REACH_KM[level]);
  const groups = new Map<string, IntelGroup>();
  for (const r of v.intel.filter((x) => near(x.at))) {
    // ближайший старший нужной ступени; нет такого (дивизия прямо под армией) — ближайший не старше её
    let g: { id: string; name: string; echelon: string } = { id: r.id, name: r.name, echelon: 'division' };
    if (want !== 'division' && e) {
      for (let x: string | null = e.divisions[r.id] ?? null, n = 0; x && n < 8; x = e.hqs[x]?.parent ?? null, n++) {
        const h = e.hqs[x];
        if (!h || RANK[h.echelon] > RANK[want]) break;
        g = { id: x, name: h.name, echelon: h.echelon };
        if (h.echelon === want) break;
      }
    }
    const cur = groups.get(g.id) ?? { ...g, at: [0, 0] as LngLat, members: [], fresh: false, nearestKm: null };
    cur.members.push(r);
    cur.fresh ||= r.fresh;
    if (r.nearest) cur.nearestKm = cur.nearestKm === null ? r.nearest.km : Math.min(cur.nearestKm, r.nearest.km);
    groups.set(g.id, cur);
  }
  return [...groups.values()].map((g) => ({ ...g, at: [g.members.reduce((s, m) => s + m.at[0], 0) / g.members.length, g.members.reduce((s, m) => s + m.at[1], 0) / g.members.length] as LngLat }))
    .sort((a, b) => (a.nearestKm ?? 1e9) - (b.nearestKm ?? 1e9));
}

/** Документы штаба пункта и его подчинённых штабов. */
export function postDocs(v: TurnView, issuer: string): NonNullable<TurnView['command']>['documents'] {
  const subs = new Set([issuer, ...recipients(v, issuer).map((x) => x.id)]);
  return (v.command?.documents ?? []).filter((d) => subs.has(d.hq));
}
