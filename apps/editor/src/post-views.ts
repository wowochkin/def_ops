/**
 * Вкладки экрана командования по уровню пункта управления (агентная модель): доклады — подчинённых штаба пункта,
 * разведка — противник ступенью, как у пункта (у Ставки — группы армий, у фронта — армии, у армии — корпуса, у корпуса
 * и дивизии — дивизии), в полосе пункта; документы — штаба и его подчинённых. Без React.
 */
import type { IntelReport, UnitReport } from '@def-ops/sim';
import type { LngLat } from '@def-ops/core';
import type { HumanDecision, TurnView } from './sim/game-protocol';
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

/** Центр войск штаба: среднее положение его действующих дивизий по численности; дивизий нет — null. */
export function hqCenter(v: TurnView, hq: string): LngLat | null {
  const l = divisionsUnder(v, hq);
  if (!l.length) return null;
  const P = l.reduce((s, u) => s + u.personnel, 0) || 1;
  return [l.reduce((s, u) => s + u.at[0] * u.personnel, 0) / P, l.reduce((s, u) => s + u.at[1] * u.personnel, 0) / P];
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

/** Штаб и все штабы под ним (по подчинённости штабов, глубина до 8). */
export function subtreeHqs(v: TurnView, issuer: string): Set<string> {
  const hqs = v.command?.hqs ?? {};
  const out = new Set([issuer]);
  for (let n = 0; n < 8; n++) {
    let grew = false;
    for (const [id, h] of Object.entries(hqs)) if (h.parent && out.has(h.parent) && !out.has(id)) { out.add(id); grew = true; }
    if (!grew) break;
  }
  return out;
}

/** Документы пункта: штаба и штабов под ним, а также документы старших, адресованные в это поддерево (штабам или дивизиям). */
export function postDocs(v: TurnView, issuer: string): NonNullable<TurnView['command']>['documents'] {
  const subs = subtreeHqs(v, issuer);
  const seniors = new Set(ancestry(v, issuer));
  const targets = new Set([...subs, ...divisionsUnder(v, issuer).map((u) => u.id)]);
  return (v.command?.documents ?? []).filter((d) => subs.has(d.hq) || (seniors.has(d.hq) && d.to.some((t) => targets.has(t))));
}

/** Резервы пункта: у Ставки — все, у фронта — его, ниже — где соединения резерва в подчинении штаба. */
export function postReserves(v: TurnView, issuer: string): TurnView['reserveGroups'] {
  const h = v.command?.hqs[issuer];
  if (!h || h.echelon === 'high_command') return v.reserveGroups;
  if (h.echelon === 'front') return v.reserveGroups.filter((g) => g.front === issuer);
  return v.reserveGroups.filter((g) => g.id === issuer || g.members.some((m) => ancestry(v, m).includes(issuer)));
}

/** День журнала боевых действий штаба: события с его войсками, его решение, документы отданные и полученные. */
/** Ключ времени для сравнения: документы — «ДД.ММ ЧЧ:ММ», журнал — ISO. */
const docKey = (t: string) => `${t.slice(3, 5)}${t.slice(0, 2)} ${t.slice(6, 11)}`;
const isoKey = (t: string) => `${t.slice(5, 7)}${t.slice(8, 10)} ${t.slice(11, 16)}`;

export interface PostJournalDay {
  time: string;
  events: string[];
  decision: HumanDecision | null;
  issued: NonNullable<TurnView['command']>['documents'];
  received: NonNullable<TurnView['command']>['documents'];
}

/**
 * Журнал боевых действий штаба пункта (его вели штабы фронта, армии, корпуса, дивизии): по ходам — события, где названы
 * его войска (он сам, подчинённые, их дивизии), его решение (запись игры), документы, отданные им и полученные им.
 */
export function postJournal(v: TurnView, issuer: string, decisions: { time: string; d: HumanDecision | null }[]): PostJournalDay[] {
  const hq = v.command?.hqs[issuer];
  const ids = new Set([issuer, ...recipients(v, issuer).map((x) => x.id), ...divisionsUnder(v, issuer).map((d) => d.id)]);
  const names = [...new Set([...ids].flatMap((id) => {
    const n = v.command?.hqs[id]?.name ?? v.own.find((u) => u.id === id)?.name ?? '';
    return n ? [n, n.replace(/\s*\(.*?\)\s*/g, ' ').trim()] : [];
  }))].filter((n) => n.length > 2);
  const top = hq?.echelon === 'high_command';
  const days = [...v.journal].sort((a, b) => a.time.localeCompare(b.time));
  const docs = (v.command?.documents ?? []).map((x) => ({ x, k: docKey(x.time) }));
  return days.map((d, i) => {
    const from = isoKey(d.time), until = days[i + 1] ? isoKey(days[i + 1].time) : '~';
    const inDay = docs.filter(({ k }) => k >= from && k < until).map(({ x }) => x);
    return {
      time: d.time,
      events: top ? d.events : d.events.filter((e) => names.some((n) => e.includes(n))),
      decision: decisions.find((x) => x.time === d.time)?.d ?? null,
      issued: inDay.filter((x) => x.hq === issuer),
      received: inDay.filter((x) => x.hq !== issuer && x.to.includes(issuer)),
    };
  });
}
