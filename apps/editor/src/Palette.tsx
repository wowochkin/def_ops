/**
 * Палитра знаков: библиотека по логическим категориям.
 * Сверху — стиль оформления и принадлежность (свои / противник), поиск.
 * Каждый элемент показан в выбранном стиле (или в ближайшем доступном).
 */
import { useMemo, useState } from 'react';
import { CATEGORIES, STYLES, PALETTE, variantFor, searchLibrary, type StyleId, type Side, type LibraryElement } from '@def-ops/core';
import type { Tool } from './store';
import { presetPreview } from './previews';

export function paperFor(style: StyleId): string {
  return style === 'inf' ? PALETTE.inf.paper : style === 'tac' ? PALETTE.tac.paper : PALETTE.atlas.paper;
}

const load = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };

export function Palette({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  const [style, setStyle] = useState<StyleId>(() => load('palette.style', 'ustav') as StyleId);
  const [side, setSide] = useState<Side>(() => load('palette.side', 'own') as Side);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>(() => JSON.parse(load('palette.open', '{"maneuver":true}')));
  const [onlyStyle, setOnlyStyle] = useState(() => load('palette.onlyStyle', '0') === '1');

  const found = useMemo(() => searchLibrary(q), [q]);
  const groups = useMemo(() => CATEGORIES.map((c) => ({
    c, items: found.filter((e) => e.category === c.id && (!onlyStyle || e.variants[style])),
  })).filter((g) => g.items.length), [found, onlyStyle, style]);

  const toggle = (id: string) => { const o = { ...open, [id]: !open[id] }; setOpen(o); save('palette.open', JSON.stringify(o)); };
  const pick = (e: LibraryElement) => {
    const v = variantFor(e, style);
    const on = tool.mode === 'draw' && tool.preset === v.preset && tool.element === e.id;
    setTool(on ? { mode: 'select' } : { mode: 'draw', kind: e.kind, preset: v.preset, element: e.id, side: e.sideAware ? side : undefined });
  };
  const searching = q.trim().length > 0;

  return (
    <div className="palette">
      <div className="pal-top">
        <div className="seg" title="Стиль оформления знаков">
          {STYLES.map((s) => (
            <button key={s.id} className={s.id === style ? 'on' : ''} title={s.description}
              onClick={() => { setStyle(s.id); save('palette.style', s.id); }}>{s.short}</button>
          ))}
        </div>
        <div className="seg side" title="Принадлежность: свои — красным, противник — синим, нейтральное — чёрным">
          {([['own', 'Свои'], ['enemy', 'Противник'], ['neutral', 'Нейтр.']] as [Side, string][]).map(([id, n]) => (
            <button key={id} className={`${id}${id === side ? ' on' : ''}`} onClick={() => {
              setSide(id); save('palette.side', id);
              if (tool.mode === 'draw' && tool.side) setTool({ ...tool, side: id });
            }}>{n}</button>
          ))}
        </div>
        <input className="pal-search" placeholder="Поиск знака…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="pal-row">
          <button className={`tool-select${tool.mode === 'select' ? ' on' : ''}`} onClick={() => setTool({ mode: 'select' })}>⬚ Выбор (Esc)</button>
          <label className="muted" title="Показывать только знаки, оформленные в выбранном стиле">
            <input type="checkbox" checked={onlyStyle} onChange={(e) => { setOnlyStyle(e.target.checked); save('palette.onlyStyle', e.target.checked ? '1' : '0'); }} /> только стиль
          </label>
          <a className="muted" href="/library.html" target="_blank" rel="noreferrer" title="Справочник: все знаки с описаниями">справочник ↗</a>
        </div>
      </div>
      <div className="plist">
        {groups.map(({ c, items }) => {
          const isOpen = searching || open[c.id];
          return (
            <div key={c.id} className="pcat">
              <button className="pcat-h" title={c.description} onClick={() => toggle(c.id)}>
                <span>{isOpen ? '▾' : '▸'} {c.name}</span><span className="muted">{items.length}</span>
              </button>
              {isOpen && items.map((e) => {
                const v = variantFor(e, style);
                const on = tool.mode === 'draw' && tool.element === e.id;
                return (
                  <button key={e.id} className={`pitem${on ? ' on' : ''}${v.style !== style ? ' other' : ''}`} title={e.description} onClick={() => pick(e)}>
                    <span className="pv" dangerouslySetInnerHTML={{ __html: presetPreview(e.kind, v.preset, paperFor(v.style), e.sideAware ? side : undefined) }} />
                    <span className="pn">{e.name}{e.verify && <i className="vf" title="Начертание требует сверки с первоисточником">?</i>}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {!groups.length && <div className="muted" style={{ padding: 10 }}>Ничего не найдено</div>}
      </div>
    </div>
  );
}

