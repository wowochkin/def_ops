/**
 * Раздел «Переигровка»: выбор сценария, расчёт в браузере (фоновый поток), карта с
 * плеером времени, итоги и отчёт о сравнении с историей. Результат можно открыть в
 * редакторе для правки и экспорта.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { migrateDocument, type MapDocument, type TimeInstant } from '@def-ops/core';
import type { CatalogEntry, SimRequest, SimResponse, SimResult } from './sim/protocol';
import { MapView } from './MapView';
import type { MapEngine } from './engine/types';
import { BasemapControls, Popover } from './ui';
import type { Basemaps, Llm } from './shared';
import { CommandView, loadSaved, SAVE_KEY, TakeoverDialog, turnStart, type SavedGame } from './CommandView';
import type { EnemyMode, GameStart } from './sim/game-protocol';
import { registerSectors, SectorPicker, withFocus, type Sector } from './Sectors';
import { BUILTIN_CATALOG, fullCatalog, onDataChange, sectorsOf } from './sim/userdata';
import { ZonesContext } from './time';
import { mdToHtml } from './markdown';
import { useCoverage } from './modeling/Coverage';
import { COVERAGE_LEVEL } from '@def-ops/knowledge';
import { MapHover, withoutLabels } from './MapHover';

const fmtDays = (d: number | null) => (d == null ? '—' : d > 0 ? `+${d}` : String(d));
const dayClass = (d: number | null) => (d == null ? 'miss' : Math.abs(d) <= 1 ? 'ok' : Math.abs(d) <= 2 ? 'near' : 'off');
const pct = (x: number) => `${Math.round(x * 100)} %`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Слои переигровки, которые удобно переключать одной кнопкой. */
const TOGGLES: { key: string; title: string; match: (id: string) => boolean }[] = [
  { key: 'ghosts', title: 'Ист. положения', match: (id) => id === 'hist-units' },
  { key: 'hfront', title: 'Ист. фронт', match: (id) => id === 'hist-front' },
  { key: 'front', title: 'Фронт', match: (id) => id === 'sim-front' || id.startsWith('sim-front-') },
  { key: 'combat', title: 'Бои', match: (id) => id === 'sim-combat' },
  { key: 'theatre', title: 'Рубежи', match: (id) => id === 'theatre' },
  { key: 'hbounds', title: 'Ист. разгр. линии', match: (id) => id === 'hist-bounds' },
  { key: 'bounds', title: 'Полосы', match: (id) => id === 'sim-bounds' },
];
/** Расчётные разграничительные линии — свой слой на каждом уровне карты; переключатель — видимость sim-bounds. */
const BOUND_LAYERS = ['sim-bounds', 'lvl-op-bounds', 'lvl-st-bounds'];

/** Полные названия слоёв в меню «Слои» (на кнопках были сокращения). */
export const LAYER_TITLE: Record<string, string> = { ghosts: 'Исторические положения', hfront: 'Линия фронта по истории', front: 'Линия фронта (расчёт)', combat: 'Бои за ход', theatre: 'Рубежи и укреплённые полосы', plan: 'Замысел (проект приказов)', rear: 'Тыл: базы и подвоз', rivers: 'Реки (для переправ)', hbounds: 'Разграничительные линии: директивы и распоряжения', bounds: 'Полосы фронтов и армий (расчёт)' };

