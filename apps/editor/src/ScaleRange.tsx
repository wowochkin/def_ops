/**
 * Диапазон масштабов, на которых виден слой или знак, и текущий масштаб вида.
 */
import { useEffect, useState } from 'react';
import { RANGE_SCALES, formatScale, inScaleRange, viewDenominator, type ScaleRange } from '@def-ops/core';
import type { MapEngine } from './engine/types';

/** Масштаб «1 : N» текущего вида; обновляется шагами (не на каждом кадре). */
export function useViewScale(engine: MapEngine | null): number | null {
  const [denom, setDenom] = useState<number | null>(null);
  useEffect(() => {
    if (!engine) return;
    const upd = () => {
      const v = engine.getView();
      const d = viewDenominator(v.center[1], v.zoom);
      // шаг ~2 %: панель не перерисовывается на каждом кадре
      setDenom((p) => (p != null && Math.abs(Math.log(d / p)) < 0.02 ? p : d));
    };
    upd();
    const offs = [engine.on('view', upd), engine.on('ready', upd)];
    return () => offs.forEach((f) => f());
  }, [engine]);
  return denom;
}

/**
 * Округление масштаба до двух значащих цифр в безопасную сторону: граница «от»
 * — вниз (1:1 160 200 → 1:1 100 000), «до» — вверх (→ 1:1 200 000), чтобы
 * текущий масштаб остался внутри диапазона.
 */
export function roundScale(d: number, dir: 'down' | 'up'): number {
  const p = Math.pow(10, Math.floor(Math.log10(d)) - 1);
  return (dir === 'down' ? Math.floor(d / p) : Math.ceil(d / p)) * p;
}

export function ScaleRangeField({ value, onChange, current, what }: {
  value: ScaleRange | null | undefined;
  onChange: (r: ScaleRange | null) => void;
  /** Текущий масштаб вида. */
  current: number | null;
  /** «слой» / «знак» — для подсказок. */
  what: string;
}) {
  const from = value?.from ?? null, to = value?.to ?? null;
  const set = (q: ScaleRange) => {
    const r = { from: q.from ?? null, to: q.to ?? null };
    onChange(r.from == null && r.to == null ? null : r);
  };
  const opts = (v: number | null) => [...new Set([...RANGE_SCALES, ...(v != null ? [v] : [])])].sort((a, b) => a - b);
  const visible = current == null || inScaleRange(value, current);
  return (
    <div className="scale-range">
      <div className="sr-head" title={`На каких масштабах ${what} виден. Вне диапазона ${what} скрыт на экране; экспорт и печать — со всеми знаками.`}>Виден на масштабах</div>
      <div className="sr-ctl">
        <select value={from ?? ''} title="Самый крупный (подробный) масштаб: при приближении дальше — скрыт"
          onChange={(e) => set({ from: e.target.value ? +e.target.value : null, to })}>
          <option value="">от любого</option>
          {opts(from).map((s) => <option key={s} value={s} disabled={to != null && s > to}>от {formatScale(s)}</option>)}
        </select>
        <select value={to ?? ''} title="Самый мелкий масштаб: при отдалении дальше — скрыт"
          onChange={(e) => set({ from, to: e.target.value ? +e.target.value : null })}>
          <option value="">до любого</option>
          {opts(to).map((s) => <option key={s} value={s} disabled={from != null && s < from}>до {formatScale(s)}</option>)}
        </select>
      </div>
      {current != null && (
        <div className="sr-now muted">
          сейчас {formatScale(current)}{visible ? '' : <b className="sr-off"> — скрыт</b>}
          <button className="link" title={`Скрыть ${what}, если приблизить карту крупнее текущего масштаба`}
            onClick={() => { const v = roundScale(current, 'down'); set({ from: v, to: to != null && to < v ? null : to }); }}>скрыть ближе</button>
          <button className="link" title={`Скрыть ${what}, если отдалить карту мельче текущего масштаба`}
            onClick={() => { const v = roundScale(current, 'up'); set({ from: from != null && from > v ? null : from, to: v }); }}>скрыть дальше</button>
          {(from != null || to != null) && <button className="link" onClick={() => onChange(null)}>сбросить</button>}
        </div>
      )}
    </div>
  );
}
