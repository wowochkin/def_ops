/**
 * Голосовой тур поверх любого раздела: движок, голос штаба для шагов, поиск элемента (`data-tour="…"`), настройки и
 * запуск. Слой (притемнение, рамка, подпись) — voice/TourLayer.tsx.
 * Штаб проговаривает шаг тем же путём, что и свои ответы (роль начальника штаба, панель голоса — useTourVoice);
 * договорил — через STEP_GAP_MS следующий шаг. Голосом и кнопками: «дальше», «назад», «повтори», «подробнее»,
 * «пауза» / «продолжай», «хватит» (действия реестра, voice/actions/tour.ts).
 *
 * Элемента нет (появится позже) — подсвечивается то, что к нему ведёт (`via`), звучит `unavailable`. Тур раздела
 * идёт в своём разделе: перешли в другой раздел не по шагу тура (`prepare` — открыть раздел) — тур остановлен.
 * Элемент ищется и в iframe того же источника (раздел «Знаки»).
 *
 * Запуск: событие окна `voice:ready-first` (голос впервые готов за этот запуск; отменяемое) — вступление, если оно
 * не выключено (`def_ops.voice.intro`): тур отменяет событие (preventDefault — панель голоса тогда сама калибровку
 * не предлагает), а после вступления шлёт `voice:propose` — панель предлагает калибровку, если её не было.
 * Вступление выключено — событие не отменяется, предложение — дело панели. При первом входе в раздел, у которого есть тур, штаб предлагает его
 * (`def_ops.tour.seen` — разделы, где уже предлагал).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { SECTIONS } from '../sections';
import type { VoiceClient } from './client';
import { act, register } from './registry';
import { findTour, TOURS, type Tour, type TourStep } from './tours';
import { currentTab, TABS, type TabSection } from './actions/tabs';
import { replayNow } from './actions/command';

export type { Tour, TourStep };
/** Чем кончилась фраза шага: доиграна, остановлена (перебили, «стоп») или не звучала (голоса нет). */
export type SpeechEnd = 'played' | 'stopped' | 'silent';
export interface Speech { done: Promise<SpeechEnd>; cancel(): void }
/** speaking — штаб говорит шаг; waiting — договорил (или голоса нет), ждёт; paused — пауза. */
export type Phase = 'speaking' | 'waiting' | 'paused';
/** alt — элемента шага нет, а его замена (`TourStep.alt`) на экране: показывается она. */
export interface TourState { tour: Tour; index: number; phase: Phase; missing: boolean; extra: boolean; alt?: boolean }
/** Шаг, который сейчас на экране: сам шаг или его замена. */
export const stepOf = (s: TourState): TourStep => { const x = s.tour.steps[s.index]; return s.alt && x.alt ? x.alt : x; };
/** done — шаги кончились; stopped — «хватит»; section — ушли в другой раздел. */
export type TourEnd = 'done' | 'stopped' | 'section';

/** Пауза между шагами: успеть сказать «назад» или «подробнее». */
export const STEP_GAP_MS = 1500;
/** Сколько ждать элемента после подготовки шага (раздел только что открылся). */
export const FIND_WAIT_MS = 1000;
const POLL_MS = 100;
/** Сколько ждёт предложение штаба («Скажите: да») после того, как он договорил. */
export const OFFER_MS = 15_000;

export interface TourDeps {
  tours: Tour[];
  section(): string;
  act(id: string, p?: unknown): Promise<string | void>;
  exists(target: string): boolean;
  speak(text: string): Speech;
  sleep(ms: number): Promise<void>;
  /**
   * Открытая сейчас вкладка для действия вкладки (`modeling.tab` …); null — не вкладка. Тур запоминает её перед первым
   * своим переключением и возвращает тем же действием, когда кончится (дошёл до конца, «хватит», ушли из раздела).
   */
  tabOf?(action: string): string | null;
}

/** Что говорит штаб на шаге: текст для речи, а если элемента нет — с добавкой, почему его не видно. */
export const stepSpeech = (s: TourStep, missing: boolean) => {
  const t = s.speech ?? s.text;
  return missing && s.unavailable ? `${t} ${s.unavailable}` : t;
};
/** Что написано в подписи шага. */
export const stepCaption = (s: TourStep, missing: boolean) => (missing && s.unavailable ? `${s.text} ${s.unavailable}` : s.text);

