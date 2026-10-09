/**
 * «Карты» → «Театры»: театр операции на карте — местность (растр классов), дороги, железные дороги, реки,
 * мосты и переправы, районы, рубежи; область (весь театр, текущий вид или выделенная на карте) и выгрузка
 * по ней: слои в GeoJSON, растр местности PNG (с файлом привязки), театр-фрагмент JSON, заготовка рецепта для
 * сборки нового театра. Театр можно загрузить своим файлом — им смогут пользоваться свои операции.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createFeature, type LngLat, type MapDocument } from '@def-ops/core';
import { cropGrid, cropTheatre, decodeGrid, layerCounts, layerGeoJSON, recipeFor, theatreToDocument, THEATRE_LAYERS, TERRAIN_CLASSES, type BBox, type TerrainGrid, type TheatreData, type TheatreLayerId } from '@def-ops/sim';
import { MapView } from './MapView';
import type { MapEngine } from './engine/types';
import { BasemapControls, Popover } from './ui';
import type { Basemaps } from './shared';
import { MapHover } from './MapHover';
import { BUILTIN, deleteTheatre, getData, listOperations, listTheatres, onDataChange, saveTheatre } from './sim/userdata';

const COLORS: Record<string, [number, number, number]> = { open: [243, 239, 226], forest: [150, 190, 135], marsh: [140, 196, 186], urban: [196, 172, 152], hills: [222, 196, 140], water: [120, 172, 220] };
const RU: Record<string, string> = { open: 'открытая', forest: 'лес', marsh: 'болото', urban: 'город', hills: 'высоты', water: 'вода' };

/** Растр классов местности — картинка (PNG data URL): пиксель — клетка. */
function gridImage(g: TerrainGrid, alpha = 255): { url: string; canvas: HTMLCanvasElement } {
  const cells = decodeGrid(g);
  const c = document.createElement('canvas');
  c.width = g.cols; c.height = g.rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(g.cols, g.rows);
  for (let i = 0; i < cells.length; i++) {
    const [r, gg, b] = COLORS[TERRAIN_CLASSES[cells[i]]] ?? [255, 255, 255];
    img.data.set([r, gg, b, cells[i] === 0 ? Math.round(alpha * 0.35) : alpha], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return { url: c.toDataURL('image/png'), canvas: c };
}

const save = (name: string, data: string | Blob, type = 'application/json') => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data);
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const r4 = (x: number) => +x.toFixed(4);

export function TheatreView({ bm, onOpenInEditor }: { bm: Basemaps; onOpenInEditor?: (d: MapDocument) => void }) {
  const [list, setList] = useState<{ id: string; title: string; src: 'builtin' | 'op' | 'user' }[]>([]);
  const [sel, setSel] = useState<string>('oder-berlin-1945');
  const [T, setT] = useState<TheatreData | null>(null);
  const [vis, setVis] = useState<Record<string, boolean>>({ terrain: true });
  const [area, setArea] = useState<BBox | null>(null);
  const [picking, setPicking] = useState<LngLat | 'first' | null>(null);
  const [eng, setEng] = useState<MapEngine | null>(null);
  const [mapKey, setMapKey] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [cell, setCell] = useState(2);
  const [newId, setNewId] = useState('my-theatre');
  const [srv, setSrv] = useState<{ ok: boolean; python: string; error?: string; setup: string } | null>(null);
  const [build, setBuild] = useState<{ id: string; name: string; status: 'running' | 'done' | 'error' | 'cancelled'; log: string[]; error?: string; sizeBytes?: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pickRef = useRef(picking); pickRef.current = picking;

  useEffect(() => {
    const load = async () => {
      const [ops, mine] = await Promise.all([listOperations(), listTheatres()]);
      const titles = await Promise.all(BUILTIN.theatres.map(async (id) => ({ id, title: ((await getData('theatres', `${id}.json`)) as TheatreData).name, src: 'builtin' as const })));
      setList([...titles, ...ops.map((o) => ({ id: o.pkg.theatre.id, title: `${o.pkg.theatre.name} (операция ${o.id})`, src: 'op' as const })), ...mine.map((t) => ({ id: t.id, title: t.theatre.name, src: 'user' as const }))]);
    };
    void load();
    return onDataChange(() => void load());
  }, []);
  useEffect(() => {
    let alive = true;
    void (getData('theatres', `${sel}.json`) as Promise<TheatreData>).then((t) => { if (!alive) return; setT(t); setArea(null); setCell(t.cellKm); setNewId(`${t.id}-area`.slice(0, 50)); setMapKey((k) => k + 1); }).catch((e) => setNotice((e as Error).message));
    return () => { alive = false; };
  }, [sel]);

  const terrainUrl = useMemo(() => (T?.terrainGrid ? gridImage(T.terrainGrid, 200).url : null), [T]);
  const doc = useMemo(() => {
    if (!T) return null;
    const d = theatreToDocument(T);
    d.layers = d.layers.map((l) => ({ ...l, visible: vis[l.id.slice(3)] ?? l.visible }));
    if (T.terrainGrid && terrainUrl) {
      const [w, s, e, n] = T.terrainGrid.bbox;
      d.overlays = [{ id: 'terrain', name: 'Местность', url: terrainUrl, corners: [[w, n], [e, n], [e, s], [w, s]], opacity: 0.75, visible: vis.terrain !== false }];
    }
    if (area) {
      const [w, s, e, n] = area;
      d.layers = [...d.layers, { id: 'th-area', name: 'Область', role: 'custom', visible: true, locked: true, opacity: 1 }];
      const f = createFeature('line', 'std.border', { points: [[w, s], [e, s], [e, n], [w, n], [w, s]], layerId: 'th-area' }, 1.6, 'own');
      f.name = `Область: ${r4(w)}, ${r4(s)} — ${r4(e)}, ${r4(n)}`;
      d.features = [...d.features, f];
    }
    return d;
  }, [T, vis, area, terrainUrl]);

  // выделение области: два щелчка по карте — противоположные углы
  useEffect(() => {
    if (!eng) return;
    return eng.on('click', (e) => {
      const p = pickRef.current;
      if (!p) return;
      if (p === 'first') { setPicking(e.lngLat); return; }
      const b: BBox = [Math.min(p[0], e.lngLat[0]), Math.min(p[1], e.lngLat[1]), Math.max(p[0], e.lngLat[0]), Math.max(p[1], e.lngLat[1])];
      setArea(b.map(r4) as BBox); setPicking(null);
    });
  }, [eng]);

  const b: BBox | null = area ?? T?.bbox ?? null;
  const counts = useMemo(() => (T && b ? layerCounts(T, b) : null), [T, b]);
  const viewArea = () => {
    if (!eng) return;
    const { width, height } = eng.size();
    const a = eng.unproject([0, height]), c = eng.unproject([width, 0]);
    setArea([r4(a[0]), r4(a[1]), r4(c[0]), r4(c[1])]);
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      const t = JSON.parse(await f.text()) as TheatreData;
      if (!t.id || !Array.isArray(t.areas) || !t.bbox || !t.cellKm) throw new Error('это не театр: нужны id, bbox, cellKm, areas');
      if (BUILTIN.theatres.includes(t.id)) throw new Error(`театр «${t.id}» уже встроен — дайте другой id`);
      await saveTheatre({ id: t.id, created: new Date().toISOString(), theatre: t });
      setSel(t.id); setNotice(`Театр «${t.name}» загружен: им могут пользоваться свои операции (поле theatre сценария — «${t.id}»).`);
    } catch (e) { setNotice(`Не удалось загрузить: ${(e as Error).message}`); }
  };
  const pngTerrain = () => {
    if (!T?.terrainGrid || !b) return;
    const g = cropGrid(T.terrainGrid, b);
    if (!g) return;
    const { canvas } = gridImage(g);
    canvas.toBlob((blob) => {
      if (!blob) return;
      save(`${T.id}-terrain.png`, blob, 'image/png');
      // файл привязки (world file): размер пикселя и координаты центра левого верхнего пикселя, градусы
      const dx = (g.bbox[2] - g.bbox[0]) / g.cols, dy = (g.bbox[3] - g.bbox[1]) / g.rows;
      save(`${T.id}-terrain.pgw`, [dx, 0, 0, -dy, g.bbox[0] + dx / 2, g.bbox[3] - dy / 2].map((x) => x.toFixed(10)).join('\n') + '\n', 'text/plain');
      save(`${T.id}-terrain-legend.json`, JSON.stringify({ classes: Object.fromEntries(TERRAIN_CLASSES.map((c) => [c, { title: RU[c], rgb: COLORS[c] }])), bbox: g.bbox, cols: g.cols, rows: g.rows, crs: 'EPSG:4326' }, null, 1));
    }, 'image/png');
  };
  const editorDoc = () => {
    if (!doc) return;
    onOpenInEditor?.({ ...doc, name: `Театр: ${T!.name}`, layers: doc.layers.map((l) => ({ ...l, locked: false })) });
  };
  const fmtB = (x: BBox) => `${x[0]}, ${x[1]} — ${x[2]}, ${x[3]}`;
  const sizeKm = b ? [((b[2] - b[0]) * 111.32 * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180)).toFixed(0), ((b[3] - b[1]) * 111.32).toFixed(0)] : null;
  const recipe = () => recipeFor({ id: newId, name: area ? `${T?.name ?? 'Театр'} — область` : `${T?.name ?? 'Новый театр'} (пересборка)`, bbox: b!, cellKm: cell });
  const cmd = `.venv/bin/python packages/sim/tools/theatre/build_theatre.py ${newId}.recipe.json --out ${newId}.json`;
  const API = '/api/cartography/theatre';
  const startBuild = async () => {
    setBuild(null);
    try {
      const chk = await fetch(`${API}/check`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 || r.status === 502 ? 'сервер стенда не запущен (npm run dev:services)' : `сервер ответил ${r.status}`))));
      setSrv(chk);
      if (!chk.ok) return;
      const r = await fetch(`${API}/builds`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recipe: recipe() }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? `сервер ответил ${r.status}`);
      setBuild(j);
    } catch (e) { setSrv({ ok: false, python: '', error: (e as Error).message, setup: 'python3 -m venv .venv && .venv/bin/pip install -r packages/sim/tools/theatre/requirements.txt' }); }
  };
  const cancelBuild = async () => { if (build) setBuild(await fetch(`${API}/builds/${build.id}/cancel`, { method: 'POST' }).then((r) => r.json())); };
  // ход сборки — опрос раз в 2 с; собран — театр сохраняется в списке и открывается
  useEffect(() => {
    if (build?.status !== 'running') return;
    const t = setInterval(async () => {
      const x = await fetch(`${API}/builds/${build.id}`).then((r) => r.json()).catch(() => null);
      if (!x) return;
      setBuild(x);
      if (x.status === 'done') {
        const th = (await fetch(`${API}/builds/${build.id}/result`).then((r) => r.json())) as TheatreData;
        await saveTheatre({ id: th.id, created: new Date().toISOString(), theatre: th });
        setSel(th.id);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [build?.id, build?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="replay th">
      <aside className="rp-side th-side">
        <div className="rp-head"><h2>Театры</h2><p>Местность, дороги, реки, мосты, районы и рубежи, на которых считает арбитр. Выберите область — и выгрузите по ней слои или заготовку для сборки нового театра.</p></div>
        <label className="th-f">Театр <select value={sel} onChange={(e) => setSel(e.target.value)}>
          {list.map((x) => <option key={x.id} value={x.id}>{x.title}{x.src === 'user' ? ' · загружен' : ''}</option>)}</select></label>
        <div className="row"><input ref={input} type="file" accept=".json" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          <button onClick={() => input.current?.click()}>Загрузить театр…</button>
          {list.find((x) => x.id === sel)?.src === 'user' && <button className="danger" onClick={() => { if (confirm('Удалить загруженный театр?')) void deleteTheatre(sel).then(() => setSel('oder-berlin-1945')); }}>Удалить</button>}</div>
        {T && <p className="muted th-info">{T.id} · клетка {T.cellKm} км{T.terrainGrid ? ` · растр ${T.terrainGrid.cols}×${T.terrainGrid.rows}` : ''} · районов {T.areas.length}{T.frozen ? ` · ледостав ${T.frozen.from.slice(5, 10)}–${T.frozen.until.slice(5, 10)}` : ''}</p>}

        <h4>Слои {area && <small className="muted">— в области</small>}</h4>
        <div className="th-layers">{THEATRE_LAYERS.map((l) => counts && <label key={l.id} className={counts[l.id as TheatreLayerId] ? '' : 'empty'}>
          <input type="checkbox" checked={vis[l.id] ?? !['terrainShapes'].includes(l.id)} onChange={(e) => setVis((v) => ({ ...v, [l.id]: e.target.checked }))} />
          <span>{l.title}</span><small>{l.id === 'terrain' ? (counts.terrain ? 'есть' : 'нет') : counts[l.id as TheatreLayerId]}</small>
          {l.geo && counts[l.id as TheatreLayerId] > 0 && <button className="link" title="Скачать слой (GeoJSON) по области" onClick={() => save(`${T!.id}-${l.id}.geojson`, JSON.stringify(layerGeoJSON(T!, l.id as TheatreLayerId, b!)), 'application/geo+json')}>↓</button>}
          {l.id === 'terrain' && counts.terrain > 0 && <button className="link" title="Растр местности по области: PNG, файл привязки .pgw, легенда" onClick={pngTerrain}>↓</button>}
        </label>)}</div>
        {T?.terrainGrid && <div className="th-legend">{TERRAIN_CLASSES.map((c) => <span key={c}><i style={{ background: `rgb(${COLORS[c].join(',')})` }} />{RU[c]}</span>)}</div>}

        <h4>Область</h4>
        <p className="muted small">{b ? `${fmtB(b)} (≈ ${sizeKm![0]} × ${sizeKm![1]} км)` : '—'}{!area && ' — весь театр'}</p>
        <div className="row">
          <button className={picking ? 'primary' : ''} onClick={() => setPicking(picking ? null : 'first')}>{picking === 'first' ? 'Щёлкните первый угол…' : picking ? 'Щёлкните второй угол…' : 'Выделить на карте'}</button>
          <button onClick={viewArea} title="Область — то, что сейчас видно на карте">Текущий вид</button>
          {area && <button onClick={() => setArea(null)}>Весь театр</button>}
        </div>
        {b && <div className="th-bbox">{(['запад', 'юг', 'восток', 'север'] as const).map((t, i) => <label key={t}>{t}<input type="number" step={0.01} value={b[i]} onChange={(e) => { const x = [...b] as BBox; x[i] = +e.target.value; if (x[0] < x[2] && x[1] < x[3]) setArea(x); }} /></label>)}</div>}

        <h4>Выгрузка по области</h4>
        <div className="th-dl">
          <button disabled={!T || !b} onClick={() => save(`${T!.id}-${area ? 'fragment' : 'full'}.json`, JSON.stringify(area ? cropTheatre(T!, b!) : T))} title="Театр в формате движка (TheatreData), обрезанный по области: растры местности и дорог, объекты, задевающие область">Театр JSON{area ? ' (фрагмент)' : ''}</button>
          <button disabled={!T || !b} onClick={() => save(`${T!.id}-layers.geojson`, JSON.stringify({ type: 'FeatureCollection', features: THEATRE_LAYERS.filter((l) => l.geo).flatMap((l) => layerGeoJSON(T!, l.id as TheatreLayerId, b!).features.map((f) => ({ ...f, properties: { layer: l.id, ...f.properties } }))) }), 'application/geo+json')}>Все слои GeoJSON</button>
          {onOpenInEditor && <button disabled={!doc} onClick={editorDoc} title="Слои театра — документом редактора (правка, экспорт SVG / PNG)">Открыть в редакторе</button>}
        </div>

        <h4>Новый театр по области</h4>
        <p className="muted small">Местность (ESA WorldCover), рельеф (Copernicus DEM), реки, дороги и населённые пункты (OpenStreetMap) сводит на сетку сборщик на Python — на сервере стенда. Большие реки — по длине в охвате, районы — города и посёлки. Исторический слой (рубежи, переправы, разрушенные мосты) дописывается в рецепт.</p>
        <div className="row"><label className="th-f inl">id <input className="th-id" value={newId} onChange={(e) => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></label>
          <label className="th-f inl">Клетка, км <input type="number" min={0.05} step={0.05} value={cell} onChange={(e) => setCell(Math.max(0.05, +e.target.value || 1))} /></label></div>
        <div className="row">
          {build?.status === 'running' ? <button onClick={() => void cancelBuild()}>Остановить сборку</button>
            : <button className="primary" disabled={!b || !newId} onClick={() => void startBuild()}>Собрать на сервере</button>}
          <button disabled={!b} onClick={() => save(`${newId}.recipe.json`, JSON.stringify(recipe(), null, 2))} title="Рецепт для правки и сборки вручную">Рецепт</button>
        </div>
        {srv && !srv.ok && <div className="th-srv"><b>Сборщик на сервере не готов</b>{srv.error && <span>{srv.error}</span>}<span>Подготовка (один раз, в папке проекта):</span><code onClick={() => { void navigator.clipboard?.writeText(srv.setup); setNotice('Команда скопирована'); }}>{srv.setup}</code><span>Сервер стенда: <code>npm run dev:services</code>.</span></div>}
        {build && <div className={`th-build ${build.status}`}>
          <b>{build.status === 'running' ? <><span className="spinner" /> собирается «{build.name}»…</> : build.status === 'done' ? `Собран: ${build.name} (${((build.sizeBytes ?? 0) / 1e6).toFixed(1)} МБ) — загружен в список` : build.status === 'cancelled' ? 'Сборка остановлена' : `Ошибка: ${build.error}`}</b>
          <pre>{build.log.slice(-8).join('\n')}</pre>
        </div>}
        <details className="small muted"><summary>Собрать вручную</summary><code className="th-cmd" title="Скопировать" onClick={() => { void navigator.clipboard?.writeText(cmd); setNotice('Команда скопирована'); }}>{cmd}</code>
          <p className="muted small">Готовый театр загрузите сюда («Загрузить театр…») — он станет доступен для своих операций в «Моделировании».</p></details>
      </aside>
      <main className="rp-main">
        {doc && <MapView key={mapKey} doc={doc} setDoc={() => {}} selected={null} setSelected={() => {}} selectedOverlay={null} tool={{ mode: 'select' }} setTool={() => {}} activeLayer={null}
          basemap={bm.current} basemapOpacity={bm.opacity} onEngineReady={(e) => setEng(e)} onStatus={() => {}} time={null} newFromNow={false} />}
        {doc && <MapHover engine={eng} doc={doc} time={null} />}
        {picking && <div className="pick-hint">{picking === 'first' ? 'Щёлкните по карте — первый угол области' : 'Щёлкните — противоположный угол'}<button onClick={() => setPicking(null)}>Отмена</button></div>}
        <div className="rp-tools"><Popover label="Подложка" align="right"><BasemapControls bm={bm} /></Popover></div>
        {notice && <div className="cmd-notice" onClick={() => setNotice(null)}>{notice}</div>}
      </main>
    </div>
  );
}
