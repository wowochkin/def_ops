/**
 * Место панели голоса и окна поверх раздела.
 *
 * Панель — сверху по центру, под верхней полосой кнопок раздела (TOP_BARS: полоса карты «Тактический · Слои ·
 * Участки · Подложка», шапки разделов; новую шапку — пометить `data-voice-top`). Окна (всякое помечено `data-modal`:
 * вопросы dialogs.ts, «Принять командование», «Разбор операции», калибровка, «Голоса»…) панель не перекрывает: она
 * пишет свой нижний край в CSS-переменную `--vp-space`, и окна встают ниже (styles.css).
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { anchorBottom, topPlace } from './panel-state';

export const MODAL_SELECTOR = '[data-modal]';
export const TOP_BARS = '[data-voice-top], .rp-bar, .app > header, .kb-top, .mdl-top';

export interface PanelPlace {
  /** открыто хоть одно окно */
  modal: boolean;
  /** левый верхний угол панели */
  left: number;
  top: number;
}

/** Пересчёт раз в 300 мс и при смене размера окна: окна и шапки появляются без событий. */
export function usePanelPlace(card: RefObject<HTMLElement | null>): PanelPlace {
  const [st, setSt] = useState<PanelPlace>({ modal: false, left: 0, top: 8 });
  const last = useRef('');
  const measure = () => {
    const modal = [...document.querySelectorAll(MODAL_SELECTOR)].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const bars = [...document.querySelectorAll(TOP_BARS)].map((e) => e.getBoundingClientRect());
    const c = card.current?.getBoundingClientRect();
    const p = topPlace(window.innerWidth, c?.width ?? 0, anchorBottom(bars));
    // окна — ниже панели
    document.documentElement.style.setProperty('--vp-space', `${Math.round(c && c.height ? p.top + c.height + 12 : 0)}px`);
    const next = { modal, ...p };
    const key = JSON.stringify(next);
    if (key !== last.current) { last.current = key; setSt(next); }
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const t = setInterval(measure, 300);
    window.addEventListener('resize', measure);
    return () => { clearInterval(t); window.removeEventListener('resize', measure); document.documentElement.style.removeProperty('--vp-space'); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return st;
}