const REAL = new Set<string>(SECTIONS.map((s) => s.id));
export const INTRO_STOPPED = 'Вступление остановлено. Продолжить — «Штаб, расскажи о приложении».';
/** После «хватит» во вступлении — один раз: как его выключить. */
export const INTRO_HOW_OFF = 'Чтобы вступление больше не звучало при запуске, скажите: «Штаб, без вступления».';
/** Игра началась посреди тура «Переигровки» (или кончилась посреди тура по командованию). */
export const GAME_STARTED = 'Тур остановлен: началась игра. Показать командование — «Штаб, тур по командованию».';
export const GAME_ENDED = 'Тур остановлен: игра закончена.';

export class TourEngine {
  state: TourState | null = null;
  /** Номер перехода: устаревшие продолжения (договорил старый шаг, дождались элемента) ничего не делают. */
  private seq = 0;
  private speech: Speech | null = null;
  /** Раздел, в котором идёт тур; null — тур поверх любого раздела (вступление, панель голоса). */
  private where: string | null = null;
  private onEnd: ((r: TourEnd) => void) | undefined;
  /** Вкладки, открытые до тура: действие → вкладка; возвращаются в конце тура. */
  private tabs = new Map<string, string>();
  /** Вкладка, которую открыл сам тур: сменил человек — его выбор в конце не перетирается. */
  private opened = new Map<string, string>();
  private subs = new Set<() => void>();

  constructor(private d: TourDeps) {}

