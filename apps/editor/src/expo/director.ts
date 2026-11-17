/**
 * Режиссёр выставочного сеанса — чистая машина состояний.
 *
 * Живёт в главном окне: оболочка шлёт ему ввод посетителя и оператора и тик часов (раз в 250 мс), а он возвращает новое
 * состояние и эффекты (что сказать голосом, когда попросить ИИ выбрать, когда начать новый сеанс, что записать в
 * статистику). Время — миллисекунды по часам режиссёра: его приносит только тик, остальные события происходят «сейчас» —
 * в момент последнего тика. Тик с большим скачком часов догоняет все переходы, наступившие за это время, по порядку.
 *
 * Фазы: startup → attract (заставка) → intro → welcome → briefing → три перелома (пояснение, выбор, прокрутка) → result.
 * Пояснение и бриф переходят дальше сами по DURATIONS, прокрутка — по `scrollMs` (дольше у длинного хода); ход модели ведёт хост по эффектам deal, replace, decide.
 * Бриф — доклад по пунктам (`BRIEF_POINTS`): пункт меняется по концу его фразы (`briefDone` от голоса) или по сроку,
 * посетитель листает пункты (`brief`) или пропускает доклад («К решениям»). Каждая смена сцены — эффект `scene`
 * (по нему голос обрывает фразу ушедшей сцены); фразы входа в сцену несут её ключ (`sceneKey`).
 */
import { BANK } from './bank';
import type { ExpoSettings, FrontId } from './settings';
import { INTRO_DURATION_MS, INTRO_KEYS, introCueAt, introCueStart } from './intro-story';

export type TurnN = 1 | 2 | 3;

export type Phase =
  | { kind: 'startup' }
  | { kind: 'attract' }
  /** Визитная карточка сеанса: после заставки, до выбора фронта. */
  | { kind: 'intro'; /** Текущий раздел, по порядку монтажа (1…13). */ line?: number; /** Очередь ведёт монтаж: общий запасной срок не обрывает клипы и тихие сцены. */ voiced?: boolean; /** Монтаж закончился, пока открыто меню. */ done?: boolean }
  | { kind: 'welcome' }
  /** Ввод в обстановку: пункт доклада (0…BRIEF_POINTS−1). */
  | { kind: 'briefing'; point: number }
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
      /** Сколько карточек заменено на этом переломе. */
      replacements: number;
      /** Выбранная карточка или промедление. */
      choice: number | 'delay' | 'aim' | null;
      /** Пункт своего направления, если выбор — `aim`. */
      aim?: string;
      /** Прокрутка ждёт конца расчёта: таймер хода не идёт, пока модель не отдаст карту. */
      scrollHold?: boolean;
      gpuHold?: boolean;
      gpuError?: string;
      debriefError?: string;
      debriefProgress?: { done: number; total: number; stage: 'load' | 'warm' | 'synthesis'; started: number };
      /** Карта получила данные и начала воспроизведение. */
      scrollBegan?: boolean;
      /** Ход завершён на паузе: продолжить сразу после закрытия меню (мс режиссёра). */
      rest?: number;
      /** Третий ход доигран: на экране «готовим итог», речь ещё синтезируется. */
      preparing?: boolean;
      /** Комментарий завершённого хода: ждём текст, синтез и конец воспроизведения. */
      commenting?: { token: number };
      /** Пока штаб готовит ответ, отсчёт выбора стоит на этом моменте. */
      held?: number;
    }
  | {
      kind: 'result';
      /** Режим результата фиксируется при входе: настройка оператора относится к следующему разбору. */
      narrated?: boolean;
      /** Не показывать предупреждение раньше этого момента: пока звучит разбор. */
      until?: number;
      /** Конец предупреждения: в этот момент сеанс уходит на заставку. Нет — предупреждение ещё не показано. */
      leave?: number;
      /** «Остаться»: следующее предупреждение только после бездействия. */
      quiet?: boolean;
    };

