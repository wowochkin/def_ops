/**
 * Режиссёр выставочного сеанса — чистая машина состояний.
 *
 * Живёт в главном окне: оболочка шлёт ему ввод посетителя и оператора и тик часов (раз в 250 мс), а он возвращает новое
 * состояние и эффекты (что сказать голосом, когда попросить ИИ выбрать, когда начать новый сеанс, что записать в
 * статистику). Время — миллисекунды по часам режиссёра: его приносит только тик, остальные события происходят «сейчас» —
 * в момент последнего тика. Тик с большим скачком часов догоняет все переходы, наступившие за это время, по порядку.
 *
 * Фазы: startup → attract (заставка) → welcome → briefing → три перелома (пояснение, выбор, прокрутка) → result.
 * Сцены этапа 1 — заглушки, пояснение, прокрутка и бриф переходят дальше сами по DURATIONS.
 */
import type { ExpoSettings, FrontId } from './settings';

type TurnN = 1 | 2 | 3;

export type Phase =
  | { kind: 'startup' }
  | { kind: 'attract' }
  | { kind: 'welcome' }
  | { kind: 'briefing' }
  | {
      kind: 'turn';
      n: TurnN;
      step: 'explain' | 'choose' | 'scroll';
      /** Конец времени на выбор (таймер включён), иначе null. */
      deadline: number | null;
      /** Предупреждение «осталось 10 с» уже сказано. */
      warned: boolean;
      /** Таймер выключен: голос уже предложил решить за посетителя. */
      offered: boolean;
      /** Выбранная карточка или промедление. */
      choice: number | 'delay' | null;
      /** Сколько раз заменили карточку на этом переломе. */
      replacements: number;
    }
  | { kind: 'result' };

export interface DirectorState {
  phase: Phase;
  front: FrontId | null;
  phaseStart: number;
  lastInput: number;
  paused: boolean;
  pausedAt: number | null;
  session: number;
  stats: { sessions: number; finished: number };
  /** Часы режиссёра — время последнего тика (дополнение к интерфейсу плана: события, кроме тика, времени не несут). */
  now: number;
}

export type DirectorEvent =
  | { t: 'tick'; now: number }
  | { t: 'ready' }
  | { t: 'touch' }
  | { t: 'pickFront'; front: FrontId }
  | { t: 'next' }
  | { t: 'choose'; card: number }
  | { t: 'replace'; card: number }
  | { t: 'restart' }
  | { t: 'pause' }
  | { t: 'resume' }
  | { t: 'jump'; phase: Phase['kind']; n?: TurnN };

export type Effect =
  | { e: 'say'; key: string; priority: 'action' | 'timer' | 'event' | 'ambient' }
  | { e: 'aiPick'; n: TurnN }
  | { e: 'newSession' }
  | { e: 'stat'; kind: 'started' | 'finished' };

/** Длительности фаз-заглушек этапа 1, мс. */
export const DURATIONS = { welcome: 20_000, briefing: 35_000, explain: 10_000, scroll: 20_000 } as const;

/** Предупреждение до конца таймера, мс. */
const WARN_BEFORE = 10_000;
/** Таймер выключен: через столько голос предлагает решить за посетителя, ещё через столько — выбор ИИ, мс. */
const OFFER_AFTER = 30_000;
const AI_PICK_AFTER = 60_000;

export function initialState(now: number): DirectorState {
  return {
    phase: { kind: 'startup' },
    front: null,
    phaseStart: now,
    lastInput: now,
    paused: false,
    pausedAt: null,
    session: 0,
    stats: { sessions: 0, finished: 0 },
    now,
  };
}

const turnPhase = (n: TurnN, stepName: 'explain' | 'choose' | 'scroll' = 'explain'): Phase => ({
  kind: 'turn', n, step: stepName, deadline: null, warned: false, offered: false, choice: null, replacements: 0,
});

const isInput = (ev: DirectorEvent) =>
  ev.t === 'touch' || ev.t === 'pickFront' || ev.t === 'next' || ev.t === 'choose' || ev.t === 'replace';

