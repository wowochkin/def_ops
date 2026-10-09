/**
 * Участки: ключевые районы операции (из данных сценария) и свои (выделенные на карте). Выбор участка
 * приближает карту к нему, обводит его и (если включено) подставляет подходящую подложку: историческую
 * локальную карту, покрывающую участок, иначе — карту из интернета по масштабу.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createFeature, type LngLat, type MapDocument } from '@def-ops/core';
import type { MapEngine } from './engine/types';
import { Popover } from './ui';
import { pickBasemap, type Basemaps } from './shared';

export interface Sector { id: string; title: string; note?: string; bbox: [number, number, number, number]; custom?: boolean }

const files = import.meta.glob('../../../packages/sim/data/scenarios/*.sectors.json', { eager: true, import: 'default' }) as Record<string, { sectors: Sector[] }>;
/** Участки своих (загруженных) операций — регистрирует каталог при загрузке. */
const extra = new Map<string, Sector[]>();
export const registerSectors = (scenario: string, list: Sector[]) => { extra.set(scenario, list); };
export function scenarioSectors(scenario: string): Sector[] {
  return files[`../../../packages/sim/data/scenarios/${scenario}.sectors.json`]?.sectors ?? extra.get(scenario) ?? [];
}
const KEY = (s: string) => `def_ops.sectors.${s}`;
const loadCustom = (s: string): Sector[] => { try { return JSON.parse(localStorage.getItem(KEY(s)) || '[]'); } catch { return []; } };

/** Масштаб, при котором bbox помещается в окно карты. */
export function fitZoom(en: MapEngine, b: Sector['bbox']): { center: LngLat; zoom: number } {
  const { width, height } = en.size();
  const lat = (b[1] + b[3]) / 2;
  const zx = Math.log2((Math.max(200, width) * 360) / (512 * Math.max(1e-4, b[2] - b[0])));
  const zy = Math.log2((Math.max(200, height) * 360 * Math.cos((lat * Math.PI) / 180)) / (512 * Math.max(1e-4, b[3] - b[1])));
  return { center: [(b[0] + b[2]) / 2, lat], zoom: +(Math.min(zx, zy) - 0.25).toFixed(2) };
}

/** Документ с обводкой участка (слой «Участок»). */
export function withFocus(doc: MapDocument, s: Sector | null): MapDocument {
  if (!s) return doc;
  const [w, so, e, n] = s.bbox;
  const ring: LngLat[] = [[w, so], [e, so], [e, n], [w, n], [w, so]];
  const f = createFeature('line', 'std.border', { points: ring, layerId: 'focus' }, 1.2, 'own');
  f.name = `Участок: ${s.title}`;
  return { ...doc, layers: [...doc.layers, { id: 'focus', name: 'Участок', role: 'custom', visible: true, locked: true, opacity: 0.85 }], features: [...doc.features, f] };
}

export const inSector = (s: Sector | null, at: LngLat) => !s || (at[0] >= s.bbox[0] && at[0] <= s.bbox[2] && at[1] >= s.bbox[1] && at[1] <= s.bbox[3]);

export function SectorPicker({ scenario, engine, bm, focus, setFocus, opYear, onNotice }: {
  scenario: string; engine: MapEngine | null; bm: Basemaps; focus: Sector | null; setFocus: (s: Sector | null) => void; opYear: number; onNotice?: (t: string) => void;
}) {
  const [custom, setCustom] = useState<Sector[]>(() => loadCustom(scenario));
  const [auto, setAuto] = useState(() => localStorage.getItem('def_ops.autoBasemap') !== '0');
  const [drawing, setDrawing] = useState<LngLat | null | 'wait'>(null);
  const list = useMemo(() => [...scenarioSectors(scenario), ...custom], [scenario, custom]);
  const live = useRef({ drawing }); live.current = { drawing };
  useEffect(() => { setCustom(loadCustom(scenario)); }, [scenario]);

  const go = (s: Sector | null) => {
    setFocus(s);
    if (!engine) return;
    if (!s) return;
    const v = fitZoom(engine, s.bbox);
    engine.setView(v);
    if (auto) {
      const p = pickBasemap(bm, s.bbox, v.zoom, opYear);
      if (p.id !== bm.id) { bm.setId(p.id); onNotice?.(`Подложка: ${p.why}`); }
    }
  };
  // свой участок: два щелчка по карте — углы прямоугольника
  useEffect(() => {
    if (!engine || !drawing) return;
    return engine.on('click', (e) => {
      const d = live.current.drawing;
      if (d === 'wait') { setDrawing(e.lngLat); return; }
      if (!d) return;
      const a = d, b = e.lngLat;
      const s: Sector = { id: `c${Date.now()}`, title: `Свой участок ${custom.length + 1}`, custom: true, bbox: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
      const name = prompt('Название участка:', s.title);
      if (name) s.title = name;
      const next = [...custom, s];
      setCustom(next);
      try { localStorage.setItem(KEY(scenario), JSON.stringify(next)); } catch { /* */ }
      setDrawing(null);
      go(s);
    });
  }, [engine, drawing]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Popover label={<span className="sec-chip">{focus ? `Участок: ${focus.title}` : 'Участки'}</span>} align="right" className="sec-pop">{(close) => (
        <div className="sec-menu">
          <div className="pop-title">Участки</div>
          <button className={!focus ? 'on' : ''} onClick={() => { close(); go(null); }}>Весь театр</button>
          {list.map((s) => (
            <div key={s.id} className="sec-row">
              <button className={focus?.id === s.id ? 'on' : ''} onClick={() => { close(); go(s); }} title={s.note}>{s.title}{s.note ? <small>{s.note}</small> : null}</button>
              {s.custom && <button className="link" title="Удалить свой участок" onClick={() => { const next = custom.filter((x) => x.id !== s.id); setCustom(next); try { localStorage.setItem(KEY(scenario), JSON.stringify(next)); } catch { /* */ } if (focus?.id === s.id) go(null); }}>×</button>}
            </div>
          ))}
          <hr />
          <button onClick={() => { close(); setDrawing('wait'); }}>+ Выделить свой участок на карте…</button>
          <label className="sec-auto"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); try { localStorage.setItem('def_ops.autoBasemap', e.target.checked ? '1' : '0'); } catch { /* */ } }} />
            подбирать подложку под участок <small>историческая локальная карта, иначе — из интернета по масштабу</small></label>
        </div>
      )}</Popover>
      {drawing && <div className="pick-hint">{drawing === 'wait' ? 'Щёлкните первый угол участка' : 'Щёлкните противоположный угол'} <button onClick={() => setDrawing(null)}>Отмена</button></div>}
    </>
  );
}