export interface DirectorState {
  phase: Phase;
  front: FrontId | null;
  phaseStart: number;
  lastInput: number;
  paused: boolean;
  pausedAt: number | null;
  session: number;
  /** Последовательность комментариев внутри окна: защищает от запоздалого завершения. */
  commentSeq?: number;
  gpuManaged?: boolean;
  stats: { sessions: number; finished: number };
  /** Часы режиссёра — время последнего тика (дополнение к интерфейсу плана: события, кроме тика, времени не несут). */
  now: number;
  /** Голос стенда включён. Кнопка на заставке; держится до перезапуска. Старт — из настроек. */
  voice: boolean;
}

export type DirectorEvent =
  | { t: 'tick'; now: number }
  | { t: 'ready' }
  | { t: 'touch' }
  /** Интро доиграло само. */
  | { t: 'introDone' }
  /** Очередь ведёт монтаж, включая тихие сцены вместо отсутствующих записей. */
  | { t: 'introVoice'; playing: boolean; line?: number }
  /** Открыть раздел интро с начала, прервав прежнюю реплику. */
  | { t: 'introSeek'; line: number }
  /** Посетитель нажал «Пропустить» в интро. */
  | { t: 'skipIntro' }
  | { t: 'pickFront'; front: FrontId }
  | { t: 'next' }
  | { t: 'choose'; card: number }
  /** Своё направление удара: пункт театра, не карточка. */
  | { t: 'aim'; place: string }
  | { t: 'replace'; card: number }
  | { t: 'speak' }
  /** Включить или выключить голос стенда (кнопка на заставке). */
  | { t: 'voice' }
  /** Вопрос к ИИ (готовый или своими словами). */
  | { t: 'ask'; q: string }
  /** Посетитель открыл пункт брифинга. */
  | { t: 'brief'; point: number }
  /** Голос договорил фразу пункта брифинга (от главного окна, не ввод посетителя). */
  | { t: 'briefDone'; point: number }
  /** Модель ещё считает ход: не обрывать прокрутку карты таймером, начатым в момент выбора. */
  | { t: 'gpuManaged'; managed: boolean }
  | { t: 'gpuWait' }
  | { t: 'gpuReady' }
  | { t: 'gpuFailed'; error: string }
  | { t: 'debriefProgress'; done: number; total: number; stage: 'load' | 'warm' | 'synthesis'; started: number }
  | { t: 'scrollWait' }
  /** Данные карты получены: начинается визуализация. */
  | { t: 'scrollReady' }
  /** Карта доиграла прокрутку — следующий перелом, не дожидаясь запасного срока. */
  | { t: 'scrollDone' }
  /** Разбор итога озвучен заранее — можно открывать итог. */
  | { t: 'debriefReady' }
  | { t: 'debriefFailed'; error: string }
  | { t: 'commentDone'; n: TurnN; session: number; token: number }
  | { t: 'restart' }
  /** С выбора фронта — обратно на заставку. */
  | { t: 'back' }
  /** Итог: не уходить на заставку, предупреждение погашено. */
  | { t: 'stay' }
  /** Продлить итог, пока не дозвучит разбор. */
  | { t: 'hold'; ms: number }
  /** Разбор итога дослушан: теперь можно предупреждать об уходе на заставку. */
  | { t: 'spoken' }
  /** Выбор фронта отмечен, сеанс ещё не начат. */
  | { t: 'markFront'; front: FrontId }
  /** Перелом: перейти между обстановкой и решением, не раздавая карточки заново. */
  | { t: 'step'; step: 'explain' | 'choose' }
  | { t: 'pause' }
  | { t: 'resume' }
  /** Выбор: остановить таймер, пока штаб готовит ответ. */
  | { t: 'timerHold' }
  /** Выбор: продолжить таймер с того места, где его остановили. */
  | { t: 'timerRelease' }
  | { t: 'jump'; phase: Phase['kind']; n?: TurnN };

