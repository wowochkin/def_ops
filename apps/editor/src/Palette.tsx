/** Палитра знаков: пресеты по стилям оформления и типам объектов. */
import { useMemo, useState } from 'react';
import { PRESETS, PALETTE, type PresetKind } from '@def-ops/core';
import type { Tool } from './store';
import { presetPreview } from './previews';

const GROUPS = [
  { id: 'Инфографика', paper: PALETTE.inf.paper },
  { id: 'Атлас', paper: PALETTE.atlas.paper },
  { id: 'Тактика', paper: PALETTE.tac.paper },
];
const KINDS: [PresetKind, string, string][] = [
  ['arrow', 'Стрелки', 'Клик — точки оси (первый клик у линии фронта привязывает хвост), двойной клик/Enter — готово'],
  ['line', 'Линии и рубежи', 'Клик — точки, двойной клик/Enter — готово'],
  ['area', 'Районы', 'Клик — точки контура, двойной клик/Enter — замкнуть'],
  ['symbol', 'Знаки', 'Клик — поставить'],
  ['label', 'Надписи', 'Клик — поставить и ввести текст'],
];

export function Palette({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  const [group, setGroup] = useState(() => localStorage.getItem('palette.group') || 'Атлас');
  const g = GROUPS.find((x) => x.id === group) ?? GROUPS[0];
  const items = useMemo(() => KINDS.map(([kind, title, hint]) => ({
    kind, title, hint,
    presets: Object.entries(PRESETS[kind] as Record<string, { name: string; group: string }>).filter(([, p]) => p.group === g.id),
  })), [g.id]);
  return (
    <div className="palette">
      <div className="tabs">
        {GROUPS.map((x) => (
          <button key={x.id} className={x.id === g.id ? 'on' : ''} onClick={() => { setGroup(x.id); try { localStorage.setItem('palette.group', x.id); } catch { /* */ } }}>{x.id}</button>
        ))}
      </div>
      <button className={`tool-select${tool.mode === 'select' ? ' on' : ''}`} onClick={() => setTool({ mode: 'select' })}>⬚ Выбор и правка (Esc)</button>
      <div className="plist">
        {items.map((it) => it.presets.length > 0 && (
          <div key={it.kind}>
            <div className="pkind" title={it.hint}>{it.title}</div>
            {it.presets.map(([id, p]) => {
              const on = tool.mode === 'draw' && tool.preset === id && tool.kind === it.kind;
              return (
                <button key={id} className={`pitem${on ? ' on' : ''}`} title={it.hint} onClick={() => setTool(on ? { mode: 'select' } : { mode: 'draw', kind: it.kind, preset: id })}>
                  <span className="pv" dangerouslySetInnerHTML={{ __html: presetPreview(it.kind, id, g.paper) }} />
                  <span className="pn">{p.name}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
