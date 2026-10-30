/**
 * Разбор хода по правилам, без языковой модели: ключевые события окна хода ядра (прорыв, окружение, взятие пункта,
 * контрудар, отход, разгром) с местом, стрелкой, участниками, потерями и причинами (документы штабов, решения
 * командующих, полученные приказы), и положение каждого штаба своей стороны — для выбора «разобрать с позиции …».
 * События сверки (взятие, соединение, котёл) — та же функция, что у мерила сходства (agentsEvents). Пороги здесь —
 * пороги показа, не правила модели. Чистые функции: их зовут фоновые потоки переигровки и игры.
 */
import type { LngLat } from '@def-ops/core';
import { CUT_H, postureOf, type AgentHistory, type AgentTrace } from './agents';
import { agentsEvents } from './agents-score';
import type { EventResult, History } from './history';
import { areaTitle, describePlace } from './reports';
import { divisionLoss } from './results';
import { addHours, type SimContext } from './step';

/** Прорыв: наступавшие дивизии армии прошли в среднем не меньше стольких км за сутки окна (и не меньше 4 км). */
export const BREAK_KM_DAY = 10;
/** Контрудар: не меньше стольких дивизий армии перешли из обороны в наступление. */
export const COUNTER_MIN = 2;
/** Отход: дивизия в отходе сместилась не меньше стольких км. */
export const WITHDRAW_KM = 3;
/** Причины события — документы, решения и приказы не раньше стольких часов до начала окна. */
export const CAUSE_LOOKBACK_H = 24;
/** Разбор с позиции штаба: события в пределах стольких км от его дивизий. */
export const BAND_PAD_KM = 15;
/** Ключевых событий хода — не больше. */
export const KEY_EVENTS_MAX = 8;
/** Причин у события — не больше. */
export const CAUSES_MAX = 3;
/** Туман: событие невидимого противника затрагивает свои войска, если они в пределах стольких км от его участников. */
export const TOUCH_KM = 10;

export type KeyEventKind = 'breakthrough' | 'encirclement' | 'capture' | 'counterattack' | 'withdrawal' | 'destroyed';
export interface KeyCause { kind: 'document' | 'decision' | 'order'; side: 'su' | 'de'; hq: string; tick: number; text: string }
export interface KeyEvent {
  id: string; kind: KeyEventKind; side: 'su' | 'de'; tick: number; title: string; text: string;
  at: LngLat; from: LngLat | null; to: LngLat | null;
  divisions: string[];
  /** Все штабы-предки участников. */
  hqs: string[];
  km: number | null; lost: number; causes: KeyCause[]; weight: number;
  /** false — участники противника не видны: событие показано по своим затронутым войскам. */
  seen: boolean;
}
export interface DebriefHq {
  id: string; name: string; echelon: string; side: 'su' | 'de'; parent: string | null;
  alive: number; state: 'line' | 'removed' | 'destroyed';
  points: LngLat[]; center: LngLat | null;
  task: { tick: number; text: string } | null;
  goal: { title: string; kmBefore: number | null; kmAfter: number | null } | null;
  histKm: number | null;
}
export interface TurnDebrief {
  from: number; to: number; time: string; side: 'su' | 'de';
  events: KeyEvent[]; hqs: Record<string, DebriefHq>;
  quiet: { maxAdvanceKm: number; lost: number };
}

/** Ход игры для окна разбора: кадры и час передачи командования. */
export type GameWindowTrace = Pick<AgentTrace, 'frames'> & { game?: { takeover: number } };

/** Окно разбора хода игры по ходу ядра: последние turnHours часов, не раньше передачи командования. */
export function debriefWindow(t: GameWindowTrace, turnHours: number): { from: number; to: number } {
  const to = t.frames.length - 1;
  return { from: Math.max(0, t.game?.takeover ?? 0, to - turnHours), to };
}

const WEIGHT: Record<KeyEventKind, number> = { capture: 5, encirclement: 4, breakthrough: 3, counterattack: 3, destroyed: 2, withdrawal: 1 };
const ENEMY_TITLE: Record<KeyEventKind, string> = {
  breakthrough: 'Прорыв противника', encirclement: 'Окружение противника', capture: 'Противник занял пункт',
  counterattack: 'Контрудар противника', withdrawal: 'Отход противника', destroyed: 'Разгром противника',
};
const HIDDEN = 'Причины: решения противника известны только посреднику.';

