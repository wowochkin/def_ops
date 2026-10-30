/**
 * Ход агентной модели (crates/agents-core, trace.json) в виде прогона этой модели: дивизии — действующие
 * формирования, штабы — узлы подчинения, кадры по часам — снимки через stepHours. Дальше — те же runToDocument,
 * summaryToDocument, checkEvents, что и для нынешней модели: «Переигровка» показывает обе одинаково.
 */
import type { LngLat } from '@def-ops/core';
import type { Echelon, Formation, FormationDef, Order, Posture, SimState, Task } from './types';
import { addHours, type SimContext } from './step';
import type { History, RunResult, Snapshot } from './history';

/** Ход агентной модели (trace::describe). */
export interface AgentTrace {
  scenario: string;
  name: string;
  start: string;
  hours: number;
  seed: number;
  fields: string[];
  divisions: { id: string; name: string; side: string; hq: string; kind: string; mobility: string; size: string; quality: number; note?: string }[];
  hqs: { id: string; name: string; side: string; echelon: string; parent: string | null }[];
  /** По кадру на час (и начальный), в кадре — строка на дивизию в порядке divisions, поля — fields. */
  frames: unknown[][][];
  journal: { tick: number; time: string; agent: string | null; text: string }[];
  sources?: string[];
  /** Действующий приказ каждой дивизии на последний кадр (порядок divisions); null — без приказа. */
  orders?: ({ kind: AgentOrderKind; target: LngLat; from: string; issued: number; arrives: number; note: string } | null)[];
  /** Документы штабов-агентов: директивы, приказы, распоряжения, извещения, донесения — с обоснованием. */
  documents?: { tick: number; time: string; hq: string; kind: 'directive' | 'order' | 'instruction' | 'notice' | 'report'; to: string[]; text: string; rule: string | null }[];
  /** Командующие (режим `commanders`): характер, состояние по часам, решения со всеми вариантами и оценками. Нет — командующих нет. */
  commanders?: AgentCommander[];
  /** История как замысел (режим `intent`): по штабу — смены статуса «по истории / сдвинут / сам» с причиной. Нет — режима нет. */
  intent?: { hq: string; changes: { tick: number; status: 'history' | 'shifted' | 'own'; reason: string | null }[] }[];
  /** Действующие полосы армий-агентов: при каждой смене (новый замысел, продление, войска вышли за полосу) — обе границы. */
  bands?: { hq: string; tick: number; left: LngLat[]; right: LngLat[] }[];
}

/** Число с пределами и источником (узел commanders.json). */
export interface AgentTrait { value: number; range: [number, number]; source: string; confidence: string }
export interface AgentCommanderOption {
  kind: string; label: string; rule: string; target: LngLat | null; parts: Record<string, number>; penalty: number; bonus: number; total: number;
  /** Деблокирование: выручаемая армия и армия, которой приказано выручать (получатель директивы). */
  army?: string | null; by?: string | null;
  mind: { hours: number; advanceKm: number; losses: number; encircled: number } | null;
}
export interface AgentCommander {
  hq: string; profile: string; name: string; side: 'su' | 'de';
  traits: Record<'risk' | 'persistence' | 'ambition' | 'lossTolerance' | 'obedience', AgentTrait>;
  baseMotives: Record<string, number>;
  rival: string | null; objective: string | null;
  snapshots: { tick: number; motives: Record<string, number>; mood: { confidence: number; stress: number }; intent: string | null;
    picture: { armies: { hq: string; advanceKm: number; strength: number; enemyEst: number; enemyTrue: number; toObjectiveKm: number | null; brokeThrough: boolean }[];
      rival: { hq: string; toObjectiveKm: number; asOf: number } | null; openFlanks: string[]; pockets: { center: LngLat; enemyEst: number; gapKm: number }[];
      enemyReserves: { at: LngLat; strength: number }[]; toObjectiveKm: number | null } }[];
  decisions: { tick: number; trigger: string; chosen: number; why: string; options: AgentCommanderOption[] }[];
}

export type AgentOrderKind = 'move' | 'attack' | 'defend' | 'hold' | 'withdraw';
/** Приказ агентной модели → задача этой модели и обратно. */
export const AGENT_TASK: Record<AgentOrderKind, Task> = { move: 'regroup', attack: 'attack', defend: 'defend', hold: 'hold', withdraw: 'withdraw' };
export function agentKindOf(task: Task): AgentOrderKind {
  switch (task) {
    case 'attack': case 'counterattack': case 'breakout': return 'attack';
    case 'defend': case 'delay': return 'defend';
    case 'hold': return 'hold';
    case 'withdraw': return 'withdraw';
    default: return 'move';
  }
}

