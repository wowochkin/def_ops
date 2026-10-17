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
  confirm?(p: P): string;              // текст подтверждения
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

/** Действие по id (нет — undefined). */
export function getAction(id: string): Action | undefined { return byId.get(id); }

/** Действия раздела: общие и самого раздела. */
export function actions(section: string): Action[] {
  return [...byId.values()].filter((a) => a.section === 'global' || a.section === section);
}

/** Кнопка, вызывающая действие реестра. data-action — для тура и проверки. */
export function ActButton({ action, params, children, ...rest }: { action: string; params?: unknown; children?: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return createElement('button', { ...rest, 'data-action': action, onClick: () => { void act(action, params); } }, children);
}

// ---------------------------------------------------------------- голос штаба для модулей

let speaker: ((text: string) => void) | null = null;
/** Панель голоса подключает речь штаба (null — голоса нет: speak молчит). */
export function setSpeaker(fn: ((text: string) => void) | null): void { speaker = fn; }
/** Штаб говорит фразу как есть (к озвучке её готовит вызывающий: speakable). Голоса нет или он дежурит — молчит. */
export function speak(text: string): void { if (text) speaker?.(text); }

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
