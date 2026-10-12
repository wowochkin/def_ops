/**
 * Данные приложения: ход прогона ядра (trace), история для сравнения и театр.
 * В приложении (Tauri) прогон считает ядро на Rust по команде run_scenario; в браузере (разработка) берётся
 * готовый ход из evals-out (npm run agents:seelow) через сервер разработки.
 */
import type { TheatreData } from '@def-ops/sim';

export type LngLat = [number, number];
export type Side = 'su' | 'de';

export interface DivisionInfo { id: string; name: string; side: Side; hq: string; kind: string; mobility: string; size: string; quality: number; note: string }
export interface HqInfo { id: string; name: string; side: Side; echelon: 'front' | 'army' | 'corps'; parent: string | null }
export interface JournalEvent { tick: number; time: string; agent: string | null; text: string }
/** Кадр дивизии: lng, lat, состояние, люди, танки, орудия, боекомплекты, заправки, усталость, организованность. */
export type Row = [number, number, string, number, number, number, number, number, number, number];

export interface StaffCall { tick: number; time: string; hq: string; model: string; request: string; reply: string; ok: boolean; tokens?: number | null; secs?: number | null; truncated?: boolean | null }
export interface ProbeResult { best: number; rows: { parallel: number; tokensPerSec: number; secs: number }[]; error?: string }
export interface LlmInfo { url: string; model: string; reasoning?: Reasoning; maxTokens?: number; parallel?: number; sync?: boolean; byArmy?: boolean; parallelUsed?: number; probe?: ProbeResult }
export interface Trace {
  scenario: string; name: string; start: string; hours: number; seed: number; theatre: string;
  divisions: DivisionInfo[]; hqs: HqInfo[]; frames: Row[][]; journal: JournalEvent[];
  /** Источник решений штабов: [советская сторона, немецкая] — script, doctrine, llm. */
  sources?: string[]; llm?: LlmInfo | null; staff?: StaffCall[];
}

/** Источник решений немецких штабов. */
export type StaffSource = 'script' | 'doctrine' | 'llm';
/** Уровень размышлений модели: по умолчанию модели, выключить, низкий, средний, высокий. */
export type Reasoning = 'default' | 'off' | 'low' | 'medium' | 'high';
/** Настройки штаба на модели для ядра (crates/agents-core/src/llm.rs, LlmConfig). */
export interface LlmRun { url: string; model: string; reasoning: Reasoning; maxTokens: number; parallel: number; sync: boolean; byArmy: boolean }
export interface RunOptions { seed: number; de: StaffSource; llm: LlmRun | null }
export interface HistPos { formation: string; time: string; at: LngLat; approxKm: number; set?: string; reliability?: string | null }
export interface History { divisions: HistPos[]; armies: HistPos[] }
export interface RunData { trace: Trace; history: History; theatre: TheatreData; live: boolean }

export const SCENARIO = 'packages/sim/data/scenarios/agents/seelow-1945.json';

