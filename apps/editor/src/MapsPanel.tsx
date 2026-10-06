/**
 * Локальные карты-подложки (сервис картографии): работают без интернета.
 * Загрузка тайлов из внешнего источника (пока он доступен), нарезка
 * привязанного скана, граница карты по нарисованному контуру, пакеты для
 * переноса в закрытый контур.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  parseOziMap, tileCount, validBBox, type BBox, type ControlPoint, type Feature, type ImageOverlay, type LngLat, type MapDocument, type MapJob, type MapSource,
} from '@def-ops/core';
import type { MapEngine } from './engine/types';
import { ask } from './dialogs';

const API = '/api/cartography';

async function req<T>(method: string, path: string, body?: unknown, raw?: BodyInit, contentType?: string): Promise<T> {
  const h: Record<string, string> = {};
  const key = localStorage.getItem('def_ops.apiKey');
  if (key) h['X-Api-Key'] = key;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (contentType) h['Content-Type'] = contentType;
  const r = await fetch(API + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  if (!r.ok) {
    let msg = r.statusText;
    try { const e = await r.json(); msg = e.error?.message ?? msg; } catch { /* */ }
    throw new Error(msg);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

export const cartography = {
  list: () => req<MapSource[]>('GET', '/maps'),
  create: (m: Partial<MapSource>) => req<MapSource>('POST', '/maps', m),
  update: (id: string, p: Partial<MapSource>) => req<MapSource>('PATCH', `/maps/${id}`, p),
  remove: (id: string) => req<void>('DELETE', `/maps/${id}`),
  jobs: (mapId?: string) => req<MapJob[]>('GET', `/jobs${mapId ? `?mapId=${mapId}` : ''}`),
  cancel: (id: string) => req<MapJob>('POST', `/jobs/${id}/cancel`),
  downloadXyz: (id: string, r: { url: string; bounds: BBox; minzoom: number; maxzoom: number; rate?: number; headers?: Record<string, string> }) =>
    req<MapJob>('POST', `/maps/${id}/import/xyz`, r),
  uploadRaster: (id: string, image: Blob, georef: { corners?: [LngLat, LngLat, LngLat, LngLat]; controlPoints?: ControlPoint[] }) =>
    req<MapJob>('POST', `/maps/${id}/import/raster?georef=${encodeURIComponent(JSON.stringify(georef))}`, undefined, image, image.type || 'image/png'),
  importPackage: (file: Blob) => req<{ map: MapSource; job: MapJob }>('POST', '/maps/import-package', undefined, file, 'application/x-tar'),
  /** Тайловый архив других программ: .sqlitedb (RMaps / Locus / OsmAnd) или .mbtiles. */
  importArchive: (file: Blob, o: { name?: string; file?: string; date?: string; attribution?: string } = {}) => {
    const q = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]);
    return req<{ map: MapSource; job: MapJob }>('POST', `/maps/import-archive${q.size ? `?${q}` : ''}`, undefined, file, 'application/vnd.sqlite3');
  },
  packageUrl: (id: string) => `${API}/maps/${id}/package`,
  tileTemplate: (m: MapSource) => `${location.origin}${API}/maps/${m.id}/tiles/{z}/{x}/{y}.${m.format}`,
  subscribe: (fn: (type: string, data: unknown) => void) => {
    const key = localStorage.getItem('def_ops.apiKey');
    const es = new EventSource(`${API}/events${key ? `?api_key=${encodeURIComponent(key)}` : ''}`);
    for (const t of ['map.created', 'map.updated', 'map.deleted', 'job.progress', 'job.done', 'job.failed']) {
      es.addEventListener(t, (m) => { try { fn(t, JSON.parse((m as MessageEvent).data)); } catch { /* */ } });
    }
    return () => es.close();
  },
};

