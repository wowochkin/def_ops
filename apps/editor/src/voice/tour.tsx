/**
 * Голосовой тур поверх любого раздела: остальной экран притемнён (четыре полосы вокруг проёма), вокруг элемента (`data-tour="…"`) — светящаяся
 * рамка, плавно переезжающая к следующему; внизу (или вверху, если элемент внизу; правее колонки разделов, левее панели голоса) — подпись крупно и пример фразы.
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
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SECTIONS } from '../sections';
import type { VoiceClient } from './client';
import { act, ActButton, register } from './registry';
import { registerTourActions } from './actions/tour';
import { findTour, TOURS, type Tour, type TourStep } from './tours';

export type { Tour, TourStep };
/** Чем кончилась фраза шага: доиграна, остановлена (перебили, «стоп») или не звучала (голоса нет). */
export type SpeechEnd = 'played' | 'stopped' | 'silent';
export interface Speech { done: Promise<SpeechEnd>; cancel(): void }
/** speaking — штаб говорит шаг; waiting — договорил (или голоса нет), ждёт; paused — пауза. */
export type Phase = 'speaking' | 'waiting' | 'paused';
export interface TourState { tour: Tour; index: number; phase: Phase; missing: boolean; extra: boolean }
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
}

const REAL = new Set<string>(SECTIONS.map((s) => s.id));

export class TourEngine {
  state: TourState | null = null;
  /** Номер перехода: устаревшие продолжения (договорил старый шаг, дождались элемента) ничего не делают. */
  private seq = 0;
  private speech: Speech | null = null;
  /** Раздел, в котором идёт тур; null — тур поверх любого раздела (вступление, панель голоса). */
  private where: string | null = null;
  private onEnd: ((r: TourEnd) => void) | undefined;
  private subs = new Set<() => void>();

  constructor(private d: TourDeps) {}