/** Расстояние по дуге большого круга, км. */
function km(a: LngLat, b: LngLat): number {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
const r1 = (x: number) => Math.round(x * 10) / 10;
const center = (ps: LngLat[]): LngLat | null => ps.length ? [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length] : null;
/** Км словами: меньше 10 — с десятыми, дальше — целые. */
const fmtKm = (x: number) => { const v = x < 10 ? r1(x) : Math.round(x); return (v >= 10 ? String(Math.round(v)) : String(v)).replace('.', ','); };
const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10, b = n % 100;
  return `${n} ${a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many}`;
};
const divs = (n: number) => plural(n, 'дивизия', 'дивизии', 'дивизий');
const listNames = (names: string[]) => names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} и ещё ${names.length - 3}`;
/** Текст документа без служебной метки «[штаб@время:вид]», не длиннее n знаков. */
const clip = (s0: string, n = 240) => { const s = s0.replace(/\s*\[[^\]]*@[^\]]*\]/g, '').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
/** Глагол по числу дивизий: одна — единственное. */
const vb = (n: number, one: string, many: string) => (n === 1 ? one : many);
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

type Raw = { id: string; kind: KeyEventKind; side: 'su' | 'de'; tick: number; ks: number[]; at: LngLat; from: LngLat | null; to: LngLat | null; km: number | null; title: string; text: string };
type HistEvent = NonNullable<History['events']>[number] & { side?: string; place?: string; radiusKm?: number; formations?: string[]; at?: LngLat | null };

/**
 * Ключевые события окна (from, to] хода t с позиции стороны side. seen — видна ли дивизия противника (игра, туман);
 * reveal — посредник: видно всё, причины противника тоже. Свои штабы — с положением, задачей, целью и удалением от
 * исторического положения.
 */
export function turnEvents(
  base: SimContext,
  t: AgentTrace & { command?: { historical?: { at: number; to: string; task: string; note: string; issued: boolean }[] } },
  h: AgentHistory, baseHistory: History | null, fromH: number, toH: number,
  o: { side: 'su' | 'de'; seen?: (division: string) => boolean; reveal?: boolean },
): TurnDebrief {
  const last = t.frames.length - 1;
  const to = Math.max(0, Math.min(last, Math.round(toH)));
  const from = Math.max(0, Math.min(to, Math.round(fromH)));
  const me = o.side, reveal = !!o.reveal;
  const T = base.theatre;
  const [iLng, iLat, iState, iEnc, iCap] = ['lng', 'lat', 'state', 'encircled', 'captured'].map((n) => t.fields.indexOf(n));
  const sideOf = (s: string): 'su' | 'de' => (s === 'de' ? 'de' : 'su');
  const hq = new Map(t.hqs.map((x) => [x.id, x]));
  const chain = (id: string): string[] => {
    const out: string[] = [];
    for (let p: string | null = id, n = 0; p && n < 12; p = hq.get(p)?.parent ?? null, n++) out.push(p);
    return out;
  };
  const up = (id: string, echelon: string) => chain(id).find((x) => hq.get(x)?.echelon === echelon) ?? null;
  const D = t.divisions;
  const dSide = D.map((d) => sideOf(d.side));
  const dChain = D.map((d) => chain(d.hq));
  const st = (k: number, x: number) => String(t.frames[x][k][iState]);
  const post = (k: number, x: number) => postureOf(st(k, x));
  const pending = (k: number, x: number) => st(k, x).startsWith('не введена');
  const out = (k: number, x: number) => post(k, x) === 'destroyed' || st(k, x).startsWith('сведена');
  const inLine = (k: number, x: number) => { const p = post(k, x); return p !== null && p !== 'destroyed'; };
  const pos = (k: number, x: number): LngLat => [t.frames[x][k][iLng] as number, t.frames[x][k][iLat] as number];
  const enc = (k: number, x: number) => (iEnc >= 0 ? (t.frames[x][k][iEnc] as number) ?? 0 : 0);
  const any = (f: (x: number) => boolean) => { for (let x = from + 1; x <= to; x++) if (f(x)) return x; return -1; };
  const lostW = D.map((_, k) => divisionLoss(t, k, to).personnel - divisionLoss(t, k, from).personnel);
  const visible = (k: number) => dSide[k] === me || reveal || !o.seen || o.seen(D[k].id);
  const name = (id: string) => hq.get(id)?.name ?? id;

  // объединения: армия-предок, без армии — фронт, без фронта — свой штаб
  const groups = new Map<string, number[]>();
  D.forEach((d, k) => { const g = up(d.hq, 'army') ?? up(d.hq, 'front') ?? d.hq; groups.set(g, [...(groups.get(g) ?? []), k]); });

  // события сверки: наступившие к to и не наступившие к from — случились в окне
  const cutAt = (x: number) => (x < last ? { ...t, hours: x, frames: t.frames.slice(0, x + 1) } : t);
  const evTo: EventResult[] = (h.events ?? []).length ? agentsEvents(base, cutAt(to), h, baseHistory) : [];
  const evFrom: EventResult[] = evTo.some((e) => e.simulated) ? agentsEvents(base, cutAt(from), h, baseHistory) : [];
  const before = new Set(evFrom.filter((e) => e.simulated).map((e) => e.id));
  const startMs = Date.parse(`${t.start}Z`);
  const hourOf = (iso: string) => Math.round((Date.parse(`${iso}Z`) - startMs) / 3.6e6);
  const hev = new Map(((h.events ?? []) as HistEvent[]).map((e) => [e.id, e]));
  const locOf = (e: HistEvent): LngLat | null => (e.at as LngLat | null | undefined) ?? (e.place ? (T.area(e.place)?.center as LngLat | undefined) ?? null : null);

  const raw: Raw[] = [];
  const covered = new Set<number>();
  for (const e of evTo) {
    if (!e.simulated || before.has(e.id)) continue;
    const he = hev.get(e.id);
    if (!he) continue;
    const tick = Math.max(from + 1, Math.min(to, e.at ? hourOf(e.at) : to));
    const when = `по истории — ${ddmm(e.historical)}${e.days == null ? '' : e.days === 0 ? ', в срок' : `, ${e.days > 0 ? 'позже' : 'раньше'} на ${plural(Math.abs(e.days), 'сутки', 'суток', 'суток')}`}`;
    const under = (k: number) => !he.formations?.length || he.formations.includes(D[k].id) || he.formations.some((f) => dChain[k].includes(f));
    if (he.kind === 'cut') {
      const ks = D.map((_, k) => k).filter((k) => under(k) && enc(k, to) > 0 && !out(k, to));
      const c = center(ks.map((k) => pos(k, to)));
      if (!ks.length || !c) continue;
      ks.forEach((k) => covered.add(k));
      raw.push({ id: e.id, kind: 'encirclement', side: dSide[ks[0]], tick, ks, at: c, from: null, to: null, km: null, title: e.title, text: `${vb(ks.length, 'Отрезана', 'Отрезаны')} ${divs(ks.length)}: ${listNames(ks.map((k) => D[k].name))}; ${when}.` });
    } else if (he.kind === 'reach' || he.kind === 'meet') {
      const loc = locOf(he);
      if (!loc) continue;
      const side = he.side ? sideOf(he.side) : null;
      const r = (he.radiusKm ?? 8) + 2;
      const near = D.map((_, k) => k).filter((k) => (!side || dSide[k] === side) && under(k) && inLine(k, tick));
      let ks = near.filter((k) => km(pos(k, tick), loc) <= r);
      if (!ks.length && near.length) ks = [near.reduce((a, k) => (km(pos(k, tick), loc) < km(pos(a, tick), loc) ? k : a))];
      raw.push({ id: e.id, kind: 'capture', side: side ?? (ks.length ? dSide[ks[0]] : me), tick, ks, at: loc, from: null, to: null, km: null, title: e.title,
        text: `${describePlace(T, loc).replace(/^у /, 'У ')}${ks.length ? `: ${listNames(ks.map((k) => D[k].name))}` : ''}; ${when}.` });
    }
  }

  const hours = to - from;
  for (const [g, ks] of groups) {
    const gName = name(g), side = dSide[ks[0]];
    // прорыв: наступавшие дивизии прошли в среднем не меньше порога
    const att = ks.filter((k) => inLine(k, from) && inLine(k, to) && (post(k, from) === 'attack' || any((x) => post(k, x) === 'attack') >= 0));
    // одна дивизия большой армии — не прорыв армии: нужно не меньше двух (или все, если в объединении одна)
    if (att.length >= Math.min(2, ks.length) && hours > 0) {
      const avg = att.reduce((a, k) => a + km(pos(k, from), pos(k, to)), 0) / att.length;
      if (avg >= Math.max(4, BREAK_KM_DAY * hours / 24)) {
        const a = center(att.map((k) => pos(k, from)))!, b = center(att.map((k) => pos(k, to)))!;
        raw.push({ id: `breakthrough:${g}:${to}`, kind: 'breakthrough', side, tick: to, ks: att, at: b, from: a, to: b, km: r1(avg), title: `Прорыв: ${gName}`,
          text: `${gName}: ${divs(att.length)} ${vb(att.length, 'продвинулась', 'продвинулись')} в среднем на ${fmtKm(avg)} км за ${plural(hours, 'час', 'часа', 'часов')}, ${describePlace(T, b)}.` });
      }
    }
    // контрудар: армия в обороне, не меньше COUNTER_MIN дивизий перешли в наступление
    const live0 = ks.filter((k) => inLine(k, from));
    const def0 = live0.filter((k) => post(k, from) === 'defend');
    if (def0.length * 2 > live0.length) {
      const sw = def0.map((k) => [k, any((x) => post(k, x) === 'attack')] as const).filter(([, x]) => x >= 0);
      if (sw.length >= COUNTER_MIN) {
        const kk = sw.map(([k]) => k);
        const a = center(kk.map((k) => pos(k, from)))!;
        const foes = D.map((_, k) => k).filter((k) => dSide[k] !== side && inLine(k, to));
        const foe = foes.length ? foes.reduce((m, k) => (km(pos(k, to), a) < km(pos(m, to), a) ? k : m)) : -1;
        const target = foe >= 0 ? pos(foe, to) : null;
        const foeName = foe < 0 ? '' : dSide[foe] === me || visible(foe) ? D[foe].name : 'противник';
        raw.push({ id: `counterattack:${g}:${to}`, kind: 'counterattack', side, tick: Math.min(...sw.map(([, x]) => x)), ks: kk, at: a, from: target ? a : null, to: target, km: null, title: `Контрудар: ${gName}`,
          text: `${gName}: ${divs(kk.length)} из обороны ${vb(kk.length, 'перешла', 'перешли')} в наступление${foe >= 0 ? ` — на ${foeName}, ${describePlace(T, target!)}` : ''}.` });
      }
    }
    // отход: не меньше половины живых дивизий отходили и сместились не меньше WITHDRAW_KM
    const wd = live0.filter((k) => !out(k, to) && (post(k, from) === 'withdraw' || any((x) => post(k, x) === 'withdraw') >= 0) && km(pos(k, from), pos(k, to)) >= WITHDRAW_KM);
    if (live0.length && wd.length * 2 >= live0.length && wd.length) {
      const a = center(wd.map((k) => pos(k, from)))!, b = center(wd.map((k) => pos(k, to)))!;
      const avg = wd.reduce((s, k) => s + km(pos(k, from), pos(k, to)), 0) / wd.length;
      raw.push({ id: `withdrawal:${g}:${to}`, kind: 'withdrawal', side, tick: to, ks: wd, at: b, from: a, to: b, km: r1(avg), title: `Отход: ${gName}`,
        text: `${gName}: ${divs(wd.length)} ${vb(wd.length, 'отошла', 'отошли')} в среднем на ${fmtKm(avg)} км, ${describePlace(T, b)}.` });
    }
    // окружение: отрезанность перешла CUT_H внутри окна (кроме дивизий котла из событий сверки)
    const cut = ks.map((k) => [k, enc(k, from) < CUT_H && !out(k, from) ? any((x) => enc(k, x) >= CUT_H) : -1] as const).filter(([k, x]) => x >= 0 && !covered.has(k));
    if (cut.length) {
      const kk = cut.map(([k]) => k);
      const c = center(kk.map((k) => pos(k, to)))!;
      raw.push({ id: `encirclement:${g}:${to}`, kind: 'encirclement', side, tick: Math.min(...cut.map(([, x]) => x)), ks: kk, at: c, from: null, to: null, km: null, title: `Окружение: ${gName}`,
        text: `${gName}: больше суток ${vb(kk.length, 'отрезана', 'отрезаны')} ${divs(kk.length)} — ${listNames(kk.map((k) => D[k].name))}, ${describePlace(T, c)}.` });
    }
    // разгром: дивизии стали небоеспособны или сведены в другие (капитуляция — по пленным)
    const dead = ks.map((k) => [k, !out(k, from) && out(k, to) ? any((x) => out(k, x)) : -1] as const).filter(([, x]) => x >= 0);
    if (dead.length) {
      const kk = dead.map(([k]) => k);
      const lastAt = (k: number, x: number) => pos(k, Math.max(from, x - 1));
      const c = center(dead.map(([k, x]) => lastAt(k, x)))!;
      const what = (k: number) => {
        const cap = iCap >= 0 ? Math.round((t.frames[to][k][iCap] as number) - (t.frames[from][k][iCap] as number)) : 0;
        return `${D[k].name} — ${cap > 0 ? `капитулировала (в плен — ${cap})` : st(k, to).startsWith('сведена') ? 'сведена в другую' : 'небоеспособна'}`;
      };
      raw.push({ id: `destroyed:${g}:${to}`, kind: 'destroyed', side, tick: Math.min(...dead.map(([, x]) => x)), ks: kk, at: c, from: null, to: null, km: null, title: `Разгром: ${gName}`,
        text: `${gName}: ${listNames(kk.map(what))}.` });
    }
  }

  // причины: документы, решения командующих, полученные приказы участников (окно с запасом CAUSE_LOOKBACK_H)
  const lo = from - CAUSE_LOOKBACK_H;
  const inRange = (x: number) => x >= lo && x <= to;
  const hqSide = (id: string) => sideOf(hq.get(id)?.side ?? 'su');
  const causesOf = (ks: number[], hqs: Set<string>): KeyCause[] => {
    const ids = new Set(ks.map((k) => D[k].id));
    const hqOfDiv = new Map(ks.map((k) => [D[k].id, D[k].hq]));
    const cs: KeyCause[] = [
      ...(t.documents ?? []).filter((d) => d.kind !== 'report' && inRange(d.tick) && hqs.has(d.hq)).map((d): KeyCause => ({ kind: 'document', side: hqSide(d.hq), hq: d.hq, tick: d.tick, text: clip(d.text) })),
      ...(t.commanders ?? []).filter((c) => hqs.has(c.hq)).flatMap((c) => c.decisions.filter((x) => inRange(x.tick)).map((x): KeyCause => ({ kind: 'decision', side: hqSide(c.hq), hq: c.hq, tick: x.tick, text: clip(x.why) }))),
    ];
    const seenText = new Set<string>();
    for (const j of t.journal) {
      if (!j.agent || !ids.has(j.agent) || !inRange(j.tick) || !j.text.startsWith('получен приказ') || seenText.has(j.text)) continue;
      seenText.add(j.text);
      const dh = hqOfDiv.get(j.agent)!;
      cs.push({ kind: 'order', side: hqSide(dh), hq: dh, tick: j.tick, text: clip(j.text).replace(/:\s*$/, '') });
    }
    // одна причина — один раз: тот же текст (документ нескольким адресатам, приказ по цепочке) — свежий
    const once = new Set<string>();
    return cs.sort((a, b) => b.tick - a.tick).filter((c) => !once.has(c.text) && !!once.add(c.text)).slice(0, CAUSES_MAX);
  };
  const lossOf = (ks: number[]) => Math.round(ks.reduce((a, k) => a + lostW[k], 0));
  const hqsOf = (ks: number[]) => [...new Set(ks.flatMap((k) => dChain[k]))];

  const events: KeyEvent[] = [];
  for (const r of raw) {
    const hidden = r.side !== me && !reveal;
    let ev: KeyEvent = { id: r.id, kind: r.kind, side: r.side, tick: r.tick, title: r.title, text: r.text, at: r.at, from: r.from, to: r.to,
      divisions: r.ks.map((k) => D[k].id), hqs: hqsOf(r.ks), km: r.km, lost: lossOf(r.ks), causes: [], weight: 0, seen: true };
    if (hidden && o.seen && !r.ks.some((k) => o.seen!(D[k].id))) {
      // туман: событие невидимого противника — только если затрагивает свои войска, по ним
      const marks = r.ks.flatMap((k) => [pos(k, from), pos(k, to)]).concat(r.ks.length ? [] : [r.at]);
      const own = D.map((_, k) => k).filter((k) => dSide[k] === me && inLine(k, to) && marks.some((p) => km(pos(k, to), p) <= TOUCH_KM));
      if (!own.length) continue;
      const c = center(own.map((k) => pos(k, to)))!;
      ev = { ...ev, title: ENEMY_TITLE[r.kind], text: `${ENEMY_TITLE[r.kind]}: затронуты ${divs(own.length)} — ${listNames(own.map((k) => D[k].name))}, ${describePlace(T, c)}.`,
        at: c, from: null, to: null, km: null, divisions: own.map((k) => D[k].id), hqs: hqsOf(own), lost: lossOf(own), seen: false };
    }
    if (hidden) ev.text = `${ev.text} ${HIDDEN}`;
    else ev.causes = causesOf(r.ks, new Set(hqsOf(r.ks)));
    ev.weight = r1(WEIGHT[ev.kind] + ev.lost / 1000);
    events.push(ev);
  }
  events.sort((a, b) => b.weight - a.weight);
  const kept = events.slice(0, KEY_EVENTS_MAX).sort((a, b) => a.tick - b.tick || b.weight - a.weight);

  // ход без событий: наибольшее смещение и потери своих
  const mine = D.map((_, k) => k).filter((k) => dSide[k] === me);
  const moved = mine.filter((k) => inLine(k, from) && inLine(k, to)).map((k) => km(pos(k, from), pos(k, to)));
  const quiet = { maxAdvanceKm: r1(moved.length ? Math.max(...moved) : 0), lost: lossOf(mine) };

  // штабы своей стороны
  const occurred = new Set(evTo.filter((e) => e.simulated).map((e) => e.id));
  const timeTo = addHours(t.start, to), msTo = Date.parse(`${timeTo}Z`);
  const hqs: Record<string, DebriefHq> = {};
  for (const x of t.hqs) {
    if (sideOf(x.side) !== me || x.echelon === 'high_command') continue;
    const ks = D.map((_, k) => k).filter((k) => dChain[k].includes(x.id));
    if (!ks.length) continue;
    const alive = ks.filter((k) => inLine(k, to));
    const points = alive.map((k) => pos(k, to));
    const c = center(points);
    const c0 = center(ks.filter((k) => inLine(k, from)).map((k) => pos(k, from)));
    let state: DebriefHq['state'] = 'line';
    if (!alive.length) {
      const entered = ks.filter((k) => { for (let y = 0; y <= to; y++) if (!pending(k, y)) return true; return false; });
      const removed = entered.filter((k) => pending(k, to)).length, gone = entered.filter((k) => out(k, to)).length;
      state = removed && removed >= gone ? 'removed' : gone ? 'destroyed' : 'line';
    }
    // задача: последний документ (директива, приказ) штабу; в игре — и поданная историческая директива
    const tasks = [
      ...(t.documents ?? []).filter((d) => (d.kind === 'directive' || d.kind === 'order') && d.to.includes(x.id) && d.tick <= to).map((d) => ({ tick: d.tick, text: clip(d.text) })),
      ...(t.command?.historical ?? []).filter((d) => d.to === x.id && d.issued && d.at <= to).map((d) => ({ tick: d.at, text: clip(d.note || d.task) })),
    ].sort((a, b) => b.tick - a.tick);
    // цель: ближайшее к штабу из не наступивших событий сверки «выход к пункту» его стороны (при равном удалении —
    // раньшее по истории): самое раннее по дате у далёкого фронта — чужая цель (Торгау для 8 гв. А под Берлином)
    let goal: DebriefHq['goal'] = null;
    if (c) {
      const cand = ((h.events ?? []) as HistEvent[]).filter((e) => e.kind === 'reach' && sideOf(e.side ?? 'su') === me && !occurred.has(e.id) && locOf(e));
      if (cand.length) {
        const near = cand.reduce((m, e) => { const a = km(c, locOf(e)!), b = km(c, locOf(m)!); return a < b - 0.5 || (Math.abs(a - b) <= 0.5 && e.date < m.date) ? e : m; });
        const loc = locOf(near)!;
        goal = { title: near.place ? areaTitle(near.place) : near.title, kmBefore: c0 ? r1(km(c0, loc)) : null, kmAfter: r1(km(c, loc)) };
      }
    }
    // удаление от исторического положения: штаб (ближайшее время в пределах 12 ч), иначе среднее его дивизий в тот же день
    let histKm: number | null = null;
    if (c) {
      const arm = (h.armies ?? []).filter((a) => a.formation === x.id && Math.abs(Date.parse(`${a.time}Z`) - msTo) <= 12 * 3.6e6)
        .sort((a, b) => Math.abs(Date.parse(`${a.time}Z`) - msTo) - Math.abs(Date.parse(`${b.time}Z`) - msTo));
      const ids = new Set(ks.map((k) => D[k].id));
      const dh = center(h.divisions.filter((p) => ids.has(p.formation) && p.time.slice(0, 10) === timeTo.slice(0, 10)).map((p) => p.at));
      const ref = arm.length ? arm[0].at : dh;
      histKm = ref ? r1(km(c, ref)) : null;
    }
    hqs[x.id] = { id: x.id, name: x.name, echelon: x.echelon, side: me, parent: x.parent, alive: alive.length, state, points, center: c, task: tasks[0] ?? null, goal, histKm };
  }
  return { from, to, time: timeTo, side: me, events: kept, hqs, quiet };
}

/**
 * Разбор с позиции штаба: null — верхняя инстанция (Ставка / ОКХ): все события разбора; штаб — события его войск и в
 * пределах BAND_PAD_KM от них. verdict — задача, цель, удаление от истории; войск в строю нет — почему.
 */
export function debriefFor(d: TurnDebrief, hq: string | null): { events: KeyEvent[]; hq: DebriefHq | null; verdict: string[] } {
  if (hq == null) return { events: d.events, hq: null, verdict: [] };
  const x = d.hqs[hq] ?? null;
  const events = d.events.filter((e) => e.hqs.includes(hq) || !!x?.points.some((p) => km(p, e.at) <= BAND_PAD_KM));
  const verdict: string[] = [];
  if (!x) return { events, hq: null, verdict };
  if (x.task) verdict.push(`Задача: ${x.task.text}`);
  if (!x.alive) {
    verdict.push(`войск в строю нет: ${x.state === 'removed' ? 'штаб снят с операции' : x.state === 'destroyed' ? 'штаб разгромлен' : 'войска ещё не введены'}`);
    return { events, hq: x, verdict };
  }
  if (x.goal?.kmAfter != null) {
    const dd = x.goal.kmBefore == null ? null : x.goal.kmBefore - x.goal.kmAfter;
    verdict.push(`до ${x.goal.title} ${fmtKm(x.goal.kmAfter)} км${dd == null ? '' : Math.abs(dd) < 0.5 ? ', за ход — на прежнем удалении' : `, за ход ${dd > 0 ? 'ближе' : 'дальше'} на ${fmtKm(Math.abs(dd))} км`}`);
  }
  verdict.push(x.histKm == null ? 'исторического пути этого штаба в данных нет' : `от исторического положения — ${fmtKm(x.histKm)} км`);
  return { events, hq: x, verdict };
}
