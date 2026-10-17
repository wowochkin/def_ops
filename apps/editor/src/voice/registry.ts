/**
 * Реестр действий: кнопки раздела и голос исполняют один и тот же код.
 * Действие регистрируется компонентом (useAction — живёт, пока компонент смонтирован)
 * или напрямую (register — для оболочки и тестов в node).
 */
import { createElement, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface Action<P = any> {
  id: string;                          // 'command.turn'
  section: string;                     // раздел или 'global'
  title: string;                       // для подсказок и тура
  describe: string;                    // для модели
  params?: Record<string, unknown>;    // JSON-схема параметров
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

/** Действия раздела: общие и самого раздела. */
export function actions(section: string): Action[] {
  return [...byId.values()].filter((a) => a.section === 'global' || a.section === section);
}

/** Кнопка, вызывающая действие реестра. data-action — для тура и проверки. */
export function ActButton({ action, params, children, ...rest }: { action: string; params?: unknown; children?: ReactNode } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return createElement('button', { ...rest, 'data-action': action, onClick: () => { void act(action, params); } }, children);
}
