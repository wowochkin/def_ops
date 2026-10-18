/**
 * Реестр действий: кнопки раздела и голос исполняют один и тот же код.
 * Действие регистрируется компонентом (useAction — живёт, пока компонент смонтирован)
 * или напрямую (register — для оболочки и тестов в node).
 *
 * Здесь же — окна, ждущие ответа (openModal: пока открыто, голосом исполняются только его ответы), и голос штаба для
 * модулей без панели (speak: окно зачитывает вопрос, чтение по частям; панель голоса подключает его setSpeaker).
 */
import { createElement, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface Action<P = any> {
  id: string;                          // 'command.turn'
  section: string;                     // раздел или 'global'
  title: string;                       // для подсказок и тура
  describe: string;                    // для модели
  params?: Record<string, unknown>;    // JSON-схема параметров; она же — параметры инструмента модели (llm.ts toTools)
  say?: string[];                      // примеры фраз: «штаб, делай ход»
  irreversible?: boolean;
  /**
   * Ярлык: другая запись того же, что умеет действие с параметром (`tour.of.maps` — `tour.start {section: maps}`), —
   * только чтобы разборщик понял фразу без модели. Модели в инструменты не попадает, в «Что можно сказать» не
   * показывается.
   */
  shortcut?: boolean;
  /** Строка для панели «Что можно сказать» вместо фраз `say` (перечень: «штаб, открой вкладку …: Модели, …»); не для речи. */
  hint?: string;
  confirm?(p: P): string;              // текст подтверждения
  check?(p: P): true | string;         // параметры годятся сейчас (до подтверждения); строка — что сказать («Какой голос: …»)
  available(): true | string;          // строка — почему недоступно
  run(p: P): Promise<string | void>;   // строка — что доложить
}

const byId = new Map<string, Action>();

/** Регистрирует действие; возвращает функцию снятия (снимает только своё). */
export function register(a: Action): () => void {
  byId.set(a.id, a);
  return () => { if (byId.get(a.id) === a) byId.delete(a.id); };
}

/** Регистрация из компонента. Действие читается из ref — свежие замыкания без перерегистрации. */
export function useAction<P>(a: Action<P>): void {
  const ref = useRef(a);
  ref.current = a;
  useEffect(() => register({
    ...a,
    available: () => ref.current.available(),
    run: (p) => ref.current.run(p),
    ...(a.confirm ? { confirm: (p: P) => ref.current.confirm!(p) } : {}),
    ...(a.check ? { check: (p: P) => ref.current.check!(p) } : {}),
  }), [a.id, a.section]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Вызов действия. Недоступное не выполняется — возвращается причина. */
export async function act(id: string, p?: unknown): Promise<string | void> {
  const a = byId.get(id);
  if (!a) throw new Error(`Нет действия «${id}»`);
  const av = a.available();
  if (av !== true) return av;
  return a.run(p);
}

/**
 * Разбор фраз с параметрами без модели («покажи Зелов», «доложи о восьмой гвардейской»): модуль раздела регистрирует
 * разборщик; реплика (без обращения, нормализованная) и открытый раздел → действие с параметрами или готовый ответ say
 * (например, почему сейчас нельзя: игра не идёт). section у действия — сначала перейти в этот раздел («рассчитай
 * операцию» из «Знаний»). Не своё — null: фразу разбирают дальше (модель). Разборщики спрашиваются по порядку регистрации.
 */
export type PhraseHit = { id: string; params?: unknown; section?: string } | { say: string };
/** raw — реплика как распознана (с регистром и знаками): из неё берут текст указаний. */
export type PhraseParser = (rest: string, section: string, raw: string) => PhraseHit | null;
const parsers: PhraseParser[] = [];
/** Добавить разборщик фраз (first — раньше прочих: ответ на вопрос штаба); возвращает снятие. */
export function registerParser(p: PhraseParser, o: { first?: boolean } = {}): () => void {
  if (o.first) parsers.unshift(p); else parsers.push(p);
  return () => { const i = parsers.indexOf(p); if (i >= 0) parsers.splice(i, 1); };
}
/** Первое, что поняли разборщики (нет — null). */
export function parsePhrase(rest: string, section: string, raw = rest): PhraseHit | null {
  for (const p of parsers) { const h = p(rest, section, raw); if (h) return h; }
  return null;
}

/** Голосом пользовались недавно (подсказки «скажите: …» — только тогда): столько мс после последней реплики штабу. */
export const VOICE_RECENT_MS = 5 * 60_000;
let voiceAt = -Infinity;
let turn = 0;
/** Реплика штабу (разборщик отмечает каждую обращённую). */
export function markVoice(at = Date.now()): void { voiceAt = at; turn++; }
/** Номер последней реплики штабу: «ответ на вопрос» — только следующая за вопросом. */
export function voiceTurn(): number { return turn; }
/** Голосом пользовались за последние ms. */
export function voiceRecent(ms = VOICE_RECENT_MS): boolean { return Date.now() - voiceAt <= ms; }

/** Действие по id (нет — undefined). */
export function getAction(id: string): Action | undefined { return byId.get(id); }

/** Действия раздела: общие и самого раздела. */
export function actions(section: string): Action[] {
  return [...byId.values()].filter((a) => a.section === 'global' || a.section === section);
}

/** Действия без ярлыков — для модели и списков «что можно сказать». */
export const listed = (list: Action[]): Action[] => list.filter((a) => !a.shortcut);

/** Кнопка, вызывающая действие реестра. data-action — для тура и проверки. */
export function ActButton({ action, params, children, ...rest }: { action: string; params?: unknown; children?: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return createElement('button', { ...rest, 'data-action': action, onClick: () => { void act(action, params); } }, children);
}

// ---------------------------------------------------------------- голос штаба для модулей

/** keep — фраза не устаревает от новой реплики человека (поздний ответ советника): ждёт конца реплики и звучит. */
export interface SpeakOpts { keep?: boolean }
let speaker: ((text: string, o?: SpeakOpts) => number | void) | null = null;
let retractor: ((id: number) => void) | null = null;
/** Панель голоса подключает речь штаба (null — голоса нет: speak молчит). */
export function setSpeaker(fn: ((text: string, o?: SpeakOpts) => number | void) | null): void { speaker = fn; }
/** Панель голоса подключает снятие фразы (ждёт — снимается, звучит — гасится). */
export function setRetractor(fn: ((id: number) => void) | null): void { retractor = fn; }
/** Штаб говорит фразу как есть (к озвучке её готовит вызывающий: speakable). Голоса нет или он дежурит — молчит. Номер фразы. */
export function speak(text: string, o?: SpeakOpts): number | void { if (text) return speaker?.(text, o); }
/** Фраза больше не нужна (новая просьба о том же). */
export function retract(id: number): void { retractor?.(id); }

// ---------------------------------------------------------------- окна, ждущие ответа

/**
 * Окно, ждущее ответа (вопрос, калибровка, «Голоса»): пока оно открыто, голосом исполняются только его ответы (parse —
 * реплика без обращения → действие окна), стоп-слова, «отбой» и «повтори»; прочее — «Сначала ответьте на вопрос: …».
 * question — коротко, для этой фразы; read — что зачитать при открытии и на «повтори» (по умолчанию question).
 */
export interface VoiceModal {
  question: string;
  read?: string;
  /** не зачитывать при открытии (окно говорит само — например, ждёт, когда штаб договорит) */
  quiet?: boolean;
  parse(rest: string): { id: string; params?: unknown } | null;
  /**
   * Реплика целиком — ответ окна («да», «второй», название варианта): такую принимают и без обращения, и после окна
   * разговора (по умолчанию — «да» / «нет»).
   */
  isAnswer?(rest: string): boolean;
  /** Сообщение с одной кнопкой: посторонняя команда закрывает его (dismiss) и исполняется как обычно. */
  dismiss?(): void;
}

const modals: VoiceModal[] = [];
const modalCbs = new Set<(m: VoiceModal | null, opened: boolean) => void>();

/** Открыть окно (стопкой: отвечает верхнее) и зачитать его вопрос; возвращает закрытие (повторное — без действия). */
export function openModal(m: VoiceModal): () => void {
  modals.push(m);
  modalCbs.forEach((cb) => cb(m, true));
  if (!m.quiet) speak(m.read ?? m.question);
  return () => {
    const i = modals.lastIndexOf(m);
    if (i < 0) return;
    modals.splice(i, 1);
    const top = topModal();
    modalCbs.forEach((cb) => cb(top, false));
  };
}
/** Верхнее открытое окно (нет — null). */
export function topModal(): VoiceModal | null { return modals[modals.length - 1] ?? null; }
/** Окно открылось (opened) или закрылось (m — верхнее теперь); возвращает отписку. */
export function onModal(cb: (m: VoiceModal | null, opened: boolean) => void): () => void { modalCbs.add(cb); return () => { modalCbs.delete(cb); }; }
