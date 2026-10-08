/**
 * Палитра знаков: библиотека по логическим категориям.
 * Сверху — оформление (уставное или по образцу карты), принадлежность, поиск.
 * Каждый элемент показан в выбранном оформлении (или в ближайшем доступном).
 */

import { useMemo, useState } from 'react';
import { CATEGORIES, STYLES, PALETTE, variantFor, searchLibrary, sourceText, type StyleId, type Side, type LibraryElement } from '@def-ops/core';
import type { Tool } from './store';
import { presetPreview } from './previews';

/** Цвет «бумаги» миниатюры — по пресету (или варианту оформления): у образцов он свой. */
export function paperFor(styleOrPreset: string): string {
  const p = styleOrPreset.split('.')[0];
  return p === 'inf' ? PALETTE.inf.paper : p === 'tac' ? PALETTE.tac.paper : PALETTE.atlas.paper;
}

const load = (k: string, d: string) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };

export function Palette({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  const [style, setStyle] = useState<StyleId>(() => {
    const v = load('palette.style', 'rkka');
    return (STYLES.some((s) => s.id === v) ? v : v === 'tac' ? 'atlas' : 'rkka') as StyleId;
  });
  const [side, setSide] = useState<Side>(() => load('palette.side', 'own') as Side);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>(() => JSON.parse(load('palette.open.v2', '{}')));
  const [onlyStyle, setOnlyStyle] = useState(() => load('palette.onlyStyle', '0') === '1');
  const [series, setSeries] = useState(() => load('palette.series', '0') === '1');
  /** Недавние знаки — сверху палитры (последние 8). */
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(load('palette.recent', '[]')); } catch { return []; } });

  const found = useMemo(() => searchLibrary(q), [q]);
  const groups = useMemo(() => CATEGORIES.map((c) => ({
    c, items: found.filter((e) => e.category === c.id && (!onlyStyle || e.variants[style])),
  })).filter((g) => g.items.length), [found, onlyStyle, style]);

  const toggle = (id: string) => { const o = { ...open, [id]: !open[id] }; setOpen(o); save('palette.open.v2', JSON.stringify(o)); };
  const pick = (e: LibraryElement) => {
    const v = variantFor(e, style);
    const on = tool.mode === 'draw' && tool.preset === v.preset && tool.element === e.id;
    setTool(on ? { mode: 'select' } : { mode: 'draw', kind: e.kind, preset: v.preset, element: e.id, side: e.sideAware ? side : undefined, keep: series });
    if (!on) { const r = [e.id, ...recent.filter((x) => x !== e.id)].slice(0, 8); setRecent(r); save('palette.recent', JSON.stringify(r)); }
  };
  const searching = q.trim().length > 0;
  const styleName = STYLES.find((x) => x.id === style)?.short ?? style;
  const current = tool.mode === 'draw' ? found.find((e) => e.id === tool.element) ?? searchLibrary('').find((e) => e.id === tool.element) : undefined;
  const hint = (k: string | undefined) => k === 'symbol' || k === 'label' ? 'щёлкните на карте, чтобы поставить' : 'щёлкайте точки; двойной щелчок или Enter — закончить';
  const recentItems = recent.map((id) => found.find((e) => e.id === id)).filter((e): e is LibraryElement => !!e && (!onlyStyle || !!e.variants[style]));
  const tile = (e: LibraryElement) => {
    const v = variantFor(e, style);
    const on = tool.mode === 'draw' && tool.element === e.id;
    return (
      <button key={e.id} className={`ptile${on ? ' on' : ''}${v.style !== style ? ' other' : ''}`} title={e.sources ? `${e.name}\n\n${e.description}\nИсточник: ${sourceText(e.sources)}` : `${e.name}\n\n${e.description}`} onClick={() => pick(e)}>
        <span className="pv" style={{ background: paperFor(v.preset) }} dangerouslySetInnerHTML={{ __html: presetPreview(e.kind, v.preset, paperFor(v.preset), e.sideAware ? side : undefined, e.kind === 'symbol') }} />
        <span className="pn">{e.verify && <i className="vf" title="Начертание не подтверждено первоисточниками — сверить">?</i>}{e.name}</span>
        {v.style !== style && <span className="pfrom" title="В выбранном оформлении этого знака нет — показан в ближайшем">{STYLES.find((x) => x.id === v.style)?.short ?? v.style}</span>}
      </button>
    );
  };

  return (
    <div className="palette">
      <div className="pal-top">
        <div className="seg" title="Оформление знаков: уставное (по таблице РККА) или по образцу карты">
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
        <label className="pal-search-w">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
          <input className="pal-search" placeholder="Поиск: танк, мост, котёл…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="link" onClick={() => setQ('')} title="Очистить">✕</button>}
        </label>
        <div className={`pal-mode${tool.mode === 'draw' ? ' drawing' : ''}`}>
          {tool.mode === 'draw'
            ? <>
              <span className="pm-dot" />
              <span className="pm-text">Рисуете: <b>{current?.name ?? 'знак'}</b><small>{hint(tool.kind)}</small></span>
              <button onClick={() => setTool({ mode: 'select' })} title="Закончить рисование (Esc)">Готово</button>
            </>
            : <span className="pm-text">Выбор и правка<small>Щёлкните знак на карте, чтобы изменить. Чтобы рисовать — выберите знак ниже.</small></span>}
        </div>
        <label className="sw" title="После того как знак поставлен, можно сразу ставить следующий такой же. Выключено — после каждого знака возврат к выбору и правке">
          <input type="checkbox" checked={series} onChange={(e) => {
            setSeries(e.target.checked); save('palette.series', e.target.checked ? '1' : '0');
            if (tool.mode === 'draw') setTool({ ...tool, keep: e.target.checked });
          }} /><i />Рисовать несколько подряд
        </label>
        <label className="sw" title={`Показывать только знаки, у которых есть начертание в оформлении «${styleName}». Выключено — остальные знаки показаны в ближайшем оформлении, с пометкой`}>
          <input type="checkbox" checked={onlyStyle} onChange={(e) => { setOnlyStyle(e.target.checked); save('palette.onlyStyle', e.target.checked ? '1' : '0'); }} /><i />Только в оформлении «{styleName}»
        </label>
      </div>
      <div className="plist">
        {!searching && recentItems.length > 0 && (
          <div className="pcat">
            <div className="pcat-h static"><span>Недавние</span></div>
            <div className="pgrid">{recentItems.map(tile)}</div>
          </div>
        )}
        {groups.map(({ c, items }) => {
          const isOpen = searching || open[c.id];
          return (
            <div key={c.id} className="pcat">
              <button className={`pcat-h${isOpen ? ' open' : ''}`} title={c.description} onClick={() => toggle(c.id)}>
                <span><i className="chev">{isOpen ? '▾' : '▸'}</i>{c.name}</span><span className="cnt">{items.length}</span>
              </button>
              {isOpen && <div className="pgrid">{items.map(tile)}</div>}
            </div>
          );
        })}
        {!groups.length && <div className="muted" style={{ padding: 10 }}>Ничего не найдено</div>}
      </div>
    </div>
  );
}

