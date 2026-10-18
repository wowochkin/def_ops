/**
 * Окна поверх раздела, которые панель голоса не закрывает: всякое окно помечено атрибутом `data-modal` (вопросы
 * dialogs.ts, «Принять командование», «Разбор операции», отчёт, калибровка, «Голоса», окна разделов). Новое окно —
 * тоже с `data-modal`, иначе панель его не заметит.
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { crowded as crowdedBy, placePanel } from './panel-state';

export const MODAL_SELECTOR = '[data-modal]';

export interface AvoidState {
  /** открыто хоть одно окно */
  modal: boolean;
  /** куда поставить панель (null — обычное место) */
  pos: { left: number; top: number } | null;
  /** окно почти во весь экран: панели места нет — только строка состояния */
  crowded: boolean;
}

/** Окна появляются и закрываются без событий — проверка раз в 300 мс и при смене размера окна. */
export function useAvoidModals(card: RefObject<HTMLElement | null>): AvoidState {
  const [st, setSt] = useState<AvoidState>({ modal: false, pos: null, crowded: false });
  const last = useRef('');
  /** Размер полосы целиком (с фразой): по нему решается, есть ли ей место, — пока она строкой состояния, он не меняется. */
  const full = useRef<{ width: number; height: number } | null>(null);
  const measure = () => {
    const boxes = [...document.querySelectorAll(MODAL_SELECTOR)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ left: r.left, top: r.top, width: r.width, height: r.height }));
    const c = card.current?.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const pos = boxes.length && c ? placePanel({ width: c.width, height: c.height }, boxes, vw, vh) : null;
    // размер полосы — только полосы (не развёрнутой панели в первый миг окна) и не строки состояния
    if (c && card.current?.classList.contains('strip') && !last.current.includes('"crowded":true')) full.current = { width: c.width, height: Math.max(c.height, full.current?.height ?? 0) };
    if (!boxes.length) full.current = null;
    const crowded = boxes.length > 0 && crowdedBy(boxes, vw, vh, full.current && full.current.height > 0 ? full.current : undefined);
    const next = { modal: boxes.length > 0, pos, crowded };
    const key = JSON.stringify(next);
    if (key !== last.current) { last.current = key; setSt(next); }
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const t = setInterval(measure, 300);
    window.addEventListener('resize', measure);
    return () => { clearInterval(t); window.removeEventListener('resize', measure); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return st;
}