  subscribe = (f: () => void): (() => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  get step(): TourStep | null { return this.state ? stepOf(this.state) : null; }
  has(idOrSection: string): boolean { return !!findTour(idOrSection, this.d.tours); }

  /**
   * Начать тур (по идентификатору или разделу). Идущий тур уступает новому, а его onEnd переходит к новому:
   * калибровку после вступления предложат и тогда, когда посреди него попросили другой тур.
   */
  async start(idOrSection: string, o: { onEnd?(r: TourEnd): void } = {}): Promise<string | void> {
    const tour = findTour(idOrSection, this.d.tours);
    if (!tour) return 'Такого тура нет.';
    const prev = this.onEnd;
    this.onEnd = undefined;
    if (this.state) this.finish('stopped');
    this.onEnd = prev && o.onEnd ? (r) => { o.onEnd!(r); prev(r); } : o.onEnd ?? prev;
    this.where = REAL.has(tour.section) ? tour.section : null;
    this.set({ tour, index: 0, phase: 'speaking', missing: false, extra: false });
    const my = this.seq;
    if (this.where && this.d.section() !== this.where) {
      await this.d.act('shell.open', { section: this.where });
      if (my !== this.seq) return;
    }
    void this.go(0);
  }

  next(): void {
    const s = this.state;
    if (!s) return;
    if (s.index + 1 >= s.tour.steps.length) this.finish('done');
    else void this.go(s.index + 1);
  }
  back(): void { if (this.state) void this.go(Math.max(0, this.state.index - 1)); }
  repeat(): void { if (this.state) void this.go(this.state.index); }
  resume(): void { this.repeat(); }
  more(): void {
    const s = this.state;
    const more = this.step?.more;
    if (!s || !more) return;
    const my = this.hush();
    this.set({ ...s, phase: 'speaking', extra: true });
    this.say(my, more);
  }
  pause(): void {
    if (!this.state) return;
    this.hush();
    this.set({ ...this.state, phase: 'paused' });
  }
  stop(): void { if (this.state) this.finish('stopped'); }

  /**
   * Открыт раздел sec: тур раздела, ушедший не по своему шагу, останавливается; вступление (шагов с переходом у
   * него нет — раздел сменил человек) — тоже, чтобы не висеть поверх нового раздела. Тур по панели голоса идёт дальше.
   */
  onSection(sec: string): void {
    const s = this.state;
    if (!s) return;
    if (s.tour.section === 'intro') {
      // последний шаг предлагает перейти («Штаб, покажи переигровку») — перешли: вступление закончено, а не прервано
      if (s.index === s.tour.steps.length - 1) { this.finish('done'); return; }
      this.finish('section');
      this.d.speak(INTRO_STOPPED);
      return;
    }
    if (!this.where || sec === this.where) return;
    this.finish('section');
    this.d.speak('Тур остановлен: открыт другой раздел.');
  }

  /**
   * Игра в «Переигровке» началась или кончилась: тур, который идёт только вне игры (или только в ней), остановлен —
   * его элементов на экране больше нет.
   */
  onGame(game: boolean): void {
    const g = this.state?.tour.game;
    if (g === undefined || g === game) return;
    this.finish('section');
    this.d.speak(game ? GAME_STARTED : GAME_ENDED);
  }

  private set(s: TourState | null): void {
    this.state = s;
    this.subs.forEach((f) => f());
  }

  /** Замолчать и сделать устаревшими все продолжения; новый номер перехода. */
  private hush(): number {
    this.speech?.cancel();
    this.speech = null;
    return ++this.seq;
  }

  private finish(r: TourEnd): void {
    const cb = this.onEnd;
    this.onEnd = undefined;
    this.hush();
    this.where = null;
    // вкладки — как были до тура (и запомненные разделом — тоже)
    for (const [action, tab] of this.tabs) {
      if (this.d.tabOf?.(action) === this.opened.get(action)) void this.d.act(action, { tab }).catch(() => {});
    }
    this.tabs.clear();
    this.opened.clear();
    this.set(null);
    cb?.(r);
  }

  private async go(i: number): Promise<void> {
    if (!this.state) return;
    const my = this.hush();
    const step = this.state.tour.steps[i];
    this.set({ ...this.state, index: i, phase: 'speaking', missing: false, extra: false, alt: false });
    const p = step.prepare;
    if (p) {
      // шаг тура сам открывает раздел — это не уход из тура
      const sec = p.action === 'shell.open' ? (p.params as { section?: string } | undefined)?.section : undefined;
      if (sec && REAL.has(sec)) this.where = sec;
      if (!this.tabs.has(p.action)) { const was = this.d.tabOf?.(p.action); if (was) this.tabs.set(p.action, was); }
      try { await this.d.act(p.action, p.params); } catch { /* элемента не будет — шаг скажет, когда он появится */ }
      const tab = (p.params as { tab?: string } | undefined)?.tab;
      if (this.tabs.has(p.action) && tab) this.opened.set(p.action, tab);
      if (my !== this.seq) return;
    }
    let found = this.d.exists(step.target);
    for (let t = 0; !found && t < FIND_WAIT_MS; t += POLL_MS) {
      await this.d.sleep(POLL_MS);
      if (my !== this.seq) return;
      found = this.d.exists(step.target);
    }
    if (!this.state) return;
    // элемента нет, а его замена на экране (конец игры вместо кнопки хода) — шаг о ней
    if (!found && step.alt && this.d.exists(step.alt.target)) {
      this.set({ ...this.state, missing: false, alt: true });
      this.say(my, stepSpeech(step.alt, false));
      return;
    }
    this.set({ ...this.state, missing: !found });
    this.say(my, stepSpeech(step, !found));
  }

  private say(my: number, text: string): void {
    const sp = this.d.speak(text);
    this.speech = sp;
    void sp.done.then((r) => {
      if (my !== this.seq || !this.state) return;
      if (r === 'stopped') { this.set({ ...this.state, phase: 'paused' }); return; }
      this.set({ ...this.state, phase: 'waiting' });
      // голоса нет — шаги листают кнопками
      if (r === 'played') void this.d.sleep(STEP_GAP_MS).then(() => { if (my === this.seq && this.state?.phase === 'waiting') this.next(); });
    });
  }
}

// ---------------------------------------------------------------- голос штаба

export interface VoiceOut { client: Pick<VoiceClient, 'newSayId'>; send(id: number, text: string): void; stop(id: number): void; live(): boolean }
let voice: VoiceOut | null = null;
const waiting = new Map<number, (r: SpeechEnd) => void>();
/** Фраза id кончилась: тот, кто ждал её (шаг тура), узнаёт как. Чужие номера ничего не делают. */
export const settleSpeech = (id: number, r: SpeechEnd) => { const f = waiting.get(id); if (f) { waiting.delete(id); f(r); } };
/** Вся речь штаба остановлена («стоп», выключение, окно калибровки): ждущие шаги — на паузу. */
export const stopTourSpeech = () => { [...waiting.keys()].forEach((id) => settleSpeech(id, 'stopped')); };
/** Как часто проверять, что голос ещё жив (выключили, открыли калибровку, обрыв связи), пока шаг ждёт конца фразы. */
const LIVE_POLL_MS = 500;

/** Сказать фразу голосом начальника штаба; голоса нет (выключен, не готов, открыто окно калибровки) — 'silent'. */
export function speakChief(text: string): Speech {
  const v = voice;
  if (!v || !v.live()) return { done: Promise.resolve('silent'), cancel: () => {} };
  const id = v.client.newSayId();
  const done = new Promise<SpeechEnd>((res) => waiting.set(id, res));
  v.send(id, text);
  return { done, cancel: () => { if (waiting.has(id)) { settleSpeech(id, 'stopped'); v.stop(id); } } };
}

/**
 * Привязать путь речи (панель голоса или тест); возвращает отвязку. Пока шаг ждёт конца фразы, а голос перестал
 * быть живым, — фраза считается остановленной: тур не висит в «говорит».
 */
export function bindTourVoice(v: VoiceOut): () => void {
  voice = v;
  const t = setInterval(() => { if (waiting.size && !v.live()) stopTourSpeech(); }, LIVE_POLL_MS);
  return () => {
    clearInterval(t);
    if (voice === v) voice = null;
    stopTourSpeech();
  };
}

/**
 * Панель голоса отдаёт туру свой путь речи: send — фраза в очередь штаба (ждёт конца речи человека, видна в ленте),
 * stop — снять фразу, live — голос включён, сервис готов, окна калибровки и голосов нет. Снятые из очереди фразы
 * панель передаёт в settleSpeech (SayGate onDrop), остановку всей речи — в stopTourSpeech.
 */
export function useTourVoice(o: VoiceOut & { client: VoiceClient }): void {
  const ref = useRef(o);
  ref.current = o;
  useEffect(() => {
    const c = o.client;
    const unbind = bindTourVoice({ client: c, send: (id, t) => ref.current.send(id, t), stop: (id) => ref.current.stop(id), live: () => ref.current.live() });
    const offs = [
      c.onPlayed((id) => settleSpeech(id, 'played')),
      c.on('say-done', (m) => { if (m.stopped) settleSpeech(m.id, 'stopped'); }),
      c.on('barge', (m) => settleSpeech(m.id, 'stopped')),
    ];
    return () => { offs.forEach((f) => f()); unbind(); };
  }, [o.client]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------- поиск элемента

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };

const shown = (el: Element, r: DOMRect, win: Window) => r.width > 0 && r.height > 0 && win.getComputedStyle(el).visibility !== 'hidden';

/** Первый видимый элемент `data-tour="target"` — в окне или в iframe того же источника; прямоугольник — в координатах окна. */
export function findTarget(target: string): { el: Element; rect: DOMRect } | null {
  if (typeof document === 'undefined') return null;
  const sel = `[data-tour="${CSS.escape(target)}"]`;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (shown(el, r, window)) return { el, rect: r };
  }
  for (const f of document.querySelectorAll('iframe')) {
    let doc: Document | null = null;
    try { doc = f.contentDocument; } catch { /* чужой источник */ }
    const fr = f.getBoundingClientRect();
    if (!doc || !f.contentWindow || !shown(f, fr, window)) continue;
    for (const el of doc.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (shown(el, r, f.contentWindow)) return { el, rect: new DOMRect(fr.left + r.left, fr.top + r.top, r.width, r.height) };
    }
  }
  return null;
}

// ---------------------------------------------------------------- настройки

export const INTRO_KEY = 'def_ops.voice.intro';
export const SEEN_KEY = 'def_ops.tour.seen';
const introSubs = new Set<() => void>();
/** Вступление при запуске: по умолчанию включено. */
export const introOn = () => lsGet(INTRO_KEY) !== 'off';
export function setIntroOn(on: boolean): void { lsSet(INTRO_KEY, on ? 'on' : 'off'); introSubs.forEach((f) => f()); }
/** Флажок «Вступление при запуске» (и голосом — «Штаб, больше не показывай вступление»). */
export function useIntroSetting(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore((f) => { introSubs.add(f); return () => { introSubs.delete(f); }; }, introOn, introOn);
  return [on, setIntroOn];
}
const seen = (): string[] => { try { const v = JSON.parse(lsGet(SEEN_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

// ---------------------------------------------------------------- движок окна, предложения

let currentSection = 'editor';
export const tourEngine = new TourEngine({
  tours: TOURS,
  section: () => currentSection,
  act,
  exists: (t) => !!findTarget(t),
  speak: speakChief,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  tabOf: (action) => {
    if (action === 'command.tab') return commandTab();
    const sec = /^(\w+)\.tab$/.exec(action)?.[1];
    return sec && sec in TABS ? currentTab(sec as TabSection) : null;
  },
});
/** Открытая вкладка командования — по кнопке `.on` (`data-tour="cmd-tab-…"`); игры нет — null. */
function commandTab(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('[data-tour^="cmd-tab-"].on')?.getAttribute('data-tour')?.slice('cmd-tab-'.length) ?? null;
}

// ---------------------------------------------------------------- игра в «Переигровке»

type ReplayNow = ReturnType<typeof replayNow>;
let replaySource: () => ReplayNow = replayNow;
/** Откуда брать состояние «Переигровки» (тесты; по умолчанию — действия раздела, voice/actions/command.ts). */
export function setReplaySource(f: () => ReplayNow): void { replaySource = f; }
export const inGame = () => !!replaySource()?.game;
/** Тур, который показывает раздел сейчас: в «Переигровке» во время игры — командование. */
export const sectionTour = (section: string) => (section === 'replay' && inGame() ? 'command' : section);

/**
 * Начать тур. «Командование» вне игры — тур о том, как в неё попасть; дослушали до конца — штаб предлагает начать
 * (продолжить незавершённую, открыть «Принять командование» или рассчитать операцию).
 */
export function startTourFor(s: string): Promise<string | void> {
  if (s === 'command' && !inGame()) return tourEngine.start('command-entry', { onEnd: (r) => { if (r === 'done') void proposeStart(); } });
  return tourEngine.start(s);
}

/** Предложение начать игру — по тому, что есть в «Переигровке»; «да» исполняет то же действие, что и фраза. */
export function proposeStart(speak?: (t: string) => Speech): Promise<boolean> {
  const r = replaySource();
  if (r?.game) return Promise.resolve(false);
  if (r?.saved) return offer('Продолжить незавершённую игру? Скажите «да» — и продолжу.', () => act('replay.continue'), speak);
  if (r?.calculated) return offer('Открыть окно «Принять командование»? Скажите «да» — и открою.', () => act('replay.takeCommand'), speak);
  return offer('Рассчитать операцию сейчас? Скажите «да» — и начну.', () => act('replay.calc'), speak);
}
export const startTour = (id: string) => startTourFor(id);
export const stopTour = () => tourEngine.stop();

let offerOff: (() => void) | null = null;
const NOTHING_OFFERED = 'Штаб сейчас ничего не предлагает.';
/** Открыто окно (вопрос, «Принять командование», разбор): ответы «да / нет» — его. */
const modalOpen = () => typeof document !== 'undefined' && !!document.querySelector('.modal-bg, [data-modal]');
let offerSeq = 0;
/**
 * Предложение штаба: фраза и «Скажите: да» — пока OFFER_MS после того, как он договорил, «да» исполняет yes
 * (действие `tour.yes`). Голоса нет — предложения нет (false).
 */
export async function offer(text: string, yes: () => unknown, speak: (t: string) => Speech = speakChief): Promise<boolean> {
  offerOff?.();
  const my = ++offerSeq;
  const end = await speak(text).done;
  // голоса нет или штаб уже предлагает другое — это предложение снято
  if (end === 'silent' || my !== offerSeq) return false;
  const until = Date.now() + OFFER_MS;
  /** Предложение живо: не истекло и не открыто окно — тогда «да» и «нет» относятся к окну, а предложение снимается. */
  const alive = (): true | string => {
    if (modalOpen()) { clear(); return NOTHING_OFFERED; }
    return Date.now() <= until ? true : NOTHING_OFFERED;
  };
  const offNo = register({
    id: 'tour.no', section: 'global', title: 'Отказаться', describe: 'Отказ от того, что штаб только что предложил.',
    available: alive,
    run: async () => { clear(); },
  });
  const offYes = register({
    id: 'tour.yes', section: 'global', title: 'Согласиться', describe: 'Согласие на то, что штаб только что предложил (тур, калибровка).',
    say: ['да', 'давай', 'хорошо'],
    available: alive,
    // ответ действия (или причина, почему нельзя) штаб говорит вслух — после «да» не тишина
    run: async () => { clear(); const r = await yes(); return typeof r === 'string' ? r : undefined; },
  });
  const t = setTimeout(() => clear(), OFFER_MS);
  const clear = () => { clearTimeout(t); offYes(); offNo(); if (offerOff === clear) offerOff = null; };
  offerOff = clear;
  return true;
}

// фраза не кончается словом «да»: ответ сразу после неё сервис счёл бы эхом своей же фразы (server.py, ECHO_RATIO)
/** События окна панели голоса (имена — строками: панель их шлёт и слушает сама). */
export const READY_FIRST = 'voice:ready-first';
export const PROPOSE = 'voice:propose';
/** Голос готов (было `voice:ready-first`): с этого момента штаб может предлагать туры разделов. */
let voiceReady = false;

/**
 * Голос впервые готов: вступление включено — событие отменено (панель сама калибровку не предлагает), идёт
 * вступление, по его окончании (и после «хватит») — `voice:propose`: предложение калибровки, если её не было.
 */
export function onVoiceReady(e: Event, emit: (name: string) => void = (n) => window.dispatchEvent(new CustomEvent(n))): void {
  voiceReady = true;
  if (!introOn() || tourEngine.state) return;
  e.preventDefault();
  // после ответа на «хватит» («Хорошо.»), а не перед ним
  void tourEngine.start('intro', { onEnd: () => { setTimeout(() => emit(PROPOSE), 0); } });
}

/** Что действиям тура нужно от движка окна (voice/actions/tour.ts). */
export const tourControl = {
  active: () => !!tourEngine.state,
  hasMore: () => !!tourEngine.step?.more,
  paused: () => tourEngine.state?.phase === 'paused',
  section: () => currentSection,
  has: (s: string) => tourEngine.has(s),
  start: (s: string) => startTourFor(s),
  inGame,
  next: () => tourEngine.next(),
  back: () => tourEngine.back(),
  repeat: () => tourEngine.repeat(),
  more: () => tourEngine.more(),
  pause: () => tourEngine.pause(),
  resume: () => tourEngine.resume(),
  stop: () => {
    const intro = tourEngine.state?.tour.id === 'intro';
    tourEngine.stop();
    if (!intro) return;
    speakChief(INTRO_HOW_OFF);
    return INTRO_HOW_OFF;
  },
  introOn: () => setIntroOn(true),
  introOff: () => { setIntroOn(false); if (tourEngine.state?.tour.id === 'intro') tourEngine.stop(); },
};

/** Раздел сменился (слой тура): тур раздела — только в своём; при первом входе в раздел с туром — предложение. */
export function tourSection(section: string): void {
  currentSection = section;
  tourEngine.onSection(section);
  const t = findTour(sectionTour(section));
  if (!t || !voiceReady || tourEngine.state || seen().includes(section)) return;
  void offer(`Показать, что есть в разделе «${SECTIONS.find((s) => s.id === section)?.title ?? section}»? Скажите «да» — и покажу.`, () => tourEngine.start(t.id))
    .then((spoken) => { if (spoken) lsSet(SEEN_KEY, JSON.stringify([...new Set([...seen(), section])])); });
}