/** Ход агентной модели по сторонам и в расчёте этой модели. */
export interface AgentHistory {
  divisions: { formation: string; time: string; at: LngLat; approxKm: number; reliability: string; set?: string; source?: string }[];
  /** Положения армий (штабов) по документам — для оперативного масштаба карты; в сверку не входят. */
  armies?: { formation: string; time: string; at: LngLat; approxKm: number; reliability?: string | null; source?: string }[];
  events?: History['events'];
}

/** Состояние агента → положение соединения на карте; null — нет на карте (ещё не введена, сведена в другую). */
export function postureOf(state: string): Posture | 'destroyed' | null {
  if (state.startsWith('наступление')) return 'attack';
  if (state.startsWith('оборона')) return 'defend';
  if (state.startsWith('марш') || state === 'развёртывание') return 'march';
  if (state === 'отход' || state === 'отступление' || state.startsWith('остатки')) return 'withdraw';
  if (state === 'резерв') return 'reserve';
  if (state === 'небоеспособна') return 'destroyed';
  return null;
}

/** Тип профиля стороны для знака и силы: пешие — стрелковые, остальные — танковые/моторизованные. */
function typeOf(side: string, mobility: string): string {
  const foot = mobility === 'foot';
  return side === 'de' ? (foot ? 'inf_div' : 'pz_div') : foot ? 'rifle_corps' : 'tank_corps';
}

const ECH: Echelon[] = ['front', 'army', 'corps', 'division', 'brigade', 'regiment'];

/** Перестановка, а не ход: больше стольких км за час (быстрее всех на марше — автоколонны, 25 км/ч днём). */
export const JUMP_KM_H = 30;

/**
 * Прогон агентной модели как RunResult для контекста сценария того же театра (berlin-1945-tasks): контекст получает
 * формирования хода (дивизии и штабы), шаг снимков stepHours и конец по последнему кадру.
 */