/** Уровень обобщения карты: тактический — соединения и бои, оперативный — объединения (армии), стратегический — фронты. */
export type MapLevel = 'tac' | 'op' | 'st';
export const MAP_LEVELS: { id: MapLevel; title: string; hint: string }[] = [
  { id: 'tac', title: 'Тактический', hint: 'соединения (дивизии, корпуса) и бои за ход' },
  { id: 'op', title: 'Оперативный', hint: 'объединения (армии): положение, направления действий за сутки, рубежи обороны' },
  { id: 'st', title: 'Стратегический', hint: 'фронты и группы армий: направления главных ударов за двое суток, оборона' },
];
const LEVEL_LAYERS: Record<MapLevel, string[]> = { tac: ['sim-own', 'sim-enemy', 'sim-combat', 'sim-bounds'], op: ['lvl-op-units', 'lvl-op-moves', 'lvl-op-bounds'], st: ['lvl-st-units', 'lvl-st-moves', 'lvl-st-bounds'] };
const ALL_LEVEL_LAYERS = new Set(Object.values(LEVEL_LAYERS).flat());
/** Слои уровня со своим переключателем: показываются, только если он включён. */
const SWITCHED = new Set(['sim-combat', ...BOUND_LAYERS]);
/** Видимость слоёв по уровню; бои и полосы — ещё и по своему переключателю (полосы всех уровней — по слою sim-bounds). */
export function withLevel(doc: MapDocument, level: MapLevel): MapDocument {
  const boundsOff = doc.layers.some((l) => l.id === 'sim-bounds' && !l.visible);
  const on = (l: MapDocument['layers'][number]) => !SWITCHED.has(l.id) || (BOUND_LAYERS.includes(l.id) ? !boundsOff : l.visible);
  return { ...doc, layers: doc.layers.map((l) => (ALL_LEVEL_LAYERS.has(l.id) ? { ...l, visible: LEVEL_LAYERS[level].includes(l.id) && on(l) } : l)) };
}
/** Подписи знаков: на карте или только при наведении (запоминается). */
export function useMapLabels(): [boolean, () => void] {
  const [on, set] = useState<boolean>(() => { try { return localStorage.getItem('def_ops.mapLabels') !== 'hover'; } catch { return true; } });
  return [on, () => set((x) => { try { localStorage.setItem('def_ops.mapLabels', x ? 'hover' : 'on'); } catch { /* */ } return !x; })];
}
export function useMapLevel(): [MapLevel, (l: MapLevel) => void] {
  const [l, set] = useState<MapLevel>(() => { try { return (localStorage.getItem('def_ops.mapLevel') as MapLevel) || 'tac'; } catch { return 'tac'; } });
  return [l, (x) => { set(x); try { localStorage.setItem('def_ops.mapLevel', x); } catch { /* */ } }];
}
/**
 * Слои карты одним меню: подписи и слои-переключатели (исторические положения, фронт, бои…) — флажками.
 * Над картой остаются только масштаб, «Слои», «Участки» и «Подложка»: панель помещается в строку на любом экране.
 */
export function LayersMenu({ labels, toggleLabels, items }: { labels: boolean; toggleLabels: () => void; items: { key: string; title: string; on: boolean; toggle: () => void }[] }) {
  const n = items.filter((x) => x.on).length + (labels ? 1 : 0);
  return (
    <Popover label={<>Слои <small className="lyr-n">{n}</small></>} title="Что показать на карте" align="right" className="lyr-menu">
      <div className="pop-title">Показать на карте</div>
      <label className="lyr-row" title="Выключено — подписи только при наведении на знак"><input type="checkbox" checked={labels} onChange={toggleLabels} /> Подписи знаков</label>
      {items.map((x) => <label key={x.key} className="lyr-row"><input type="checkbox" checked={x.on} onChange={x.toggle} /> {x.title}</label>)}
    </Popover>
  );
}

export function LevelSwitch({ level, setLevel }: { level: MapLevel; setLevel: (l: MapLevel) => void }) {
  return <div className="lvl-sw" role="group" aria-label="Уровень карты">{MAP_LEVELS.map((x) => <button key={x.id} className={level === x.id ? 'on' : ''} title={x.hint} onClick={() => setLevel(x.id)}>{x.title}</button>)}</div>;
}
export const LEVEL_LEGEND: Record<MapLevel, { cls: string; text: string; mark?: string }[]> = {
  tac: [{ cls: 'lg-destroyed', text: 'соединение уничтожено', mark: '✕' }],
  op: [{ cls: 'lg-arrow', text: 'удар объединения (за сутки)' }, { cls: 'lg-bar', text: 'удар остановлен: рубеж и дата' }, { cls: 'lg-axis', text: 'ось танковой армии, даты по суткам', mark: '◆' }, { cls: 'lg-retreat', text: 'отход' }, { cls: 'lg-defense', text: 'рубеж обороны' }, { cls: 'lg-reserve', text: 'на марше или в резерве' }, { cls: 'lg-routed', text: 'разгромлено' }, { cls: 'lg-barmy', text: 'разграничительная линия армий' }],
  st: [{ cls: 'lg-arrow', text: 'главный удар фронта (за двое суток)' }, { cls: 'lg-fork', text: 'расходящиеся удары', mark: 'Y' }, { cls: 'lg-bar', text: 'удар остановлен: рубеж и дата' }, { cls: 'lg-retreat', text: 'отход' }, { cls: 'lg-defense', text: 'оборона' }],
};

