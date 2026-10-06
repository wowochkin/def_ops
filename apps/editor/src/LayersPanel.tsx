/**
 * Панель слоёв: видимость, блокировка, прозрачность, порядок, активный слой
 * для новых объектов, перенос объектов между слоями (перетаскиванием),
 * растровые подложки.
 */
import { ask } from './dialogs';
import { useState } from 'react';
import type { ImageOverlay, LayerRole, MapDocument } from '@def-ops/core';
import { newId, addLayer, updateLayer, removeLayer, moveLayer, setFeatureLayer, soloLayer, orderedFeatures, inScaleRange, hasScaleRange, scaleRangeLabel } from '@def-ops/core';
import { ScaleRangeField } from './ScaleRange';
import type { MapEngine } from './engine/types';

const ICON = { arrow: '➤', line: '〰', area: '⬭', symbol: '◆', label: 'T' };
const ROLES: [LayerRole, string][] = [
  ['base', 'основа'], ['front', 'фронт'], ['friendly', 'свои'], ['enemy', 'противник'], ['labels', 'подписи'], ['custom', 'прочее'],
];

interface Props {
  doc: MapDocument;
  setDoc: (d: MapDocument, key?: string) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  selectedOverlay: string | null;
  setSelectedOverlay: (id: string | null) => void;
  activeLayer: string | null;
  setActiveLayer: (id: string | null) => void;
  engine: MapEngine | null;
  /** Текущий масштаб вида «1 : N». */
  viewScale?: number | null;
}

