/**
 * Раздел «Переигровка»: выбор сценария, расчёт в браузере (фоновый поток), карта с
 * плеером времени, итоги и отчёт о сравнении с историей. Результат можно открыть в
 * редакторе для правки и экспорта.
 */
import { confirmAsync } from './dialogs';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { documentAt, formatScale, migrateDocument, zoomForScale, type LngLat, type MapDocument, type SymbolFeature, type TimeInstant } from '@def-ops/core';
import type { CatalogEntry, SimRequest, SimResponse, SimResult } from './sim/protocol';
import { MapView } from './MapView';
import { useViewScale } from './ScaleRange';
import { LEGACY_LEVEL_KEY, legacyLevel, LEVEL_KEY, levelDefaultScale, levelScaleLabel, migrateLevel, scaleInLevel, type LevelId } from './map-level-scale';
import { withLevel } from './map-levels';
import { findLegendItem, legendFor, legendText, presentItems, shownLegend, withHidden, type LegendItem } from './map-legend';
import type { MapEngine } from './engine/types';
import { BasemapControls, dmy, Popover } from './ui';
import { basemapDate } from './engine/basemaps';
import type { Basemaps, Llm } from './shared';
import { CommandView, loadSaved, SAVE_KEY, savedGameMode, TakeoverDialog, turnStart, type SavedGame } from './CommandView';
import { defaultEnemy, fitEnemy, resumeEnemy } from './command-forms';
import type { EnemyMode, GameStart } from './sim/game-protocol';
import { registerSectors, SectorPicker, withFocus, type Sector } from './Sectors';
import { BUILTIN_CATALOG, deleteReplay, fullCatalog, getReplay, listReplays, onDataChange, renameReplay, saveReplay, sectorsOf, type SavedReplay } from './sim/userdata';
import { ZonesContext } from './time';
import { mdToHtml } from './markdown';
import { useCoverage } from './modeling/Coverage';
import { COVERAGE_LEVEL } from '@def-ops/knowledge';
import { MapHover, withoutLabels } from './MapHover';
import { invoke } from '@tauri-apps/api/core';
import { addHours, type AgentHistory, type GameMode } from '@def-ops/sim';
import { AgentMark, AgentPanel, divisionNear, hourOf, posAt, type AgentRun } from './AgentCard';
import { nearestFeature, OVER_MAP, shownFeatures, unitAt, unitPlace } from './map-pick';
import { agentHqCard, formationCard } from './formation-card';
import { intentAt, intentBadge } from './intent-view';
import { FormationPanel, useEsc } from './FormationCard';
import { CommanderPanel } from './CommanderPanel';
import { CommanderOverlay } from './CommanderOverlay';
import { RivalryChart } from './RivalryChart';
import { commanderOf } from './commander-view';

import { AGENT_COMMANDS, AGENT_SCENARIOS, agentVariants, DEFAULT_AGENT_COMMAND, DESKTOP, runAgents, type AgentCommand, type AgentVariant } from './sim/agent-scenarios';
import { coreEditsFor, KB_WAIT, kbSettled, takeoverNow } from './sim/kb-recompile';
import { kbStamp, type KbStamp } from './sim/kb-stamp';
import { KbStampNote } from './KbStampNote';
import type { TakeoverSummary } from './sim/takeover-state';
import { act, ActButton, register, speak, useAction, voiceRecent } from './voice/registry';
import { btn, hl, note, noted } from './voice/highlight';
import { calcDoneText, calcFailText, findLayer, inReplay, releaseReplay, replayActions, type ReplayDeps } from './voice/actions/command';
import { readAloud } from './voice/dictation';
import { speakable } from './voice/speech';
/** Ход игры на агентной модели, ч. */
/** Режим командования агентной модели в «Переигровке» (запоминается). */
const COMMAND_KEY = 'def_ops.agents.command';
const AGENT_GAME_HOURS = 12;
/** Шаг снимков агентной модели на карте, ч (расчёт — по часам). */
const AGENT_STEP_HOURS = 6;

const fmtDays = (d: number | null) => (d == null ? '—' : d > 0 ? `+${d}` : String(d));
const dayClass = (d: number | null) => (d == null ? 'miss' : Math.abs(d) <= 1 ? 'ok' : Math.abs(d) <= 2 ? 'near' : 'off');
const pct = (x: number) => `${Math.round(x * 100)} %`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Слои переигровки, которые удобно переключать одной кнопкой. */
const TOGGLES: { key: string; title: string; match: (id: string) => boolean }[] = [
  { key: 'ghosts', title: 'Ист. положения', match: (id) => id === 'hist-units' || id === 'hist-marks' || id === 'lvl-op-hist' },
  { key: 'hfront', title: 'Ист. фронт', match: (id) => id === 'hist-front' },
  { key: 'front', title: 'Фронт', match: (id) => id === 'sim-front' || id.startsWith('sim-front-') },
  { key: 'combat', title: 'Бои', match: (id) => id === 'sim-combat' },
  { key: 'theatre', title: 'Рубежи', match: (id) => id === 'theatre' || id.startsWith('theatre-') },
  { key: 'pockets', title: 'Котлы', match: (id) => id === 'sim-pockets' },
  { key: 'fortress', title: 'Крепости', match: (id) => id === 'sim-fortress' },
  { key: 'hbounds', title: 'Ист. разгр. линии', match: (id) => id === 'hist-bounds' },
  { key: 'bounds', title: 'Полосы', match: (id) => id === 'sim-bounds' },
];
/** Полные названия слоёв в меню «Слои» (на кнопках были сокращения). */
export const LAYER_TITLE: Record<string, string> = { ghosts: 'Исторические положения', hfront: 'Линия фронта по истории', front: 'Линия фронта (расчёт)', combat: 'Бои за ход', theatre: 'Рубежи и укреплённые полосы', plan: 'Замысел (проект приказов)', rear: 'Тыл: базы и подвоз', rivers: 'Реки (для переправ)', hbounds: 'Разграничительные линии: директивы и распоряжения', bounds: 'Полосы фронтов и армий (расчёт)', pockets: 'Котлы (окружённые группировки)', fortress: 'Крепости: обводы по застройке', zones: 'Зоны влияния сторон' };