  subscribe = (f: () => void): (() => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  get step(): TourStep | null { return this.state ? this.state.tour.steps[this.state.index] : null; }
  has(idOrSection: string): boolean { return !!findTour(idOrSection, this.d.tours); }

  /** Начать тур (по идентификатору или разделу); идущий тур заканчивается без своего onEnd. */
  async start(idOrSection: string, o: { onEnd?(r: TourEnd): void } = {}): Promise<string | void> {
    const tour = findTour(idOrSection, this.d.tours);
    if (!tour) return 'Такого тура нет.';
    this.onEnd = undefined;
    if (this.state) this.finish('stopped');
    this.onEnd = o.onEnd;
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

  /** Открыт раздел sec: тур раздела, ушедший не по своему шагу, останавливается. */
  onSection(sec: string): void {
    if (!this.state || !this.where || sec === this.where) return;
    this.finish('section');
    this.d.speak('Тур остановлен: открыт другой раздел.');
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
    this.set(null);
    cb?.(r);
  }

  private async go(i: number): Promise<void> {
    if (!this.state) return;
    const my = this.hush();
    const step = this.state.tour.steps[i];
    this.set({ ...this.state, index: i, phase: 'speaking', missing: false, extra: false });
    const p = step.prepare;
    if (p) {
      // шаг тура сам открывает раздел — это не уход из тура
      const sec = p.action === 'shell.open' ? (p.params as { section?: string } | undefined)?.section : undefined;
      if (sec && REAL.has(sec)) this.where = sec;
      try { await this.d.act(p.action, p.params); } catch { /* элемента не будет — шаг скажет, когда он появится */ }
      if (my !== this.seq) return;
    }
    let found = this.d.exists(step.target);
    for (let t = 0; !found && t < FIND_WAIT_MS; t += POLL_MS) {
      await this.d.sleep(POLL_MS);
      if (my !== this.seq) return;
      found = this.d.exists(step.target);
    }
    if (!this.state) return;
    this.set({ ...this.state, missing: !found });
    this.say(my, !found && step.unavailable ? step.unavailable : step.text);
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

interface VoiceOut { client: VoiceClient; send(id: number, text: string): void; stop(id: number): void; live(): boolean }
let voice: VoiceOut | null = null;
const waiting = new Map<number, (r: SpeechEnd) => void>();
const settle = (id: number, r: SpeechEnd) => { const f = waiting.get(id); if (f) { waiting.delete(id); f(r); } };

/** Сказать фразу голосом начальника штаба; голоса нет (выключен, не готов, открыто окно калибровки) — 'silent'. */
export function speakChief(text: string): Speech {
  const v = voice;
  if (!v || !v.live()) return { done: Promise.resolve('silent'), cancel: () => {} };
  const id = v.client.newSayId();
  const done = new Promise<SpeechEnd>((res) => waiting.set(id, res));
  v.send(id, text);
  return { done, cancel: () => { if (waiting.has(id)) { settle(id, 'stopped'); v.stop(id); } } };
}

/**
 * Панель голоса отдаёт туру свой путь речи: send — фраза в очередь штаба (ждёт конца речи человека, видна в ленте),
 * stop — снять фразу, live — голос включён, сервис готов, окна калибровки и голосов нет.
 */
export function useTourVoice(o: VoiceOut): void {
  const ref = useRef(o);
  ref.current = o;
  useEffect(() => {
    const c = o.client;
    voice = { client: c, send: (id, t) => ref.current.send(id, t), stop: (id) => ref.current.stop(id), live: () => ref.current.live() };
    const offs = [
      c.onPlayed((id) => settle(id, 'played')),
      c.on('say-done', (m) => { if (m.stopped) settle(m.id, 'stopped'); }),
      c.on('barge', (m) => settle(m.id, 'stopped')),
    ];
    return () => {
      offs.forEach((f) => f());
      voice = null;
      [...waiting.keys()].forEach((id) => settle(id, 'stopped'));
    };
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
});
export const startTour = (id: string) => tourEngine.start(id);
export const stopTour = () => tourEngine.stop();

let offerOff: (() => void) | null = null;
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
  const off = register({
    id: 'tour.yes', section: 'global', title: 'Согласиться', describe: 'Согласие на то, что штаб только что предложил (тур, калибровка).',
    say: ['да', 'давай', 'хорошо'],
    available: () => (Date.now() <= until ? true : 'Штаб сейчас ничего не предлагает.'),
    run: async () => { clear(); await yes(); },
  });
  const t = setTimeout(() => clear(), OFFER_MS);
  const clear = () => { clearTimeout(t); off(); if (offerOff === clear) offerOff = null; };
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

const control = {
  active: () => !!tourEngine.state,
  hasMore: () => !!tourEngine.step?.more,
  paused: () => tourEngine.state?.phase === 'paused',
  section: () => currentSection,
  has: (s: string) => tourEngine.has(s),
  start: (s: string) => tourEngine.start(s),
  next: () => tourEngine.next(),
  back: () => tourEngine.back(),
  repeat: () => tourEngine.repeat(),
  more: () => tourEngine.more(),
  pause: () => tourEngine.pause(),
  resume: () => tourEngine.resume(),
  stop: () => tourEngine.stop(),
  introOn: () => setIntroOn(true),
  introOff: () => { setIntroOn(false); if (tourEngine.state?.tour.id === 'intro') tourEngine.stop(); },
};

// ---------------------------------------------------------------- слой тура

const FRAME_PAD = 8;
const snapshot = () => tourEngine.state;
type Box = { top: number; left: number; width: number; height: number };

/** Слой тура и его действия; подключается в оболочке одной строкой: `<TourLayer section={section} />`. */
export function TourLayer({ section }: { section: string }) {
  currentSection = section;
  const st = useSyncExternalStore(tourEngine.subscribe, snapshot, snapshot);

  useEffect(() => registerTourActions(control), []);
  // голос впервые готов: вступление, затем — предложение калибровки (панелью, voice:propose)
  useEffect(() => {
    const h = (e: Event) => onVoiceReady(e);
    window.addEventListener(READY_FIRST, h);
    return () => window.removeEventListener(READY_FIRST, h);
  }, []);
  // смена раздела: тур раздела — только в своём; при первом входе в раздел с туром — предложение
  useEffect(() => {
    tourEngine.onSection(section);
    const t = TOURS.find((x) => x.section === section);
    if (!t || !voiceReady || tourEngine.state || seen().includes(section)) return;
    void offer(`Показать, что есть в разделе «${SECTIONS.find((s) => s.id === section)?.title ?? section}»? Скажите «да» — и покажу.`, () => tourEngine.start(t.id))
      .then((spoken) => { if (spoken) lsSet(SEEN_KEY, JSON.stringify([...new Set([...seen(), section])])); });
  }, [section]);

  const step = st ? st.tour.steps[st.index] : null;
  const target = step ? (st!.missing && step.via ? step.via : step.target) : null;
  const box = useTargetBox(target, st?.index ?? -1);
  if (!st || !step) return null;

  const n = st.tour.steps.length;
  const text = st.extra && step.more ? step.more : st.missing && step.unavailable ? step.unavailable : step.text;
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight;
  // подпись не закрывает элемент: элемент внизу (и не у правого края, где панель голоса) — подпись вверху
  const low = box && box.top + box.height / 2 > vh * 0.55 && box.left < vw * 0.6;
  // проём в притемнении — рамка с отступом; элемента нет — проём схлопнут в середину экрана (притемнено всё)
  const hole: Box = box
    ? { top: box.top - FRAME_PAD, left: box.left - FRAME_PAD, width: box.width + 2 * FRAME_PAD, height: box.height + 2 * FRAME_PAD }
    : { top: vh / 2, left: vw / 2, width: 0, height: 0 };
  const bottom = hole.top + hole.height;
  const right = hole.left + hole.width;
  return (
    <div className="tour" data-phase={st.phase}>
      <div className="tour-dim" style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
      <div className="tour-dim" style={{ top: bottom, left: 0, right: 0, bottom: 0 }} />
      <div className="tour-dim" style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
      <div className="tour-dim" style={{ top: hole.top, left: right, right: 0, height: hole.height }} />
      <div className={`tour-frame${box ? '' : ' none'}`} data-target={box ? target ?? '' : ''} aria-hidden="true" style={hole} />
      <section className={`tour-cap${low ? ' top' : ''}`} role="dialog" aria-label={`Тур: ${st.tour.title}`} aria-live="polite">
        <div className="tour-count">{st.tour.title} · шаг {st.index + 1} из {n}{st.phase === 'paused' ? ' · пауза' : ''}</div>
        <h2>{step.title}</h2>
        <p className="tour-text">{text}</p>
        {step.example && <p className="tour-say">Скажите: «{step.example}»</p>}
        <div className="tour-btns">
          <ActButton action="tour.back" disabled={st.index === 0}>Назад</ActButton>
          {st.phase === 'paused'
            ? <ActButton action="tour.resume">Продолжить</ActButton>
            : <ActButton action="tour.pause">Пауза</ActButton>}
          <ActButton action="tour.next" className="primary">{st.index + 1 < n ? 'Дальше' : 'Готово'}</ActButton>
          <ActButton action="tour.stop">Хватит</ActButton>
        </div>
        <p className="tour-hint">{st.phase === 'paused' ? 'Пауза. Скажите: «продолжай» или «хватит».' : 'Голосом: «дальше», «назад», «повтори», «хватит».'}</p>
      </section>
    </div>
  );
}

/** Прямоугольник элемента тура: пересчёт при прокрутке, смене размера окна и раз в 250 мс (раздел дорисовывается). */
function useTargetBox(target: string | null, index: number): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    if (!target) { setBox(null); return; }
    findTarget(target)?.el.scrollIntoView?.({ block: 'nearest' });
    let last = '';
    const measure = () => {
      const r = findTarget(target)?.rect;
      const b = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      const key = JSON.stringify(b);
      if (key !== last) { last = key; setBox(b); }
    };
    measure();
    const t = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearInterval(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [target, index]);
  return box;
}