interface Props {
  online: boolean;
  doc: MapDocument;
  selected: Feature | null;
  engine: MapEngine | null;
  /** Показать карту подложкой. */
  onShow: (m: MapSource) => void;
  /** Список карт изменился (для выбора подложки). */
  onMaps: (list: MapSource[]) => void;
  notify: (s: string) => void;
}

const fmtBytes = (b = 0) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} ГБ` : b > 1e6 ? `${(b / 1e6).toFixed(1)} МБ` : `${Math.round(b / 1e3)} КБ`);

/** Контур выделенного объекта (район или замкнутая линия) — как граница карты. */
function ringOf(f: Feature | null): LngLat[] | null {
  if (!f) return null;
  if (f.kind === 'area') return f.points;
  if (f.kind === 'line' && f.closed) return f.points;
  return null;
}

function viewBBox(engine: MapEngine | null): BBox | null {
  if (!engine) return null;
  const { width, height } = engine.size();
  const pts = [[0, 0], [width, 0], [width, height], [0, height]].map((p) => engine.unproject(p as [number, number]));
  const b: BBox = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  return b.map((v) => +v.toFixed(5)) as BBox;
}

export function MapsPanel({ online, doc, selected, engine, onShow, onMaps, notify }: Props) {
  const [maps, setMaps] = useState<MapSource[]>([]);
  const [jobs, setJobs] = useState<Record<string, MapJob>>({});
  const [form, setForm] = useState<null | 'xyz'>(null);
  const [err, setErr] = useState<string | null>(null);

  const reload = async () => {
    try { const l = await cartography.list(); setMaps(l); onMaps(l); setErr(null); } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { if (online) { reload(); cartography.jobs().then((l) => setJobs(Object.fromEntries(l.filter((j) => j.status === 'running' || j.status === 'queued').map((j) => [j.id, j])))).catch(() => undefined); } }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!online) return;
    return cartography.subscribe((type, data) => {
      if (type.startsWith('job.')) {
        const j = (data as { job?: MapJob }).job;
        if (!j) return;
        setJobs((cur) => ({ ...cur, [j.id]: j }));
        if (type !== 'job.progress') { reload(); notify(type === 'job.done' ? `Карта готова: ${j.done} тайлов` : j.status === 'cancelled' ? 'Задание остановлено' : `Задание не выполнено: ${j.message ?? ''}`); }
      } else reload();
    });
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const ring = ringOf(selected);
  const active = Object.values(jobs).filter((j) => j.status === 'running' || j.status === 'queued');

  if (!online) {
    return (
      <div className="maps">
        <div className="sec-h"><span>Локальные карты</span></div>
        <div className="muted pad">Сервис картографии недоступен. Запуск: npm run dev:services или docker compose up.</div>
      </div>
    );
  }

  return (
    <div className="maps">
      <div className="sec-h">
        <span>Локальные карты <span className="muted" title="Хранятся на сервере платформы, работают без интернета">(офлайн)</span></span>
        <span className="row-btns">
          <button onClick={() => setForm(form === 'xyz' ? null : 'xyz')} title="Скачать тайлы карты из интернет-источника в локальное хранилище">+ скачать</button>
          <label className="filebtn" title="Загрузить карту из файла: пакет платформы (.tar), Locus / RMaps / OsmAnd (.sqlitedb), MBTiles (.mbtiles) или OziExplorer — файл привязки .map вместе с изображением карты (выберите оба)">из файла
            <input type="file" multiple accept=".tar,.sqlitedb,.mbtiles,.map,.jpg,.jpeg,.png,.tif,.tiff,.webp" onChange={async (e) => {
              const files = [...(e.target.files ?? [])]; e.target.value = '';
              if (!files.length) return;
              setErr(null);
              try { notify(await importFiles(files)); reload(); } catch (x) { setErr((x as Error).message); }
            }} />
          </label>
        </span>
      </div>
      {err && <div className="err pad">{err}</div>}
      {form === 'xyz' && <XyzForm engine={engine} selectedRing={ring} onDone={(msg) => { setForm(null); if (msg) notify(msg); reload(); }} onError={setErr} />}
      {active.map((j) => (
        <div key={j.id} className="job">
          <span>{maps.find((m) => m.id === j.mapId)?.name ?? 'карта'}: {j.type === 'xyz-download' ? 'загрузка' : j.type === 'raster-tile' ? 'нарезка' : 'импорт'}</span>
          <progress max={Math.max(1, j.total)} value={j.done + j.skipped} />
          <span className="muted">{j.done + j.skipped}/{j.total}</span>
          <button className="link" onClick={() => cartography.cancel(j.id)}>стоп</button>
        </div>
      ))}
      {!maps.length && <div className="muted pad">Пока нет. Скачайте карту, нарежьте привязанный скан (кнопка у подложки-изображения ниже) или импортируйте пакет.</div>}
      {maps.map((m) => (
        <div key={m.id} className="mapitem">
          <div className="mi-h">
            <b className="link" title="Показать подложкой" onClick={() => onShow(m)}>{m.name}</b>
            <span className="muted">{m.date ? `${m.date} · ` : ''}z{m.minzoom}–{m.maxzoom} · {m.stats?.tiles ?? 0} тайлов · {fmtBytes(m.stats?.bytes)}</span>
          </div>
          <div className="mi-btns">
            <button onClick={() => onShow(m)}>подложить</button>
            <button onClick={() => engine?.setView({ center: [(m.bounds[0] + m.bounds[2]) / 2, (m.bounds[1] + m.bounds[3]) / 2], zoom: Math.max(m.minzoom, Math.min(m.maxzoom, 12)) })}>показать район</button>
            <button disabled={!ring} title={ring ? 'Граница карты — по выделенному контуру: за ней тайлы прозрачны' : 'Нарисуйте и выделите район (контур) — он станет границей карты'}
              onClick={async () => { if (!ring) return; try { await cartography.update(m.id, { coverage: ring }); notify(`Граница карты «${m.name}» задана`); reload(); } catch (e) { setErr((e as Error).message); } }}>
              граница = контур
            </button>
            {m.coverage && <button onClick={async () => { await cartography.update(m.id, { coverage: null }); reload(); }}>снять границу</button>}
            <a className="btnlink" href={cartography.packageUrl(m.id)} title="Выгрузить пакет для переноса в закрытый контур">пакет ↓</a>
            <button className="danger" onClick={async () => { if (!ask(`Удалить карту «${m.name}» со всеми тайлами?`)) return; await cartography.remove(m.id); reload(); }}>✕</button>
          </div>
        </div>
      ))}
      <ScanToMap overlays={doc.overlays} onError={setErr} onDone={(msg) => { notify(msg); reload(); }} />
    </div>
  );
}

/* ----------------------------- загрузка XYZ ----------------------------- */
function XyzForm({ engine, selectedRing, onDone, onError }: { engine: MapEngine | null; selectedRing: LngLat[] | null; onDone: (msg?: string) => void; onError: (s: string) => void }) {
  const [name, setName] = useState('Берлин 1945');
  const [url, setUrl] = useState('');
  const [minzoom, setMin] = useState(10);
  const [maxzoom, setMax] = useState(16);
  const [bounds, setBounds] = useState<BBox | null>(() => viewBBox(engine));
  const [date, setDate] = useState('');
  const [attribution, setAttribution] = useState('');
  const [referer, setReferer] = useState('');
  const count = useMemo(() => (bounds && validBBox(bounds) && minzoom <= maxzoom ? tileCount(bounds, minzoom, maxzoom) : 0), [bounds, minzoom, maxzoom]);
  const fromRing = () => {
    if (!selectedRing) return;
    setBounds([Math.min(...selectedRing.map((p) => p[0])), Math.min(...selectedRing.map((p) => p[1])), Math.max(...selectedRing.map((p) => p[0])), Math.max(...selectedRing.map((p) => p[1]))]);
  };
  return (
    <div className="xyzform">
      <label className="row"><span className="lbl">Название</span><span className="ctl"><input value={name} onChange={(e) => setName(e.target.value)} /></span></label>
      <label className="row"><span className="lbl">Адрес тайлов</span><span className="ctl"><input value={url} placeholder="https://…/{z}/{x}/{y}.png" onChange={(e) => setUrl(e.target.value)} /></span></label>
      <label className="row"><span className="lbl">Дата карты</span><span className="ctl"><input value={date} placeholder="1945" onChange={(e) => setDate(e.target.value)} /></span></label>
      <label className="row"><span className="lbl">Источник</span><span className="ctl"><input value={attribution} placeholder="etomesto.ru" onChange={(e) => setAttribution(e.target.value)} /></span></label>
      <label className="row"><span className="lbl">Referer</span><span className="ctl"><input value={referer} placeholder="если источник требует" onChange={(e) => setReferer(e.target.value)} /></span></label>
      <div className="row"><span className="lbl">Уровни</span><span className="ctl">
        <input type="number" min={0} max={22} value={minzoom} onChange={(e) => setMin(+e.target.value)} />—
        <input type="number" min={0} max={22} value={maxzoom} onChange={(e) => setMax(+e.target.value)} />
      </span></div>
      <div className="row"><span className="lbl">Район</span><span className="ctl">
        <span className="muted">{bounds ? bounds.map((v) => v.toFixed(3)).join(', ') : '—'}</span>
      </span></div>
      <div className="btns">
        <button onClick={() => setBounds(viewBBox(engine))}>по текущему виду</button>
        <button disabled={!selectedRing} title="По выделенному контуру" onClick={fromRing}>по контуру</button>
      </div>
      <div className={count > 50000 ? 'err' : 'muted'}>Тайлов: {count.toLocaleString('ru-RU')}{count > 50000 ? ' — слишком много, уменьшите район или уровни' : ''}</div>
      <div className="btns">
        <button disabled={!url || !count || count > 50000} onClick={async () => {
          try {
            const m = await cartography.create({ name, date: date || null, attribution: attribution || undefined, format: /\.jpe?g/i.test(url) ? 'jpg' : 'png', tileSize: 256, minzoom, maxzoom, bounds: bounds!, sourceUrl: url });
            await cartography.downloadXyz(m.id, { url, bounds: bounds!, minzoom, maxzoom, headers: referer ? { Referer: referer } : undefined });
            onDone(`Загрузка «${name}» начата: ${count} тайлов`);
          } catch (e) { onError((e as Error).message); }
        }}>Скачать в локальное хранилище</button>
        <button className="link" onClick={() => onDone()}>отмена</button>
      </div>
      <div className="muted hint">Скачивайте только то, что разрешено условиями сайта-источника; загрузка идёт не быстрее 4 тайлов в секунду. Источник указывается в подписи карты.</div>
    </div>
  );
}

/* -------------------- скан (подложка-изображение) → карта -------------------- */
function ScanToMap({ overlays, onError, onDone }: { overlays: ImageOverlay[]; onError: (s: string) => void; onDone: (s: string) => void }) {
  if (!overlays.length) return null;
  return (
    <div className="scan2map">
      <div className="muted">Привязанные сканы этой карты — нарезать в локальную карту:</div>
      {overlays.map((o) => (
        <div key={o.id} className="mi-btns">
          <span>{o.name}</span>
          <button onClick={async () => {
            try {
              const blob = await (await fetch(o.url)).blob();
              const m = await cartography.create({ name: o.name, format: 'png', tileSize: 256, minzoom: 8, maxzoom: 16, bounds: bboxOf(o.corners), opacity: o.opacity });
              await cartography.uploadRaster(m.id, blob, { corners: o.corners });
              onDone(`Нарезка скана «${o.name}» начата`);
            } catch (e) { onError((e as Error).message); }
          }}>нарезать</button>
        </div>
      ))}
    </div>
  );
}

const bboxOf = (c: LngLat[]): BBox => [Math.min(...c.map((p) => p[0])), Math.min(...c.map((p) => p[1])), Math.max(...c.map((p) => p[0])), Math.max(...c.map((p) => p[1]))];

/* ----------------------------- загрузка из файлов ----------------------------- */
const ext = (f: File) => f.name.toLowerCase().split('.').pop() ?? '';
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp'];
const IMAGE_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp' };

/** Текст .map: UTF-8, а если не читается — Windows-1251 (обычная кодировка OziExplorer). */
async function readMapText(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1251').decode(buf); }
}

/** Загрузить выбранные файлы карты; возвращает сообщение для пользователя. */
async function importFiles(files: File[]): Promise<string> {
  const maps = files.filter((f) => ext(f) === 'map');
  const done: string[] = [];
  for (const f of files) {
    const e = ext(f);
    if (e === 'tar') { await cartography.importPackage(f); done.push(`пакет «${f.name}»`); }
    if (e === 'sqlitedb' || e === 'mbtiles') {
      const r = await cartography.importArchive(f, { file: f.name.replace(/\.[^.]+$/, '') });
      done.push(`«${r.map.name}»: ${r.map.stats?.tiles ?? 0} тайлов, уровни ${r.map.minzoom}–${r.map.maxzoom}`);
    }
  }
  for (const mf of maps) {
    const ozi = parseOziMap(await readMapText(mf));
    const base = (n: string) => n.toLowerCase().replace(/\.[^.]+$/, '');
    const image = files.find((f) => IMAGE_EXT.includes(ext(f)) && (f.name.toLowerCase() === ozi.imageFile.toLowerCase() || base(f.name) === base(ozi.imageFile) || base(f.name) === base(mf.name)))
      ?? (files.filter((f) => IMAGE_EXT.includes(ext(f))).length === 1 ? files.find((f) => IMAGE_EXT.includes(ext(f))) : undefined);
    if (!image) {
      if (/\.ozf[234]?$/i.test(ozi.imageFile)) throw new Error(`«${mf.name}»: изображение карты в формате OziExplorer (${ozi.imageFile}) не читается — нужен тот же скан в JPG, PNG или TIFF`);
      throw new Error(`«${mf.name}»: выберите вместе с ним изображение карты (${ozi.imageFile})`);
    }
    const name = ozi.title || base(mf.name);
    const lng = ozi.points.map((p) => p.lngLat[0]), lat = ozi.points.map((p) => p.lngLat[1]);
    const m = await cartography.create({ name, format: 'png', tileSize: 256, minzoom: 8, maxzoom: 16, bounds: [Math.min(...lng), Math.min(...lat), Math.max(...lng), Math.max(...lat)], description: `OziExplorer: ${mf.name}, датум ${ozi.datum}` });
    const r = await cartography.uploadRaster(m.id, new Blob([image], { type: IMAGE_MIME[ext(image)] }), { controlPoints: ozi.points }) as unknown as { georef?: { rmsMeters: number } };
    done.push(`«${name}»: привязка по ${ozi.points.length} точкам${r.georef ? `, невязка ${r.georef.rmsMeters.toFixed(1)} м` : ''} — идёт нарезка${ozi.warnings.length ? `. ${ozi.warnings.join('; ')}` : ''}`);
  }
  const unknown = files.filter((f) => !['tar', 'sqlitedb', 'mbtiles', 'map', ...IMAGE_EXT].includes(ext(f)));
  if (unknown.length) done.push(`пропущено: ${unknown.map((f) => f.name).join(', ')}`);
  if (!done.length) throw new Error('Изображение карты без файла привязки: нарезать скан можно с .map (OziExplorer) или как подложку-изображение с углами');
  return `Загружено: ${done.join('; ')}`;
}
