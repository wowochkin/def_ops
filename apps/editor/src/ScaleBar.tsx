/**
 * Масштаб карты: линейка с делениями и численный масштаб «1:25 000».
 * Щелчок по численному масштабу — выбор стандартного масштаба (карта
 * перемасштабируется так, чтобы на экране получился именно он).
 */
import { useState } from 'react';
import { STANDARD_SCALES, formatScale, scaleBar, scaleDenominator, zoomForScale } from '@def-ops/core';
import type { MapEngine } from './engine/types';

export function ScaleBar({ engine, tick }: { engine: MapEngine | null; tick: number }) {
  const [open, setOpen] = useState(false);
  void tick; // пересчёт при каждом движении карты
  if (!engine) return null;
  const v = engine.getView();
  const lat = v.center[1];
  const bar = scaleBar(lat, v.zoom, 130);
  const denom = scaleDenominator(lat, v.zoom);
  return (
    <div className="scalebar">
      <svg width={Math.ceil(bar.px) + 2} height={14} aria-label={`Линейка масштаба: ${bar.label}`}>
        {bar.ticks.slice(0, -1).map((t, i) => (
          <rect key={i} x={1 + t} y={4} width={bar.ticks[i + 1] - t} height={5} fill={i % 2 ? '#fff' : '#222'} stroke="#222" strokeWidth={1} />
        ))}
      </svg>
      <span className="sb-label">{bar.label}</span>
      <button className="sb-num" title="Численный масштаб на экране (пиксель 0,28 мм). Щёлкните — выбрать стандартный масштаб" onClick={() => setOpen(!open)}>
        {formatScale(denom)}
      </button>
      {open && (
        <div className="sb-menu">
          {STANDARD_SCALES.map((s) => (
            <button key={s} onClick={() => { engine.setView({ zoom: zoomForScale(lat, s) }); setOpen(false); }}>{formatScale(s)}</button>
          ))}
        </div>
      )}
    </div>
  );
}