export type Effect =
  | { e: 'introPause'; paused: boolean; at: number }
  /** Фраза-заготовка; `scene` — сцена, к которой она относится (нет — переходная, живёт до конца). */
  | { e: 'say'; key: string; priority: 'action' | 'timer' | 'scene'; scene?: string }
  /** Смена сцены (ключ `sceneKey`): голос обрывает фразу ушедшей сцены. */
  | { e: 'scene'; key: string }
  | { e: 'aiPick'; n: TurnN }
  /** Ответить на вопрос посетителя. */
  | { e: 'ask'; q: string }
  /** Слушать посетителя (кнопка «Говорить»): команда сеанса или вопрос. */
  | { e: 'listen' }
  | { e: 'newSession' }
  /** Раздать карточки перелома n (вход в перелом). */
  | { e: 'deal'; n: TurnN; front: FrontId }
  /** Заменить карточку в слоте. */
  | { e: 'replace'; n: TurnN; card: number }
  /** Решение перелома: слот карточки или промедление — прокрутка (после третьего — досчёт). */
  | { e: 'decide'; n: TurnN; choice: number | 'delay' | { place: string } }
  /** Прокрутка доиграна: теперь можно комментировать выбор, карта уже стоит. */
  | { e: 'commentChoice'; n: TurnN; session: number; token: number }
  /** Третий ход доигран: синтезировать разбор, карта в это время стоит. */
  | { e: 'prepareDebrief' }
  | { e: 'stat'; kind: 'started' | 'finished' };

/** Пунктов в докладе брифинга. */
export const BRIEF_POINTS = 6;
/** Срок пункта брифинга, мс: голос договорил раньше — пункт меняется раньше. */
const BRIEF_POINT_MS = 18_000;
/** Длительности фаз, мс; briefing — весь доклад, если голос молчит. */
export const DURATIONS = { welcome: 20_000, briefPoint: BRIEF_POINT_MS, briefing: BRIEF_POINT_MS * BRIEF_POINTS, explain: 10_000 } as const;

/**
 * Миллисекунд экрана на час операции. Ориентир — первый перелом 1-го Белорусского (96 часов, четверо суток):
 * около 15 секунд. Скорость одна на всех переломах, более длинный ход длится дольше.
 */
export const SCROLL_MS_PER_HOUR = 156;

/**
 * Длительность прокрутки перелома, мс: от часа этого перелома до следующего (у третьего — до конца операции).
 * Включает паузу перед стартом карты. Третий перелом самый длинный: длительность пропорциональна времени операции.
 */
export function scrollMs(front: FrontId | null, n: TurnN): number {
  const turns = front ? BANK.fronts[front]?.turns : undefined;
  const from = turns?.find((t) => t.n === n)?.hour ?? 0;
  const next = n < 3 ? turns?.find((t) => t.n === ((n + 1) as TurnN))?.hour : BANK.end;
  const hours = Math.max(1, (next ?? from) - from);
  return Math.max(8_000, Math.round(hours * SCROLL_MS_PER_HOUR));
}

/** Ключ сцены: фаза, пункт брифинга, перелом и его шаг. */
export function sceneKey(s: Pick<DirectorState, 'phase'>): string {
  const p = s.phase;
  return p.kind === 'turn' ? `turn-${p.n}-${p.step}` : p.kind === 'briefing' ? `briefing-${p.point ?? 0}` : p.kind;
}

/** Ключ фразы пункта брифинга: `brief-<фронт>-<номер с 1>`. */
export const briefKey = (front: FrontId, point: number) => `brief-${front}-${point + 1}`;

/** Обстановка перелома после уже принятого решения: говорит командующий этого фронта. */
export const situationKey = (front: FrontId, n: TurnN) => `situation-${front}-${n}`;

const briefing = (point = 0): Phase => ({ kind: 'briefing', point });

/** Касание, продвигающее фазу, в первые столько мс после входа в неё — дребезг или касание вместе с мышью; не продвигает. */
export const DEBOUNCE_MS = 300;

/** Фразы входа в фазу (ключи заготовок). */
const SAY_ON_ENTER: Record<string, string | undefined> = { welcome: 'welcome', explain: 'explain', result: 'result' };

/** Предупреждение до конца таймера, мс. */
const WARN_BEFORE = 10_000;
/** Нет клипов интро: картина всё равно открывает выбор фронта, мс. */
export const INTRO_FALLBACK_MS = INTRO_DURATION_MS;
/** Таймер выключен: через столько без выбора — промедление, как по истечении таймера, мс. */
const DELAY_AFTER = 60_000;

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
    voice: true,
  };
}

const turnPhase = (n: TurnN, stepName: 'explain' | 'choose' | 'scroll' = 'explain'): Phase => ({
  kind: 'turn', n, step: stepName, deadline: null, warned: false, offered: false, choice: null, replacements: 0,
});

