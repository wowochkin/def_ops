import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapDocument, GeoJSONCollection } from '@def-ops/core';
import { emptyDocument, newId, migrateDocument, toGeoJSON, fromGeoJSON, zoomFactor, documentAt, type TimeInstant } from '@def-ops/core';
import { DefOpsClient, ApiError, type DocumentMeta } from '@def-ops/api-client';
import { useHistory, removeFeature, insertFeature, type Tool } from './store';
import { MapView } from './MapView';
import { Palette } from './Palette';
import { Inspector } from './Inspector';
import { LayersPanel } from './LayersPanel';
import { Timeline } from './Timeline';
import { EntityPanel, type RegistryApi } from './EntityPanel';
import { translateFeature } from './geometry';
import { download, exportPNG, svgWithFonts } from './exporting';
import type { BasemapSpec, MapEngine } from './engine/types';
import { BUILTIN_BASEMAPS, loadCustomBasemaps, saveCustomBasemaps, isValidTemplate } from './engine/basemaps';
import { SCENES } from '../demo/scenes';

const STORAGE = 'def_ops.doc.v1';
const api = new DefOpsClient({ baseUrl: '/api', apiKey: localStorage.getItem('def_ops.apiKey') || undefined, sourceSystem: 'editor' });

function loadInitial(): MapDocument {
  try {
    const s = localStorage.getItem(STORAGE);
    if (s) return migrateDocument(JSON.parse(s));
  } catch { /* повреждённое автосохранение — начинаем с примера */ }
  return SCENES[0].build();
}

function loadInitialTime(): TimeInstant | null {
  try { return localStorage.getItem(STORAGE + '.time') || null; } catch { return null; }
}

/** Реестр через клиент API (в форме, нужной панели объекта). */
const registryApi: RegistryApi = {
  types: () => api.registry.types(),
  search: async (q, o = {}) => (await api.registry.entities.list({ q: q || undefined, type: o.type, at: o.at ?? undefined, limit: o.limit }))
    .map(({ state, ...entity }) => ({ entity, state })),
  get: (id, at) => api.registry.entities.get(id, at ?? undefined),
  create: (e) => api.registry.entities.create(e),
  update: (id, patch) => api.registry.entities.update(id, patch),
  facts: (id) => api.registry.facts.list(id),
  addFact: (id, f) => api.registry.facts.add(id, f),
  removeFact: (id, factId) => api.registry.facts.remove(id, factId),
  subscribe: (fn) => api.registry.subscribe(fn),
};

type ServerState = { status: 'unknown' | 'online' | 'offline'; services?: Record<string, string> };