export const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function repoText(path: string): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('read_text', { path });
  }
  const r = await fetch(`/repo/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.text();
}

export async function loadRun(scenario = SCENARIO, opts: RunOptions = { seed: 1, de: 'script', llm: null }): Promise<RunData> {
  const history = JSON.parse(await repoText(scenario.replace(/\.json$/, '.history.json'))) as History;
  let trace: Trace;
  let live = false;
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    trace = await invoke<Trace>('run_scenario', { scenario, seed: opts.seed, de: opts.de, llm: opts.de === 'llm' ? opts.llm : null });
    live = true;
  } else {
    trace = JSON.parse(await repoText('evals-out/agents/seelow/trace.json')) as Trace;
  }
  const theatre = JSON.parse(await repoText(`packages/sim/data/theatres/${trace.theatre}.json`)) as TheatreData;
  return { trace, history, theatre, live };
}

/** Языковая модель (протокол OpenAI): в приложении — через ядро, в браузере — через прокси сервера разработки. */
export const defaultLlmUrl = () => (isTauri() ? 'http://localhost:1234/v1' : '/llm/v1');

export async function listModels(url: string): Promise<string[]> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string[]>('list_models', { url });
  }
  const r = await fetch(`${url.replace(/\/$/, '')}/models`);
  if (!r.ok) throw new Error(`сервер модели ответил ${r.status}`);
  const j = await r.json();
  return ((j.data ?? []) as { id: string }[]).map((m) => m.id).sort();
}

export async function chatLLM(url: string, model: string, messages: { role: string; content: string }[]): Promise<string> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('llm_chat', { url, model, messages: messages.map((m) => [m.role, m.content]) });
  }
  const r = await fetch(`${url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, temperature: 0.2, messages }),
  });
  if (!r.ok) throw new Error(`модель ответила ${r.status}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? '(пустой ответ)';
}

/**
 * Замер числа параллельных запросов (как llm::probe_parallel в ядре): короткие одинаковые ответы на 1, 2, 4, 8…
 * одновременных запросах; берётся ступень, после которой суммарная скорость растёт меньше чем на 20 %.
 */
export async function probeParallel(l: LlmRun): Promise<ProbeResult> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ProbeResult>('probe_parallel', { llm: l });
  }
  const url = `${l.url.replace(/\/$/, '')}/chat/completions`;
  const one = async () => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: l.model, temperature: 0, max_tokens: 96, reasoning_effort: 'low', chat_template_kwargs: { enable_thinking: false }, think: false, messages: [{ role: 'user', content: 'Перечисли через запятую словами числа от одного до шестидесяти, без пояснений. /no_think' }] }) });
    if (!r.ok) throw new Error(`модель ответила ${r.status}`);
    const j = await r.json();
    return (j.usage?.completion_tokens as number | undefined) ?? String(j.choices?.[0]?.message?.content ?? '').length / 3;
  };
  await one();
  const rows: ProbeResult['rows'] = [];
  for (let n = 1; n <= 16; n *= 2) {
    const t0 = performance.now();
    let toks: number[];
    try { toks = await Promise.all(Array.from({ length: n }, one)); } catch { break; }
    const secs = (performance.now() - t0) / 1000;
    const tps = toks.reduce((a, b) => a + b, 0) / secs;
    const prev = rows[rows.length - 1];
    rows.push({ parallel: n, tokensPerSec: Math.round(tps * 10) / 10, secs: Math.round(secs * 10) / 10 });
    if (prev && tps < prev.tokensPerSec * 1.2) break;
  }
  if (!rows.length) throw new Error('сервер не ответил на замер');
  let best = rows[0].parallel;
  for (let k = 1; k < rows.length && rows[k].tokensPerSec >= rows[k - 1].tokensPerSec * 1.2; k++) best = rows[k].parallel;
  return { best, rows };
}

/** Настройки модели и источника решений — в хранилище окна (переживают перезапуск). */
export interface Settings {
  llmUrl: string; staffModel: string; chatModel: string; de: StaffSource;
  /** Уровень размышлений и потолок токенов ответа штаба (0 — без ограничения). */
  reasoning: Reasoning; maxTokens: number;
  /** Одновременных запросов: 0 — авто (замер перед расчётом). */
  parallel: number;
  /** Штабы на модели решают в один час — запросы уходят параллельно. */
  sync: boolean;
  /** Один запрос на армию за все её корпуса. */
  byArmy: boolean;
}
export const llmRun = (s: Settings): LlmRun => ({ url: s.llmUrl, model: s.staffModel, reasoning: s.reasoning, maxTokens: s.maxTokens, parallel: s.parallel, sync: s.sync, byArmy: s.byArmy });
export function loadSettings(): Settings {
  const d: Settings = { llmUrl: defaultLlmUrl(), staffModel: '', chatModel: '', de: 'script', reasoning: 'default', maxTokens: 0, parallel: 0, sync: true, byArmy: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem('agents.settings') ?? '{}') }; } catch { return d; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem('agents.settings', JSON.stringify(s)); } catch { /* без хранилища */ } }

/** Часы от начала сценария → «16.04.1945 05:00». */
export function timeLabel(start: string, h: number): string {
  const t = new Date(`${start}:00Z`);
  t.setUTCMinutes(t.getUTCMinutes() + Math.round(h * 60));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}.${p(t.getUTCMonth() + 1)}.${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

/** Час сценария для отметки времени «1945-04-17T20:00». */
export function hourOf(start: string, time: string): number {
  return (Date.parse(`${time}:00Z`) - Date.parse(`${start}:00Z`)) / 3600000;
}

const KY = 110.57;
export function km(a: LngLat, b: LngLat): number {
  const kx = 111.32 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * KY);
}

/** Положение дивизии на дробный час (между кадрами — линейно). */
export function posAt(trace: Trace, i: number, h: number): LngLat {
  const n = trace.frames.length - 1;
  const h0 = Math.max(0, Math.min(n, Math.floor(h))), h1 = Math.min(n, h0 + 1), f = Math.max(0, Math.min(1, h - h0));
  const a = trace.frames[h0][i], b = trace.frames[h1][i];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

export const rowAt = (trace: Trace, i: number, h: number): Row => trace.frames[Math.max(0, Math.min(trace.frames.length - 1, Math.round(h)))][i];

/** Группа состояния — для цвета и диаграммы. */
export function stateGroup(label: string): 'reserve' | 'march' | 'deploy' | 'attack' | 'defense' | 'withdraw' | 'destroyed' {
  if (label.startsWith('марш')) return 'march';
  if (label.startsWith('развёрт')) return 'deploy';
  if (label.startsWith('наступ')) return 'attack';
  if (label.startsWith('оборона')) return 'defense';
  if (label.startsWith('отход') || label.startsWith('отступ')) return 'withdraw';
  if (label.startsWith('небоеспособ')) return 'destroyed';
  return 'reserve';
}

/** Короткое обозначение: «185-я стрелковая дивизия» → «185 сд». */
export function shortName(d: DivisionInfo): string {
  const n = d.name.match(/^(\d+)/)?.[1];
  const g = /гвардейск/.test(d.name) ? 'гв. ' : '';
  const map: Record<string, string> = { sd: 'сд', tk: 'тк', mk: 'мк', brigade: 'бр', kd: 'кд', vdd: 'вдд' };
  if (d.side === 'su' && n) return `${n} ${g}${map[d.kind] ?? d.kind}`;
  return d.name.replace(/дивизия/, 'д.').replace(/танко-гренадерская/, 'тгд').replace(/пехотная/, 'пд');
}