/** Перейти в фазу в момент at (с эффектами входа). */
function enter(s: DirectorState, phase: Phase, at: number, cfg: ExpoSettings, fx: Effect[]): DirectorState {
  let next: DirectorState = { ...s, phase, phaseStart: at };
  if (phase.kind === 'turn' && phase.step === 'choose' && cfg.timer.on) {
    next = { ...next, phase: { ...phase, deadline: at + cfg.timer.seconds * 1000 } };
  }
  if (phase.kind === 'briefing') {
    fx.push({ e: 'stat', kind: 'started' });
    next = { ...next, stats: { ...next.stats, sessions: next.stats.sessions + 1 } };
  }
  if (phase.kind === 'result') {
    fx.push({ e: 'stat', kind: 'finished' });
    next = { ...next, stats: { ...next.stats, finished: next.stats.finished + 1 } };
  }
  return next;
}

/** Новый сеанс: эффект newSession, счётчик сеанса, фронт сброшен. */
function fresh(s: DirectorState, fx: Effect[]): DirectorState {
  fx.push({ e: 'newSession' });
  return { ...s, session: s.session + 1, front: null };
}

/** Фаза после прокрутки перелома n. */
const afterScroll = (n: TurnN): Phase => (n < 3 ? turnPhase((n + 1) as TurnN) : { kind: 'result' });

type Due = { at: number; apply: (s: DirectorState) => DirectorState };

/** Ближайшее по времени событие часов (без учёта того, наступило ли оно). */
function nextDue(s: DirectorState, cfg: ExpoSettings, fx: Effect[], prevNow: number, aiFired: { v: boolean }): Due | null {
  const cands: Due[] = [];
  const p = s.phase;
  if (p.kind !== 'startup' && p.kind !== 'attract') {
    cands.push({ at: s.lastInput + cfg.idleSeconds * 1000, apply: (x) => enter(fresh(x, fx), { kind: 'attract' }, x.lastInput + cfg.idleSeconds * 1000, cfg, fx) });
  }
  const t0 = s.phaseStart;
  if (p.kind === 'briefing') cands.push({ at: t0 + DURATIONS.briefing, apply: (x) => enter(x, turnPhase(1), t0 + DURATIONS.briefing, cfg, fx) });
  if (p.kind === 'result') {
    const at = t0 + cfg.resultSeconds * 1000;
    cands.push({ at, apply: (x) => enter(fresh(x, fx), { kind: 'attract' }, at, cfg, fx) });
  }
  if (p.kind === 'turn') {
    if (p.step === 'explain') cands.push({ at: t0 + DURATIONS.explain, apply: (x) => enter(x, { ...p, step: 'choose' }, t0 + DURATIONS.explain, cfg, fx) });
    if (p.step === 'scroll') cands.push({ at: t0 + DURATIONS.scroll, apply: (x) => enter(x, afterScroll(p.n), t0 + DURATIONS.scroll, cfg, fx) });
    if (p.step === 'choose' && p.deadline !== null) {
      const dl = p.deadline;
      if (!p.warned) cands.push({ at: dl - WARN_BEFORE, apply: (x) => { fx.push({ e: 'say', key: 'timer-warn', priority: 'timer' }); return { ...x, phase: { ...p, warned: true } }; } });
      cands.push({ at: dl, apply: (x) => { fx.push({ e: 'say', key: 'delay', priority: 'event' }); return enter(x, { ...p, step: 'scroll', choice: 'delay' }, dl, cfg, fx); } });
    }
    if (p.step === 'choose' && p.deadline === null && p.choice === null) {
      if (!p.offered) cands.push({ at: t0 + OFFER_AFTER, apply: (x) => { fx.push({ e: 'say', key: 'offer-decide', priority: 'action' }); return { ...x, phase: { ...p, offered: true } }; } });
      const aiAt = t0 + AI_PICK_AFTER;
      // Выбор ИИ — один раз: в момент, когда часы переходят отметку (выбор выставит последующий choose от оболочки).
      if (!aiFired.v && aiAt > prevNow) cands.push({ at: aiAt, apply: (x) => { aiFired.v = true; fx.push({ e: 'aiPick', n: p.n }); return x; } });
    }
  }
  if (!cands.length) return null;
  return cands.reduce((a, b) => (b.at < a.at ? b : a));
}