/** Уровень карты — по ступени командования: Ставка (фронты), фронт (армии), армия (корпуса), корпус и дивизия (дивизии). */
export type MapLevel = LevelId;
export const MAP_LEVELS: { id: MapLevel; title: string; hint: string }[] = [
  { id: 'stavka', title: 'Ставка', hint: 'фронты и группы армий: направления главных ударов за двое суток, оборона; армии — подписями' },
  { id: 'front', title: 'Фронт', hint: 'армии: положение, направления действий за сутки, рубежи обороны' },
  { id: 'army', title: 'Армия', hint: 'корпуса: положение, направления действий за сутки, рубежи обороны' },
  { id: 'corps', title: 'Корпус', hint: 'дивизии и полосы' },
  { id: 'division', title: 'Дивизия', hint: 'дивизии и выделенные части, бои за ход, переправы' },
];
/** Подписи знаков: на карте или только при наведении (запоминается). */
export function useMapLabels(): [boolean, () => void] {
  const [on, set] = useState<boolean>(() => { try { return localStorage.getItem('def_ops.mapLabels') !== 'hover'; } catch { return true; } });
  return [on, () => set((x) => { try { localStorage.setItem('def_ops.mapLabels', x ? 'hover' : 'on'); } catch { /* */ } return !x; })];
}
export function useMapLevel(): [MapLevel, (l: MapLevel) => void] {
  const [l, set] = useState<MapLevel>(() => { try { return migrateLevel(localStorage.getItem(LEVEL_KEY) ?? localStorage.getItem(LEGACY_LEVEL_KEY)); } catch { return 'division'; } });
  // прежний ключ — значением, понятным прежним версиям (main): уровень «stavka» там ронял окно после расчёта
  return [l, (x) => { set(x); try { localStorage.setItem(LEVEL_KEY, x); localStorage.setItem(LEGACY_LEVEL_KEY, legacyLevel(x)); } catch { /* */ } }];
}
/**
 * Слои карты одним меню: подписи и слои-переключатели (исторические положения, фронт, бои…) — флажками.
 * Над картой остаются только масштаб, «Слои», «Участки» и «Подложка»: панель помещается в строку на любом экране.
 */
export function LayersMenu({ labels, toggleLabels, items, setAll }: { labels: boolean; toggleLabels: () => void; items: { key: string; title: string; on: boolean; toggle: () => void }[]; setAll: (on: boolean) => void }) {
  useAction({
    id: 'map.layer', section: 'replay', title: 'Слой карты', describe: 'Показывает или скрывает слой карты (реки, фронт, бои, тыл, полосы, подписи…).',
    params: { type: 'object', properties: { layer: { type: 'string' }, on: { type: 'boolean' } }, required: ['layer'] }, say: ['штаб, покажи реки', 'штаб, скрой подписи'],
    available: inReplay, highlight: noted,
    run: async (p: { layer: string; on?: boolean }) => {
      const keys = [...items.map((x) => x.key), 'labels'];
      const key = keys.includes(p?.layer) ? p.layer : findLayer(String(p?.layer ?? ''), keys);
      if (!key) return `Такого слоя на этой карте нет. Есть: ${items.map((x) => `«${x.title}»`).join(', ')}, «Подписи знаков».`;
      const it = key === 'labels' ? { title: 'Подписи знаков', on: labels, toggle: toggleLabels } : items.find((x) => x.key === key)!;
      const on = p.on ?? !it.on;
      if (on !== it.on) it.toggle();
      note(hl(`layer-${key}`), '.lyr-menu > .pop-btn', `.legend [data-layer="${key}"]`);
      return `${on ? 'Показываю' : 'Скрыл'}: ${it.title.toLowerCase()}.`;
    },
  });
  const n = items.filter((x) => x.on).length + (labels ? 1 : 0);
  useAction({
    id: 'map.layers.all', section: 'replay', title: 'Все слои карты', describe: 'Показывает все слои и подписи (on) или скрывает их — остаются войска и подложка.',
    params: { type: 'object', properties: { on: { type: 'boolean' } }, required: ['on'] }, say: ['штаб, покажи все слои', 'штаб, скрой все слои'], available: inReplay,
    run: async (p: { on: boolean }) => { const on = !!p?.on; setAll(on); if (labels !== on) toggleLabels(); return on ? 'Показываю все слои.' : 'Слои скрыты: остаются войска и подложка.'; },
  });
  return (
    <Popover label={<>Слои <small className="lyr-n">{n}</small></>} title="Что показать на карте" align="right" className="lyr-menu">
      <div className="pop-title">Показать на карте</div>
      <div className="lyr-all">
        <ActButton disabled={n === items.length + 1} action="map.layers.all" params={{ on: true }} title="Включить все слои и подписи">Показать все</ActButton>
        <ActButton disabled={n === 0} action="map.layers.all" params={{ on: false }} title="Выключить все слои и подписи — остаются войска и подложка">Скрыть все</ActButton>
      </div>
      <label className="lyr-row" title="Выключено — подписи только при наведении на знак"><input type="checkbox" data-action="map.layer" checked={labels} onChange={() => void act('map.layer', { layer: 'labels', on: !labels })} /> Подписи знаков</label>
      {items.map((x) => <label key={x.key} className="lyr-row"><input type="checkbox" data-action="map.layer" checked={x.on} onChange={() => void act('map.layer', { layer: x.key, on: !x.on })} /> {x.title}</label>)}
    </Popover>
  );
}

/** Поставить масштаб карты, стандартный для уровня (Ставка 1:1 000 000 … дивизия 1:50 000); возвращает его. */
function fitLevelScale(engine: MapEngine | null, level: MapLevel): number | null {
  if (!engine) return null;
  const lat = engine.getView().center[1], t = levelDefaultScale(level);
  engine.setView({ zoom: zoomForScale(lat, t) });
  return t;
}

