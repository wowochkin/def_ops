/** Список объектов (порядок отрисовки) и растровых подложек. */
import type { ImageOverlay, MapDocument } from '../core/model';
import { newId } from '../core/model';
import type { Map as MlMap } from 'maplibre-gl';

const ICON = { arrow: '➤', line: '〰', area: '⬭', symbol: '◆', label: 'T' };

interface Props {
  doc: MapDocument;
  setDoc: (d: MapDocument, key?: string) => void;
  selected: string | null;
  setSelected: (id: string | null) => void;
  selectedOverlay: string | null;
  setSelectedOverlay: (id: string | null) => void;
  map: MlMap | null;
}

export function LayersPanel({ doc, setDoc, selected, setSelected, selectedOverlay, setSelectedOverlay, map }: Props) {
  const move = (id: string, d: number) => {
    const a = doc.features.slice();
    const i = a.findIndex((f) => f.id === id), j = i + d;
    if (i < 0 || j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    setDoc({ ...doc, features: a });
  };
  const addOverlay = async (file: File) => {
    const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
    const img = new Image();
    img.src = url;
    await img.decode();
    // по умолчанию — вписать в текущий вид с сохранением пропорций
    const c = map!.getContainer();
    const W = c.clientWidth, H = c.clientHeight;
    const s = Math.min(W * 0.8 / img.width, H * 0.8 / img.height);
    const w = img.width * s, h = img.height * s;
    const x0 = (W - w) / 2, y0 = (H - h) / 2;
    const ll = (x: number, y: number): [number, number] => { const p = map!.unproject([x, y]); return [p.lng, p.lat]; };
    const o: ImageOverlay = {
      id: newId('o'), name: file.name, url, opacity: 0.6, visible: true,
      corners: [ll(x0, y0), ll(x0 + w, y0), ll(x0 + w, y0 + h), ll(x0, y0 + h)],
    };
    setDoc({ ...doc, overlays: [...doc.overlays, o] });
    setSelectedOverlay(o.id);
  };
  const updOv = (id: string, p: Partial<ImageOverlay>, key?: string) =>
    setDoc({ ...doc, overlays: doc.overlays.map((o) => (o.id === id ? { ...o, ...p } : o)) }, key);

  return (
    <div className="layers">
      <div className="sec-h"><span>Объекты ({doc.features.length})</span><span className="muted">сверху — поверх</span></div>
      <div className="llist">
        {doc.features.slice().reverse().map((f) => (
          <div key={f.id} className={`litem${f.id === selected ? ' on' : ''}${f.hidden ? ' hid' : ''}`} onClick={() => { setSelected(f.id); setSelectedOverlay(null); }}>
            <span className="ic">{ICON[f.kind]}</span>
            <span className="nm">{f.name || (f.kind === 'label' ? f.text.split('\n')[0] : f.preset) || f.id}</span>
            <button className="link" title="Выше" onClick={(e) => { e.stopPropagation(); move(f.id, 1); }}>↑</button>
            <button className="link" title="Ниже" onClick={(e) => { e.stopPropagation(); move(f.id, -1); }}>↓</button>
            <button className="link" title="Видимость" onClick={(e) => { e.stopPropagation(); setDoc({ ...doc, features: doc.features.map((q) => q.id === f.id ? { ...q, hidden: !q.hidden } : q) }); }}>{f.hidden ? '◌' : '●'}</button>
          </div>
        ))}
      </div>
      <div className="sec-h"><span>Подложки-изображения</span>
        <label className="filebtn">+ файл<input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f && map) addOverlay(f); e.target.value = ''; }} /></label>
      </div>
      {doc.overlays.map((o) => (
        <div key={o.id} className={`ovitem${o.id === selectedOverlay ? ' on' : ''}`}>
          <div className="litem" onClick={() => { setSelectedOverlay(o.id === selectedOverlay ? null : o.id); setSelected(null); }}>
            <span className="ic">▣</span><span className="nm">{o.name}</span>
            <button className="link" onClick={(e) => { e.stopPropagation(); updOv(o.id, { visible: !o.visible }); }}>{o.visible ? '●' : '◌'}</button>
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
    </div>
  );
}
