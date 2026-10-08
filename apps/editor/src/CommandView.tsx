/**
 * «Командование»: игра с выбранного момента переигровки до конца операции.
 * Советской стороной командует человек — с полной штабной работой: доклады
 * подчинённых, разведсводка, боевое распоряжение (приказы с задержкой доведения),
 * журнал боевых действий. Немецкой стороной — штаб на модели (LM Studio): решает
 * одновременно с человеком по своей обстановке. Посредник видит решения модели и
 * может снять туман войны. Игра сохраняется в браузере после каждого хода.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createFeature, migrateDocument, type ArrowFeature, type LngLat, type MapDocument } from '@def-ops/core';
import { TASK_RU, type GameRecord, type Order, type Target, type Task, type UnitReport } from '@def-ops/sim';
import type { AiTurn } from '@def-ops/staff-service/live';
import type { AiStatus, EnemyMode, GameRequest, GameResponse, GameStart, Place, TurnView } from './sim/game-protocol';
import { MapView } from './MapView';
import type { MapEngine } from './engine/types';
import { BasemapControls, Popover } from './ui';
import type { Basemaps, Llm } from './shared';
import { ZonesContext } from './time';
import { download, Legend, Player } from './ReplayView';

export const SAVE_KEY = 'def_ops.game';
export interface SavedGame { record: GameRecord; enemy: EnemyMode; title: string; turn: string }
export function loadSaved(): SavedGame | null {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as SavedGame | null; return s?.record?.version === 1 ? s : null; } catch { return null; }
}

const TASKS: Task[] = ['attack', 'counterattack', 'defend', 'hold', 'delay', 'regroup', 'reserve', 'withdraw', 'breakout', 'relieve'];
/** Задачи, для которых цель обязательна. */
const NEEDS_TARGET: Task[] = ['attack', 'counterattack', 'regroup', 'withdraw', 'breakout', 'relieve'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const toMs = (t: string) => Date.parse((t.length <= 16 ? t + ':00' : t) + 'Z');
const addH = (t: string, h: number) => new Date(toMs(t) + h * 3600_000).toISOString().slice(0, 16);
const ddmm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;
const hhmm = (t: string) => t.slice(11, 16);
const dayLong = (t: string) => { const d = new Date(toMs(t)); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const pct = (x: number) => `${Math.round(x * 100)} %`;
const num = (x: number) => x.toFixed(1).replace('.', ',');
const short = (n: string) => n.replace(/\s*\(.*?\)\s*/g, ' ').trim();

interface Draft { formation: string; task: Task; target: Target; targetText: string; at: LngLat | null; note: string }
type Tab = 'reports' | 'intel' | 'orders' | 'journal' | 'umpire';

const TOGGLES = [
  { key: 'ghosts', title: 'Ист. положения', match: (id: string) => id === 'hist-units' },
  { key: 'hfront', title: 'Ист. фронт', match: (id: string) => id === 'hist-front' },
  { key: 'front', title: 'Фронт', match: (id: string) => id === 'sim-front' },
  { key: 'combat', title: 'Бои', match: (id: string) => id === 'sim-combat' },
  { key: 'plan', title: 'Замысел', match: (id: string) => id === 'plan' },
];

export function CommandView({ bm, llm, start, saved, enemy: enemy0, onExit, onOpenInEditor }: {
  bm: Basemaps; llm: Llm; start: GameStart | null; saved: SavedGame | null; enemy: EnemyMode;
  onExit: (opts: { discard: boolean }) => void; onOpenInEditor: (d: MapDocument) => void;
}) {
  const [view, setView] = useState<TurnView | null>(null);
  const [progress, setProgress] = useState<string | null>('запуск…');
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus>({ state: 'off' });
  const [stream, setStream] = useState('');
  const [blocked, setBlocked] = useState<string | null>(null);
  const [record, setRecord] = useState<GameRecord | null>(saved?.record ?? null);
  const [enemy, setEnemy] = useState<EnemyMode>(saved?.enemy ?? enemy0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [tab, setTab] = useState<Tab>('reports');
  const [sel, setSel] = useState<string | null>(null);
  const [pick, setPick] = useState(false);
  const [time, setTime] = useState<string | null>(null);
  const [vis, setVis] = useState<Record<string, boolean>>({ ghosts: false, hfront: false, front: true, combat: true, plan: true });
  const [reveal, setReveal] = useState(false);
  const [now, setNow] = useState(Date.now());
  const worker = useRef<Worker | null>(null);
  const engine = useRef<MapEngine | null>(null);
  const live = useRef({ pick, sel });
  live.current = { pick, sel };
  const liveView = useRef<TurnView | null>(null);
  liveView.current = view;

  const send = (m: GameRequest) => worker.current?.postMessage(m);

  useEffect(() => {
    const w = new Worker(new URL('./sim/game-worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<GameResponse>) => {
      const m = e.data;
      if (m.kind === 'progress') setProgress(m.text);
      else if (m.kind === 'error') { setProgress(null); setError(m.message); }
      else if (m.kind === 'view') {
        setProgress(null); setBlocked(null);
        setView({ ...m.view, doc: migrateDocument(m.view.doc) });
        setTime(m.view.time);
        setDrafts({});
      } else if (m.kind === 'ai') setAi(m.status);
      else if (m.kind === 'ai-stream') setStream((s) => (m.reset ? '' : (s + m.text).slice(-4000)));
      else if (m.kind === 'blocked') { setProgress(null); setBlocked(m.error); }
      else if (m.kind === 'record') {
        setRecord(m.record);
        try { localStorage.setItem(SAVE_KEY, JSON.stringify({ record: m.record, enemy: enemyRef.current, title: titleRef.current, turn: m.record.turns.length ? addH(m.record.turns[m.record.turns.length - 1].time, 0) : m.record.takeover } satisfies SavedGame)); } catch { /* */ }
      }
    };
    w.onerror = (e) => { setProgress(null); setError(e.message || 'ошибка игры'); };
    const st: GameStart = saved ? { scenario: saved.record.scenario, rules: saved.record.rules, seed: saved.record.seed, takeover: saved.record.takeover } : start!;
    w.postMessage({ kind: 'start', start: st, record: saved?.record, llm: llm.settings, enemy } satisfies GameRequest);
    return () => w.terminate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const enemyRef = useRef(enemy); enemyRef.current = enemy;
  const titleRef = useRef(''); titleRef.current = view?.scenarioName ?? saved?.title ?? '';

  useEffect(() => { send({ kind: 'settings', llm: llm.settings, enemy }); }, [llm.settings, enemy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ai.state !== 'thinking') return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [ai.state]);

  // выбор точки на карте (цель приказа) и знака (формирование)
  useEffect(() => {
    const en = engine.current;
    if (!en) return;
    return en.on('click', (e) => {
      if (!live.current.pick || !live.current.sel) {
        // щелчок по знаку своего объединения — выбрать его (доклад, приказ)
        let best: string | null = null, bd = 18;
        for (const u of liveView.current?.own ?? []) {
          if (u.status !== 'active') continue;
          const p = en.project(u.at);
          const dd = Math.hypot(p[0] - e.point[0], p[1] - e.point[1]);
          if (dd < bd) { bd = dd; best = u.id; }
        }
        if (best) setSel(best);
        return;
      }
      const at = e.lngLat;
      setDrafts((d) => ({ ...d, [live.current.sel!]: { ...(d[live.current.sel!] ?? blankDraft(live.current.sel!)), target: at, at, targetText: `точка ${at[1].toFixed(3)}° с.ш., ${at[0].toFixed(3)}° в.д.` } }));
      setPick(false);
    });
  }, [view?.scenario, engine.current]); // eslint-disable-line react-hooks/exhaustive-deps

  const unit = (id: string | null) => view?.own.find((u) => u.id === id) ?? null;
  const blankDraft = (id: string): Draft => ({ formation: id, task: 'attack', target: null, targetText: '', at: null, note: '' });

  /** Документ карты: туман войны (из расчёта), замысел — стрелки проекта приказов, видимость слоёв. */
  const doc = useMemo(() => {
    if (!view) return null;
    const d: MapDocument = { ...view.doc, layers: [...view.doc.layers, { id: 'plan', name: 'Замысел: проект приказов', role: 'custom', visible: true, locked: true, opacity: 0.9 }] };
    d.layers = d.layers.map((l) => { const t = TOGGLES.find((x) => x.match(l.id)); return t ? { ...l, visible: vis[t.key] } : l; });
    const plan = Object.values(drafts).flatMap((dr) => {
      const u = unit(dr.formation);
      if (!u || !dr.at) return [];
      const mid: LngLat = [(u.at[0] + dr.at[0]) / 2, (u.at[1] + dr.at[1]) / 2];
      const preset = dr.task === 'withdraw' ? 'inf.retreat' : ['attack', 'counterattack', 'breakout', 'relieve'].includes(dr.task) ? 'inf.attack' : 'inf.attackFade';
      const a = createFeature('arrow', preset, { points: [u.at, mid, dr.at], layerId: 'plan' }, 0.55, 'own') as ArrowFeature;
      a.name = `${short(u.name)}: ${TASK_RU[dr.task]} — ${dr.targetText}`;
      a.time = { from: view.time, to: null };
      return [a];
    });
    d.features = [...view.doc.features, ...plan];
    return d;
  }, [view, drafts, vis]); // eslint-disable-line react-hooks/exhaustive-deps

  const goTo = (at: LngLat | null, zoomIn = true) => {
    const en = engine.current;
    if (!at || !en) return;
    const z = en.getView().zoom;
    en.setView({ center: at, zoom: zoomIn ? Math.max(z, 9) : z });
  };
  const draftList = Object.values(drafts);
  const endTurn = () => {
    if (!view) return;
    const bad = draftList.filter((d) => NEEDS_TARGET.includes(d.task) && !d.target);
    if (bad.length) { alert(`Не указана цель:\n${bad.map((d) => `${short(unit(d.formation)?.name ?? d.formation)} — ${TASK_RU[d.task]}`).join('\n')}`); setTab('orders'); setSel(bad[0].formation); return; }
    const orders: Order[] = draftList.map((d) => ({ id: `human@${view.time}:${d.formation}`, formation: d.formation, task: d.task, target: d.target, issuedAt: view.time, source: 'human', note: d.note || undefined }));
    setProgress('отправка приказов…');
    send({ kind: 'turn', orders });
  };
  const aiTurns = (record?.turns ?? []).filter((t) => t.ai).map((t) => t.ai as AiTurn).reverse();
  const current = ai.state === 'done' || ai.state === 'error' ? ai.turn : undefined;

  const journalMd = () => {
    if (!view) return '';
    const lines = [`# Журнал боевых действий: ${view.scenarioName}`, '', `Командование принято ${ddmm(view.takeover)} ${hhmm(view.takeover)}. Сторона: ${view.human.name}. Противник: ${view.ai.name} — ${enemy === 'llm' ? 'штаб на модели' : 'без штаба (прежние приказы)'}.`, ''];
    for (const d of view.journal) {
      lines.push(`## ${dayLong(d.time)}, ${hhmm(d.time)}`, '', '**Отданы приказы:**', '', ...(d.orders.length ? d.orders.map((o) => `- ${o}`) : ['- новых приказов нет']), '', '**Донесения за ход:**', '', ...(d.events.length ? d.events.map((x) => `- ${x}`) : ['- существенных событий нет']), '');
    }
    if (aiTurns.length) {
      lines.push('# Решения штаба противника (для разбора)', '');
      for (const t of [...aiTurns].reverse()) {
        lines.push(`## ${dayLong(t.time)}, ${hhmm(t.time)} — ${t.model}`, '');
        if (!t.ok) { lines.push(`Ошибка: ${t.error}`, ''); continue; }
        const d = t.decision!;
        lines.push('**Оценка обстановки.** ' + d.assessment, '', '**Замысел противника (как его понял штаб).** ' + d.enemyIntent, '', '**Замысел.** ' + d.intent, '', '**Приказы:**', '',
          ...t.applied.map((a) => `- ${a.given.formation}: ${TASK_RU[a.given.task]} — ${a.target ?? a.given.toArea ?? a.given.area}${a.order ? '' : ' (не исполнен)'}${a.given.details ? `. ${a.given.details}` : ''}${a.issue ? ` — ${a.issue}` : ''}`),
          '', '**Доклады наверх:**', '', ...d.requests.map((x) => `- ${x}`), '', '**Риски:**', '', ...d.risks.map((x) => `- ${x}`), '');
      }
    }
    return lines.join('\n');
  };

  const zones = useMemo(() => ({ local: 'Europe/Berlin', localFixed: true, input: 'msk' as const, setInput: () => {} }), []);
  const layerOn = (k: string) => vis[k] ?? true;
  const toggle = (k: string) => setVis((h) => ({ ...h, [k]: !(h[k] ?? true) }));
  const goals = view?.goals ?? [];
  const playerEvents = goals.map((g) => ({ title: g.title, historical: g.historical, simulated: g.simulated, days: [g.days], at: g.at, place: g.place, marker: false }));

  if (error && !view) return <div className="rp-empty"><div><b>Игра не запустилась</b><p className="err">{error}</p><button onClick={() => onExit({ discard: false })}>Назад к переигровке</button></div></div>;

  return (
    <ZonesContext.Provider value={zones}>
    <div className="replay cmd">
      <aside className="rp-side cmd-side">
        <div className="cmd-head">
          <div className="cmd-top">
            <span className="cmd-kicker" title={view?.scenarioName}>Командование · {(view?.scenarioName ?? saved?.title ?? '').split(':')[0]}</span>
            <Popover label="⋯" align="right" title="Игра">{(close) => (
              <div className="menu">
                <button onClick={() => { close(); download(`${view?.scenario}-журнал.md`, journalMd(), 'text/markdown'); }}>Скачать журнал боевых действий (.md)</button>
                <button onClick={() => { close(); if (record) download(`${record.scenario}-игра.json`, JSON.stringify(record, null, 1), 'application/json'); }}>Скачать запись игры (.json)</button>
                <button onClick={() => { close(); if (doc) onOpenInEditor(doc); }}>Открыть карту в редакторе</button>
                <hr />
                <button onClick={() => { close(); onExit({ discard: false }); }}>Выйти (игра сохранена)</button>
                <button className="danger" onClick={() => { close(); if (confirm('Завершить игру и удалить её запись?')) onExit({ discard: true }); }}>Завершить и удалить игру</button>
              </div>
            )}</Popover>
          </div>
          {view && <div className="cmd-date">
            <b>{dayLong(view.time)}, {hhmm(view.time)}</b>
            <span>ход {view.turn} из {view.turns} · вы командуете: {view.human.name}</span>
          </div>}
          <AiChip ai={ai} enemy={enemy} now={now} model={llm.settings.model} onClick={() => setTab('umpire')} />
        </div>
        <nav className="cmd-tabs">
          {([['reports', 'Доклады'], ['intel', 'Разведка'], ['orders', `Приказы${draftList.length ? ` · ${draftList.length}` : ''}`], ['journal', 'Журнал'], ['umpire', 'Посредник']] as [Tab, string][]).map(([k, t]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>
          ))}
        </nav>
        <div className="cmd-body">
          {!view ? <div className="cmd-wait"><span className="spinner" /> {progress}</div> : <>
            {tab === 'reports' && <Reports v={view} drafts={drafts} onUnit={(id) => { setSel(id); goTo(unit(id)?.at ?? null, false); }} onOrder={(id) => { setSel(id); setTab('orders'); }} sel={sel} />}
            {tab === 'intel' && <Intel v={view} onGo={(at) => goTo(at)} onAttack={(id, name) => { if (!sel) { setTab('orders'); return; } setDrafts((d) => ({ ...d, [sel]: { ...(d[sel] ?? blankDraft(sel)), task: 'attack', target: { formation: id }, at: view.intel.find((x) => x.id === id)?.at ?? null, targetText: `против: ${name}` } })); setTab('orders'); }} />}
            {tab === 'orders' && <Orders v={view} drafts={drafts} setDrafts={setDrafts} sel={sel} setSel={(id) => { setSel(id); goTo(unit(id)?.at ?? null, false); }} pick={pick} setPick={setPick} blank={blankDraft} />}
            {tab === 'journal' && <Journal v={view} onDownload={() => download(`${view.scenario}-журнал.md`, journalMd(), 'text/markdown')} />}
            {tab === 'umpire' && <Umpire ai={ai} turns={aiTurns} current={current} stream={stream} reveal={reveal} setReveal={(on) => { setReveal(on); send({ kind: 'reveal', on }); }}
              enemy={enemy} setEnemy={setEnemy} llm={llm} onRetry={() => send({ kind: 'retry-ai' })} />}
          </>}
        </div>
        {view && !view.over && <div className="cmd-foot">
          {blocked ? <div className="cmd-blocked">
            <b>Штаб противника не дал решения</b><span>{blocked}</span>
            <div><button onClick={() => { setBlocked(null); setProgress('повторный запрос…'); send({ kind: 'retry-ai' }); }}>Повторить запрос</button>
              <button onClick={() => { setBlocked(null); setProgress('расчёт хода…'); send({ kind: 'skip-ai' }); }}>Ход без новых приказов противника</button></div>
          </div> : progress ? <button className="rp-go" disabled><span className="spinner" /> {progress}</button>
            : <button className="rp-go primary" onClick={endTurn} title="Отдать приказы и посчитать ход">
              Провести {view.turnHours === 24 ? 'сутки' : `${view.turnHours} ч`} ▸ <small>{draftList.length ? `${draftList.length} прик.` : 'без новых приказов'}</small>
            </button>}
        </div>}
        {view?.over && <div className="cmd-foot cmd-over"><b>Операция завершена — {ddmm(view.time)}</b>
          <span>{goals.filter((g) => g.simulated).length} из {goals.length} контрольных событий случились. Журнал и запись игры — в меню «⋯».</span>
          <button onClick={() => download(`${view.scenario}-журнал.md`, journalMd(), 'text/markdown')}>Скачать журнал</button></div>}
      </aside>
      <main className={`rp-main${pick ? ' picking' : ''}`}>
        {doc && time ? <>
          <MapView doc={doc} setDoc={() => {}} selected={null} setSelected={() => {}}
            selectedOverlay={null} tool={{ mode: 'select' }} setTool={() => {}} activeLayer={null} basemap={bm.current} basemapOpacity={bm.opacity}
            onEngineReady={(e) => { engine.current = e; }} onStatus={() => {}} time={time} newFromNow={false} />
          {pick && <div className="pick-hint">Щёлкните по карте — цель приказа для «{short(unit(sel)?.name ?? '')}» <button onClick={() => setPick(false)}>Отмена</button></div>}
          <div className="rp-tools">
            {TOGGLES.map((t) => <button key={t.key} className={`chip${layerOn(t.key) ? ' on' : ''}`} onClick={() => toggle(t.key)}>{t.title}</button>)}
            <Popover label="Подложка" align="right"><BasemapControls bm={bm} /></Popover>
          </div>
          <Legend on={layerOn} toggle={toggle} />
          {view && <Player start={view.start} end={view.time > view.start ? view.time : addH(view.start, view.turnHours)} time={time} setTime={setTime} events={playerEvents}
            onEvent={(e) => { if (e.at) setTime(e.at); goTo(e.place ?? null); }} mark={{ at: view.takeover, title: `Командование принято: ${ddmm(view.takeover)} ${hhmm(view.takeover)}` }} />}
        </> : <div className="rp-empty"><div><div className="rp-empty-ic"><span className="spinner big" /></div><b>{progress ?? 'Подготовка…'}</b></div></div>}
      </main>
    </div>
    </ZonesContext.Provider>
  );
}

function AiChip({ ai, enemy, now, model, onClick }: { ai: AiStatus; enemy: EnemyMode; now: number; model: string; onClick: () => void }) {
  const sec = ai.state === 'thinking' ? Math.max(0, Math.round((now - ai.since) / 1000)) : 0;
  const text = enemy === 'passive' ? 'противник без штаба: держится прежних приказов'
    : ai.state === 'thinking' ? `штаб противника принимает решение… ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
    : ai.state === 'done' ? `штаб противника принял решение${ai.turn.timings ? ` (${Math.round(ai.turn.timings.totalMs / 1000)} с)` : ''}`
    : ai.state === 'error' ? 'штаб противника: нет решения — см. «Посредник»' : 'штаб противника: ожидание';
  return <button className={`ai-chip ${enemy === 'passive' ? 'off' : ai.state}`} onClick={onClick} title={model ? `модель: ${model}` : 'модель: первая загруженная в LM Studio'}><i />{text}</button>;
}

/* ───────────── доклады ───────────── */

function Bar({ v, warn = 0.5, bad = 0.25, label }: { v: number; warn?: number; bad?: number; label: string }) {
  const cls = v <= bad ? 'bad' : v <= warn ? 'warn' : 'ok';
  return <span className={`bar ${cls}`} title={label}><i style={{ width: `${Math.max(3, Math.min(100, v * 100))}%` }} /></span>;
}

function UnitCard({ u, open, onToggle, onOrder, draft }: { u: UnitReport; open: boolean; onToggle: () => void; onOrder: () => void; draft?: Draft }) {
  const chips: [string, string][] = [];
  if (u.status === 'arriving') chips.push(['muted', `прибудет ${ddmm(u.arrives!)}`]);
  if (u.status === 'destroyed') chips.push(['bad', 'утратила боеспособность']);
  if (u.cutOff) chips.push(['bad', 'отрезана']);
  if (u.status === 'active' && u.ammo < 0.5) chips.push(['warn', 'мало боеприпасов']);
  if (u.status === 'active' && u.fuel <= 0.05) chips.push(['warn', 'нет горючего']);
  for (const c of u.combats.slice(0, 1)) chips.push([c.outcome === 'прорыв' || c.outcome === 'продвижение' ? 'ok' : 'warn', c.role === 'attack' ? c.outcome : c.outcome === 'оборона удержана' || c.outcome === 'атака отбита' ? 'отбила атаку' : 'под натиском']);
  if (draft) chips.push(['plan', 'новый приказ']);
  return (
    <div className={`ucard${open ? ' open' : ''}${u.status !== 'active' ? ' dim' : ''}`}>
      <button className="ucard-h" onClick={onToggle}>
        <span className="ucard-n">{short(u.name)}</span>
        <span className="ucard-bars"><Bar v={u.strength} label={`укомплектованность ${pct(u.strength)}`} /><Bar v={u.ammo / 2} label={`боеприпасы ${num(u.ammo)} бк`} /><Bar v={u.fuel / 2} label={`горючее ${num(u.fuel)} запр.`} /></span>
        <span className="ucard-p">{u.status === 'active' ? `${u.posture}, ${u.place}` : u.status === 'arriving' ? `в резерве Ставки, прибудет ${ddmm(u.arrives!)}` : 'уничтожена'}</span>
        {chips.length > 0 && <span className="ucard-chips">{chips.map(([c, t]) => <i key={t} className={c}>{t}</i>)}</span>}
      </button>
      {open && <div className="ucard-b">
        <dl>
          <dt>Задача</dt><dd>{u.task ? `${u.task} — ${u.target}` : 'нет'}{u.orderSource && <small> · {u.orderSource === 'script' ? 'по историческому плану' : u.orderSource === 'human' ? 'ваш приказ' : u.orderSource}</small>}</dd>
          {u.pending.length > 0 && <><dt>В пути</dt><dd>{u.pending.map((p, i) => <div key={i}>{p.task} — {p.target} <small>(отдан {ddmm(p.issuedAt)} {hhmm(p.issuedAt)})</small></div>)}</dd></>}
          <dt>Состав</dt><dd>{pct(u.strength)} — {u.personnel.toLocaleString('ru')} чел., танков и САУ {u.tanks}, орудий {u.guns}</dd>
          <dt>Запасы</dt><dd>боеприпасы {num(u.ammo)} бк, горючее {num(u.fuel)} запр.{u.cutOff ? ' · подвоз прерван' : ''}</dd>
          <dt>Усталость</dt><dd>{pct(u.fatigue)}</dd>
          <dt>За ход</dt><dd>{u.movedKm >= 0.5 ? `переместилась на ${Math.round(u.movedKm)} км` : 'на месте'}{u.combats.map((c, i) => <div key={i}>{c.role === 'attack' ? 'наступала на' : 'отражала'} {c.against.map(short).join(', ')}: {c.outcome}{c.advanceKm ? ` на ${num(c.advanceKm)} км` : ''}, соотношение {num(c.ratio)}:1, потери {c.lossPct} %</div>)}</dd>
        </dl>
        {u.status !== 'destroyed' && <button className="link" onClick={onOrder}>{draft ? 'Изменить приказ →' : 'Отдать приказ →'}</button>}
      </div>}
    </div>
  );
}

function Grouped({ v, children }: { v: TurnView; children: (u: UnitReport) => ReactNode }) {
  const groups = [...v.groups, { id: '', name: 'Прочие' }];
  return <>{groups.map((g) => {
    const list = v.own.filter((u) => (g.id ? u.parent === g.id : !v.groups.some((x) => x.id === u.parent)));
    if (!list.length) return null;
    return <section key={g.id || 'other'} className="grp"><h4>{g.name} <small>{list.filter((u) => u.status === 'active').length} в строю</small></h4>{list.map(children)}</section>;
  })}</>;
}

function Reports({ v, drafts, onUnit, onOrder, sel }: { v: TurnView; drafts: Record<string, Draft>; onUnit: (id: string) => void; onOrder: (id: string) => void; sel: string | null }) {
  const active = v.own.filter((u) => u.status === 'active');
  const cut = active.filter((u) => u.cutOff).length;
  const strength = active.length ? active.reduce((s, u) => s + u.strength, 0) / active.length : 0;
  const reached = v.goals.filter((g) => g.simulated);
  return (
    <div className="cmd-sec">
      <h3>Оперативная сводка к {hhmm(v.time)} {ddmm(v.time)}</h3>
      <div className="kpis small">
        <div><b>{active.length}</b><span>объединений в строю</span></div>
        <div><b>{pct(strength)}</b><span>средняя укомплектованность</span></div>
        <div className={cut ? 'alarm' : ''}><b>{cut}</b><span>отрезано от подвоза</span></div>
      </div>
      {v.turn > 1 && <div className="dispatch">
        <h4>Донесения за ход</h4>
        {v.events.length ? <ul>{v.events.map((e, i) => <li key={i}>{e}</li>)}</ul> : <p className="muted">Существенных событий нет.</p>}
      </div>}
      {v.turn === 1 && <p className="note">Командование принято. Войска выполняют задачи, полученные до этого момента; исторические приказы дальше не поступают. Новые приказы — во вкладке «Приказы».</p>}
      {reached.length > 0 && <div className="dispatch"><h4>Достигнуто</h4><ul>{reached.map((g) => <li key={g.title}>{g.title.split(':')[0]} — {ddmm(g.simulated!)} <small className="muted">(в истории {ddmm(g.historical)})</small></li>)}</ul></div>}
      <h4 className="cmd-h4">Доклады объединений</h4>
      <Grouped v={v}>{(u) => <UnitCard key={u.id} u={u} open={sel === u.id} draft={drafts[u.id]} onToggle={() => onUnit(sel === u.id ? '' : u.id)} onOrder={() => onOrder(u.id)} />}</Grouped>
    </div>
  );
}

function Intel({ v, onGo, onAttack }: { v: TurnView; onGo: (at: LngLat) => void; onAttack: (id: string, name: string) => void }) {
  return (
    <div className="cmd-sec">
      <h3>Разведсводка к {hhmm(v.time)} {ddmm(v.time)}</h3>
      <p className="note">Противник виден в пределах {v.detectKm} км от наших войск (войсковая и авиационная разведка). Силы — оценка, округлённо. Что дальше — неизвестно.</p>
      {!v.intel.length && <p className="muted">Противник в пределах разведки не обнаружен.</p>}
      {v.intel.map((e) => (
        <div key={e.id} className="intel" onClick={() => onGo(e.at)}>
          <div className="intel-h"><b>{short(e.name)}</b>{e.fresh && <i className="fresh">новое</i>}<span className="muted">{e.posture}</span></div>
          <div>{e.place}{e.nearest ? ` · ${Math.round(e.nearest.km)} км от: ${short(e.nearest.name)}` : ''}</div>
          <div className="muted">{e.estimate}</div>
          <button className="link" onClick={(ev) => { ev.stopPropagation(); onAttack(e.id, e.name); }} title="Цель для выбранного объединения во вкладке «Приказы»">назначить целью удара →</button>
        </div>
      ))}
    </div>
  );
}

/* ───────────── приказы ───────────── */

function Orders({ v, drafts, setDrafts, sel, setSel, pick, setPick, blank }: {
  v: TurnView; drafts: Record<string, Draft>; setDrafts: (f: (d: Record<string, Draft>) => Record<string, Draft>) => void;
  sel: string | null; setSel: (id: string | null) => void; pick: boolean; setPick: (b: boolean) => void; blank: (id: string) => Draft;
}) {
  const u = v.own.find((x) => x.id === sel && x.status !== 'destroyed') ?? null;
  const d = u ? drafts[u.id] ?? null : null;
  const list = Object.values(drafts);
  return (
    <div className="cmd-sec">
      <h3>Боевое распоряжение на {ddmm(v.time)}</h3>
      <p className="note">Приказ доходит до войск не сразу: армиям — {v.delays.army ?? 0} ч, корпусам — {v.delays.corps ?? 0} ч. Объединения без нового приказа продолжают выполнять прежнюю задачу.</p>
      {list.length > 0 && <div className="draft-list">
        {list.map((x) => { const w = v.own.find((y) => y.id === x.formation)!; return (
          <div key={x.formation} className={`draft${x.formation === sel ? ' on' : ''}`} onClick={() => setSel(x.formation)}>
            <b>{short(w.name)}</b> — {TASK_RU[x.task]}{x.targetText ? `: ${x.targetText}` : ''}
            <button className="x" title="Отменить приказ" onClick={(e) => { e.stopPropagation(); setDrafts((all) => { const n = { ...all }; delete n[x.formation]; return n; }); }}>×</button>
          </div>); })}
      </div>}
      {u ? <OrderEditor v={v} u={u} d={d ?? blank(u.id)} isNew={!d} pick={pick} setPick={setPick}
        save={(nd) => setDrafts((all) => ({ ...all, [u.id]: nd }))} drop={() => setDrafts((all) => { const n = { ...all }; delete n[u.id]; return n; })} close={() => setSel(null)} />
        : <p className="muted">Выберите объединение — в списке ниже или щелчком по его знаку на карте.</p>}
      <h4 className="cmd-h4">Объединения</h4>
      <Grouped v={v}>{(x) => x.status === 'destroyed' ? null : (
        <button key={x.id} className={`orow${x.id === sel ? ' on' : ''}`} onClick={() => setSel(x.id)}>
          <span className="orow-n">{short(x.name)}</span>
          <span className="orow-t">{drafts[x.id] ? <b className="plan">{TASK_RU[drafts[x.id].task]}{drafts[x.id].targetText ? `: ${drafts[x.id].targetText}` : ''}</b> : x.status === 'arriving' ? `прибудет ${ddmm(x.arrives!)}` : x.task ? `${x.task} — ${x.target}` : 'без задачи'}</span>
        </button>)}</Grouped>
    </div>
  );
}

function OrderEditor({ v, u, d, isNew, pick, setPick, save, drop, close }: { v: TurnView; u: UnitReport; d: Draft; isNew: boolean; pick: boolean; setPick: (b: boolean) => void; save: (d: Draft) => void; drop: () => void; close: () => void }) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'place' | 'enemy' | 'point'>(Array.isArray(d.target) ? 'point' : d.target && typeof d.target === 'object' ? 'enemy' : 'place');
  useEffect(() => { setQ(''); }, [u.id]);
  const delay = v.delays[u.echelon] ?? 0;
  const P = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111;
  const nearPlaces = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return v.places.map((p) => ({ ...p, km: P(u.at, p.at) })).filter((p) => !ql || p.title.toLowerCase().includes(ql)).sort((a, b) => a.km - b.km).slice(0, ql ? 30 : 12);
  }, [q, u.id, v.places]); // eslint-disable-line react-hooks/exhaustive-deps
  const setPlace = (p: Place) => save({ ...d, target: p.id, at: p.at, targetText: p.title });
  const needs = NEEDS_TARGET.includes(d.task);
  const arrive = addH(v.time, delay);
  return (
    <div className="oedit">
      <div className="oedit-h"><b>{u.name}</b><button className="x" onClick={close} title="Закрыть">×</button></div>
      <div className="muted small">{u.status === 'arriving' ? `прибудет ${ddmm(u.arrives!)} — приказ будет ждать` : `${u.posture}, ${u.place} · сейчас: ${u.task ? `${u.task} — ${u.target}` : 'без задачи'}`}</div>
      <label>Задача
        <select value={d.task} onChange={(e) => save({ ...d, task: e.target.value as Task })}>
          {TASKS.map((t) => <option key={t} value={t}>{TASK_RU[t]}</option>)}
        </select>
      </label>
      <div className="seg">
        {([['place', 'Пункт'], ['enemy', 'Противник'], ['point', 'Точка на карте']] as const).map(([k, t]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{t}</button>)}
      </div>
      {mode === 'place' && <div className="pick-list">
        <input placeholder="Поиск пункта…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="pl-items">{nearPlaces.map((p) => <button key={p.id} className={d.target === p.id ? 'on' : ''} onClick={() => setPlace(p)}>{p.title}<small>{Math.round(p.km)} км</small></button>)}</div>
      </div>}
      {mode === 'enemy' && <div className="pick-list"><div className="pl-items">
        {v.intel.length ? v.intel.map((e) => <button key={e.id} className={typeof d.target === 'object' && d.target && !Array.isArray(d.target) && d.target.formation === e.id ? 'on' : ''}
          onClick={() => save({ ...d, target: { formation: e.id }, at: e.at, targetText: `против: ${short(e.name)}` })}>{short(e.name)}<small>{Math.round(P(u.at, e.at))} км</small></button>) : <span className="muted">Противник в пределах разведки не обнаружен</span>}
      </div></div>}
      {mode === 'point' && <button className={pick ? 'on' : ''} onClick={() => setPick(!pick)}>{pick ? 'Щёлкните по карте… (отмена)' : Array.isArray(d.target) ? 'Указать другую точку' : 'Указать точку на карте'}</button>}
      <div className={`otarget${needs && !d.target && !isNew ? ' miss' : ''}`}>{d.target ? <>Цель: <b>{d.targetText}</b> <button className="link" onClick={() => save({ ...d, target: null, at: null, targetText: '' })}>убрать</button></> : needs ? 'Для этой задачи нужна цель — выберите пункт, противника или точку' : 'Цель не указана — на месте'}</div>
      <label>Указания <textarea rows={2} value={d.note} placeholder="Силы, порядок, взаимодействие, срок…" onChange={(e) => save({ ...d, note: e.target.value })} /></label>
      <div className="muted small">Дойдёт до войск ≈ {hhmm(arrive)} {ddmm(arrive)} (через {delay} ч).</div>
      <div className="oedit-f">
        {isNew ? <span className="muted small">Приказ войдёт в распоряжение, как только вы выберете задачу или цель.</span>
          : <button className="link danger" onClick={drop}>Отменить приказ</button>}
      </div>
    </div>
  );
}

/* ───────────── журнал и посредник ───────────── */

function Journal({ v, onDownload }: { v: TurnView; onDownload: () => void }) {
  return (
    <div className="cmd-sec">
      <div className="row"><h3>Журнал боевых действий</h3><button onClick={onDownload}>Скачать .md</button></div>
      {!v.journal.length && <p className="muted">Записи появятся после первого хода.</p>}
      {[...v.journal].reverse().map((d) => (
        <div key={d.time} className="jday">
          <h4>{dayLong(d.time)}, {hhmm(d.time)}</h4>
          <div className="jsub">Отданы приказы</div>
          {d.orders.length ? <ul>{d.orders.map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="muted">новых приказов нет</p>}
          <div className="jsub">Донесения</div>
          {d.events.length ? <ul>{d.events.map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="muted">существенных событий нет</p>}
        </div>
      ))}
    </div>
  );
}

function Umpire({ ai, turns, current, stream, reveal, setReveal, enemy, setEnemy, llm, onRetry }: {
  ai: AiStatus; turns: AiTurn[]; current?: AiTurn; stream: string; reveal: boolean; setReveal: (b: boolean) => void;
  enemy: EnemyMode; setEnemy: (e: EnemyMode) => void; llm: Llm; onRetry: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const list = current && !turns.some((t) => t.time === current.time) ? [current, ...turns] : turns;
  return (
    <div className="cmd-sec">
      <p className="note warnbox">Посредник видит решения штаба противника и может снять туман войны. Если играете честно — заглядывайте сюда после игры.</p>
      <label className="switch"><input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /><span /> Показать на карте всех (снять туман войны)</label>
      <div className="umpire-cfg">
        <label>Противник
          <select value={enemy} onChange={(e) => setEnemy(e.target.value as EnemyMode)}>
            <option value="llm">штаб на модели (LM Studio)</option>
            <option value="passive">без штаба — держится прежних приказов</option>
          </select>
        </label>
        <label>Размышление
          <select value={llm.settings.thinking} onChange={(e) => llm.set({ thinking: e.target.value as typeof llm.settings.thinking })}>
            <option value="off">нет (быстрее)</option><option value="low">короткое</option><option value="medium">обычное</option><option value="high">глубокое</option>
          </select>
        </label>
        <span className={`llm-st ${llm.check.state}`}>{llm.check.state === 'ok' ? `модель: ${llm.settings.model || llm.check.models[0]}` : llm.check.state === 'fail' ? `LM Studio: ${llm.check.error}` : 'проверка связи…'}</span>
      </div>
      {ai.state === 'thinking' && <div className="ai-live"><div className="jsub">Штаб противника думает над решением на {ddmm(ai.time)} {hhmm(ai.time)}…</div><pre>{stream.slice(-1500) || '…'}</pre></div>}
      {ai.state === 'error' && <div className="cmd-blocked"><b>Нет решения на {ddmm(ai.time)}</b><span>{ai.error}</span><div><button onClick={onRetry}>Повторить запрос</button></div></div>}
      <h4 className="cmd-h4">Решения штаба противника</h4>
      {!list.length && <p className="muted">Решений пока нет.</p>}
      {list.map((t) => {
        const k = t.time, d = t.decision;
        return (
          <div key={k} className={`aiturn${open === k ? ' open' : ''}`}>
            <button className="aiturn-h" onClick={() => setOpen(open === k ? null : k)}>
              <b>{ddmm(t.time)} {hhmm(t.time)}</b>
              <span>{t.ok ? d!.intent : `ошибка: ${t.error}`}</span>
              <small>{t.model}{t.timings ? ` · ${Math.round(t.timings.totalMs / 1000)} с` : ''}{t.repaired ? ' · переписан в JSON' : ''}</small>
            </button>
            {open === k && t.ok && d && <div className="aiturn-b">
              <div className="jsub">Приказы</div>
              <ul>{t.applied.map((a, i) => <li key={i} className={a.order ? '' : 'rej'}><b>{short(a.formation ?? a.given.formation)}</b>: {TASK_RU[a.given.task]} — {a.target ?? a.given.toArea ?? a.given.area}{a.given.details ? <span className="muted">. {a.given.details}</span> : null}{a.issue && <div className="iss">{a.issue}</div>}</li>)}</ul>
              <div className="jsub">Оценка обстановки</div><p>{d.assessment}</p>
              <div className="jsub">Замысел противника (как его понял штаб)</div><p>{d.enemyIntent}</p>
              {d.requests.length > 0 && <><div className="jsub">Доклады наверх</div><ul>{d.requests.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
              {d.risks.length > 0 && <><div className="jsub">Риски</div><ul>{d.risks.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
            </div>}
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── передача командования ───────────── */

/** Начало хода, на который приходится момент t (командование принимается с начала хода). */
export function turnStart(t: string, start: string, end: string, turnHours: number): string {
  const H = turnHours * 3600_000;
  let k = Math.max(0, Math.floor((toMs(t) - toMs(start)) / H));
  while (k > 0 && toMs(start) + k * H >= toMs(end)) k--;
  return new Date(toMs(start) + k * H).toISOString().slice(0, 16);
}

export function TakeoverDialog({ at, end, turnHours, start, scenarioName, llm, onStart, onCancel }: {
  at: string; end: string; turnHours: number; start: string; scenarioName: string; llm: Llm; onStart: (enemy: EnemyMode) => void; onCancel: () => void;
}) {
  const [enemy, setEnemy] = useState<EnemyMode>(llm.check.state === 'fail' ? 'passive' : 'llm');
  const turn = Math.round((toMs(at) - toMs(start)) / (turnHours * 3600_000)) + 1;
  const left = Math.round((toMs(end) - toMs(at)) / (turnHours * 3600_000));
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onCancel]);
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal take" onClick={(e) => e.stopPropagation()}>
        <h3>Принять командование</h3>
        <p className="take-when"><b>{dayLong(at)}, {hhmm(at)}</b> · ход {turn} · до конца операции — {left} {turnHours === 24 ? 'сут.' : 'ходов'} ({ddmm(end)})</p>
        <ul className="take-list">
          <li>Советской стороной с этого момента командуете вы — до конца операции: доклады объединений, разведсводка, боевое распоряжение, журнал. Вернуть командование историческому плану нельзя.</li>
          <li>Немецкой стороной с того же момента командует штаб на языковой модели. На каждом ходу он получает свою обстановку — то, что знал бы немецкий штаб, — и отдаёт приказы. Обе стороны решают одновременно.</li>
          <li>Исторические приказы после этого момента отменяются. Приказы, отданные раньше и ещё не дошедшие до войск, остаются в силе.</li>
          <li>Противник виден только в пределах разведки (туман войны). Игра сохраняется в браузере после каждого хода.</li>
        </ul>
        <div className="take-enemy">
          <label className={enemy === 'llm' ? 'on' : ''}><input type="radio" checked={enemy === 'llm'} onChange={() => setEnemy('llm')} />
            <span><b>Штаб на модели</b> — LM Studio на этом компьютере<small className={`llm-st ${llm.check.state}`}>{llm.check.state === 'ok' ? `✓ на связи: ${llm.settings.model || llm.check.models[0]}` : llm.check.state === 'fail' ? `✗ ${llm.check.error} — запустите сервер в LM Studio (настройки — раздел «Штаб»)` : 'проверка связи…'}</small></span></label>
          <label className={enemy === 'passive' ? 'on' : ''}><input type="radio" checked={enemy === 'passive'} onChange={() => setEnemy('passive')} />
            <span><b>Без штаба</b> — противник держится прежних приказов<small>для пробы без модели; переключить можно в ходе игры (вкладка «Посредник»)</small></span></label>
        </div>
        <div className="take-f">
          {llm.check.state === 'fail' && <button className="link" onClick={llm.recheck}>Проверить связь ещё раз</button>}
          <span style={{ flex: 1 }} />
          <button onClick={onCancel}>Отмена</button>
          <button className="primary" onClick={() => onStart(enemy)} title={scenarioName}>Принять командование с {ddmm(at)}</button>
        </div>
      </div>
    </div>
  );
}
