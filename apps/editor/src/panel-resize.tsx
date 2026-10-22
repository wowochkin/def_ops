/**
 * Ширина боковой панели перетаскиванием края: запоминается в браузере, двойной щелчок по краю — ширина по умолчанию.
 */
import { useState, type CSSProperties } from 'react';

/** Ширина в пределах [min, max] и не больше доли окна (карте остаётся место). */
export function clampWidth(w: number, min: number, max: number, viewport: number, share = 0.7): number {
  return Math.round(Math.max(min, Math.min(max, viewport * share, w)));
}

export function usePanelWidth(key: string, def: number, min: number, max: number): [number, (w: number) => void, () => void] {
  const [w, set] = useState<number>(() => { try { const v = Number(localStorage.getItem(key)); return v ? clampWidth(v, min, max, window.innerWidth) : def; } catch { return def; } });
  const save = (x: number) => { const c = clampWidth(x, min, max, window.innerWidth); set(c); try { localStorage.setItem(key, String(c)); } catch { /* */ } };
  const reset = () => { set(def); try { localStorage.removeItem(key); } catch { /* */ } };
  return [w, save, reset];
}

/**
 * Край панели: тянуть мышью. edge — какой край у панели (right — панель слева от края, ширина растёт вправо; left —
 * панель справа, ширина растёт влево).
 */
export function Resizer({ width, setWidth, reset, edge, title = 'Потяните, чтобы изменить ширину; двойной щелчок — по умолчанию' }: { width: number; setWidth: (w: number) => void; reset: () => void; edge: 'left' | 'right'; title?: string }) {
  const style: CSSProperties = edge === 'right' ? { right: -3 } : { left: -3 };
  return <div className="panel-resizer" style={style} title={title} role="separator" aria-orientation="vertical"
    onDoubleClick={reset}
    onPointerDown={(e) => {
      e.preventDefault();
      const x0 = e.clientX, w0 = width;
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing');
      const move = (m: PointerEvent) => setWidth(w0 + (edge === 'right' ? m.clientX - x0 : x0 - m.clientX));
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    }} />;
}