export function LayersPanel(p: Props) {
  const { doc, setDoc, selected, setSelected, activeLayer, setActiveLayer } = p;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const groups = orderedFeatures(doc).reverse(); // сверху — верхний слой

  const moveFeature = (id: string, d: number) => {
    const f = doc.features.find((x) => x.id === id);
    if (!f) return;
    // соседний объект того же слоя
    const same = doc.features.map((x, i) => [x, i] as const).filter(([x]) => x.layerId === f.layerId);
    const k = same.findIndex(([x]) => x.id === id), j = k + d;
    if (j < 0 || j >= same.length) return;
    const a = doc.features.slice();
    const i1 = same[k][1], i2 = same[j][1];
    [a[i1], a[i2]] = [a[i2], a[i1]];
    setDoc({ ...doc, features: a });
  };

  return (
    <div className="layers">
      <div className="sec-h">
        <span>Слои</span>
        <button onClick={() => {
          const top = activeLayer ?? doc.layers[doc.layers.length - 1]?.id;
          const r = addLayer(doc, { name: `Слой ${doc.layers.length + 1}` }, top);
          setDoc(r.doc); setActiveLayer(r.layer.id); setEditing(r.layer.id);
        }}>+ слой</button>
      </div>
      <div className="row active-layer">
        <span className="lbl">Новые объекты в</span>
        <span className="ctl">
          <select value={activeLayer ?? ''} onChange={(e) => setActiveLayer(e.target.value || null)}>
            <option value="">авто (по смыслу знака)</option>
            {[...doc.layers].reverse().map((l) => <option key={l.id} value={l.id} disabled={l.locked}>{l.name}</option>)}
          </select>
        </span>
      </div>
      <div className="ltree">
        {groups.map(({ layer: l, features }) => (
          <div key={l.id}
            className={`lgroup${activeLayer === l.id ? ' active' : ''}${dragOver === l.id ? ' over' : ''}`}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('text/x-feature')) { e.preventDefault(); setDragOver(l.id); } }}
            onDragLeave={() => setDragOver((x) => (x === l.id ? null : x))}
            onDrop={(e) => {
              const fid = e.dataTransfer.getData('text/x-feature');
              setDragOver(null);
              if (fid && !l.locked) setDoc(setFeatureLayer(doc, fid, l.id));
            }}>
            <div className={`lhead${l.visible ? '' : ' hid'}${p.viewScale != null && !inScaleRange(l.scales, p.viewScale) ? ' outscale' : ''}`}>
              <button className="link tw" onClick={() => setOpen({ ...open, [l.id]: !open[l.id] })}>{open[l.id] ? '▾' : '▸'}</button>
              <button className="link" title="Показать/скрыть (Alt+щелчок — только этот слой)"
                onClick={(e) => setDoc(e.altKey ? soloLayer(doc, l.id) : updateLayer(doc, l.id, { visible: !l.visible }))}>{l.visible ? '👁' : '◌'}</button>
              <button className="link" title="Заблокировать (объекты нельзя выделить и править)"
                onClick={() => setDoc(updateLayer(doc, l.id, { locked: !l.locked }))}>{l.locked ? '🔒' : '🔓'}</button>
              {editing === l.id
                ? <input className="lname-edit" autoFocus defaultValue={l.name} onFocus={(e) => e.target.select()}
                  onBlur={(e) => { setDoc(updateLayer(doc, l.id, { name: e.target.value || l.name })); setEditing(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }} />
                : <span className="lname" title="Щелчок — сделать активным, двойной — переименовать"
                  onClick={() => setActiveLayer(activeLayer === l.id ? null : l.id)} onDoubleClick={() => setEditing(l.id)}>
                  {l.name}{l.source ? <i className="muted"> · {l.source.system}</i> : null}
                </span>}
              {hasScaleRange(l.scales) && (
                <span className={`lscale${p.viewScale != null && !inScaleRange(l.scales, p.viewScale) ? ' off' : ''}`}
                  title={`Виден на масштабах ${scaleRangeLabel(l.scales)}${p.viewScale != null && !inScaleRange(l.scales, p.viewScale) ? ' — на текущем скрыт' : ''}`}>⌕</span>
              )}
              <span className="muted cnt">{features.length}</span>
              <button className="link" title="Выше" onClick={() => setDoc(moveLayer(doc, l.id, 1))}>↑</button>
              <button className="link" title="Ниже" onClick={() => setDoc(moveLayer(doc, l.id, -1))}>↓</button>
            </div>
            {open[l.id] && (
              <div className="lbody">
                <div className="row">
                  <span className="lbl">Прозрачность</span>
                  <span className="ctl"><input type="range" min={0} max={1} step={0.05} value={l.opacity}
                    onChange={(e) => setDoc(updateLayer(doc, l.id, { opacity: +e.target.value }), `lop-${l.id}`)} />
                    <span className="muted">{Math.round(l.opacity * 100)}%</span></span>
                </div>
                <ScaleRangeField value={l.scales} current={p.viewScale ?? null} what="слой"
                  onChange={(r) => setDoc(updateLayer(doc, l.id, { scales: r }))} />
                <div className="row">
                  <span className="lbl">Назначение</span>
                  <span className="ctl"><select value={l.role} onChange={(e) => setDoc(updateLayer(doc, l.id, { role: e.target.value as LayerRole }))}>
                    {ROLES.map(([r, n]) => <option key={r} value={r}>{n}</option>)}
                  </select></span>
                </div>
                <div className="btns">
                  <button className="danger" disabled={doc.layers.length < 2} onClick={() => {
                    const others = doc.layers.filter((x) => x.id !== l.id);
                    const target = others[others.length - 1];
                    const keep = features.length > 0 && ask(`Перенести ${features.length} объект(ов) в слой «${target.name}»?\nОтмена — удалить слой вместе с объектами.`);
                    setDoc(removeLayer(doc, l.id, keep ? target.id : null));
                    if (activeLayer === l.id) setActiveLayer(null);
                  }}>Удалить слой</button>
                </div>
                {features.slice().reverse().map((f) => (
                  <div key={f.id} draggable className={`litem${f.id === selected ? ' on' : ''}${f.hidden ? ' hid' : ''}`}
                    onDragStart={(e) => e.dataTransfer.setData('text/x-feature', f.id)}
                    onClick={() => { setSelected(f.id); p.setSelectedOverlay(null); }}>
                    <span className="ic">{ICON[f.kind]}</span>
                    <span className="nm">{f.name || (f.kind === 'label' ? f.text.split('\n')[0] : f.preset) || f.id}</span>
                    <button className="link" title="Выше" onClick={(e) => { e.stopPropagation(); moveFeature(f.id, 1); }}>↑</button>
                    <button className="link" title="Ниже" onClick={(e) => { e.stopPropagation(); moveFeature(f.id, -1); }}>↓</button>
                    <button className="link" title="Видимость" onClick={(e) => { e.stopPropagation(); setDoc({ ...doc, features: doc.features.map((q) => q.id === f.id ? { ...q, hidden: !q.hidden } : q) }); }}>{f.hidden ? '◌' : '●'}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <Overlays {...p} />
    </div>
  );
}

function Overlays({ doc, setDoc, selectedOverlay, setSelectedOverlay, setSelected, engine }: Props) {
  const addOverlay = async (file: File) => {
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
    const img = new Image();
    img.src = url;
    await img.decode();
    // по умолчанию — вписать в текущий вид с сохранением пропорций
    const { width: W, height: H } = engine!.size();
    const s = Math.min((W * 0.8) / img.width, (H * 0.8) / img.height);
    const w = img.width * s, h = img.height * s;
    const x0 = (W - w) / 2, y0 = (H - h) / 2;
    const ll = (x: number, y: number) => engine!.unproject([x, y]);
    const o: ImageOverlay = {
      id: newId('o'), name: file.name, url, opacity: 0.6, visible: true,
      corners: [ll(x0, y0), ll(x0 + w, y0), ll(x0 + w, y0 + h), ll(x0, y0 + h)],
    };
    setDoc({ ...doc, overlays: [...doc.overlays, o] });
    setSelectedOverlay(o.id);
  };
  const updOv = (id: string, q: Partial<ImageOverlay>, key?: string) =>
    setDoc({ ...doc, overlays: doc.overlays.map((o) => (o.id === id ? { ...o, ...q } : o)) }, key);
  return (
    <>
      <div className="sec-h"><span>Подложки-изображения</span>
        <label className="filebtn">+ файл<input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f && engine) addOverlay(f); e.target.value = ''; }} /></label>
      </div>
      {doc.overlays.map((o) => (
        <div key={o.id} className={`ovitem${o.id === selectedOverlay ? ' on' : ''}`}>
          <div className="litem" onClick={() => { setSelectedOverlay(o.id === selectedOverlay ? null : o.id); setSelected(null); }}>
            <span className="ic">▣</span><span className="nm">{o.name}</span>
            <button className="link" onClick={(e) => { e.stopPropagation(); updOv(o.id, { visible: !o.visible }); }}>{o.visible ? '👁' : '◌'}</button>
            <button className="link" onClick={(e) => { e.stopPropagation(); setDoc({ ...doc, overlays: doc.overlays.filter((q) => q.id !== o.id) }); }}>✕</button>
          </div>
          {o.id === selectedOverlay && (
            <div className="ovctl">
              <input type="range" min={0} max={1} step={0.05} value={o.opacity} onChange={(e) => updOv(o.id, { opacity: +e.target.value }, `ovo-${o.id}`)} />
              <span className="muted">Тяните углы на карте для привязки</span>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

