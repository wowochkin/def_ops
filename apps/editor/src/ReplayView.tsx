/**
 * Раздел «Переигровка»: выбор сценария, расчёт в браузере (фоновый поток), карта с
 * плеером времени, итоги и отчёт о сравнении с историей. Результат можно открыть в
 * редакторе для правки и экспорта.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { migrateDocument, type MapDocument, type TimeInstant } from '@def-ops/core';
import catalogFile from '../../../packages/sim/data/scenarios/catalog.json';
import type { CatalogEntry, SimRequest, SimResponse, SimResult } from './sim/protocol';
import { MapView } from './MapView';
import { Timeline } from './Timeline';
import { BasemapControls, Popover } from './ui';
import type { Basemaps } from './shared';
import { ZonesContext } from './time';
import { mdToHtml } from './markdown';

const CATALOG = (catalogFile as { scenarios: CatalogEntry[] }).scenarios;
const fmtDays = (d: number | null) => (d == null ? '—' : d > 0 ? `+${d}` : String(d));
const dayClass = (d: number | null) => (d == null ? 'miss' : Math.abs(d) <= 1 ? 'ok' : Math.abs(d) <= 2 ? 'near' : 'off');
const pct = (x: number) => `${Math.round(x * 100)} %`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Слои переигровки, которые удобно переключать одной кнопкой. */
const TOGGLES: { key: string; title: string; match: (id: string) => boolean }[] = [
  { key: 'hist', title: 'История', match: (id) => id.startsWith('hist-') },
  { key: 'front', title: 'Фронт', match: (id) => id === 'sim-front' },
  { key: 'combat', title: 'Бои', match: (id) => id === 'sim-combat' },
  { key: 'theatre', title: 'Рубежи', match: (id) => id === 'theatre' },
];

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function ReplayView({ bm, onOpenInEditor }: { bm: Basemaps; onOpenInEditor: (d: MapDocument) => void }) {
  const [scenario, setScenario] = useState(CATALOG[0].id);
  const entry = useMemo(() => CATALOG.find((c) => c.id === scenario) ?? CATALOG[0], [scenario]);
  const [rules, setRules] = useState(entry.rules[0].id);
  const [seed, setSeed] = useState(1);
  const [runs, setRuns] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [doc, setDoc] = useState<MapDocument | null>(null);
  const [time, setTime] = useState<TimeInstant | null>(null);
  const [mapKey, setMapKey] = useState(0);
  const [report, setReport] = useState(false);
  const worker = useRef<Worker | null>(null);

  useEffect(() => { setRules(entry.rules[0].id); }, [entry]);
  useEffect(() => () => worker.current?.terminate(), []);

  const run = () => {
    worker.current?.terminate();
    const w = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setBusy('запуск…'); setError(null);
    w.onmessage = (e: MessageEvent<SimResponse>) => {
      const m = e.data;
      if (m.kind === 'progress') setBusy(m.text);
      else if (m.kind === 'error') { setBusy(null); setError(m.message); w.terminate(); }
      else {
        setBusy(null); w.terminate();
        const d = migrateDocument(m.result.doc);
        setResult(m.result); setDoc(d); setTime(d.timeline?.start ?? null); setMapKey((k) => k + 1);
      }
    };
    w.onerror = (e) => { setBusy(null); setError(e.message || 'ошибка расчёта'); };
    const q: SimRequest = { scenario, rules, seed, runs, toleranceKm: entry.toleranceKm };
    w.postMessage(q);
  };
  const stop = () => { worker.current?.terminate(); worker.current = null; setBusy(null); };

  const layerOn = (t: (typeof TOGGLES)[number]) => !!doc?.layers.filter((l) => t.match(l.id)).some((l) => l.visible);
  const toggle = (t: (typeof TOGGLES)[number]) => doc && setDoc({ ...doc, layers: doc.layers.map((l) => (t.match(l.id) ? { ...l, visible: !layerOn(t) } : l)) });
  const tol = CATALOG.find((c) => c.id === result?.scenario)?.toleranceKm ?? entry.toleranceKm;

  const zones = useMemo(() => ({ local: 'Europe/Berlin', localFixed: true, input: 'msk' as const, setInput: () => {} }), []);
  return (
    <ZonesContext.Provider value={zones}>
    <div className="replay">
      <aside className="rp-side">
        <div className="rp-head">
          <h2>Переигровка</h2>
          <p>Обе стороны получают исторические задачи; движение, бои, подвоз и окружения считает арбитр. Итог сравнивается с историей.</p>
        </div>
        <div className="rp-cards">
          {CATALOG.map((c) => (
            <button key={c.id} className={`rp-card${c.id === scenario ? ' on' : ''}`} disabled={!!busy} onClick={() => setScenario(c.id)}>
              <b>{c.title}</b><span>{c.detail}</span>
            </button>
          ))}
        </div>
        <div className="rp-form">
          <label>Правила
            <select value={rules} onChange={(e) => setRules(e.target.value)} disabled={!!busy}>
              {entry.rules.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </label>
          <div className="rp-inline">
            <label title="Номер случайного прогона: один и тот же seed — один и тот же расчёт">Seed <input type="number" min={1} value={seed} onChange={(e) => setSeed(Math.max(1, +e.target.value || 1))} disabled={!!busy} /></label>
            <label title="Прогонов с разными seed — разброс исходов. На карте — первый">Прогонов
              <select value={runs} onChange={(e) => setRuns(+e.target.value)} disabled={!!busy}>{[1, 3, 5, 10].map((n) => <option key={n}>{n}</option>)}</select>
            </label>
          </div>
          {busy
            ? <button className="rp-go" onClick={stop}><span className="spinner" /> {busy} <small>остановить</small></button>
            : <button className="rp-go primary" onClick={run}>Рассчитать</button>}
          {error && <div className="err">Ошибка: {error}</div>}
        </div>
        {result && !busy && <Results r={result} tol={tol} onReport={() => setReport(true)} onOpen={() => doc && onOpenInEditor(doc)} />}
      </aside>
      <main className="rp-main">
        {doc ? <>
          <MapView key={mapKey} doc={doc} setDoc={(d) => setDoc(d)} selected={null} setSelected={() => {}} selectedOverlay={null}
            tool={{ mode: 'select' }} setTool={() => {}} activeLayer={null} basemap={bm.current} basemapOpacity={bm.opacity}
            onEngineReady={() => {}} onStatus={() => {}} time={time} newFromNow={false} />
          <div className="rp-tools">
            {TOGGLES.map((t) => <button key={t.key} className={`chip${layerOn(t) ? ' on' : ''}`} onClick={() => toggle(t)}>{t.title}</button>)}
            <Popover label="Подложка" align="right"><BasemapControls bm={bm} /></Popover>
          </div>
          <Timeline doc={doc} setDoc={(d) => setDoc(d)} time={time} setTime={setTime} newFromNow={false} setNewFromNow={() => {}} autoZone="Europe/Berlin" />
        </> : <Empty busy={!!busy} />}
      </main>
      {report && result && <ReportModal md={result.report} onClose={() => setReport(false)}
        onDownload={() => download(`${result.scenario}-seed${result.seed}-report.md`, result.report, 'text/markdown')} />}
    </div>
    </ZonesContext.Provider>
  );
}

function Empty({ busy }: { busy: boolean }) {
  return (
    <div className="rp-empty">
      <div>
        <div className="rp-empty-ic">{busy ? <span className="spinner big" /> : '▶'}</div>
        <b>{busy ? 'Идёт расчёт…' : 'Выберите сценарий и нажмите «Рассчитать»'}</b>
        <p>Расчёт идёт прямо в браузере: 5–30 секунд. На карте — ход операции по часам: соединения, линия фронта, бои, отметки; бледные знаки — исторические положения.</p>
      </div>
    </div>
  );
}

function Results({ r, tol, onReport, onOpen }: { r: SimResult; tol: number; onReport: () => void; onOpen: () => void }) {
  const lo = Math.min(...r.spread), hi = Math.max(...r.spread);
  return (
    <div className="rp-res">
      <div className="kpis">
        <div><b>{r.runs > 1 && lo !== hi ? `${pct(lo)}–${pct(hi)}` : pct(r.within)}</b><span>положений в пределах ±{tol} км от исторических</span></div>
        <div><b>{r.eventsHit}<small> / {r.eventsTotal}</small></b><span>событий с точностью ±2 сут{r.runs > 1 ? `, ${r.runs} прогонов` : ''}</span></div>
      </div>
      <div className="rp-events">
        {r.events.map((e) => (
          <div key={e.title} className="ev" title={e.title}>
            <div className="ev-t">{e.title.split(':')[0]}</div>
            <div className="ev-d"><span className="muted">{ddmm(e.historical)} → {e.simulated ? ddmm(e.simulated) : '—'}</span>
              <span className="days">{e.days.map((d, i) => <i key={i} className={dayClass(d)}>{fmtDays(d)}</i>)}</span></div>
          </div>
        ))}
      </div>
      <div className="rp-actions">
        <button onClick={onReport}>Отчёт</button>
        <button onClick={onOpen} title="Открыть результат в редакторе: правка, экспорт, сохранение на сервер">В редактор →</button>
      </div>
    </div>
  );
}

function ReportModal({ md, onClose, onDownload }: { md: string; onClose: () => void; onDownload: () => void }) {
  const html = useMemo(() => mdToHtml(md), [md]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal report" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><b>Отчёт о сравнении с историей</b><span style={{ flex: 1 }} /><button onClick={onDownload}>Скачать .md</button><button onClick={onClose}>Закрыть</button></div>
        <div className="modal-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
