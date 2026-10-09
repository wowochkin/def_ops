/** Общие элементы интерфейса: всплывающее меню, выбор подложки, значки разделов. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { newId } from '@def-ops/core';
import { askText } from './dialogs';
import { isValidTemplate } from './engine/basemaps';
import type { Basemaps } from './shared';

/** Кнопка со всплывающей панелью (закрывается щелчком вне её и Esc). */
export function Popover({ label, title, children, align = 'left', className = '' }: { label: ReactNode; title?: string; children: ReactNode | ((close: () => void) => ReactNode); align?: 'left' | 'right'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const close = () => setOpen(false);
  return (
    <div className={`pop ${className}`} ref={ref}>
      <button className={`pop-btn${open ? ' on' : ''}`} title={title} onClick={() => setOpen(!open)}>{label}</button>
      {open && <div className={`pop-body ${align}`}>{typeof children === 'function' ? children(close) : children}</div>}
    </div>
  );
}

/** Подложка: выбор, прозрачность, офлайн, своя XYZ/WMS. */
export function BasemapControls({ bm }: { bm: Basemaps }) {
  return (
    <div className="bm">
      <div className="pop-title">Подложка</div>
      <div className="bm-list">
        <label className={`bm-item${bm.id === 'none' ? ' on' : ''}`}><input type="radio" checked={bm.id === 'none'} onChange={() => bm.setId('none')} /> без подложки (бумага)</label>
        {bm.local.length > 0 && <div className="pop-sub">Локальные (работают без интернета)</div>}
        {bm.local.map((b) => <label key={b.id} className={`bm-item${bm.id === b.id ? ' on' : ''}`}><input type="radio" checked={bm.id === b.id} onChange={() => bm.setId(b.id)} /> {b.name}</label>)}
        {!bm.offline && <div className="pop-sub">Интернет</div>}
        {!bm.offline && bm.all.filter((b) => !b.id.startsWith('local-')).map((b) => <label key={b.id} className={`bm-item${bm.id === b.id ? ' on' : ''}`}><input type="radio" checked={bm.id === b.id} onChange={() => bm.setId(b.id)} /> {b.name}</label>)}
      </div>
      {bm.current && <label className="bm-row">Прозрачность <input type="range" min={0} max={1} step={0.05} value={bm.opacity} onChange={(e) => bm.setOpacity(+e.target.value)} /></label>}
      <div className="bm-row">
        <label title="Только локальные карты, без обращений в интернет"><input type="checkbox" checked={bm.offline} onChange={(e) => bm.setOffline(e.target.checked)} /> офлайн</label>
        {!bm.offline && <button className="link" onClick={() => {
          const name = askText('Название подложки:', 'Моя карта');
          if (!name) return;
          const url = askText('Шаблон адреса тайлов XYZ, например https://server/{z}/{x}/{y}.png\n(или WMS с {bbox-epsg-3857}):', '');
          if (!url || !isValidTemplate(url)) { if (url) alert('Нужен адрес с {z}/{x}/{y}, {quadkey} или {bbox-epsg-3857}'); return; }
          bm.addCustom({ id: 'custom-' + newId('b'), name, tiles: [url], tileSize: 256 });
        }}>+ своя XYZ / WMS…</button>}
      </div>
    </div>
  );
}

/** Значки разделов (линейные, 20×20). */
export const Icon = {
  editor: <svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></svg>,
  replay: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M10 8.5v7l5.5-3.5z" /></svg>,
  maps: <svg viewBox="0 0 24 24"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z" /><path d="M9 4v13.5M15 6.5V20" /></svg>,
  library: <svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><path d="M13.5 16.5h6M16.5 13.5v6" /></svg>,
  staff: <svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="11" rx="3" /><path d="M12 7V4M9 12h.01M15 12h.01M9.5 15.5h5" /></svg>,
  knowledge: <svg viewBox="0 0 24 24"><path d="M4 5.5C6.5 4.5 9.5 4.5 12 6v13c-2.5-1.5-5.5-1.5-8-.5z" /><path d="M20 5.5c-2.5-1-5.5-1-8 .5v13c2.5-1.5 5.5-1.5 8-.5z" /></svg>,
  modeling: <svg viewBox="0 0 24 24"><path d="M4 19.5h16" /><path d="M5 16l4-5 3.5 3 3-6L20 11" /><circle cx="9" cy="11" r="1" /><circle cx="15.5" cy="8" r="1" /></svg>,
  help: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.4M12 16.5h.01" /></svg>,
  layers: <svg viewBox="0 0 24 24"><path d="M12 4l8.5 4.5L12 13 3.5 8.5z" /><path d="M3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5" /></svg>,
};

/**
 * Выбор модели на сервере: модели и их варианты (4bit / 8bit — «имя@вариант»), загружена ли, квантование;
 * «другое имя…» — вписать вручную (например, имя, под которым модель загружена).
 */
export function ModelSelect({ value, onChange, check, empty, title }: {
  value: string; onChange: (v: string) => void; empty: string; title?: string;
  check: { state: string; models?: string[]; info?: Record<string, { quant?: string; loaded?: boolean; variants?: string[]; selected?: string; instances?: string[]; instanceOf?: string }> };
}) {
  const models = check.models ?? [];
  const info = (m: string) => check.info?.[m];
  // загруженные — отвечают сразу; базовая модель, загруженная под другими именами, — среди скачанных со ссылкой на них
  const loaded = models.filter((m) => info(m)?.loaded && !info(m)?.instances?.length);
  const disk = models.filter((m) => !loaded.includes(m));
  const label = (m: string) => {
    const i = info(m);
    if (loaded.includes(m)) return `${m}${i?.quant ? ` — ${i.quant}` : ''}${i?.instanceOf ? ` (${i.instanceOf})` : ''}`;
    const q = i?.selected ?? i?.quant;
    const other = (i?.variants ?? []).filter((v) => v !== q);
    return `${m}${q ? ` — ${q}` : ''}${other.length ? ` (в LM Studio выбран ${q}; есть ${other.join(', ')})` : ''}${i?.instances?.length ? ` · загружена как ${i.instances.join(', ')}` : ''}`;
  };
  return (
    <select value={value} title={title} onChange={(e) => {
      if (e.target.value !== '__other') { onChange(e.target.value); return; }
      const v = window.prompt('Имя модели на сервере — как в списке /v1/models или идентификатор загруженного экземпляра (например, qwen-8bit после «lms load … --identifier qwen-8bit»):', value);
      if (v != null) onChange(v.trim());
    }}>
      <option value="">{empty}</option>
      {loaded.length > 0 && <optgroup label="Загружены — отвечают сразу">{loaded.map((m) => <option key={m} value={m}>{label(m)}</option>)}</optgroup>}
      {disk.length > 0 && <optgroup label={loaded.length ? 'Скачаны — LM Studio загрузит по запросу' : 'Модели'}>{disk.map((m) => <option key={m} value={m}>{label(m)}</option>)}</optgroup>}
      {value && !models.includes(value) && <option value={value}>{value} (нет на сервере)</option>}
      <option value="__other">другое имя…</option>
    </select>
  );
}