export function agentsToRun(base: SimContext, t: AgentTrace, stepHours = 6): { ctx: SimContext; run: RunResult } {
  const F = (k: string) => t.fields.indexOf(k);
  const [iLng, iLat, iState, iPers, iTanks, iGuns, iAmmo, iFuel, iFat, iEnc] = ['lng', 'lat', 'state', 'personnel', 'tanks', 'guns', 'ammo', 'fuel', 'fatigue', 'encircled'].map(F);
  const time = (h: number) => addHours(t.start, h);
  const hours = t.frames.length - 1;
  const end = time(hours);
  const top = new Set(t.hqs.filter((h) => h.echelon === 'high_command').map((h) => h.id));
  const defs: FormationDef[] = [
    // верхние инстанции (Ставка, ОКХ/ОКВ) — не формирования карты: фронты и группы армий над картой без старшего
    ...t.hqs.filter((h) => !top.has(h.id)).map((h) => ({ id: h.id, name: h.name, side: h.side, echelon: (ECH.includes(h.echelon as Echelon) ? h.echelon : 'army') as Echelon, parent: h.parent && !top.has(h.parent) ? h.parent : null })),
    ...t.divisions.map((d) => ({ id: d.id, name: d.name, side: d.side, echelon: 'division' as Echelon, parent: d.hq, type: typeOf(d.side, d.mobility), staffKind: d.kind, note: d.note })),
  ];
  const ctx: SimContext = { ...base, agentModel: true, scenario: { ...base.scenario, formations: defs, orders: [], end, turnHours: stepHours } };
  if (t.bands?.length) ctx.agentBands = t.bands.map((b) => ({ hq: b.hq, time: time(b.tick), left: b.left, right: b.right }));

  // снимки: начальный кадр и далее через stepHours (и последний)
  const at = (row: unknown[]) => [row[iLng] as number, row[iLat] as number] as LngLat;
  const ticks: number[] = [];
  for (let h = 0; h < hours; h += stepHours) ticks.push(h);
  ticks.push(hours);
  const first = new Map<string, number>();
  const gone = new Set<string>();
  const P = (row: unknown[]) => base.theatre.proj.toXY(at(row));
  const snapshots: Snapshot[] = ticks.map((h, turn) => {
    const units: Snapshot['units'] = [];
    // переставленные с прошлого снимка (состояние при передаче командования): часовой шаг больше JUMP_KM_H
    const jumped: string[] = [];
    if (turn > 0) {
      t.frames[h].forEach((_, k) => {
        for (let x = ticks[turn - 1] + 1; x <= h; x++) {
          const a = t.frames[x - 1][k], b = t.frames[x][k];
          if (postureOf(String(a[iState])) === null || postureOf(String(b[iState])) === null) continue;
          const p = P(a), q = P(b);
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) > JUMP_KM_H) { jumped.push(t.divisions[k].id); break; }
        }
      });
    }
    t.frames[h].forEach((row, k) => {
      const d = t.divisions[k];
      const p = postureOf(String(row[iState]));
      if (p === null || gone.has(d.id)) return;
      if (!first.has(d.id)) first.set(d.id, h);
      const destroyed = p === 'destroyed';
      if (destroyed) gone.add(d.id);
      units.push({
        id: d.id, at: at(row), personnel: row[iPers] as number, tanks: row[iTanks] as number,
        posture: destroyed ? 'defend' : p, destroyed, ammo: row[iAmmo] as number,
        ...((row[iEnc] as number) > 0 ? { cutOff: true } : {}),
      });
    });
    return { time: time(h), turn, units, ...(jumped.length ? { jumped } : {}) };
  });

  const last = t.frames[hours];
  const init = t.frames[0];
  const formations: Formation[] = defs.map((f) => {
    const k = t.divisions.findIndex((d) => d.id === f.id);
    const row = k >= 0 ? last[k] : null;
    const r0 = k >= 0 ? init[k] : null;
    const num = (r: unknown[] | null, i: number) => (r ? (r[i] as number) : 0);
    return {
      id: f.id, name: f.name, side: f.side, echelon: f.echelon, parent: f.parent ?? null, type: f.type ?? '',
      position: row ? at(row) : [0, 0], personnel: num(row, iPers), tanks: num(row, iTanks), guns: num(row, iGuns),
      initial: { personnel: num(r0, iPers), tanks: num(r0, iTanks), guns: num(r0, iGuns) },
      ammo: num(row, iAmmo), fuel: num(row, iFuel), fatigue: num(row, iFat),
      posture: (row && postureOf(String(row[iState]))) as Posture || 'defend', dugInHours: 0, order: null, route: null,
      destroyed: gone.has(f.id), enterAt: first.get(f.id) ? time(first.get(f.id)!) : null,
    };
  });
  // журнал окружений и гибели (сверка событий «окружены», «уничтожены»): дивизия окружена — отрезана (поле encircled
  // ядра — часов в окружении) не меньше суток, с начала этих суток (короткая изоляция на час-другой — не котёл); штаб —
  // когда так окружена не меньше половины его живых дивизий; уничтожен — все его дивизии
  const journal: SimState['journal'] = [];
  const CUT_H = 24;
  const parentOf = new Map(defs.map((f) => [f.id, f.parent ?? null]));
  const under = new Map<string, number[]>();
  t.divisions.forEach((d, k) => { for (let p = parentOf.get(d.id), n = 0; p && n < 8; p = parentOf.get(p) ?? null, n++) under.set(p, [...(under.get(p) ?? []), k]); });
  const cutFrom = new Array<number>(t.divisions.length).fill(-1), deadFrom = new Array<number>(t.divisions.length).fill(-1);
  const hqCut = new Set<string>(), hqDead = new Set<string>();
  for (let h = 0; h <= hours; h++) {
    t.frames[h].forEach((r, k) => {
      const enc = (r[iEnc] as number) ?? 0;
      if (cutFrom[k] < 0 && enc >= CUT_H) { cutFrom[k] = h - enc + 1; journal.push({ kind: 'encircled', time: time(Math.max(0, cutFrom[k])), formation: t.divisions[k].id, cut: true }); }
      if (deadFrom[k] < 0 && postureOf(String(r[iState])) === 'destroyed') { deadFrom[k] = h; journal.push({ kind: 'destroyed', time: time(h), formation: t.divisions[k].id }); }
    });
    for (const [hq, ks] of under) {
      const live = ks.filter((k) => deadFrom[k] < 0 && postureOf(String(t.frames[h][k][iState])) !== null);
      if (!hqCut.has(hq) && live.length && live.filter((k) => cutFrom[k] >= 0 && ((t.frames[h][k][iEnc] as number) ?? 0) > 0).length * 2 >= live.length) {
        hqCut.add(hq); journal.push({ kind: 'encircled', time: time(Math.max(0, Math.min(...live.filter((k) => cutFrom[k] >= 0).map((k) => cutFrom[k])))), formation: hq, cut: true });
      }
      if (!hqDead.has(hq) && ks.every((k) => deadFrom[k] >= 0)) { hqDead.add(hq); journal.push({ kind: 'destroyed', time: time(h), formation: hq }); }
    }
  }
  journal.sort((a, b) => a.time.localeCompare(b.time));
  const final: SimState = { scenario: ctx.scenario.id, time: end, turn: snapshots.length - 1, formations, pending: [], rngState: 0, seed: t.seed, journal };
  return { ctx, run: { final, snapshots } };
}