export function App() {
  const { doc, set, undo, redo, reset, canUndo, canRedo } = useHistory(loadInitial());
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>({ mode: 'select' });
  const [activeLayer, setActiveLayer] = useState<string | null>(null);
  const [basemapId, setBasemapId] = useState<string>(() => localStorage.getItem('def_ops.basemap') || 'none');
  const [customBasemaps, setCustomBasemaps] = useState<BasemapSpec[]>(loadCustomBasemaps);
  const [basemapOpacity, setBasemapOpacity] = useState(0.55);
  const [status, setStatus] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [mapKey, setMapKey] = useState(0);
  const [engine, setEngine] = useState<MapEngine | null>(null);
  const [server, setServer] = useState<ServerState>({ status: 'unknown' });
  const [serverList, setServerList] = useState<DocumentMeta[] | null>(null);
  /** Момент, на который показана обстановка (null — все знаки без учёта времени). */
  const [time, setTime] = useState<TimeInstant | null>(() => loadInitialTime());
  const [newFromNow, setNewFromNow] = useState(true);
  /** Документ в том виде, в каком он последний раз сохранён на сервере / получен с него. */
  const syncedRef = useRef<MapDocument | null>(null);

  const basemaps = useMemo(() => [...BUILTIN_BASEMAPS, ...customBasemaps], [customBasemaps]);
  const basemap = basemaps.find((b) => b.id === basemapId) ?? null;

  // автосохранение в браузере
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem(STORAGE, JSON.stringify(doc)); localStorage.setItem(STORAGE + '.time', time ?? ''); } catch { /* слишком большой документ */ } }, 400);
    return () => clearTimeout(t);
  }, [doc, time]);
  useEffect(() => { try { localStorage.setItem('def_ops.basemap', basemapId); } catch { /* */ } }, [basemapId]);
  useEffect(() => { if (notice) { const t = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(t); } }, [notice]);

  // доступность платформы
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const h = await api.health();
      if (alive) setServer(h ? { status: 'online', services: h.services } : { status: 'offline' });
    };
    check();
    const t = setInterval(check, 20000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // живые обновления: документ изменён на сервере другим пользователем или системой
  const live = useRef({ doc, reset });
  live.current = { doc, reset };
  useEffect(() => {
    if (server.status !== 'online' || !doc.id) return;
    return api.subscribe(async (e) => {
      const cur = live.current.doc;
      if (e.documentId !== cur.id || (e.revision ?? 0) <= (cur.revision ?? 0)) return;
      const clean = syncedRef.current && JSON.stringify(stripMeta(syncedRef.current)) === JSON.stringify(stripMeta(cur));
      if (e.type === 'document.deleted') { setNotice('Карта удалена на сервере.'); return; }
      if (clean) {
        const fresh = migrateDocument(await api.documents.get(cur.id!));
        syncedRef.current = fresh;
        live.current.reset({ ...fresh, view: cur.view });
        setNotice(`Карта обновлена на сервере${e.source ? ` (${e.source})` : ''}: ревизия ${fresh.revision}.`);
      } else {
        setNotice(`На сервере новая ревизия ${e.revision}${e.source ? ` (${e.source})` : ''}. У вас есть несохранённые изменения — при сохранении будет предложено решить конфликт.`);
      }
    }, doc.id);
  }, [server.status, doc.id]);

  const loadDoc = (d: MapDocument, synced = false) => {
    reset(d);
    setTime(d.timeline?.current ?? null);
    syncedRef.current = synced ? d : null;
    setSelected(null);
    setSelectedOverlay(null);
    setActiveLayer(null);
    setMapKey((k) => k + 1); // пересоздать карту с видом документа
  };

  /** Документ для сохранения: вид карты и текущий момент шкалы времени. */
  const withView = (): MapDocument => {
    const d = doc.timeline ? { ...doc, timeline: { ...doc.timeline, current: time } } : doc;
    return engine ? { ...d, view: engine.getView() } : d;
  };
  /** Документ на момент шкалы — для экспорта «как на экране». */
  const atTime = () => documentAt(doc, time);

  // горячие клавиши
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveToServer(); }
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
  });

  const sel = doc.features.find((f) => f.id === selected) ?? null;

  /* ------------------------------ файлы ------------------------------ */
  const openFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (data?.type === 'FeatureCollection') return importGeoJSON(data);
      loadDoc(migrateDocument(data));
    } catch (e) { alert('Не удалось открыть файл: ' + (e as Error).message); }
  };
  const importGeoJSON = (fc: GeoJSONCollection) => {
    const k = engine ? zoomFactor(doc, engine.getView().zoom) : 1;
    const r = fromGeoJSON(doc, fc, { layerId: activeLayer ?? undefined, scale: k });
    set(r.doc);
    setNotice(`Импортировано объектов: ${r.added.length}`);
  };

  /* ------------------------------ сервер ------------------------------ */
  const saveToServer = async () => {
    if (server.status !== 'online') { setNotice('Сервер недоступен — карта сохранена только в браузере.'); return; }
    try {
      const d = withView();
      let out: MapDocument;
      if (!d.id) out = await api.documents.create(d);
      else {
        try { out = await api.documents.save(d, d.revision); } catch (e) {
          if (!(e instanceof ApiError) || !e.isConflict) throw e;
          const overwrite = confirm(`${e.message}.\n\nОК — перезаписать своей версией.\nОтмена — загрузить версию с сервера (ваши изменения будут потеряны).`);
          if (overwrite) out = await api.documents.save(d);
          else { const fresh = migrateDocument(await api.documents.get(d.id)); loadDoc(fresh, true); return; }
        }
      }
      const m = migrateDocument(out);
      syncedRef.current = m;
      reset({ ...doc, id: m.id, revision: m.revision });
      setNotice(`Сохранено на сервере: ревизия ${m.revision}`);
    } catch (e) { alert('Ошибка сохранения: ' + (e as Error).message); }
  };
  const openServerList = async () => {
    try { setServerList(await api.documents.list()); } catch (e) { alert('Сервер: ' + (e as Error).message); }
  };

  const serverTitle = server.status === 'online'
    ? `Сервер доступен: ${Object.entries(server.services ?? {}).map(([k, v]) => `${k} — ${v}`).join(', ')}`
    : server.status === 'offline' ? 'Сервер недоступен (работа в браузере). Запуск: npm run dev:services' : 'Проверка сервера…';

  return (
    <div className="app">
      <header>
        <b className="brand">Тактическая карта</b>
        <input className="docname" value={doc.name} onChange={(e) => set({ ...doc, name: e.target.value }, 'docname')} />
        <span className={`srv ${server.status}`} title={serverTitle}>●{doc.id ? ` рев. ${doc.revision}` : ''}</span>
        <span className="sep" />
        <button disabled={!canUndo} onClick={undo} title="Ctrl+Z">↶</button>
        <button disabled={!canRedo} onClick={redo} title="Ctrl+Shift+Z">↷</button>
        <span className="sep" />
        <select value="" onChange={(e) => {
          const v = e.target.value;
          e.target.value = '';
          if (v === 'new') { if (confirm('Создать пустую карту? Несохранённые изменения будут потеряны.')) { const vw = engine?.getView(); loadDoc(emptyDocument(vw?.center, vw?.zoom)); } }
          if (v === 'json') download(`${doc.name || 'map'}.json`, JSON.stringify(withView(), null, 1), 'application/json');
          const suffix = time ? `-${time.replace(/[:T]/g, '-')}` : '';
          if (v === 'geojson') download(`${doc.name || 'map'}${suffix}.geojson`, JSON.stringify(toGeoJSON(doc, { time })), 'application/geo+json');
          if (v === 'svg') svgWithFonts(atTime(), doc.paper).then((s) => download(`${doc.name || 'map'}${suffix}.svg`, s, 'image/svg+xml'));
          if (v === 'png') exportPNG(atTime(), doc.paper, 2).then((b) => download(`${doc.name || 'map'}${suffix}.png`, b));
          const s = SCENES.find((x) => x.id === v);
          if (s && confirm(`Открыть пример «${s.name}»? Текущая карта будет заменена.`)) loadDoc(s.build());
        }}>
          <option value="">Файл…</option>
          <option value="new">Новая пустая карта</option>
          <optgroup label="Сохранить / экспорт">
            <option value="json">Документ (JSON)</option>
            <option value="geojson">GeoJSON (видимые слои{time ? ', на дату' : ''})</option>
            <option value="svg">SVG (слои — группами{time ? ', на дату' : ''})</option>
            <option value="png">PNG{time ? ' (на дату)' : ''}</option>
          </optgroup>
          <optgroup label="Примеры">
            {SCENES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </optgroup>
        </select>
        <label className="filebtn" title="Документ JSON или GeoJSON (добавится в активный слой)">Открыть / импорт…<input type="file" accept=".json,.geojson,application/json,application/geo+json" onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} /></label>
        <span className="sep" />
        <button disabled={server.status !== 'online'} onClick={openServerList} title={serverTitle}>С сервера…</button>
        <button disabled={server.status !== 'online'} onClick={saveToServer} title="Ctrl+S">На сервер</button>
        <span className="sep" />
        <label className="inl">Подложка
          <select value={basemapId} onChange={(e) => {
            const v = e.target.value;
            if (v === '__add') {
              const name = prompt('Название подложки:', 'Моя карта');
              if (!name) return;
              const url = prompt('Шаблон адреса тайлов XYZ, например https://server/{z}/{x}/{y}.png\n(или WMS с {bbox-epsg-3857}):', '');
              if (!url || !isValidTemplate(url)) { if (url) alert('Нужен адрес с {z}/{x}/{y}, {quadkey} или {bbox-epsg-3857}'); return; }
              const spec: BasemapSpec = { id: 'custom-' + newId('b'), name, tiles: [url], tileSize: 256 };
              const list = [...customBasemaps, spec];
              setCustomBasemaps(list); saveCustomBasemaps(list); setBasemapId(spec.id);
              return;
            }
            setBasemapId(v);
          }}>
            <option value="none">нет (бумага)</option>
            {basemaps.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="__add">+ своя (XYZ / WMS)…</option>
          </select>
        </label>
        {basemap && <input type="range" min={0} max={1} step={0.05} value={basemapOpacity} onChange={(e) => setBasemapOpacity(+e.target.value)} title="Прозрачность подложки" />}
        <label className="inl">Бумага <input type="color" value={doc.paper} onChange={(e) => set({ ...doc, paper: e.target.value }, 'paper')} /></label>
        <span className="status">{status}</span>
      </header>
      <aside className="left"><Palette tool={tool} setTool={(t) => { setTool(t); if (t.mode === 'draw') setSelected(null); }} /></aside>
      <main>
        <MapView key={mapKey} doc={doc} setDoc={set} selected={selected} setSelected={setSelected} selectedOverlay={selectedOverlay}
          tool={tool} setTool={setTool} activeLayer={activeLayer} basemap={basemap} basemapOpacity={basemapOpacity}
          onEngineReady={(m) => { setEngine(m); (window as unknown as { __engine: MapEngine }).__engine = m; }} onStatus={setStatus}
          time={time} newFromNow={newFromNow} />
        <Timeline doc={doc} setDoc={set} time={time} setTime={setTime} newFromNow={newFromNow} setNewFromNow={setNewFromNow} />
        {tool.mode === 'draw' && (
          <div className="hintbar">
            {tool.kind === 'arrow' ? 'Стрелка: щёлкайте точки оси от хвоста к острию. Первый щелчок у линии фронта/контура — хвост привяжется (Alt — без привязки). ' : ''}
            {tool.kind === 'symbol' || tool.kind === 'label' ? 'Щёлкните на карте, чтобы поставить. ' : 'Двойной щелчок или Enter — завершить, Backspace — убрать точку, Esc — отмена.'}
          </div>
        )}
        {notice && <div className="notice" onClick={() => setNotice(null)}>{notice}</div>}
        {serverList && (
          <div className="modal-bg" onClick={() => setServerList(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="sec-h"><span>Карты на сервере</span><button className="link" onClick={() => setServerList(null)}>✕</button></div>
              {!serverList.length && <div className="muted">Пока пусто — сохраните текущую карту кнопкой «На сервер».</div>}
              {serverList.map((m) => (
                <div key={m.id} className="srvitem">
                  <span className="nm" onClick={async () => {
                    try { loadDoc(migrateDocument(await api.documents.get(m.id)), true); setServerList(null); } catch (e) { alert((e as Error).message); }
                  }}>{m.name}</span>
                  <span className="muted">рев. {m.revision} · слоёв {m.layers} · объектов {m.features} · {new Date(m.updatedAt).toLocaleString('ru-RU')}</span>
                  <button className="link danger" title="Удалить" onClick={async () => {
                    if (!confirm(`Удалить «${m.name}» с сервера?`)) return;
                    await api.documents.remove(m.id); setServerList(serverList.filter((x) => x.id !== m.id));
                  }}>✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
      <aside className="right">
        {sel ? <Inspector doc={doc} setDoc={set} feature={sel} onDeselect={() => setSelected(null)} time={time} setTime={setTime}
          extra={<EntityPanel api={server.status === 'online' && server.services?.registry === 'up' ? registryApi : null} doc={doc} setDoc={set} feature={sel} time={time} />} />
          : <div className="help">
            <h3>Как работать</h3>
            <ul>
              <li>Слева выберите оформление (уставное РККА или по образцу: атлас, инфографика, схема боя) и знак — затем рисуйте на карте.</li>
              <li><b>Слои</b> (ниже): глаз — показать/скрыть (Alt — только этот слой), замок — запретить правку, ▸ — прозрачность и объекты слоя. Объекты перетаскиваются между слоями. Новые объекты ложатся в активный слой или — в режиме «авто» — по смыслу знака.</li>
              <li><b>Стрелки</b> строятся по оси от хвоста к острию; начатая у линии фронта стрелка крепится к ней хвостом.</li>
              <li>В режиме выбора: тяните объект, его узлы, «+» на серединах — новый узел, двойной щелчок по узлу — удалить.</li>
              <li>Ctrl+Z / Ctrl+Shift+Z, Ctrl+D — дублировать, Del — удалить, Ctrl+S — на сервер.</li>
            </ul>
          </div>}
        <LayersPanel doc={doc} setDoc={set} selected={selected} setSelected={setSelected}
          selectedOverlay={selectedOverlay} setSelectedOverlay={setSelectedOverlay}
          activeLayer={activeLayer} setActiveLayer={setActiveLayer} engine={engine} />
      </aside>
    </div>
  );
}

function stripMeta(d: MapDocument) {
  const { view: _v, revision: _r, ...rest } = d as MapDocument & { updatedAt?: string; createdAt?: string };
  delete (rest as Record<string, unknown>).updatedAt;
  delete (rest as Record<string, unknown>).createdAt;
  return rest;
}
