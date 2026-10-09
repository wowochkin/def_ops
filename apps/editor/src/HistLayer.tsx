/**
 * «Театры» → «Исторический слой по карте»: пользователь подкладывает историческую карту (скан с привязкой,
 * тайловый архив — в «Карты» → «Подложки»), задаёт, как на ней выглядят дороги, вода, застройка, лес (готовая
 * легенда или образцы цвета, снятые щелчком по карте), — распознавание сводит карту на сетку театра. Дороги
 * карты становятся растром дорог театра (вместо современных — в охвате карты), вода, застройка и лес — поправкой
 * к местности. Результат — новый театр (свои операции могут на него ссылаться) и поправка для сборщика.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapSource } from '@def-ops/core';
import { applyOverlay, compareRoads, decodeMask, hsv, legendFromSamples, OVERLAY_COLORS, overlayGrid, tilesFor, tileXY, type BBox, type OverlayApply, type OverlayLegend, type OverlayResult, type RoadComparison, type TheatreData } from '@def-ops/sim';
import type { MapEngine } from './engine/types';
import type { Basemaps } from './shared';
import { cartography } from './MapsPanel';
import { BUILTIN, saveTheatre } from './sim/userdata';
import type { OverlayRequest, OverlayResponse } from './sim/overlay-worker';

const LEGENDS = import.meta.glob('../../../packages/sim/tools/theatre/legends/*.json', { eager: true, import: 'default' }) as Record<string, OverlayLegend>;
const PRESETS = Object.values(LEGENDS);
const CLASSES: [string, string][] = [['road', 'дороги'], ['highway', 'шоссе'], ['water', 'вода'], ['urban', 'застройка'], ['forest', 'лес'], ['marsh', 'болото']];
const RU = Object.fromEntries(CLASSES) as Record<string, string>;
const MAX_TILES = 4000;

type Samples = Record<string, [number, number, number][]>;

/** Маски по клеткам — картинка для карты: вода, застройка, лес, болото заливкой, дороги поверх. */
function maskImage(ov: OverlayResult): string {
  const N = ov.cols * ov.rows;
  const c = document.createElement('canvas');
  c.width = ov.cols; c.height = ov.rows;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(ov.cols, ov.rows);
  const order = ['suburb', 'marsh', 'forest', 'urban', 'water', 'rail', 'road', 'highway'].filter((k) => ov.masks[k]);
  const masks = order.map((k) => [k, decodeMask(ov.masks[k], N)] as const);
  for (let i = 0; i < N; i++) for (const [k, m] of masks) if (m[i]) img.data.set([...(OVERLAY_COLORS[k] ?? [200, 0, 200]), k === 'road' || k === 'highway' ? 255 : 150], i * 4);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

const CMP_COLORS: Record<number, [number, number, number, number]> = { 1: [70, 70, 70, 230], 2: [240, 140, 40, 255], 3: [70, 120, 220, 230] };
/** Сравнение дорог — картинка: серое — совпадает, оранжевое — только на карте, синее — только в театре. */
function compareImage(c: RoadComparison): string {
  const cv = document.createElement('canvas');
  cv.width = c.cols; cv.height = c.rows;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(c.cols, c.rows);
  for (let i = 0; i < c.cells.length; i++) if (c.cells[i]) img.data.set(CMP_COLORS[c.cells[i]], i * 4);
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL('image/png');
}
const km = (cells: number, c: RoadComparison) => Math.round(cells * c.cellKm);

export function HistLayer({ T, area, eng, bm, onPreview, onSaved, onNotice }: {
  T: TheatreData; area: BBox | null; eng: MapEngine | null; bm: Basemaps;
  onPreview: (p: { url: string; bbox: BBox } | null) => void; onSaved: (id: string) => void; onNotice: (t: string) => void;
}) {
  const maps = bm.localMeta;
  const [mapId, setMapId] = useState<string>('');
  const map: MapSource | undefined = maps.find((m) => m.id === mapId) ?? maps[0];
  const [legendId, setLegendId] = useState<string>('samples');
  const [samples, setSamples] = useState<Samples>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [tol, setTol] = useState(1);
  const [mins, setMins] = useState<Record<string, number>>({});
  const box = useMemo<BBox>(() => {
    const b = area ?? T.bbox;
    if (!map) return b;
    const m = map.bounds; // только там, где есть карта
    return [Math.max(b[0], m[0]), Math.max(b[1], m[1]), Math.min(b[2], m[2]), Math.min(b[3], m[3])];
  }, [area, T, map]);
  const empty = box[0] >= box[2] || box[1] >= box[3];
  const zooms = map ? Array.from({ length: map.maxzoom - map.minzoom + 1 }, (_, i) => map.minzoom + i) : [];
  const [zoom, setZoom] = useState<number | null>(null);
  const autoZoom = useMemo(() => { if (!map || empty) return null; let z = map.minzoom; for (const k of zooms) if (tilesFor(box, k).length <= 1500) z = k; return z; }, [map, box, empty]); // eslint-disable-line react-hooks/exhaustive-deps
  const z = zoom != null && zooms.includes(zoom) ? zoom : autoZoom;
  const nTiles = z != null && !empty ? tilesFor(box, z).length : 0;
  const legend: OverlayLegend | null = legendId === 'samples' ? (Object.values(samples).some((l) => l.length) ? legendFromSamples(samples, tol, mins) : null) : PRESETS.find((l) => l.id === legendId) ?? null;
  const [run, setRun] = useState<{ done: number; total: number } | null>(null);
  const [res, setRes] = useState<{ ov: OverlayResult; tiles: number; missing: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => { setRes(null); onPreview(null); }, [T, mapId, legendId]); // eslint-disable-line react-hooks/exhaustive-deps

  // как применять: по классам, которые есть в легенде
  const cls = legend ? legend.cells.map((c) => c.cls) : [];
  const [opt, setOpt] = useState<{ roads: boolean; replace: 'road' | 'all' | false; terrain: boolean; demote: boolean }>({ roads: true, replace: 'road', terrain: true, demote: false });
  const [newId, setNewId] = useState('');
  const [view, setView] = useState<'classes' | 'roads'>('classes');
  const roadCls = cls.includes('road') || cls.includes('highway');
  const cmp = useMemo(() => (res && roadCls ? compareRoads(T, res.ov, { road: cls.includes('road') ? 'road' : undefined, highway: cls.includes('highway') ? 'highway' : undefined }) : null), [res, T, roadCls]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (res) onPreview({ url: view === 'roads' && cmp ? compareImage(cmp) : maskImage(res.ov), bbox: res.ov.bbox }); }, [view, cmp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setNewId(`${T.id.replace(/-hist.*$/, '')}-hist`); }, [T]);

  // образец цвета: щелчок по карте — пиксель тайла исторической карты под курсором
  const pickRef = useRef(picking); pickRef.current = picking;
  useEffect(() => {
    if (!eng || !map) return;
    return eng.on('click', (e) => {
      const k = pickRef.current;
      if (!k) return;
      const zz = Math.min(map.maxzoom, Math.max(map.minzoom, Math.round(eng.getView().zoom + 1) /* тайлы 256 px */));
      const fx = tileXY.lon2x(e.lngLat[0], zz), fy = tileXY.lat2y(e.lngLat[1], zz);
      const url = cartography.tileTemplate(map).replace('{z}', String(zz)).replace('{x}', String(Math.floor(fx))).replace('{y}', String(Math.floor(fy)));
      void fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject(new Error('нет тайла')))).then(createImageBitmap).then((bmp) => {
        const c = new OffscreenCanvas(256, 256), ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0, 256, 256);
        const px = ctx.getImageData(Math.floor((fx % 1) * 256), Math.floor((fy % 1) * 256), 1, 1).data;
        if (px[3] < 128) { onNotice('Здесь карты нет (прозрачно)'); return; }
        setSamples((s) => ({ ...s, [k]: [...(s[k] ?? []), [px[0], px[1], px[2]] as [number, number, number]].slice(-12) }));
      }).catch(() => onNotice('Не удалось взять образец: тайла карты здесь нет'));
    });
  }, [eng, map]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Подложить карту и показать её: вид — на охват карты в области, не мельче её наименьшего уровня. */
  const show = () => {
    if (!map) return;
    bm.setId(`local-${map.id}`);
    if (!eng) return;
    // карта вне театра или области — показать саму карту и сказать почему распознавать нечего
    if (empty) onNotice(`Карта «${map.name}» не покрывает ${area ? 'выделенную область' : `театр «${T.name}»`} — показан её охват. Выберите театр или область на ней.`);
    const bx: BBox = empty ? map.bounds : box;
    const { width, height } = eng.size();
    const kk = Math.cos((((bx[1] + bx[3]) / 2) * Math.PI) / 180);
    const fit = Math.min(Math.log2((360 * width) / (512 * Math.max(1e-6, bx[2] - bx[0]))), Math.log2((360 * height * kk) / (512 * Math.max(1e-6, bx[3] - bx[1])))) - 0.2;
    // уровень движка — для тайлов 512 px: тайлы 256 px карты видны с уровня minzoom − 1
    const zz = Math.min(map.maxzoom - 1, Math.max(map.minzoom - 0.7, fit));
    eng.setView({ center: [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2], zoom: zz });
  };
  const start = () => {
    if (!map || !legend || z == null) return;
    setErr(null); setRes(null); onPreview(null);
    worker.current?.terminate();
    const w = new Worker(new URL('./sim/overlay-worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setRun({ done: 0, total: nTiles });
    w.onmessage = (e: MessageEvent<OverlayResponse>) => {
      const m = e.data;
      if (m.kind === 'progress') setRun({ done: m.done, total: m.total });
      else if (m.kind === 'done') { setRun(null); setRes({ ov: m.result, tiles: m.tiles, missing: m.missing }); onPreview({ url: maskImage(m.result), bbox: m.result.bbox }); w.terminate(); }
      else { setRun(null); setErr(m.error); w.terminate(); }
    };
    const grid = overlayGrid(T, box);
    w.postMessage({ kind: 'run', template: cartography.tileTemplate(map), legend, grid, zoom: z, source: `${map.name}${map.date ? ` (${map.date})` : ''}` } satisfies OverlayRequest);
  };
  const stop = () => { worker.current?.postMessage({ kind: 'stop' } satisfies OverlayRequest); };

  const apply = (): OverlayApply => ({
    road: opt.roads && cls.includes('road') ? 'road' : undefined, highway: opt.roads && cls.includes('highway') ? 'highway' : undefined,
    replaceModernRoads: opt.roads && (cls.includes('road') || cls.includes('highway')) ? opt.replace : false,
    ...(opt.terrain ? { water: cls.includes('water') ? 'water' : undefined, urban: cls.includes('urban') ? 'urban' : undefined, forest: cls.includes('forest') ? 'forest' : undefined, marsh: cls.includes('marsh') ? 'marsh' : undefined } : {}),
    ...(opt.demote && cls.includes('urban') ? { demoteModernUrban: 'open', keepUrban: cls.includes('suburb') ? 'suburb' : undefined } : {}),
  });
  const saveIt = async () => {
    if (!res) return;
    const id = newId.trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || BUILTIN.theatres.includes(id)) { onNotice('id театра: латиница, цифры, дефис; не совпадает со встроенным'); return; }
    const { theatre, changes } = applyOverlay(T, res.ov, apply());
    await saveTheatre({ id, created: new Date().toISOString(), theatre: { ...theatre, id, name: `${T.name.replace(/ — исторический слой.*$/, '')} — исторический слой` } });
    onNotice(`Театр «${id}» сохранён: ${Object.entries(changes).map(([k, v]) => `${k}: ${v}`).join(', ') || 'без изменений'}. Сошлитесь на него в сценарии своей операции (поле theatre).`);
    onPreview(null); onSaved(id);
  };
  const dl = () => {
    if (!res) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(res.ov)], { type: 'application/json' }));
    a.download = `${T.id}-${res.ov.legend}-overlay.json`; a.click();
  };

  if (!maps.length) return <div className="hist"><p className="muted small">Нет локальных карт. Загрузите историческую карту в «Карты» → «Подложки»: скан с привязкой по углам или точкам, тайловый архив .sqlitedb / .mbtiles, OziExplorer .map. Нужен сервер стенда (<code>npm run dev:services</code>).</p></div>;
  return (
    <div className="hist">
      <label className="th-f">Карта <select value={map?.id ?? ''} onChange={(e) => setMapId(e.target.value)}>{maps.map((m) => <option key={m.id} value={m.id}>{m.name}{m.date ? ` (${m.date})` : ''}</option>)}</select></label>
      <div className="row"><button onClick={show} title="Карта — подложкой, вид — на её охват в области (крупнее её наименьшего уровня)">{bm.id === `local-${map?.id}` ? 'К карте' : 'Показать подложкой'}</button>
        <span className="muted small">{empty ? 'карта не покрывает область театра' : `охват: уровни ${map!.minzoom}–${map!.maxzoom}`}</span></div>
      <label className="th-f">Как распознавать <select value={legendId} onChange={(e) => setLegendId(e.target.value)}>
        <option value="samples">по образцам цвета (щелчком по карте)</option>
        {PRESETS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      {legendId === 'samples' ? <div className="hist-samples">
        <p className="muted small">Включите «Показать подложкой», приблизьте карту, выберите класс и щёлкайте по нему на карте — по 2–5 образцов (дорога — по самой линии). Серые и чёрные образцы — без тона.</p>
        {CLASSES.map(([k, t]) => <div key={k} className={`hist-cls${picking === k ? ' on' : ''}`}>
          <button className={picking === k ? 'primary' : ''} onClick={() => setPicking(picking === k ? null : k)}>{picking === k ? `щёлкайте: ${t}…` : t}</button>
          <span className="hist-sw">{(samples[k] ?? []).map((c, i) => <i key={i} title={`rgb ${c.join(',')} · тон ${Math.round(hsv(...c)[0])}° — убрать`} style={{ background: `rgb(${c.join(',')})` }} onClick={() => setSamples((s) => ({ ...s, [k]: s[k].filter((_, j) => j !== i) }))} />)}</span>
          {(samples[k]?.length ?? 0) > 0 && <label className="small" title="Клетка относится к классу, если доля таких пикселей в ней не меньше">от <input type="number" min={1} max={90} value={Math.round((mins[k] ?? legendFromSamples({ [k]: samples[k] }).cells[0].min) * 100)} onChange={(e) => setMins({ ...mins, [k]: (+e.target.value || 5) / 100 })} />%</label>}
        </div>)}
        <label className="th-f inl">Допуск цвета <input type="range" min={0.4} max={2} step={0.1} value={tol} onChange={(e) => setTol(+e.target.value)} /> ×{tol.toFixed(1)}</label>
      </div> : <p className="muted small">{PRESETS.find((l) => l.id === legendId)?.note}</p>}
      {map && !empty && <label className="th-f inl">Уровень тайлов <select value={z ?? ''} onChange={(e) => setZoom(+e.target.value)}>{zooms.map((k) => <option key={k} value={k}>{k}</option>)}</select> <span className="muted small">тайлов {nTiles}{nTiles > MAX_TILES ? ` — больше ${MAX_TILES}: уменьшите область или уровень` : ''}</span></label>}
      <div className="row">
        {run ? <><div className="kb-prog grow"><i style={{ width: `${(run.done / Math.max(1, run.total)) * 100}%` }} /><span>тайлы {run.done}/{run.total}</span></div><button onClick={stop}>Остановить</button></>
          : <button className="primary" disabled={!legend || empty || z == null || nTiles > MAX_TILES} title={!legend ? 'нет образцов цвета' : ''} onClick={start}>Распознать</button>}
      </div>
      {err && <div className="err">{err}</div>}
      {res && <div className="hist-res">
        <b>Распознано: тайлов {res.tiles}{res.missing ? ` (нет ${res.missing})` : ''}, сетка {res.ov.cols}×{res.ov.rows}</b>
        <div className="hist-stats">{Object.entries(res.ov.stats).map(([k, n]) => <span key={k}><i style={{ background: `rgb(${(OVERLAY_COLORS[k] ?? [200, 0, 200]).join(',')})` }} />{RU[k] ?? k}: {n} кл.</span>)}</div>
        {cmp && <div className="hist-roads">
          <div className="row"><b>Дороги: карта и театр</b><span className="grow" />
            <div className="seg"><button className={view === 'classes' ? 'on' : ''} onClick={() => setView('classes')}>классы</button><button className={view === 'roads' ? 'on' : ''} onClick={() => setView('roads')}>сравнение дорог</button></div></div>
          <table className="hist-tab"><tbody>
            <tr><td>Клеток с дорогой на карте</td><td>{cmp.stats.map}</td><td className="muted">≈ {km(cmp.stats.map, cmp)} км</td></tr>
            <tr><td>Клеток с дорогой в театре сейчас</td><td>{cmp.stats.theatre}</td><td className="muted">≈ {km(cmp.stats.theatre, cmp)} км</td></tr>
            <tr><td><i className="sw" style={{ background: 'rgb(70,70,70)' }} />совпадают</td><td>{cmp.stats.both}</td><td className="muted">{cmp.stats.theatre ? Math.round((cmp.stats.both / cmp.stats.theatre) * 100) : 0} % дорог театра есть на карте</td></tr>
            <tr><td><i className="sw" style={{ background: 'rgb(240,140,40)' }} />только на карте</td><td>{cmp.stats.mapOnly}</td><td className="muted">дороги того времени, которых в театре нет, — добавятся</td></tr>
            <tr><td><i className="sw" style={{ background: 'rgb(70,120,220)' }} />только в театре</td><td>{cmp.stats.theatreOnly}</td><td className="muted">послевоенные или не распознанные — {opt.roads && opt.replace ? (opt.replace === 'all' ? 'уберутся (и шоссе)' : 'дороги уберутся, шоссе останутся') : 'останутся'}</td></tr>
          </tbody></table>
          {cmp.absent.length > 0 && <div className="small"><span className="muted">Дороги театра, которых на карте нет (≥70 % длины):</span> {cmp.absent.map((a) => `${a.name} (${a.km} км)`).join('; ')}</div>}
          {cmp.stats.map > 0 && cmp.stats.both / Math.max(1, cmp.stats.map) < 0.25 && <div className="warn small">Совпадений мало: возможно, распознаны не дороги (надписи, реки, сетка) — проверьте образцы цвета на «сравнении дорог».</div>}
        </div>}
        <p className="muted small">На карте — {view === 'roads' && cmp ? 'сравнение дорог: серое — совпадают, оранжевое — только на карте, синее — только в театре' : 'клетки по классам'}. Мало или много — поправьте образцы, допуск или порог и распознайте снова.</p>
        {(cls.includes('road') || cls.includes('highway')) && <label><input type="checkbox" checked={opt.roads} onChange={(e) => setOpt({ ...opt, roads: e.target.checked })} /> дороги карты — в растр дорог театра</label>}
        {opt.roads && (cls.includes('road') || cls.includes('highway')) && <label className="th-f inl">Современные дороги в охвате карты <select value={String(opt.replace)} onChange={(e) => setOpt({ ...opt, replace: e.target.value === 'false' ? false : (e.target.value as 'road' | 'all') })}>
          <option value="road">убрать дороги (шоссе оставить)</option><option value="all">убрать и шоссе</option><option value="false">оставить</option></select></label>}
        {cls.some((c) => ['water', 'urban', 'forest', 'marsh'].includes(c)) && <label><input type="checkbox" checked={opt.terrain} onChange={(e) => setOpt({ ...opt, terrain: e.target.checked })} /> вода, застройка, лес, болото карты — поверх местности</label>}
        {cls.includes('urban') && <label title="Застройка, которой на карте нет (послевоенная), — открытая местность"><input type="checkbox" checked={opt.demote} onChange={(e) => setOpt({ ...opt, demote: e.target.checked })} /> современную застройку, которой нет на карте, — в открытую</label>}
        <div className="row"><label className="th-f inl">id театра <input className="th-id" value={newId} onChange={(e) => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></label>
          <button className="primary" onClick={() => void saveIt()}>Сохранить театр</button>
          <button onClick={dl} title="Поправка для сборщика (рецепт: overlays)">Поправка JSON</button></div>
      </div>}
    </div>
  );
}