export function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function ReplayView({ bm, llm, onOpenInEditor }: { bm: Basemaps; llm: Llm; onOpenInEditor: (d: MapDocument) => void }) {
  // каталог: встроенные операции и подготовленные свои (раздел «Моделирование»), со своими наборами правил
  const [CATALOG, setCatalog] = useState<(CatalogEntry & { custom?: boolean })[]>(BUILTIN_CATALOG);
  useEffect(() => {
    const load = () => void fullCatalog().then(async (c) => { setCatalog(c); for (const x of c.filter((y) => y.custom)) registerSectors(x.id, await sectorsOf(x.id)); });
    load();
    return onDataChange(load);
  }, []);
  const [scenario, setScenario] = useState(BUILTIN_CATALOG[0].id);
  const entry = useMemo(() => CATALOG.find((c) => c.id === scenario) ?? CATALOG[0], [scenario, CATALOG]);
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
  const [saved, setSaved] = useState<SavedGame | null>(loadSaved);
  const [game, setGame] = useState<{ start: GameStart | null; saved: SavedGame | null; enemy: EnemyMode } | null>(null);
  const [take, setTake] = useState<string | null>(null);
  const [focus, setFocus] = useState<Sector | null>(null);
  const [eng, setEng] = useState<MapEngine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [level, setLevel] = useMapLevel();
  const [labels, toggleLabels] = useMapLabels();
  const worker = useRef<Worker | null>(null);
  const engine = useRef<MapEngine | null>(null);

  useEffect(() => { setRules((r) => (entry.rules.some((x) => x.id === r) ? r : entry.rules[0].id)); }, [entry]);
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
        setResult(m.result); setDoc(d); setTime(d.timeline?.start ?? null); setMapKey((k) => k + 1); setFocus(null);
      }
    };
    w.onerror = (e) => { setBusy(null); setError(e.message || 'ошибка расчёта'); };
    const q: SimRequest = { scenario, rules, seed, runs, toleranceKm: entry.toleranceKm };
    w.postMessage(q);
  };
  const stop = () => { worker.current?.terminate(); worker.current = null; setBusy(null); };

  const layerOn = (t: (typeof TOGGLES)[number]) => !!doc?.layers.filter((l) => t.match(l.id)).some((l) => l.visible);
  const toggle = (t: (typeof TOGGLES)[number]) => doc && setDoc({ ...doc, layers: doc.layers.map((l) => (t.match(l.id) ? { ...l, visible: !layerOn(t) } : l)) });
  /** К событию: время — момент события в расчёте, карта — к месту. */
  const goEvent = (e: SimResult['events'][number]) => {
    if (e.at) setTime(e.at);
    const en = engine.current;
    if (e.place && en) { const z = en.getView().zoom; en.setView({ center: e.place, zoom: Math.min(13, Math.max(z, z + 1)) }); }
  };
  const tol = CATALOG.find((c) => c.id === result?.scenario)?.toleranceKm ?? entry.toleranceKm;

  const zones = useMemo(() => ({ local: 'Europe/Berlin', localFixed: true, input: 'msk' as const, setInput: () => {} }), []);
  if (game) {
    return <CommandView key={game.saved?.record.takeover ?? game.start?.takeover} bm={bm} llm={llm} start={game.start} saved={game.saved} enemy={game.enemy} onOpenInEditor={onOpenInEditor}
      onExit={({ discard }) => { if (discard) try { localStorage.removeItem(SAVE_KEY); } catch { /* */ } setSaved(loadSaved()); setGame(null); }} />;
  }
  const startGame = (enemy: EnemyMode) => {
    if (!result || !take) return;
    if (saved && !confirm('Есть незавершённая игра. Начать новую? Запись прежней будет заменена.')) return;
    setTake(null);
    setGame({ start: { scenario: result.scenario, rules: result.rules, seed: result.seed, takeover: take }, saved: null, enemy });
  };
  const takeAt = result && time ? turnStart(time, result.start, result.end, result.turnHours) : null;
  return (
    <ZonesContext.Provider value={zones}>
    <div className="replay">
      <aside className="rp-side">
        <div className="rp-head">
          <h2>Переигровка</h2>
          <p>Обе стороны получают исторические задачи; движение, бои, подвоз и окружения считает арбитр. Итог сравнивается с историей.</p>
        </div>
        {saved && !busy && <div className="rp-saved">
          <div><b>Незавершённая игра</b><span>{saved.title} · командование с {saved.record.takeover.slice(8, 10)}.{saved.record.takeover.slice(5, 7)}, сыграно ходов: {saved.record.turns.length}</span></div>
          <div className="rp-saved-b">
            <button className="primary" onClick={() => setGame({ start: null, saved, enemy: saved.enemy })}>Продолжить</button>
            <button onClick={() => { if (confirm('Удалить запись незавершённой игры?')) { try { localStorage.removeItem(SAVE_KEY); } catch { /* */ } setSaved(null); } }}>Удалить</button>
          </div>
        </div>}
        <div className="rp-cards">
          {CATALOG.map((c) => (
            <button key={c.id} className={`rp-card${c.id === scenario ? ' on' : ''}`} disabled={!!busy} onClick={() => setScenario(c.id)}>
              <b>{c.title}{c.custom && <i className="rp-own">своя</i>}</b><span>{c.detail}</span>
            </button>
          ))}
        </div>
        <ReplayCoverage op={scenario} />
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
        {result && !busy && <Results r={result} tol={tol} onReport={() => setReport(true)} onOpen={() => doc && onOpenInEditor(doc)} onSummary={() => result.summary && onOpenInEditor(result.summary)} onEvent={goEvent} />}
      </aside>
      <main className="rp-main">
        {doc ? <>
          <div className="rp-bar">
          {takeAt && <button className="take-btn" onClick={() => setTake(takeAt)} title="С этого хода советской стороной командуете вы, немецкой — штаб на модели">
            <span>⚑</span> Принять командование <small>с {ddmm(takeAt)}{result!.turnHours !== 24 ? ` ${takeAt.slice(11, 16)}` : ''}</small></button>}
          <div className="rp-tools">
            <LevelSwitch level={level} setLevel={setLevel} />
            <LayersMenu labels={labels} toggleLabels={toggleLabels} items={TOGGLES.filter((t) => level === 'tac' || t.key !== 'combat').map((t) => ({ key: t.key, title: LAYER_TITLE[t.key] ?? t.title, on: layerOn(t), toggle: () => toggle(t) }))} />
            {result && <SectorPicker scenario={result.scenario} engine={eng} bm={bm} focus={focus} setFocus={setFocus} opYear={+result.start.slice(0, 4)} onNotice={setNotice} />}
            <Popover label="Подложка" align="right"><BasemapControls bm={bm} /></Popover>
          </div>
          </div>
          <div className="rp-map">
          <MapView key={mapKey} doc={withoutLabels(withFocus(withLevel(doc, level), focus), labels)} setDoc={() => {}} selected={null} setSelected={() => {}} selectedOverlay={null}
            tool={{ mode: 'select' }} setTool={() => {}} activeLayer={null} basemap={bm.current} basemapOpacity={bm.opacity}
            onEngineReady={(e) => { engine.current = e; setEng(e); if (import.meta.env.DEV) (window as unknown as { __replayEngine: MapEngine }).__replayEngine = e; }} onStatus={() => {}} time={time} newFromNow={false} />
          <MapHover engine={eng} doc={doc ? withFocus(withLevel(doc, level), focus) : null} time={time} skip={['focus']} />
          {notice && <div className="cmd-notice" onClick={() => setNotice(null)}>{notice}</div>}
          <Legend on={(k) => { const t = TOGGLES.find((x) => x.key === k); return t ? layerOn(t) : true; }} toggle={(k) => { const t = TOGGLES.find((x) => x.key === k); if (t) toggle(t); }} extra={LEVEL_LEGEND[level]} combat={level === 'tac'} />
          {doc.timeline && time && <Player start={doc.timeline.start ?? time} end={doc.timeline.end ?? time} time={time} setTime={setTime}
            events={result?.events ?? []} onEvent={goEvent} />}
          </div>
        </> : <Empty busy={!!busy} />}
      </main>
      {take && result && <TakeoverDialog at={take} start={result.start} end={result.end} turnHours={result.turnHours} scenarioName={result.scenarioName} llm={llm} onStart={startGame} onCancel={() => setTake(null)} />}
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

function Results({ r, tol, onReport, onOpen, onSummary, onEvent }: { r: SimResult; tol: number; onReport: () => void; onOpen: () => void; onSummary: () => void; onEvent: (e: SimResult['events'][number]) => void }) {
  const lo = Math.min(...r.spread), hi = Math.max(...r.spread);
  return (
    <div className="rp-res">
      <div className="kpis">
        <div><b>{r.runs > 1 && lo !== hi ? `${pct(lo)}–${pct(hi)}` : pct(r.within)}</b><span>положений в пределах ±{tol} км от исторических</span></div>
        <div><b>{r.eventsHit}<small> / {r.eventsTotal}</small></b><span>событий с точностью ±2 сут{r.runs > 1 ? `, ${r.runs} прогонов` : ''}</span></div>
      </div>
      <div className="rp-events">
        {r.events.map((e) => (
          <div key={e.title} className={`ev${e.at ? ' go' : ''}`} title={e.at ? `${e.title}\nЩёлкните — показать на карте` : `${e.title}\nВ расчёте не случилось`} onClick={() => e.at && onEvent(e)}>
            <div className="ev-t">{e.title.split(':')[0]}</div>
            <div className="ev-d"><span className="muted">{ddmm(e.historical)} → {e.simulated ? ddmm(e.simulated) : '—'}</span>
              <span className="days">{e.days.map((d, i) => <i key={i} className={dayClass(d)}>{fmtDays(d)}</i>)}</span></div>
          </div>
        ))}
      </div>
      <div className="rp-actions">
        <button onClick={onReport}>Отчёт</button>
        <button onClick={onOpen} title="Открыть результат в редакторе: правка, экспорт, сохранение на сервер">В редактор →</button>
        <button onClick={onSummary} disabled={!r.summary} title="Сводная карта операции, как в историческом атласе: этапы, линии фронта с датами, удары армий с датами выхода. Открывается в редакторе — правка, экспорт в SVG и PNG">Сводная карта →</button>
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

/* ───────────── плеер и легенда ───────────── */
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const toMs = (t: string) => Date.parse((t.length <= 16 ? t + ':00' : t) + (t.endsWith('Z') ? '' : 'Z'));
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 16);
const fmtLong = (t: string) => { const d = new Date(toMs(t)); return { day: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, hour: `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` }; };

export function Player({ start, end, time, setTime, events, onEvent, mark }: { start: string; end: string; time: string; setTime: (t: string) => void; events: SimResult['events']; onEvent: (e: SimResult['events'][number]) => void; mark?: { at: string; title: string } }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(12); // часов операции в секунду
  const t0 = toMs(start), t1 = toMs(end), cur = Math.min(t1, Math.max(t0, toMs(time)));
  const H = 3600_000, total = Math.max(1, (t1 - t0) / H);
  const live = useRef({ cur, speed }); live.current = { cur, speed };
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const next = live.current.cur + ((now - last) / 1000) * live.current.speed * H;
      last = now;
      if (next >= t1) { setTime(fromMs(t1)); setPlaying(false); return; }
      setTime(fromMs(next));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement)?.closest('input, select, textarea, button')) return;
      e.preventDefault(); if (!playing && cur >= t1) setTime(start); setPlaying(!playing);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const days: number[] = [];
  for (let d = Math.ceil(t0 / (24 * H)) * 24 * H; d <= t1; d += 24 * H) days.push(d);
  const pos = (ms: number) => `${((ms - t0) / (t1 - t0)) * 100}%`;
  const { day, hour } = fmtLong(fromMs(cur));
  const step = (h: number) => setTime(fromMs(Math.min(t1, Math.max(t0, cur + h * H))));
  return (
    <div className="player">
      <div className="pl-date"><b>{day}</b><span>{hour} мск · ход {Math.floor((cur - t0) / H / 24) + 1}</span></div>
      <div className="pl-ctl">
        <button className="ic" title="Назад на сутки" onClick={() => step(-24)}>⏮</button>
        <button className="pl-play" title={playing ? 'Пауза (пробел)' : 'Воспроизвести (пробел)'} onClick={() => { if (!playing && cur >= t1) setTime(start); setPlaying(!playing); }}>{playing ? '❚❚' : '▶'}</button>
        <button className="ic" title="Вперёд на сутки" onClick={() => step(24)}>⏭</button>
        <select value={speed} onChange={(e) => setSpeed(+e.target.value)} title="Скорость: часов операции в секунду">
          {[3, 6, 12, 24, 48].map((v) => <option key={v} value={v}>{v} ч/с</option>)}
        </select>
      </div>
      <div className="pl-track">
        <div className="pl-days">{days.map((d) => <i key={d} style={{ left: pos(d) }} />)}</div>
        <div className="pl-fill" style={{ width: pos(cur) }} />
        {mark && toMs(mark.at) >= t0 && toMs(mark.at) <= t1 && <i className="pl-mark" style={{ left: pos(toMs(mark.at)) }} title={mark.title} />}
        {events.filter((e) => e.at).map((e) => (
          <button key={e.title} className={`pl-ev ${e.days[0] == null ? 'miss' : Math.abs(e.days[0]) <= 1 ? 'ok' : Math.abs(e.days[0]) <= 2 ? 'near' : 'off'}${e.marker ? ' star' : ''}`}
            style={{ left: pos(toMs(e.at!)) }} title={`${e.title}\nрасчёт: ${e.simulated ? ddmm(e.simulated) : '—'}, история: ${ddmm(e.historical)}`} onClick={() => onEvent(e)} />
        ))}
        <input type="range" min={0} max={total} step={1} value={(cur - t0) / H} onChange={(e) => { setPlaying(false); setTime(fromMs(t0 + +e.target.value * H)); }} />
        <div className="pl-ends"><span>{ddmm(start)}</span><span>{ddmm(end)}</span></div>
      </div>
    </div>
  );
}