export function LevelSwitch({ level, setLevel, engine = null }: { level: MapLevel; setLevel: (l: MapLevel) => void; engine?: MapEngine | null }) {
  const denom = useViewScale(engine);
  const off = denom != null && !scaleInLevel(level, denom);
  useAction({
    id: 'map.level', section: 'replay', title: 'Уровень карты', describe: 'Уровень карты по ступени командования: Ставка (фронты), фронт (армии), армия (корпуса), корпус (дивизии), дивизия (дивизии и бои). Прежние названия: тактический — дивизия, оперативный — фронт, стратегический — Ставка.',
    params: { type: 'object', properties: { level: { enum: [...MAP_LEVELS.map((x) => x.id), 'tac', 'op', 'st'] } }, required: ['level'] }, say: ['штаб, уровень армии', 'штаб, оперативный уровень'],
    available: inReplay, highlight: (p: { level: string }) => hl(`level-${p?.level ? migrateLevel(p.level) : ''}`),
    run: async (p: { level: string }) => {
      const x = p?.level ? MAP_LEVELS.find((l) => l.id === migrateLevel(p.level) && (l.id === p.level || ['tac', 'op', 'st'].includes(p.level))) : undefined;
      if (!x) return 'Скажите уровень: Ставка, фронт, армия, корпус или дивизия.';
      setLevel(x.id);
      const to = fitLevelScale(engine, x.id);
      return `Уровень «${x.title}»: ${x.hint}.${to ? ` Масштаб карты — ${formatScale(to)}.` : ''}`;
    },
  });
  useAction({
    id: 'map.level.fit', section: 'replay', title: 'Масштаб по уровню', describe: 'Ставит масштаб карты, стандартный для выбранного уровня: Ставка 1:1 000 000, фронт 1:500 000, армия 1:200 000, корпус 1:100 000, дивизия 1:50 000.',
    say: ['штаб, подгони масштаб'], highlight: () => hl('level-fit'), available: () => (inReplay() === true ? (off ? true : 'масштаб уже в рекомендуемом интервале') : inReplay()),
    run: async () => { const to = fitLevelScale(engine, level); return to ? `Масштаб карты — ${formatScale(to)}, как для этого уровня.` : 'Не вышло: карта ещё не открыта.'; },
  });
  return <>
    <div className="lvl-sw" role="group" aria-label="Уровень карты">{MAP_LEVELS.map((x) => <ActButton key={x.id} action="map.level" params={{ level: x.id }} className={level === x.id ? 'on' : ''} title={`${x.hint}. Рекомендуемый масштаб ${levelScaleLabel(x.id)}`} data-hl={`level-${x.id}`}>{x.title}</ActButton>)}</div>
    {off && <ActButton className="lvl-off" action="map.level.fit" data-hl="level-fit" title="Привести масштаб карты к рекомендуемому для уровня">масштаб вне {levelScaleLabel(level)}</ActButton>}
  </>;
}

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
  // сохранённые переигровки: вкладка списка, список, id сохранения открытого результата
  const [tab, setTab] = useState<'run' | 'saved'>('run');
  const [replays, setReplays] = useState<SavedReplay[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { const load = () => void listReplays().then(setReplays); load(); return onDataChange(load); }, []);
  const [game, setGame] = useState<{ start: GameStart | null; saved: SavedGame | null; enemy: EnemyMode; note?: string } | null>(null);
  const [take, setTake] = useState<string | null>(null);
  const [focus, setFocus] = useState<Sector | null>(null);
  const [eng, setEng] = useState<MapEngine | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [level, setLevel] = useMapLevel();
  const [legendHidden, setLegendHidden, clearLegend] = useLegendHidden();
  const lvHidden = useMemo(() => hiddenOn(legendHidden, level), [legendHidden, level]);
  const [labels, toggleLabels] = useMapLabels();
  const [model, setModel] = useState<'army' | 'agents'>('agents');
  // параметры агентной модели: базовые (agents-v0.json) или сохранённый вариант (калибровка в «Моделировании»)
  const [variants, setVariants] = useState<AgentVariant[]>(agentVariants);
  const [variantId, setVariantId] = useState('');
  // кто решает за советские штабы в агентной модели; по умолчанию — «История как замысел» (DEFAULT_AGENT_COMMAND)
  const [command, setCommandState] = useState<AgentCommand>(() => { try { const v = localStorage.getItem(COMMAND_KEY); return AGENT_COMMANDS.some((c) => c.id === v) ? v as AgentCommand : DEFAULT_AGENT_COMMAND; } catch { return DEFAULT_AGENT_COMMAND; } });
  const setCommand = (c: AgentCommand) => { setCommandState(c); try { localStorage.setItem(COMMAND_KEY, c); } catch { /* */ } };
  useEffect(() => { const f = () => setVariants(agentVariants()); window.addEventListener('def_ops.agents.variants', f); return () => window.removeEventListener('def_ops.agents.variants', f); }, []);
  const agentOp = DESKTOP ? AGENT_SCENARIOS[scenario] : undefined;
  const useAgents = model === 'agents' && !!agentOp;
  // сводка окна «Принять командование»: что из состояния соединений на этот момент берётся по фактам базы
  const [takeKb, setTakeKb] = useState<TakeoverSummary | null>(null);
  useEffect(() => {
    setTakeKb(null);
    if (!take || !result) return;
    let live = true;
    // состояние при передаче — по собранным данным базы: сборка идёт — сначала дождаться её
    kbSettled().then(() => (live ? takeoverNow(result.scenario, take, result.engine === 'agents' && !!agentOp) : null))
      .then((r) => { if (live && r) setTakeKb(r.summary); }).catch(() => { /* без сводки */ });
    return () => { live = false; };
  }, [take, result, agentOp]);
  // нынешняя сборка операции открытого результата: другая, чем у результата, — пометка под итогом
  const [kbNow, setKbNow] = useState<KbStamp | null | undefined>(undefined);
  useEffect(() => {
    setKbNow(undefined);
    if (!result) return;
    let live = true;
    const load = () => void kbSettled().then(() => kbStamp(result.scenario)).then((s) => { if (live) setKbNow(s); }).catch(() => undefined);
    load();
    const off = onDataChange(load);
    return () => { live = false; off(); };
  }, [result]);
  const worker = useRef<Worker | null>(null);
  const runId = useRef(0);
  // ход агентной модели последнего расчёта (для карточки агента) и выбранная дивизия
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const pendingAgent = useRef<AgentRun | null>(null);
  const [agentSel, setAgentSel] = useState<string | null>(null);
  const engine = useRef<MapEngine | null>(null);

  useEffect(() => { setRules((r) => (entry.rules.some((x) => x.id === r) ? r : entry.rules[0].id)); }, [entry]);
  useEffect(() => () => worker.current?.terminate(), []);

  const startWorker = (q: SimRequest) => {
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
        setAgentRun(m.result.engine === 'agents' ? pendingAgent.current : null); setAgentSel(null);
        setSavedId(null);
        setResult(m.result); setDoc(d); setTime(d.timeline?.start ?? null); setMapKey((k) => k + 1); setFocus(null);
        // расчёт долгий: о готовности — коротко; что дальше — если голосом пользовались недавно
        speak(speakable(calcDoneText(m.result.scenarioName, voiceRecent()), { full: true }));
      }
      if (m.kind === 'error') speak(calcFailText(m.message));
    };
    w.onerror = (e) => { setBusy(null); setError(e.message || 'ошибка расчёта'); };
    w.postMessage(q);
  };
  /** Расчёт операции sc (по умолчанию — выбранной): правила — выбранные, если они есть у этой операции. */
  const run = (sc = scenario) => {
    const token = ++runId.current;
    // данные операции — после сборки из базы знаний (при запуске она идёт несколько секунд): иначе тот же seed даст другой итог
    setBusy(KB_WAIT); setError(null);
    void kbSettled().then(() => { if (token === runId.current) calc(token, sc); });
  };
  const calc = (token: number, sc: string) => {
    const e = CATALOG.find((c) => c.id === sc) ?? entry;
    const q: SimRequest = { scenario: sc, rules: e.rules.some((x) => x.id === rules) ? rules : e.rules[0].id, seed, runs, toleranceKm: e.toleranceKm };
    const op = DESKTOP ? AGENT_SCENARIOS[sc] : undefined;
    if (!(model === 'agents' && op)) { startWorker(q); return; }
    // агентная модель: ход по часам считает ядро приложения, карту — фоновый поток, как у нынешней модели
    worker.current?.terminate();
    setBusy('расчёт агентной модели…'); setError(null);
    // вариант параметров выбран для операции на экране; другая операция (названа голосом) — базовые параметры
    const params = sc === scenario ? variants.find((v) => v.id === variantId)?.params : undefined;
    Promise.all([coreEditsFor(sc).then((edits) => runAgents(sc, { seed, params, edits, command })), invoke<string>('read_text', { path: op.history })])
      .then(([trace, h]) => {
        if (token !== runId.current) return;
        const history = JSON.parse(h) as AgentHistory;
        pendingAgent.current = { trace, history };
        startWorker({ ...q, runs: 1, agents: { trace, history, title: op.title, stepHours: AGENT_STEP_HOURS } });
      })
      .catch((e) => { if (token === runId.current) { setBusy(null); setError(String(e)); } });
  };
  /** Сохранить открытый результат: расчёт целиком (без пересчёта при открытии), у агентной модели — и ход дивизий. */
  const saveCurrent = async () => {
    if (!result) return;
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const id = `r_${now.getTime().toString(36)}`;
    const engine = result.engine === 'agents' ? 'agents' : 'army';
    const title = `${result.scenarioName.split(/[,:—(]/)[0].trim()} — ${engine === 'agents' ? 'агентная модель' : `правила ${result.rules}`}, seed ${result.seed}`;
    const meta: SavedReplay = {
      id, title, created: `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`,
      scenario: result.scenario, scenarioName: result.scenarioName, engine, rules: result.rules, seed: result.seed, runs: result.runs,
      within: result.within, eventsHit: result.eventsHit, eventsTotal: result.eventsTotal, start: result.start, end: result.end,
      ...(result.kb !== undefined ? { kb: result.kb } : {}),
    };
    setSaving(true);
    try {
      await saveReplay(meta, { id, result, ...(engine === 'agents' && agentRun ? { agents: agentRun } : {}) });
      setSavedId(id);
      setNotice(`Переигровка сохранена: «${title}» — вкладка «Сохранённые»`);
    } catch (e) { setError(`не удалось сохранить: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };
  /** Открыть сохранённую переигровку: результат, карта, у агентной модели — ход дивизий; настройки формы — как при расчёте. */
  const openReplay = async (m: SavedReplay) => {
    setBusy('открытие сохранённой переигровки…'); setError(null);
    const r = await getReplay(m.id);
    setBusy(null);
    if (!r) { setError('сохранение не найдено'); return; }
    runId.current++; worker.current?.terminate();
    const d = migrateDocument(r.result.doc);
    setScenario(m.scenario); setModel(m.engine); setSeed(m.seed);
    if (m.engine === 'army') { setRules(m.rules); setRuns(m.runs); }
    setAgentRun(r.agents ?? null); setAgentSel(null);
    setResult(r.result); setDoc(d); setTime(d.timeline?.start ?? null); setMapKey((k) => k + 1); setFocus(null);
    setSavedId(m.id); setTab('run');
  };
  const stop = () => { runId.current++; worker.current?.terminate(); worker.current = null; setBusy(null); };

  // щелчок по знаку соединения на карте — карточка. Попадание — по знакам, нарисованным на карте в этот момент
  // (между снимками знак идёт по дорогам, его место не совпадает с расчётным), знак связан с формированием по ref.
  // Нынешняя модель: любое соединение и штаб — карточка по снимкам прогона. Агентная: дивизия — карточка агента и
  // разговор, штаб (армия, корпус, фронт) — карточка штаба с переходом к его дивизиям.
  const agentHour = agentRun && time ? hourOf(agentRun.trace.start, time) : 0;
  const units = result?.units ?? null;
  const [cardSel, setCardSel] = useState<string | null>(null);
  /** Открытая вкладка карточки штаба (null — «Сводка»); «commander» — командующий: слой на карте и график состязания. */
  const [cardTab, setCardTab] = useState<string | null>(null);
  const live = useRef({ doc, level, time, focus, units });
  live.current = { doc, level, time, focus, units };
  useEffect(() => {
    const host = eng?.getContainer().parentElement;
    if (!eng || !host) return;
    const divIds = new Set(agentRun?.trace.divisions.map((d) => d.id));
    const hqIds = new Set(agentRun?.trace.hqs.map((h) => h.id));
    // старые сохранения агентной модели: у знаков нет ref — по названию
    const byName = new Map<string, string>([...(agentRun?.trace.divisions ?? []), ...(agentRun?.trace.hqs ?? [])].map((d) => [d.name, d.id]));
    const click = (e: MouseEvent) => {
      if ((e.target as Element).closest(OVER_MAP)) return;
      const r = host.getBoundingClientRect();
      const pt: [number, number] = [e.clientX - r.left, e.clientY - r.top];
      const { doc: d, level: lv, time: t, focus: fc, units: un } = live.current;
      if (!d || !t) return;
      const feats = shownFeatures(withFocus(withLevel(d, lv), fc), t, ['focus']);
      const project = (p: LngLat) => eng.project(p);
      let ref = unitAt(feats, project, pt)?.ref ?? null;
      if (agentRun) {
        if (!ref) {
          const f = nearestFeature(feats, project, pt, { lines: false, filter: (x) => !x.layerId.startsWith('hist') && byName.has(x.name!.replace(/: уничтожено.*$/, '')) });
          ref = f ? byName.get(f.name!.replace(/: уничтожено.*$/, ''))! : null;
        }
        if (ref && divIds.has(ref)) { setAgentSel(ref); setCardSel(null); return; }
        if (ref && hqIds.has(ref)) { setCardSel(ref); setAgentSel(null); return; }
        const id = divisionNear(agentRun.trace, hourOf(agentRun.trace.start, t), (p) => eng.project(p) as [number, number], pt);
        if (id) { setAgentSel(id); setCardSel(null); }
        return;
      }
      if (ref && un?.formations.some((f) => f.id === ref)) { setCardSel(ref); return; }
      if (!un && unitAt(feats, project, pt) === null && nearestFeature(feats, project, pt, { lines: false, filter: (x) => /^(sim-own|sim-enemy|lvl-..-units)$/.test(x.layerId) })) {
        setNotice('В этой сохранённой переигровке нет данных для карточек соединений — рассчитайте её заново');
      }
    };
    host.addEventListener('click', click);
    return () => host.removeEventListener('click', click);
  }, [eng, agentRun]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCardSel(null); }, [result]);
  // крючок разработки: открыть карточку штаба из скриптов проверки (scripts/stage1-shots.mjs)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __replayCard?: (id: string | null) => void }).__replayCard = (id) => { setCardSel(id); setAgentSel(null); };
  }, []);
  const closeCards = useCallback(() => { setCardSel(null); setAgentSel(null); }, []);
  useEsc(!!(cardSel || agentSel), closeCards);
  /** Карточка выбранного соединения или штаба на момент проигрывания. */
  const card = useMemo(() => {
    if (!cardSel || !time) return null;
    if (agentRun) return agentHqCard(agentRun.trace, cardSel, agentHour);
    return units ? formationCard(units, cardSel, time) : null;
  }, [cardSel, time, units, agentRun, agentHour]);
  /** Командующий выбранного штаба (режим «Командующие» агентной модели) и названия штабов для его вкладки. */
  const commander = useMemo(() => (agentRun && cardSel ? commanderOf(agentRun.trace, cardSel) : null), [agentRun, cardSel]);
  const hqNames = useMemo(() => Object.fromEntries((agentRun?.trace.hqs ?? []).map((h) => [h.id, h.name])), [agentRun]);
  const commanderOpen = !!(commander && agentRun && cardTab === 'commander' && !agentSel);
  /** Где знак выбранного нарисован сейчас: на текущем масштабе, иначе — на любом (агентная дивизия — расчётное положение на час). */
  const agentSelAt = useMemo((): LngLat | null => {
    const sel = agentSel ?? cardSel;
    if (!sel || !doc || !time) return null;
    const lv = agentSel ? 'division' as const : level;
    const at = unitPlace(shownFeatures(withLevel(doc, lv), time), sel) ?? (agentSel ? null : MAP_LEVELS.map((x) => unitPlace(shownFeatures(withLevel(doc, x.id), time), sel)).find(Boolean) ?? null);
    if (at) return at;
    if (agentRun && agentSel) {
      const i = agentRun.trace.divisions.findIndex((x) => x.id === agentSel);
      const name = agentRun.trace.divisions[i]?.name;
      const f = name ? documentAt(withLevel(doc, 'division'), time, { visibleOnly: true }).features.find((x) => x.kind === 'symbol' && x.name === name && !x.layerId.startsWith('hist')) : undefined;
      if (f) return (f as SymbolFeature).at;
      return i >= 0 ? posAt(agentRun.trace, i, agentHour) : null;
    }
    return null;
  }, [agentRun, agentSel, cardSel, doc, time, agentHour, level]);
  /** Штаб агентной модели: уровень корпуса с приближением к нему — щёлкать по его дивизиям. */
  const showDivisions = () => {
    if (!eng || !card) return;
    const at = agentSelAt;
    setLevel('corps');
    if (at) eng.setView({ center: at, zoom: Math.max(eng.getView().zoom + 1.5, 9.5) });
    setNotice(`${card.name}: уровень корпуса — щёлкните по дивизии`);
  };
  const agentToHour = (h: number) => agentRun && setTime(addHours(agentRun.trace.start, Math.max(0, Math.min(agentRun.trace.frames.length - 1, Math.round(h)))));

  const layerOn = (t: (typeof TOGGLES)[number]) => !!doc?.layers.filter((l) => t.match(l.id)).some((l) => l.visible);
  const toggle = (t: (typeof TOGGLES)[number]) => setDoc((d) => {
    if (!d) return d;
    const on = d.layers.filter((l) => t.match(l.id)).some((l) => l.visible);
    return { ...d, layers: d.layers.map((l) => (t.match(l.id) ? { ...l, visible: !on } : l)) };
  });
  /** Все слои-переключатели сразу (войска и подложка остаются). */
  const setAll = (on: boolean) => { if (on) clearLegend(); setDoc((d) => d && { ...d, layers: d.layers.map((l) => (TOGGLES.some((t) => t.match(l.id)) ? { ...l, visible: on } : l)) }); };
  /** К событию: время — момент события в расчёте, карта — к месту. */
  const goEvent = (e: SimResult['events'][number]) => {
    if (e.at) setTime(e.at);
    const en = engine.current;
    if (e.place && en) { const z = en.getView().zoom; en.setView({ center: e.place, zoom: Math.min(13, Math.max(z, z + 1)) }); }
  };
  const tol = CATALOG.find((c) => c.id === result?.scenario)?.toleranceKm ?? entry.toleranceKm;
  // действия панели итогов — через ссылку на свежие значения: сама панель не перерисовывается каждый кадр проигрывания
  const panel = useRef({ report: () => {}, open: () => {}, summary: () => {}, event: goEvent, save: () => {} });
  panel.current = {
    report: () => setReport(true), open: () => doc && onOpenInEditor(doc), summary: () => result?.summary && onOpenInEditor(result.summary),
    event: goEvent, save: () => void saveCurrent(),
  };
  const resultsAct = useMemo(() => ({
    onReport: () => panel.current.report(), onOpen: () => panel.current.open(), onSummary: () => panel.current.summary(),
    onEvent: (e: SimResult['events'][number]) => panel.current.event(e), onSave: () => panel.current.save(),
  }), []);

  // документ для карты — тот же объект, пока не изменились документ, уровень, участок и подписи
  // (иначе каждый кадр проигрывания давал бы новые знаки и перерисовку всей карты)
  const mapDoc = useMemo(() => (doc ? withoutLabels(withFocus(withHidden(withLevel(doc, level), level, lvHidden), focus), labels) : null), [doc, level, focus, labels, lvHidden]);
  const zones = useMemo(() => ({ local: 'Europe/Berlin', localFixed: true, input: 'msk' as const, setInput: () => {} }), []);
  /** Начать игру с момента окна «Принять командование» (подтверждение замены незавершённой — до этого). */
  const beginGame = (enemy0: EnemyMode | undefined, mode: GameMode = savedGameMode()) => {
    if (!result || !take) return;
    setTake(null);
    // агентная модель: ход игры — AGENT_GAME_HOURS, считает ядро приложения
    const agents = result.engine === 'agents' && agentOp ? { path: agentOp.path, history: agentOp.history, turnHours: AGENT_GAME_HOURS, mode } : undefined;
    // противник — допустимый при режиме (не назван — умолчание окна)
    const down = llm.check.state === 'fail';
    const enemy = enemy0 ? fitEnemy(enemy0, !!agents, mode, down) : defaultEnemy(!!agents, down, mode);
    setGame({ start: { scenario: result.scenario, rules: result.rules, seed: result.seed, takeover: take, ...(agents ? { agents } : {}) }, saved: null, enemy });
    return enemy;
  };
  /** Кнопка окна: поверх незавершённой игры — сначала вопрос. */
  const startGame = async (enemy: EnemyMode, mode: GameMode) => {
    if (!saved) { void act('replay.start', { enemy, mode }); return; }
    if (await confirmAsync('Есть незавершённая игра. Начать новую? Запись прежней будет заменена.', { ok: 'Начать новую' })) void act('replay.startOver', { enemy, mode });
  };
  // голос и кнопки: расчёт, вход в командование, продолжение игры
  const voice = useRef<ReplayDeps>(null!);
  voice.current = {
    catalog: CATALOG, scenario, busy, game: !!game, calc: (id) => { setScenario(id); run(id); },
    result, time, takeAt: (t) => turnStart(t, result!.start, result!.end, result!.turnHours), setTime,
    openTake: setTake, closeTake: () => setTake(null), take, saved,
    begin: beginGame, continueGame: () => {
      if (!saved) return;
      // противник старой записи может не подходить режиму игры (ядро такой отклонит): берём умолчание режима и говорим об этом
      const r = resumeEnemy(saved.enemy, !!saved.record.agents, saved.record.agents?.mode ?? 'legacy', llm.check.state === 'fail');
      setGame({ start: null, saved: r.note ? { ...saved, enemy: r.enemy } : saved, enemy: r.enemy, note: r.note });
      return r.note;
    },
    stop, discardSaved: () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* */ } setSaved(null); },
  };
  useEffect(() => { const get = () => voice.current; const offs = replayActions(get).map(register); return () => { offs.forEach((o) => o()); releaseReplay(get); }; }, []);
  if (game) {
    return <CommandView key={game.saved?.record.takeover ?? game.start?.takeover} bm={bm} llm={llm} start={game.start} saved={game.saved} enemy={game.enemy} note={game.note} onOpenInEditor={onOpenInEditor}
      onExit={({ discard }) => { if (discard) try { localStorage.removeItem(SAVE_KEY); } catch { /* */ } setSaved(loadSaved()); setGame(null); }} />;
  }
  const takeAt = result && time ? turnStart(time, result.start, result.end, result.turnHours) : null;
  return (
    <ZonesContext.Provider value={zones}>
    <div className="replay">
      <aside className="rp-side">
        <div className="rp-head" data-tour="replay-head">
          <h2>Переигровка</h2>
          <p>Обе стороны получают исторические задачи; движение, бои, подвоз и окружения считает арбитр. Итог сравнивается с историей.</p>
        </div>
        {/* voice-entry: начало */}
        {saved && !busy && <div className="rp-saved" data-tour="replay-saved">
          <div><b>Незавершённая игра</b><span>{saved.title} · командование с {saved.record.takeover.slice(8, 10)}.{saved.record.takeover.slice(5, 7)}, сыграно ходов: {saved.record.turns.length}</span></div>
          <div className="rp-saved-b">
            <ActButton className="primary" action="replay.continue">Продолжить</ActButton>
            <button data-action="replay.discardSaved" onClick={() => { void confirmAsync('Удалить запись незавершённой игры?', { ok: 'Удалить', danger: true }).then((ok) => { if (ok) void act('replay.discardSaved'); }); }}>Удалить</button>
          </div>
        </div>}
        {/* voice-entry: конец */}
        <div className="seg rp-tabs" data-tour="replay-tabs">
          <button className={tab === 'run' ? 'on' : ''} onClick={() => setTab('run')}>Расчёт</button>
          <button className={tab === 'saved' ? 'on' : ''} onClick={() => setTab('saved')}>Сохранённые{replays.length ? ` · ${replays.length}` : ''}</button>
        </div>
        {tab === 'saved' && <SavedList list={replays} current={savedId} busy={!!busy} onOpen={(m) => void openReplay(m)}
          onRename={(m, t) => void renameReplay(m.id, t)} onDelete={(m) => { void confirmAsync(`Удалить сохранённую переигровку «${m.title}»?`, { ok: 'Удалить', danger: true }).then((ok) => { if (!ok) return; void deleteReplay(m.id); if (savedId === m.id) setSavedId(null); }); }} />}
        {tab === 'run' && <>
        <div className="rp-cards" data-tour="replay-cards">
          {CATALOG.map((c) => (
            <button key={c.id} className={`rp-card${c.id === scenario ? ' on' : ''}`} disabled={!!busy} onClick={() => setScenario(c.id)}>
              <b>{c.title}{c.custom && <i className="rp-own">своя</i>}</b><span>{c.detail}</span>
            </button>
          ))}
        </div>
        <ReplayCoverage op={scenario} />
        <div className="rp-form" data-tour="replay-form">
          {agentOp && <label title="Нынешняя модель — армии и корпуса, ход сутки, считается в фоновых потоках окна. Агентная — каждая дивизия со своим состоянием и штабами, шаг час, считается ядром приложения">Модель
            <select value={model} onChange={(e) => setModel(e.target.value as 'army' | 'agents')} disabled={!!busy}>
              <option value="army">нынешняя — армии и корпуса</option>
              <option value="agents">агентная — дивизии</option>
            </select>
          </label>}
          {useAgents && variants.length > 0 && <label title="Поправки параметров агентной модели — варианты из «Моделирования → Агентная модель»">Параметры
            <select value={variantId} onChange={(e) => setVariantId(e.target.value)} disabled={!!busy}>
              <option value="">базовые (agents-v0)</option>
              {variants.filter((v) => !v.scenario || v.scenario === scenario).map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
            </select>
          </label>}
          {useAgents && <label title={AGENT_COMMANDS.find((c) => c.id === command)?.hint}>Советские штабы
            <select value={command} onChange={(e) => setCommand(e.target.value as AgentCommand)} disabled={!!busy} data-hl="agents-command">
              {AGENT_COMMANDS.map((c) => <option key={c.id} value={c.id} title={c.hint}>{c.title}</option>)}
            </select>
          </label>}
          {!useAgents && <label>Правила
            <select value={rules} onChange={(e) => setRules(e.target.value)} disabled={!!busy}>
              {entry.rules.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
          </label>}
          <div className="rp-inline">
            <label title="Номер случайного прогона: один и тот же seed — один и тот же расчёт">Seed <input type="number" min={1} value={seed} onChange={(e) => setSeed(Math.max(1, +e.target.value || 1))} disabled={!!busy} /></label>
            {!useAgents && <label title="Прогонов с разными seed — разброс исходов. На карте — первый">Прогонов
              <select value={runs} onChange={(e) => setRuns(+e.target.value)} disabled={!!busy}>{[1, 3, 5, 10].map((n) => <option key={n}>{n}</option>)}</select>
            </label>}
          </div>
          {/* voice-entry: начало */}
          {busy
            ? <ActButton className="rp-go" action="replay.stop" data-tour="replay-go" data-hl="calc"><span className="spinner" /> {busy} <small>остановить</small></ActButton>
            : <ActButton className="rp-go primary" action="replay.calc" data-tour="replay-go" data-hl="calc">Рассчитать</ActButton>}
          {/* voice-entry: конец */}
          {error && <div className="err">Ошибка: {error}</div>}
        </div>
        {result && !busy && <Results r={result} tol={tol} {...resultsAct} saved={!!savedId} saving={saving} kbNow={kbNow} />}
        </>}
      </aside>
      <main className="rp-main" data-tour="replay-main">
        {doc ? <>
          <div className="rp-bar">
          {/* voice-entry: начало */}
          {takeAt && <ActButton className="take-btn" action="replay.takeCommand" data-tour="replay-take" title="С этого хода советской стороной командуете вы; кто командует немецкой — выберете в окне">
            <span>⚑</span> Принять командование <small>с {ddmm(takeAt)}{result!.turnHours !== 24 ? ` ${takeAt.slice(11, 16)}` : ''}</small></ActButton>}
          {/* voice-entry: конец */}
          <div className="rp-tools" data-tour="replay-tools">
            <LevelSwitch level={level} setLevel={setLevel} engine={eng} />
            <LayersMenu labels={labels} toggleLabels={toggleLabels} items={TOGGLES.filter((t) => level === 'division' || t.key !== 'combat').map((t) => ({ key: t.key, title: LAYER_TITLE[t.key] ?? t.title, on: layerOn(t), toggle: () => toggle(t) }))} setAll={setAll} />
            {result && <SectorPicker scenario={result.scenario} engine={eng} bm={bm} focus={focus} setFocus={setFocus} opYear={+result.start.slice(0, 4)} onNotice={setNotice} />}
            <Popover label="Подложка" align="right"><BasemapControls bm={bm} dateNote={result ? `начала операции, ${dmy(result.start)}` : null} /></Popover>
          </div>
          </div>
          <div className="rp-map" data-tour="replay-map">
          <MapView key={mapKey} doc={mapDoc!} setDoc={() => {}} selected={null} setSelected={() => {}} selectedOverlay={null}
            tool={{ mode: 'select' }} setTool={() => {}} activeLayer={null} basemap={bm.current} basemapOpacity={bm.opacity} basemapDate={basemapDate(bm.current, result?.start, bm.year)}
            onEngineReady={(e) => { engine.current = e; setEng(e); if (import.meta.env.DEV) (window as unknown as { __replayEngine: MapEngine }).__replayEngine = e; }} onStatus={() => {}} time={time} newFromNow={false} />
          <MapHover engine={eng} doc={doc ? withFocus(withHidden(withLevel(doc, level), level, lvHidden), focus) : null} time={time} skip={['focus']} />
          {notice && <div className="cmd-notice" onClick={() => setNotice(null)}>{notice}</div>}
          {agentSelAt && eng && <AgentMark engine={eng} at={agentSelAt} />}
          {agentRun && agentSel && <AgentPanel run={agentRun} id={agentSel} hour={agentHour} onHour={agentToHour} onClose={() => setAgentSel(null)} llm={llm.settings} />}
          {commanderOpen && eng && <CommanderOverlay engine={eng} trace={agentRun!.trace} c={commander!} tick={agentHour} names={hqNames} />}
          {commanderOpen && <RivalryChart trace={agentRun!.trace} tick={agentHour} current={commander!.hq} />}
          {card && !agentSel && <FormationPanel c={card} onClose={() => setCardSel(null)} onTab={setCardTab} badge={agentRun ? intentBadge(intentAt(agentRun.trace, card.id, agentHour)) : null}
            tabs={commander && agentRun ? [{ id: 'commander', label: 'Командующий', body: <CommanderPanel trace={agentRun.trace} c={commander} tick={agentHour} onTick={agentToHour} names={hqNames} /> }] : undefined}
            onPick={(id) => { if (agentRun?.trace.divisions.some((x) => x.id === id)) { setAgentSel(id); setCardSel(null); } else setCardSel(id); }}
            actions={agentRun ? <button onClick={showDivisions} title="Уровень корпуса с приближением к штабу">Показать дивизии</button> : undefined} />}
          {!agentSel && !card && <div className="ag-hint">{agentRun ? 'Щёлкните по дивизии — карточка агента и разговор с ним; по штабу — его карточка' : 'Щёлкните по знаку соединения — его карточка'}</div>}
          <Legend level={level} doc={doc} time={time} hidden={lvHidden} setHidden={(id, h) => setLegendHidden(level, id, h)}
            on={(k) => { const t = TOGGLES.find((x) => x.key === k); return t ? layerOn(t) : true; }}
            sig={doc.layers.map((l) => (l.visible ? 1 : 0)).join('')} />
          {doc.timeline && time && <Player start={doc.timeline.start ?? time} end={doc.timeline.end ?? time} time={time} setTime={setTime}
            events={result?.events ?? []} onEvent={goEvent} />}
          </div>
        </> : <Empty busy={!!busy} saved={tab === 'saved'} />}
      </main>
      {take && result && <TakeoverDialog at={take} start={result.start} end={result.end} turnHours={result.engine === 'agents' ? AGENT_GAME_HOURS : result.turnHours} scenarioName={result.scenarioName} scenario={result.scenario} kbSummary={takeKb} llm={llm} hasSaved={!!saved} agents={result.engine === 'agents'} onStart={(e, m) => void startGame(e, m)} onCancel={() => setTake(null)} />}
      {report && result && <ReportModal md={result.report} onClose={() => setReport(false)}
        onDownload={() => download(`${result.scenario}-seed${result.seed}-report.md`, result.report, 'text/markdown')} />}
    </div>
    </ZonesContext.Provider>
  );
}

function Empty({ busy, saved }: { busy: boolean; saved?: boolean }) {
  return (
    <div className="rp-empty">
      <div>
        <div className="rp-empty-ic">{busy ? <span className="spinner big" /> : '▶'}</div>
        <b>{busy ? 'Идёт расчёт…' : saved ? 'Выберите сохранённую переигровку слева и нажмите «Открыть»' : 'Выберите сценарий и нажмите «Рассчитать»'}</b>
        <p>Расчёт занимает 5–30 секунд. На карте — ход операции по часам: соединения, линия фронта, бои, отметки; бледные знаки — исторические положения.</p>
      </div>
    </div>
  );
}

const Results = memo(ResultsPanel);
function ResultsPanel({ r, tol, onReport, onOpen, onSummary, onEvent, saved, saving, onSave, kbNow }: { r: SimResult; tol: number; onReport: () => void; onOpen: () => void; onSummary: () => void; onEvent: (e: SimResult['events'][number]) => void; saved: boolean; saving: boolean; onSave: () => void; kbNow?: KbStamp | null }) {
  const lo = Math.min(...r.spread), hi = Math.max(...r.spread);
  return (
    <div className="rp-res" data-tour="replay-results">
      <div className="kpis">
        <div><b>{r.runs > 1 && lo !== hi ? `${pct(lo)}–${pct(hi)}` : pct(r.within)}</b><span>положений в пределах ±{tol} км от исторических</span></div>
        <div><b>{r.eventsHit}<small> / {r.eventsTotal}</small></b><span>событий с точностью ±2 сут{r.runs > 1 ? `, ${r.runs} прогонов` : ''}</span></div>
      </div>
      <KbStampNote s={r.kb} now={kbNow} />
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
        <button className={saved ? 'done' : 'primary'} onClick={onSave} disabled={saved || saving} title="Сохранить расчёт целиком: открывается во вкладке «Сохранённые» без пересчёта">{saving ? 'сохранение…' : saved ? 'Сохранено ✓' : 'Сохранить'}</button>
        <button onClick={onReport}>Отчёт</button>
        <button onClick={onOpen} title="Открыть результат в редакторе: правка, экспорт, сохранение на сервер">В редактор →</button>
        <button onClick={onSummary} disabled={!r.summary} title="Сводная карта операции, как в историческом атласе: этапы, линии фронта с датами, удары армий с датами выхода. Открывается в редакторе — правка, экспорт в SVG и PNG">Сводная карта →</button>
      </div>
    </div>
  );
}

/** Сохранённые переигровки: открыть, переименовать, удалить. */
function SavedList({ list, current, busy, onOpen, onRename, onDelete }: { list: SavedReplay[]; current: string | null; busy: boolean; onOpen: (m: SavedReplay) => void; onRename: (m: SavedReplay, title: string) => void; onDelete: (m: SavedReplay) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  const [text, setText] = useState('');
  const dt = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)} ${s.slice(11, 16)}`;
  if (!list.length) return <div className="rp-savedlist"><p className="muted">Сохранённых переигровок нет. После расчёта нажмите «Сохранить» под результатом — переигровка появится здесь и будет открываться без пересчёта.</p></div>;
  return (
    <div className="rp-savedlist">
      {list.map((m) => (
        <div key={m.id} className={`rp-sv${m.id === current ? ' on' : ''}`}>
          {edit === m.id
            ? <div className="rp-sv-edit"><input autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { onRename(m, text.trim() || m.title); setEdit(null); } if (e.key === 'Escape') setEdit(null); }} />
              <button onClick={() => { onRename(m, text.trim() || m.title); setEdit(null); }}>OK</button></div>
            : <b>{m.title}</b>}
          <span className="muted small">{m.engine === 'agents' ? 'агентная модель — дивизии' : `нынешняя модель · правила ${m.rules}${m.runs > 1 ? ` · ${m.runs} прогонов` : ''}`} · seed {m.seed} · сохранено {dt(m.created)}</span>
          <span className="small">{Math.round(m.within * 100)} % положений в допуске · событий {m.eventsHit} из {m.eventsTotal} (±2 сут)</span>
          <KbStampNote s={m.kb} />
          <div className="rp-sv-b">
            <button className="primary" disabled={busy} onClick={() => onOpen(m)}>Открыть</button>
            <button className="link" onClick={() => { setEdit(m.id); setText(m.title); }}>переименовать</button>
            <span style={{ flex: 1 }} />
            <button className="danger" onClick={() => onDelete(m)} title="Удалить сохранение (с подтверждением)">Удалить</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportModal({ md, onClose, onDownload }: { md: string; onClose: () => void; onDownload: () => void }) {
  const html = useMemo(() => mdToHtml(md), [md]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal report" data-modal onClick={(e) => e.stopPropagation()}>
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
    <div className="player" data-tour="map-player">
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

type LegendProps = {
  level: MapLevel;
  /** Карта уровня до скрытия элементов: по ней — что на ней есть в этот час (скрытое остаётся в легенде). */
  doc: MapDocument | null;
  time: string | null;
  /** Слой-переключатель включён (меню «Слои»). */
  on: (key: string) => boolean;
  hidden: ReadonlySet<string>;
  setHidden: (id: string, hide: boolean) => void;
  /** Экран командования: и замысел, тыл, реки, зоны влияния. */
  command?: boolean;
  /** Элементы не из знаков карты, которые сейчас есть (зоны влияния). */
  always?: ReadonlySet<string>;
  /** Подпись состояния слоёв: с ней легенда не перерисовывается, пока состояние и час те же (кадры проигрывания). */
  sig?: string;
  /** Ключ localStorage: легенда открывается свёрнутой и помнит, что её развернули (командование — карта для работы). */
  remember?: string };
export const Legend = memo(LegendPanel, (a, b) => a.sig != null && a.sig === b.sig && a.level === b.level && a.doc === b.doc && a.hidden === b.hidden && a.always === b.always
  && (a.time ?? '').slice(0, 13) === (b.time ?? '').slice(0, 13));

/** Скрытые элементы легенды по уровням («stavka:blow-enemy»), запоминаются. */
export function useLegendHidden(): [ReadonlySet<string>, (level: MapLevel, id: string, hide: boolean) => void, () => void] {
  const KEY = 'def_ops.legend.hidden';
  const [h, set] = useState<ReadonlySet<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]); } catch { return new Set(); } });
  const save = (x: Set<string>) => { set(x); try { localStorage.setItem(KEY, JSON.stringify([...x])); } catch { /* */ } };
  return [h, (level, id, hide) => { const x = new Set(h); if (hide) x.add(`${level}:${id}`); else x.delete(`${level}:${id}`); save(x); }, () => save(new Set())];
}
/** Скрытые элементы уровня — их id. */
export const hiddenOn = (h: ReadonlySet<string>, level: MapLevel): Set<string> => new Set([...h].filter((k) => k.startsWith(`${level}:`)).map((k) => k.slice(level.length + 1)));

/** Легенда: условные обозначения уровня, только то, что сейчас на карте; строка — скрыть или показать элемент. */
function LegendPanel({ level, doc, time, on, hidden, setHidden, command = false, always, remember }: LegendProps) {
  const [open, setOpenState] = useState(() => { if (!remember) return true; try { return localStorage.getItem(remember) === 'open'; } catch { return false; } });
  const setOpen = (v: boolean) => { setOpenState(v); if (remember) try { localStorage.setItem(remember, v ? 'open' : 'closed'); } catch { /* */ } };
  const items = doc ? presentItems(legendFor(level, { command }), level, doc, time, always) : [];
  shownLegend.items = items; shownLegend.level = level;
  const shown = (it: LegendItem) => (!it.key || on(it.key)) && !hidden.has(it.id);
  const flip = (it: LegendItem, want: boolean) => {
    setHidden(it.id, !want);
    // показать элемент выключенного слоя — включить слой
    if (want && it.key && !on(it.key)) void act('map.layer', { layer: it.key, on: true });
  };
  useAction({
    id: 'map.legend', section: 'replay', title: 'Легенда карты', describe: 'Открывает условные обозначения карты и читает их вслух (open — только открыть или свернуть, без чтения).', say: ['штаб, легенда'],
    params: { type: 'object', properties: { open: { type: 'boolean' } } }, available: inReplay, highlight: () => btn('map.legend'),
    run: async (p?: { open?: boolean }) => {
      if (typeof p?.open === 'boolean') { setOpen(p.open); return; }
      setOpen(true);
      const t = items.map((r) => legendText(r, level) + (shown(r) ? '' : ' (скрыто)'));
      const parts = Array.from({ length: Math.ceil(t.length / 4) }, (_, i) => t.slice(i * 4, i * 4 + 4).join(', '));
      return readAloud(`Условные обозначения. ${parts.map((x) => `${x.charAt(0).toUpperCase()}${x.slice(1)}.`).join(' ')}`);
    },
  });
  useAction({
    id: 'map.legend.item', section: 'replay', title: 'Элемент легенды', describe: 'Скрывает или показывает на карте элемент условных обозначений этого уровня (удары противника, отходы, населённые пункты, свои войска…).',
    params: { type: 'object', properties: { item: { type: 'string' }, on: { type: 'boolean' } }, required: ['item'] }, say: ['штаб, скрой отходы', 'штаб, покажи удары противника'],
    available: inReplay, highlight: noted,
    run: async (p: { item: string; on?: boolean }) => {
      const it = findLegendItem(String(p?.item ?? ''), items, level);
      if (!it) return `На карте этого уровня такого нет. Есть: ${items.map((x) => `«${legendText(x, level)}»`).join(', ')}.`;
      const want = p.on ?? !shown(it);
      if (want !== shown(it)) flip(it, want);
      note(hl(`legend-${it.id}`), '.legend .lg-h');
      return `${want ? 'Показываю' : 'Скрыл'}: ${legendText(it, level)}.`;
    },
  });
  const off = items.filter((x) => !shown(x)).length;
  return (
    <div className={`legend${open ? '' : ' closed'}`} data-tour="map-legend">
      <ActButton className="lg-h" action="map.legend" params={{ open: !open }}>Условные обозначения{off ? <small> · скрыто {off}</small> : null} {open ? '▾' : '▸'}</ActButton>
      {open && <div className={`lg-b${items.length > 10 ? ' two' : ''}`}>
        {items.map((r) => { const v = shown(r); return (
          <button key={r.id} className={`lg-row${v ? '' : ' off'}`} title={v ? 'Скрыть на карте' : 'Показать на карте'} data-action="map.legend.item" data-hl={`legend-${r.id}`} data-layer={r.key}
            onClick={() => { void act('map.legend.item', { item: r.id, on: !v }); }}><i className={r.cls}>{r.mark}</i>{legendText(r, level)}{!v && <span className="lg-eye">скрыто</span>}</button>); })}
        {!items.length && <div className="lg-row">на карте этого уровня пока ничего нет</div>}
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