const isInput = (ev: DirectorEvent) =>
  ev.t === 'touch' || ev.t === 'skipIntro' || ev.t === 'pickFront' || ev.t === 'markFront' || ev.t === 'next' || ev.t === 'choose' || ev.t === 'aim' || ev.t === 'replace' || ev.t === 'speak' || ev.t === 'ask' || ev.t === 'brief' || ev.t === 'back' || ev.t === 'step' || ev.t === 'stay';

/** Перейти в фазу в момент at (с эффектами входа). */
function enter(s: DirectorState, phase: Phase, at: number, cfg: ExpoSettings, fx: Effect[]): DirectorState {
  if (phase.kind === 'result') phase = { ...phase, narrated: cfg.generation.debrief };
  if (phase.kind === 'turn' && phase.step === 'scroll' && s.gpuManaged) phase = { ...phase, gpuHold: true };
  let next: DirectorState = { ...s, phase, phaseStart: at };
  if (phase.kind === 'turn' && phase.step === 'choose' && cfg.timer.on) {
    next = { ...next, phase: { ...phase, deadline: at + cfg.timer.seconds * 1000 } };
  }
  if (phase.kind === 'turn' && phase.step === 'explain' && next.front) fx.push({ e: 'deal', n: phase.n, front: next.front });
  const scene = sceneKey(next);
  fx.push({ e: 'scene', key: scene });
  const say = phase.kind === 'briefing' ? (next.front ? briefKey(next.front, phase.point) : undefined) : phase.kind === 'turn' && phase.step === 'explain' ? (phase.n > 1 && next.front ? situationKey(next.front, phase.n) : 'explain') : SAY_ON_ENTER[phase.kind];
  if (say) fx.push({ e: 'say', key: say, priority: 'scene', scene });
  if (phase.kind === 'intro') {
    for (const key of INTRO_KEYS.slice((phase.line ?? 1) - 1)) fx.push({ e: 'say', key, priority: 'scene', scene });
  }
  if (phase.kind === 'briefing' && s.phase.kind !== 'briefing') {
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

/** Карта и комментарий доиграли: продолжаем без дополнительного таймера. */
function finishScroll(s: DirectorState, at: number, cfg: ExpoSettings, fx: Effect[]): DirectorState {
  const p = s.phase;
  if (p.kind !== 'turn' || p.step !== 'scroll') return s;
  if (s.paused) return { ...s, phase: { ...p, commenting: undefined, rest: at } };
  if (p.n !== 3 || !cfg.generation.debrief) return enter(s, afterScroll(p.n), at, cfg, fx);
  fx.push({ e: 'prepareDebrief' });
  return { ...s, phase: { ...p, commenting: undefined, rest: undefined, preparing: true } };
}

/**
 * С какого момента считается бездействие: только где режиссёр ждёт посетителя (выбор фронта, итог) —
 * от последнего ввода или от входа в фазу, что позже. Выбор карточки кончается промедлением и бездействие не копит.
 */
function idleStart(s: DirectorState): number | null {
  const p = s.phase;
  if (p.kind !== 'welcome' && p.kind !== 'result') return null;
  return Math.max(s.lastInput, s.phaseStart);
}

type Due = { at: number; apply: (s: DirectorState) => DirectorState };

/** Ближайшее по времени событие часов (без учёта того, наступило ли оно). */
function nextDue(s: DirectorState, cfg: ExpoSettings, fx: Effect[]): Due | null {
  const cands: Due[] = [];
  const p = s.phase;
  const t0 = s.phaseStart;
  const idleFrom = idleStart(s);
  if (idleFrom !== null && p.kind !== 'result') {
    const at = idleFrom + cfg.idleSeconds * 1000;
    cands.push({ at, apply: (x) => enter(fresh(x, fx), { kind: 'attract' }, at, cfg, fx) });
  }
  if (p.kind === 'intro' && !p.voiced) {
    const at = t0 + INTRO_FALLBACK_MS;
    cands.push({ at, apply: (x) => (x.phase.kind === 'intro' ? enter(x, { kind: 'welcome' }, at, cfg, fx) : x) });
  }
  if (p.kind === 'briefing') {
    const at = t0 + DURATIONS.briefPoint;
    cands.push({ at, apply: (x) => enter(x, p.point + 1 < BRIEF_POINTS ? briefing(p.point + 1) : turnPhase(1), at, cfg, fx) });
  }
  if (p.kind === 'result') {
    const warn = cfg.resultSeconds * 1000;
    if (p.leave !== undefined) {
      const at = p.leave;
      cands.push({ at, apply: (x) => enter(fresh(x, fx), { kind: 'attract' }, at, cfg, fx) });
    } else if (p.quiet) {
      const at = (idleFrom ?? t0) + cfg.idleSeconds * 1000;
      cands.push({ at, apply: (x) => (x.phase.kind === 'result' ? { ...x, phase: { ...x.phase, quiet: false, leave: at + warn } } : x) });
    } else {
      const at = Math.max(t0 + warn, p.until ?? 0);
      cands.push({ at, apply: (x) => (x.phase.kind === 'result' ? { ...x, phase: { ...x.phase, leave: at + warn } } : x) });
    }
  }
  if (p.kind === 'turn') {
    if (p.step === 'explain') cands.push({ at: t0 + DURATIONS.explain, apply: (x) => enter(x, { ...p, step: 'choose' }, t0 + DURATIONS.explain, cfg, fx) });
    // конец прокрутки — только когда карта дошла до конца хода. Обрыв по настенным часам срезал хвост
    // (ход доигрывался примерно до 28 апреля и перескакивал на 2 мая), пока модель занимала поток.
    if (p.step === 'choose' && p.deadline !== null && p.held == null) {
      const dl = p.deadline;
      if (!p.warned) cands.push({ at: dl - WARN_BEFORE, apply: (x) => { fx.push({ e: 'say', key: 'timer-warn', priority: 'timer', scene: sceneKey(x) }); return { ...x, phase: { ...p, warned: true } }; } });
      cands.push({ at: dl, apply: (x) => {
        fx.push({ e: 'decide', n: p.n, choice: 'delay' });
        const y = enter(x, { ...p, step: 'scroll', choice: 'delay' }, dl, cfg, fx);
        fx.push({ e: 'say', key: 'delay', priority: 'scene', scene: sceneKey(y) });
        return y;
      } });
    }
    if (p.step === 'choose' && p.deadline === null && p.choice === null && cfg.timer.on) {
      const at = t0 + DELAY_AFTER;
      cands.push({ at, apply: (x) => {
        if (x.phase.kind !== 'turn' || x.phase.step !== 'choose' || x.phase.choice !== null) return x;
        fx.push({ e: 'decide', n: x.phase.n, choice: 'delay' });
        const y = enter(x, { ...x.phase, step: 'scroll', choice: 'delay' }, at, cfg, fx);
        fx.push({ e: 'say', key: 'delay', priority: 'scene', scene: sceneKey(y) });
        return y;
      } });
    }
  }
  if (!cands.length) return null;
  return cands.reduce((a, b) => (b.at < a.at ? b : a));
}

/** Довести часы до now. Дыра больше обычного тика (поток был занят синтезом) не проглатывается целиком: иначе таймер замирает и срывается вперёд, а прокрутка обрывается. */
function advance(s: DirectorState, now: number, cfg: ExpoSettings, fx: Effect[]): DirectorState {
  const gap = Math.max(0, now - s.now);
  const target = s.now + Math.min(gap, 250);
  if (s.paused) return { ...s, now: target };
  let cur = s;
  for (let guard = 0; guard < 64; guard++) {
    const due = nextDue(cur, cfg, fx);
    if (!due || due.at > target) break;
    cur = due.apply(cur);
  }
  const phase = cur.phase.kind === 'intro' && cur.phase.line !== undefined && !cur.phase.voiced
    ? { ...cur.phase, line: introCueAt(target - cur.phaseStart).line }
    : cur.phase;
  return { ...cur, phase, now: target };
}

/** Один шаг режиссёра: новое состояние и эффекты. Входное состояние не меняется. */
export function step(s: DirectorState, ev: DirectorEvent, cfg: ExpoSettings): { state: DirectorState; effects: Effect[] } {
  const fx: Effect[] = [];
  const out = (state: DirectorState) => ({ state, effects: fx });

  if (ev.t === 'tick') return out(advance(s, ev.now, cfg, fx));

  if (ev.t === 'voice') return out({ ...s, voice: !s.voice });
  if (ev.t === 'pause') {
    if (s.paused) return out(s);
    if (s.phase.kind === 'intro') fx.push({ e: 'introPause', paused: true, at: s.now });
    return out({ ...s, paused: true, pausedAt: s.now });
  }
  if (ev.t === 'resume') {
    if (!s.paused) return out(s);
    const shift = s.now - (s.pausedAt ?? s.now);
    const p = s.phase;
    if (p.kind === 'intro') fx.push({ e: 'introPause', paused: false, at: s.now });
    const phase: Phase = p.kind === 'turn'
      ? { ...p, ...(p.deadline !== null ? { deadline: p.deadline + shift } : {}), ...(p.rest !== undefined ? { rest: p.rest + shift } : {}) }
      : p.kind === 'result'
        ? { ...p, ...(p.until !== undefined ? { until: p.until + shift } : {}), ...(p.leave !== undefined ? { leave: p.leave + shift } : {}) }
        : p;
    const resumed = { ...s, paused: false, pausedAt: null, phase, phaseStart: s.phaseStart + shift, lastInput: s.lastInput + shift };
    if (phase.kind === 'turn' && phase.step === 'scroll' && phase.rest !== undefined) return out(finishScroll(resumed, s.now, cfg, fx));
    return out(phase.kind === 'intro' && phase.done ? enter(resumed, { kind: 'welcome' }, s.now, cfg, fx) : resumed);
  }

  // «Сейчас» для событий: на паузе — момент паузы (по её снятии отсчёты сдвинутся на её длительность).
  const now = s.paused && s.pausedAt !== null ? s.pausedAt : s.now;
  const p = s.phase;

  if (ev.t === 'introSeek') {
    if (p.kind !== 'intro' || s.paused || !Number.isInteger(ev.line) || ev.line < 1 || ev.line > INTRO_KEYS.length) return out(s);
    // Логическое начало всего монтажа сдвинуто так, чтобы запасной срок
    // учитывал только выбранный раздел и всё, что следует за ним.
    return out(enter({ ...s, lastInput: now }, { kind: 'intro', line: ev.line }, now - introCueStart(ev.line), cfg, fx));
  }
  if (ev.t === 'introVoice') {
    const line = ev.line !== undefined && Number.isInteger(ev.line) && ev.line >= 1 && ev.line <= INTRO_KEYS.length ? ev.line : undefined;
    return out(p.kind === 'intro' ? { ...s, phase: { ...p, voiced: ev.playing, ...(line === undefined ? {} : { line }) } } : s);
  }
  if (ev.t === 'introDone') {
    if (p.kind !== 'intro') return out(s);
    return out(s.paused ? { ...s, phase: { ...p, done: true } } : enter(s, { kind: 'welcome' }, now, cfg, fx));
  }

  if (ev.t === 'timerHold') {
    if (p.kind !== 'turn' || p.step !== 'choose' || p.deadline === null || p.held != null) return out(s);
    return out({ ...s, phase: { ...p, held: now } });
  }
  if (ev.t === 'timerRelease') {
    if (p.kind !== 'turn' || p.held == null || p.deadline === null) return out(s);
    return out({ ...s, phase: { ...p, held: undefined, deadline: p.deadline + (now - p.held) } });
  }
  if (ev.t === 'restart') {
    if (p.kind === 'startup' || p.kind === 'attract') return out(s);
    return out(enter({ ...fresh(s, fx), lastInput: now }, { kind: 'welcome' }, now, cfg, fx));
  }
  if (ev.t === 'jump') {
    const phase: Phase = ev.phase === 'turn' ? turnPhase(ev.n ?? 1) : ev.phase === 'briefing' ? briefing() : ({ kind: ev.phase } as Phase);
    let next: DirectorState = { ...s, phase, phaseStart: now, lastInput: now };
    if (phase.kind === 'turn' && next.front === null) next = { ...next, front: cfg.fronts[0] ?? null };
    if (phase.kind === 'turn' && phase.step === 'choose' && cfg.timer.on) next = { ...next, phase: { ...phase, deadline: now + cfg.timer.seconds * 1000 } };
    if (phase.kind === 'turn' && next.front) fx.push({ e: 'deal', n: phase.n, front: next.front });
    fx.push({ e: 'scene', key: sceneKey(next) });
    return out(next);
  }
  // голос договорил пункт брифинга — следующий пункт (последний ждёт своего срока)
  if (ev.t === 'hold') {
    if (p.kind !== 'result') return out(s);
    const until = now + ev.ms;
    if (p.until !== undefined && p.until >= until) return out(s);
    const leave = p.leave !== undefined && until > p.leave ? undefined : p.leave;
    return out({ ...s, phase: { ...p, until, leave } });
  }
  if (ev.t === 'spoken') {
    if (p.kind !== 'result' || p.quiet) return out(s);
    return out({ ...s, phase: { ...p, until: now, leave: undefined } });
  }
  if (ev.t === 'briefDone') {
    if (s.paused || p.kind !== 'briefing' || p.point !== ev.point || p.point + 1 >= BRIEF_POINTS) return out(s);
    return out(enter(s, briefing(p.point + 1), now, cfg, fx));
  }
  if (ev.t === 'gpuManaged') return out({ ...s, gpuManaged: ev.managed });
  if (ev.t === 'gpuWait') {
    if (p.kind !== 'turn' || p.step !== 'scroll' || p.scrollBegan) return out(s);
    return out({ ...s, phase: { ...p, gpuHold: true, scrollBegan: false } });
  }
  if (ev.t === 'gpuFailed') {
    if (p.kind !== 'turn' || p.step !== 'scroll' || !p.gpuHold || p.scrollBegan) return out(s);
    return out({ ...s, phase: { ...p, gpuError: ev.error } });
  }
  if (ev.t === 'gpuReady') {
    if (p.kind !== 'turn' || p.step !== 'scroll' || !p.gpuHold) return out(s);
    return out({ ...s, phase: { ...p, gpuHold: false, gpuError: undefined } });
  }
  if (ev.t === 'debriefProgress') {
    if (p.kind !== 'turn' || !p.preparing) return out(s);
    return out({ ...s, phase: { ...p, debriefProgress: { done: ev.done, total: ev.total, stage: ev.stage, started: ev.started } } });
  }
  if (ev.t === 'scrollWait') {
    if (p.kind !== 'turn' || p.step !== 'scroll' || p.scrollBegan) return out(s);
    return out({ ...s, phase: { ...p, scrollHold: true } });
  }
  if (ev.t === 'scrollReady') {
    if (p.kind !== 'turn' || p.step !== 'scroll' || p.scrollBegan || p.rest !== undefined || p.gpuHold) return out(s);
    return out({ ...s, phaseStart: now, phase: { ...p, scrollHold: false, scrollBegan: true } });
  }
  if (ev.t === 'scrollDone') {
    if (p.kind !== 'turn' || p.step !== 'scroll' || p.scrollHold || p.rest !== undefined || p.preparing || p.commenting) return out(s);
    if (!cfg.generation.comments) return out(finishScroll(s, now, cfg, fx));
    const token = (s.commentSeq ?? 0) + 1;
    fx.push({ e: 'commentChoice', n: p.n, session: s.session, token });
    return out({ ...s, commentSeq: token, phase: { ...p, commenting: { token } } });
  }
  if (ev.t === 'commentDone') {
    if (p.kind !== 'turn' || p.step !== 'scroll' || p.n !== ev.n || s.session !== ev.session || p.commenting?.token !== ev.token) return out(s);
    return out(finishScroll(s, now, cfg, fx));
  }
  if (ev.t === 'debriefFailed') {
    if (p.kind !== 'turn' || !p.preparing) return out(s);
    return out({ ...s, phase: { ...p, debriefError: ev.error } });
  }
  if (ev.t === 'debriefReady') {
    if (p.kind !== 'turn' || !p.preparing) return out(s);
    return out(enter(s, { kind: 'result' }, now, cfg, fx));
  }
  if (ev.t === 'ready') return out(p.kind === 'startup' ? enter(s, { kind: 'attract' }, now, cfg, fx) : s);

  // Ввод посетителя: на паузе (меню оператора открыто) не принимается.
  if (!isInput(ev) || s.paused) return out(s);
  const touched: DirectorState = { ...s, lastInput: now };

  switch (ev.t) {
    case 'touch':
      if (now - s.phaseStart < DEBOUNCE_MS) return out(touched);
      if (p.kind === 'attract') return out(enter(touched, cfg.intro ? { kind: 'intro' } : { kind: 'welcome' }, now, cfg, fx));
      if (p.kind === 'welcome' && cfg.fronts.length === 1) return out(enter({ ...touched, front: cfg.fronts[0] }, briefing(), now, cfg, fx));
      if (p.kind === 'result') return out(enter(fresh(touched, fx), { kind: 'welcome' }, now, cfg, fx));
      return out(p.kind === 'startup' ? s : touched);
    case 'skipIntro':
      if (p.kind !== 'intro') return out(touched);
      return out(enter(touched, { kind: 'welcome' }, now, cfg, fx));
    case 'back':
      if (p.kind === 'welcome') return out(enter({ ...touched, front: null }, { kind: 'attract' }, now, cfg, fx));
      return out(touched);
    case 'stay':
      if (p.kind !== 'result') return out(touched);
      return out({ ...touched, phase: { ...p, leave: undefined, quiet: true } });
    case 'pickFront':
      if (p.kind === 'welcome' && cfg.fronts.includes(ev.front)) return out(enter({ ...touched, front: ev.front }, briefing(), now, cfg, fx));
      return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
    case 'markFront':
      if (p.kind === 'welcome' && cfg.fronts.includes(ev.front)) {
        if (s.front !== ev.front) fx.push({ e: 'say', key: `marshal-${ev.front}`, priority: 'scene', scene: 'welcome' });
        return out({ ...touched, front: ev.front });
      }
      return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
    case 'next':
      if (p.kind === 'briefing') return out(enter(touched, turnPhase(1), now, cfg, fx));
      return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
    case 'choose':
      if (p.kind === 'turn' && p.step === 'choose' && p.choice === null && Number.isInteger(ev.card) && ev.card >= 0) {
        fx.push({ e: 'decide', n: p.n, choice: ev.card });
        return out(enter(touched, { ...p, step: 'scroll', choice: ev.card }, now, cfg, fx));
      }
      return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
    case 'aim':
      if (p.kind === 'turn' && p.step === 'choose' && p.choice === null && ev.place.trim()) {
        fx.push({ e: 'decide', n: p.n, choice: { place: ev.place } });
        return out(enter(touched, { ...p, step: 'scroll', choice: 'aim', aim: ev.place }, now, cfg, fx));
      }
      return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
    case 'replace':
      if (p.kind === 'turn' && p.step === 'choose' && p.replacements < cfg.maxReplacements) {
        fx.push({ e: 'replace', n: p.n, card: ev.card });
        return out({ ...touched, phase: { ...p, replacements: p.replacements + 1 } });
      }
      return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
    case 'speak':
      if (p.kind === 'startup' || p.kind === 'attract') return out(s);
      fx.push({ e: 'listen' });
      return out(touched);
    case 'brief':
      if (p.kind === 'briefing' && Number.isInteger(ev.point) && ev.point >= 0 && ev.point < BRIEF_POINTS && ev.point !== p.point) return out(enter(touched, briefing(ev.point), now, cfg, fx));
      return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
    case 'step': {
      // между обстановкой и решением; после приказа (ход операции) карточки уже не листаются
      if (p.kind !== 'turn' || p.choice !== null || (ev.step !== 'explain' && ev.step !== 'choose') || ev.step === p.step) return out(p.kind === 'startup' || p.kind === 'attract' ? s : touched);
      const phase: Phase = {
        ...p,
        step: ev.step,
        deadline: ev.step === 'choose' && cfg.timer.on ? now + cfg.timer.seconds * 1000 : null,
        warned: false,
        offered: false,
      };
      const next: DirectorState = { ...touched, phase, phaseStart: now };
      fx.push({ e: 'scene', key: sceneKey(next) });
      return out(next);
    }
    case 'ask':
      if (p.kind === 'startup' || p.kind === 'attract' || !ev.q.trim()) return out(s);
      fx.push({ e: 'ask', q: ev.q.trim().slice(0, 300) });
      return out(touched);
  }
  return out(s);
}