/**
 * Состояние на час h хода агентной модели для контекста из agentsToRun: формирования с положением, численностью,
 * запасами и положением дел на этот час (для докладов, разведки и игры). Не введённые — с enterAt на час ввода,
 * выбывшие (небоеспособны, сведены) — уничтожены.
 */
export function agentsStateAt(ctx: SimContext, t: AgentTrace, h: number): SimState {
  const F = (k: string) => t.fields.indexOf(k);
  const [iLng, iLat, iState, iPers, iTanks, iGuns, iAmmo, iFuel, iFat, iEnc] = ['lng', 'lat', 'state', 'personnel', 'tanks', 'guns', 'ammo', 'fuel', 'fatigue', 'encircled'].map(F);
  const hh = Math.max(0, Math.min(t.frames.length - 1, Math.round(h)));
  const time = (x: number) => addHours(t.start, x);
  const row = t.frames[hh], init = t.frames[0];
  const idx = new Map(t.divisions.map((d, k) => [d.id, k]));
  const pending = (k: number, x: number) => String(t.frames[x][k][iState]).startsWith('не введена');
  // в состоянии — только действующие соединения (дивизии); штабы — узлы подчинения сценария, как у нынешней модели
  const formations: Formation[] = ctx.scenario.formations.filter((f) => idx.has(f.id)).map((f) => {
    const k = idx.get(f.id)!;
    // приказ — только на последний кадр (его знает ядро); игрок отдаёт приказы с note «приказ игрока»
    const o = hh === t.frames.length - 1 ? t.orders?.[k] ?? null : null;
    const order: Order | null = o ? { id: `agents:${f.id}@${o.issued}`, formation: f.id, task: AGENT_TASK[o.kind] ?? 'defend', target: o.target, issuedAt: time(o.issued), source: o.note.includes('игрок') ? 'human' : 'script', note: o.note.replace(/\s*\[[^\]]*@[^\]]*\]\s*$/, '') || undefined } : null;
    const base = { id: f.id, name: f.name, side: f.side, echelon: f.echelon, parent: f.parent ?? null, type: f.type ?? '', dugInHours: 0, order, route: null };
    const r = row[k], r0 = init[k];
    const st = String(r[iState]);
    const p = postureOf(st);
    // ввод: первый час, когда дивизия уже не «не введена» (в пределах хода; дальше — неизвестно, после конца хода)
    let enterAt: string | null = null;
    if (pending(k, 0)) {
      let x = 0;
      while (x < t.frames.length && pending(k, x)) x++;
      enterAt = time(x < t.frames.length ? x : t.frames.length + 24 * 365);
    }
    return {
      ...base, position: [r[iLng] as number, r[iLat] as number] as LngLat,
      personnel: r[iPers] as number, tanks: r[iTanks] as number, guns: r[iGuns] as number,
      initial: { personnel: r0[iPers] as number, tanks: r0[iTanks] as number, guns: r0[iGuns] as number },
      ammo: r[iAmmo] as number, fuel: r[iFuel] as number, fatigue: r[iFat] as number,
      posture: p && p !== 'destroyed' ? p : 'defend',
      destroyed: p === 'destroyed' || st.startsWith('сведена'), enterAt,
      ...((r[iEnc] as number) > 0 ? { cutOff: true, cutHours: r[iEnc] as number } : {}),
    } as Formation;
  });
  return { scenario: ctx.scenario.id, time: time(hh), turn: hh, formations, pending: [], rngState: 0, seed: t.seed, journal: [] };
}

/** История для сверки и «призраков»: положения дивизий и события агентной модели, линии фронта — из истории сценария. */
export function agentsHistory(h: AgentHistory, base?: History | null): History {
  return {
    scenario: base?.scenario ?? '',
    // положения дивизий и армий; сверка (compareWithHistory) — только по действующим (дивизиям): армий в снимках нет
    positions: [
      ...h.divisions.map((p) => ({ formation: p.formation, time: p.time, at: p.at, approxKm: p.approxKm, place: '', reliability: p.reliability, source: p.source ?? p.set ?? '' })),
      ...(h.armies ?? []).map((p) => ({ formation: p.formation, time: p.time, at: p.at, approxKm: p.approxKm, place: '', reliability: p.reliability ?? 'C', source: p.source ?? '' })),
    ],
    frontline: base?.frontline ?? [],
    events: h.events ?? [],
    // сверка численности и потерь с документами — те же контрольные точки, что у базовой истории
    ...(base?.checkpoints?.length ? { checkpoints: base.checkpoints } : {}),
  };
}
