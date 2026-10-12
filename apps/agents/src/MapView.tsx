/** Карта: театр (MapLibre) и слой знаков (SVG поверх карты): дивизии на дробный час, след и положения по документам. */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { RunData } from './data';
import { hourOf, lostAt, posAt, rowAt, shortName, stateGroup, timeLabel } from './data';
import { addTheatre, baseStyle, towns } from './theatreLayers';
import { symbolMarkup } from './symbols';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

interface Props { data: RunData; hour: number; selected: string | null; onSelect: (id: string | null) => void; focus: [number, number] | null; showDestroyed: boolean }

export function MapView({ data, hour, selected, onSelect, focus, showDestroyed }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [, setView] = useState(0);
  const { trace, history, theatre } = data;

  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({
      container: box.current, style: baseStyle(), center: [14.2, 52.55], zoom: 9.2, pitchWithRotate: false, maxPitch: 0,
      attributionControl: false, canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => { addTheatre(map, theatre); setView((v) => v + 1); });
    const redraw = () => setView((v) => v + 1);
    map.on('move', redraw); map.on('resize', redraw);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [theatre]);

  useEffect(() => { if (focus && mapRef.current) mapRef.current.easeTo({ center: focus, duration: 600 }); }, [focus]);

  const townList = useMemo(() => towns(theatre), [theatre]);
  const lost = useMemo(() => lostAt(trace), [trace]);
  const map = mapRef.current;
  if (!map) return <div className="map" ref={box} />;
  const zoom = map.getZoom();
  const k = Math.max(0.45, Math.min(1.1, 0.42 + (zoom - 8) * 0.22));
  const P = (ll: [number, number]) => { const p = map.project(ll); return [p.x, p.y] as const; };
  const selIdx = trace.divisions.findIndex((d) => d.id === selected);

  // след выбранной дивизии (расчёт) и её положения по документам
  const trail = selIdx >= 0 ? Array.from({ length: Math.floor(hour) + 1 }, (_, h) => P(posAt(trace, selIdx, h))).map((p) => p.join(',')).join(' ') : '';
  const ghosts = selIdx >= 0 ? history.divisions.filter((p) => p.formation === selected) : [];

  return (
    <div className="map" ref={box}>
      <svg className="overlay">
        {zoom >= 9 && townList.map((t, i) => { const [x, y] = P(t.at); return <text key={i} x={x} y={y} className="town">{t.name}</text>; })}
        {trail && <polyline points={trail} className="trail" />}
        {ghosts.map((g, i) => {
          const [x, y] = P(g.at);
          const h = hourOf(trace.start, g.time);
          return (
            <g key={i} className={`ghost ${h <= hour ? 'past' : ''}`}>
              <circle cx={x} cy={y} r={7} />
              <text x={x + 9} y={y - 6}>{g.time.slice(8, 10)}.{g.time.slice(5, 7)} {g.time.slice(11, 16)} · {g.set}</text>
            </g>
          );
        })}
        {trace.divisions.map((d, i) => {
          const row = rowAt(trace, i, hour);
          const grp = stateGroup(row[2]);
          // разгромленная — на месте разгрома, приглушённая и перечёркнутая крест-накрест, с временем разгрома
          const out = grp === 'destroyed';
          if (out && !showDestroyed && i !== selIdx) return null;
          const [x, y] = P(posAt(trace, i, hour));
          const sel = i === selIdx;
          const s = (sel ? 1.25 : 1) * k * 0.8;
          const hw = 12 * s * 1.8, hh = 8 * s * 1.8;
          return (
            <g key={d.id} transform={`translate(${x},${y})`} className={`unit ${grp} ${sel ? 'sel' : ''}`} onClick={(e) => { e.stopPropagation(); onSelect(d.id); }}>
              <g transform={`scale(${s})`} dangerouslySetInnerHTML={{ __html: symbolMarkup(d) }} />
              {out ? <path className="strike" d={`M${-hw},${-hh}L${hw},${hh}M${-hw},${hh}L${hw},${-hh}`} /> : <circle className="state-dot" cx={hw} cy={-7 * s * 1.8} r={3.2} />}
              {(zoom >= 9.6 || sel) && <text y={hh + 13} className="unit-label">{shortName(d)}</text>}
              {out && lost[i] !== undefined && (zoom >= 9.6 || sel) && <text y={hh + 25} className="unit-label lost">{row[2]} {timeLabel(trace.start, lost[i]).slice(0, 5)} {timeLabel(trace.start, lost[i]).slice(11)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