/** Довести часы до now, выполнив по порядку все наступившие переходы. */
function advance(s: DirectorState, now: number, cfg: ExpoSettings, fx: Effect[]): DirectorState {
  const target = Math.max(now, s.now);
  if (s.paused) return { ...s, now: target };
  const prevNow = s.now;
  const aiFired = { v: false };
  let cur = s;
  for (let guard = 0; guard < 64; guard++) {
    const due = nextDue(cur, cfg, fx, prevNow, aiFired);
    if (!due || due.at > target) break;
    cur = due.apply(cur);
  }
  return { ...cur, now: target };
}

/** Один шаг режиссёра: новое состояние и эффекты. Входное состояние не меняется. */
export function step(s: DirectorState, ev: DirectorEvent, cfg: ExpoSettings): { state: DirectorState; effects: Effect[] } {
  const fx: Effect[] = [];
  const out = (state: DirectorState) => ({ state, effects: fx });

  if (ev.t === 'tick') return out(advance(s, ev.now, cfg, fx));

  if (ev.t === 'pause') return out(s.paused ? s : { ...s, paused: true, pausedAt: s.now });
  if (ev.t === 'resume') {
    if (!s.paused) return out(s);
    const shift = s.now - (s.pausedAt ?? s.now);
    const p = s.phase;
    const phase: Phase = p.kind === 'turn' && p.deadline !== null ? { ...p, deadline: p.deadline + shift } : p;
    return out({ ...s, paused: false, pausedAt: null, phase, phaseStart: s.phaseStart + shift, lastInput: s.lastInput + shift });
  }

  // «Сейчас» для событий: на паузе — момент паузы (по её снятии отсчёты сдвинутся на её длительность).
  const now = s.paused && s.pausedAt !== null ? s.pausedAt : s.now;
  const p = s.phase;

  if (ev.t === 'restart') {
    if (p.kind === 'startup' || p.kind === 'attract') return out(s);
    return out(enter({ ...fresh(s, fx), lastInput: now }, { kind: 'welcome' }, now, cfg, fx));
  }
  if (ev.t === 'jump') {
    const phase: Phase = ev.phase === 'turn' ? turnPhase(ev.n ?? 1) : ({ kind: ev.phase } as Phase);
    let next: DirectorState = { ...s, phase, phaseStart: now, lastInput: now };
    if (phase.kind === 'turn' && next.front === null) next = { ...next, front: cfg.fronts[0] ?? null };
    if (phase.kind === 'turn' && phase.step === 'choose' && cfg.timer.on) next = { ...next, phase: { ...phase, deadline: now + cfg.timer.seconds * 1000 } };
    return out(next);
  }
  if (ev.t === 'ready') return out(p.kind === 'startup' ? enter(s, { kind: 'attract' }, now, cfg, fx) : s);

  // Ввод посетителя: на паузе (меню оператора открыто) не принимается.
  if (!isInput(ev) || s.paused) return out(s);
  const touched: DirectorState = { ...s, lastInput: now };

  switch (ev.t) {
    case 'touch':
      if (p.kind === 'attract') return out(enter(touched, { kind: 'welcome' }, now, cfg, fx));
      if (p.kind === 'welcome' && cfg.fronts.length === 1) return out(enter({ ...touched, front: cfg.fronts[0] }, { kind: 'briefing' }, now, cfg, fx));
      if (p.kind === 'result') return out(enter(fresh(touched, fx), { kind: 'welcome' }, now, cfg, fx));
      return out(p.kind === 'startup' ? s : touched);
    case 'pickFront':
      if (p.kind === 'welcome' && cfg.fronts.includes(ev.front)) return out(enter({ ...touched, front: ev.front }, { kind: 'briefing' }, now, cfg, fx));
      return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
    case 'next':
      if (p.kind === 'briefing') return out(enter(touched, turnPhase(1), now, cfg, fx));
      return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
    case 'choose':
      if (p.kind === 'turn' && p.step === 'choose' && p.choice === null && Number.isInteger(ev.card) && ev.card >= 0) {
        return out(enter(touched, { ...p, step: 'scroll', choice: ev.card }, now, cfg, fx));
      }
      return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
    case 'replace':
      if (p.kind === 'turn' && p.step === 'choose' && p.replacements < cfg.maxReplacements) {
        return out({ ...touched, phase: { ...p, replacements: p.replacements + 1 } });
      }
      return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
  }
  return out(s);
}