export function Legend({ on, toggle, extra = [], combat = true }: { on: (key: string) => boolean; toggle: (key: string) => void; extra?: { cls: string; text: string; mark?: string }[]; combat?: boolean }) {
  const [open, setOpen] = useState(true);
  const rows: { key?: string; cls: string; text: string; mark?: string }[] = [
    { cls: 'lg-own', text: 'советские войска' },
    { cls: 'lg-enemy', text: 'немецкие войска' },
    { key: 'ghosts', cls: 'lg-ghost', text: 'историческое положение' },
    { key: 'front', cls: 'lg-front', text: 'линия фронта (расчёт)' },
    { key: 'front', cls: 'lg-front-prev', text: 'она же сутки назад' },
    { key: 'front', cls: 'lg-front-start', text: 'передний край на начало' },
    { key: 'hfront', cls: 'lg-hfront', text: 'линия фронта (история)' },
    { key: 'bounds', cls: 'lg-bound', text: 'разграничительная линия фронтов' },
    { key: 'hbounds', cls: 'lg-hbound', text: 'разграничительная линия по директиве' },
    ...(combat ? [{ key: 'combat', cls: 'lg-arrow', text: 'бой за ход' }] : []),
    { cls: 'lg-flag', text: 'Знамя Победы', mark: '⚑' },
    ...extra,
  ];
  return (
    <div className={`legend${open ? '' : ' closed'}`}>
      <button className="lg-h" onClick={() => setOpen(!open)}>Условные обозначения {open ? '▾' : '▸'}</button>
      {open && <div className={`lg-b${rows.length > 12 ? ' two' : ''}`}>
        {rows.map((r) => r.key
          ? <button key={r.text} className={`lg-row${on(r.key) ? '' : ' off'}`} title={on(r.key) ? 'Скрыть на карте' : 'Показать на карте'} onClick={() => toggle(r.key!)}><i className={r.cls}>{r.mark}</i>{r.text}{!on(r.key) && <span className="lg-eye">скрыто</span>}</button>
          : <div key={r.text} className="lg-row"><i className={r.cls}>{r.mark}</i>{r.text}</div>)}
      </div>}
    </div>
  );
}

/** Полнота материалов выбранной операции — перед расчётом. */
function ReplayCoverage({ op }: { op: string }) {
  const c = useCoverage(op);
  if (!c) return null;
  return <div className={`rp-cov l-${c.level}`} title="Подробно — «Моделирование» → «Операции» или «Знания» → «Полнота»">
    Материалы операции: <b>{Math.round(c.score * 100)} %</b> — {COVERAGE_LEVEL[c.level]}</div>;
}
