import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import type { MapDocument } from '../core/model';
import { emptyDocument, newId } from '../core/model';
import { useHistory, removeFeature, insertFeature, type Tool } from './store';
import { MapView, type Basemap } from './MapView';
import { Palette } from './Palette';
import { Inspector } from './Inspector';
import { LayersPanel } from './LayersPanel';
import { translateFeature } from './geometry';
import { download, exportPNG, svgWithFonts } from './exporting';
import { SCENES } from '../demo/scenes';

const STORAGE = 'def_ops.doc.v1';

function loadInitial(): MapDocument {
  try {
    const s = localStorage.getItem(STORAGE);
    if (s) return JSON.parse(s);
  } catch { /* */ }
  return SCENES[0].build();
}

export function App() {
  const { doc, set, undo, redo, reset, canUndo, canRedo } = useHistory(loadInitial());
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>({ mode: 'select' });
  const [basemap, setBasemap] = useState<Basemap>(() => (localStorage.getItem('def_ops.basemap') as Basemap) || 'none');
  const [basemapOpacity, setBasemapOpacity] = useState(0.55);
  const [status, setStatus] = useState('');
  const [mapKey, setMapKey] = useState(0);
  const mapRef = useRef<MlMap | null>(null);
  const [map, setMap] = useState<MlMap | null>(null);

  // автосохранение
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem(STORAGE, JSON.stringify(doc)); } catch { /* слишком большой документ */ } }, 400);
    return () => clearTimeout(t);
  }, [doc]);
  useEffect(() => { try { localStorage.setItem('def_ops.basemap', basemap); } catch { /* */ } }, [basemap]);

  const loadDoc = (d: MapDocument) => {
    reset(d);
    setSelected(null);
    setSelectedOverlay(null);
    setMapKey((k) => k + 1); // пересоздать карту с видом документа
  };

  const saveView = () => {
    const m = mapRef.current;
    if (!m) return doc;
    const c = m.getCenter();
    return { ...doc, view: { center: [c.lng, c.lat] as [number, number], zoom: m.getZoom(), bearing: m.getBearing() } };
  };

  // горячие клавиши
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if ((e.key === 'Delete' || (e.key === 'Backspace' && tool.mode === 'select')) && selected) { set(removeFeature(doc, selected)); setSelected(null); }
      else if (mod && e.key.toLowerCase() === 'd' && selected) {
        e.preventDefault();
        const f = doc.features.find((q) => q.id === selected);
        if (!f) return;
        const copy = translateFeature(doc, { ...structuredClone(f), id: newId(f.kind[0]) }, [12, 12]);
        set(insertFeature(doc, copy));
        setSelected(copy.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, selected, tool, set, undo, redo]);

  const sel = doc.features.find((f) => f.id === selected) ?? null;

  const openFile = async (file: File) => {
    try {
      const d = JSON.parse(await file.text()) as MapDocument;
      if (d.version !== 1 || !Array.isArray(d.features)) throw new Error('не документ тактической карты');
      loadDoc(d);
    } catch (e) { alert('Не удалось открыть файл: ' + (e as Error).message); }
  };

  return (
    <div className="app">
      <header>
        <b className="brand">Тактическая карта</b>
        <input className="docname" value={doc.name} onChange={(e) => set({ ...doc, name: e.target.value }, 'docname')} />
        <span className="sep" />
        <button disabled={!canUndo} onClick={undo} title="Ctrl+Z">↶</button>
        <button disabled={!canRedo} onClick={redo} title="Ctrl+Shift+Z">↷</button>
        <span className="sep" />
        <select value="" onChange={(e) => {
          const v = e.target.value;
          if (v === 'new') { if (confirm('Создать пустую карту? Несохранённые изменения будут потеряны.')) { const m = mapRef.current; const c = m?.getCenter(); loadDoc(emptyDocument(c ? [c.lng, c.lat] : undefined, m?.getZoom())); } }
          const s = SCENES.find((x) => x.id === v);
          if (s && confirm(`Открыть пример «${s.name}»? Текущая карта будет заменена.`)) loadDoc(s.build());
        }}>
          <option value="">Файл / примеры…</option>
          <option value="new">Новая пустая карта</option>
          {SCENES.map((s) => <option key={s.id} value={s.id}>Пример: {s.name}</option>)}
        </select>
        <label className="filebtn">Открыть…<input type="file" accept=".json,application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} /></label>
        <button onClick={() => download(`${doc.name || 'map'}.json`, JSON.stringify(saveView(), null, 1), 'application/json')}>Сохранить</button>
        <button onClick={async () => download(`${doc.name || 'map'}.svg`, await svgWithFonts(doc, doc.paper), 'image/svg+xml')}>SVG</button>
        <button onClick={async () => download(`${doc.name || 'map'}.png`, await exportPNG(doc, doc.paper, 2))}>PNG</button>
        <span className="sep" />
        <label className="inl">Подложка
          <select value={basemap} onChange={(e) => setBasemap(e.target.value as Basemap)}>
            <option value="none">нет (бумага)</option>
            <option value="osm">OpenStreetMap</option>
            <option value="topo">OpenTopoMap</option>
            <option value="esri">Спутник (Esri)</option>
          </select>
        </label>
        {basemap !== 'none' && <input type="range" min={0} max={1} step={0.05} value={basemapOpacity} onChange={(e) => setBasemapOpacity(+e.target.value)} title="Прозрачность подложки" />}
        <label className="inl">Бумага <input type="color" value={doc.paper} onChange={(e) => set({ ...doc, paper: e.target.value }, 'paper')} /></label>
        <span className="status">{status}</span>
      </header>
      <aside className="left"><Palette tool={tool} setTool={(t) => { setTool(t); if (t.mode === 'draw') setSelected(null); }} /></aside>
      <main>
        <MapView key={mapKey} doc={doc} setDoc={set} selected={selected} setSelected={setSelected} selectedOverlay={selectedOverlay}
          tool={tool} setTool={setTool} basemap={basemap} basemapOpacity={basemapOpacity}
          onMapReady={(m) => { mapRef.current = m; setMap(m); (window as unknown as { __map: MlMap }).__map = m; }} onStatus={setStatus} />
        {tool.mode === 'draw' && (
          <div className="hintbar">
            {tool.kind === 'arrow' ? 'Стрелка: щёлкайте точки оси от хвоста к острию. Первый щелчок у линии фронта/контура — хвост привяжется (Alt — без привязки). ' : ''}
            {tool.kind === 'symbol' || tool.kind === 'label' ? 'Щёлкните на карте, чтобы поставить. ' : 'Двойной щелчок или Enter — завершить, Backspace — убрать точку, Esc — отмена.'}
          </div>
        )}
      </main>
      <aside className="right">
        {sel ? <Inspector doc={doc} setDoc={set} feature={sel} onDeselect={() => setSelected(null)} />
          : <div className="help">
            <h3>Как работать</h3>
            <ul>
              <li>Слева выберите стиль (Инфографика / Атлас / Тактика) и знак — затем рисуйте на карте.</li>
              <li><b>Стрелки</b> строятся по оси от хвоста к острию. Если начать у линии или контура (фронт, рубеж), хвост <b>крепится к линии</b>: основание идёт вдоль неё и следует за ней при правке.</li>
              <li>В режиме выбора: тяните объект целиком, его узлы (квадраты), «+» на серединах — добавить узел, двойной щелчок по узлу — удалить.</li>
              <li>Круглые ручки стрелки — ширина хвоста и размах/стреловидность наконечника.</li>
              <li>Подложка-изображение (скан карты) помогает переносить обстановку: привяжите её за углы и обводите.</li>
              <li>Ctrl+Z / Ctrl+Shift+Z — отмена/повтор, Ctrl+D — дублировать, Del — удалить.</li>
            </ul>
          </div>}
        <LayersPanel doc={doc} setDoc={set} selected={selected} setSelected={setSelected}
          selectedOverlay={selectedOverlay} setSelectedOverlay={setSelectedOverlay} map={map} />
      </aside>
    </div>
  );
}
