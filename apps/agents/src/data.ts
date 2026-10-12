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
/** Кадр дивизии: положение, состояние, численность, запасы, усталость, организованность, часов в окружении (в старых ходах нет). */
export type Row = [number, number, string, number, number, number, number, number, number, number, number?];

export interface StaffCall { tick: number; time: string; hq: string; model: string; request: string; reply: string; reasoning?: string; ok: boolean; tokens?: number | null; secs?: number | null; truncated?: boolean | null }
export interface ProbeResult { best: number; rows: { parallel: number; tokensPerSec: number; secs: number }[]; error?: string }
export interface LlmInfo { url: string; model: string; reasoning?: Reasoning; maxTokens?: number; parallel?: number; sync?: boolean; byArmy?: boolean; parallelUsed?: number; probe?: ProbeResult }
export interface Trace {
  scenario: string; name: string; start: string; hours: number; seed: number; theatre: string; fields?: string[];
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
export interface RunOptions { seed: number; de: StaffSource; su?: 'script' | 'doctrine'; llm: LlmRun | null; withoutFires?: boolean; withoutWithdrawals?: boolean; traceFile?: string }
export interface HistPos { formation: string; time: string; at: LngLat; approxKm: number; set?: string; reliability?: string | null }
/** Веха операции: выход к пункту (reach), встреча (meet), отсечение (cut — расчётом не проверяется). */
export interface Milestone { id: string; title: string; date: string; kind: 'reach' | 'meet' | 'cut' | string; at: LngLat | null; radiusKm?: number; formations?: string[]; source?: string }
export interface History { divisions: HistPos[]; armies: HistPos[]; events?: Milestone[] }
export interface RunData { trace: Trace; history: History; theatre: TheatreData; live: boolean }

/** Сценарии: путь для ядра и готовый ход прогона для браузера (npm run agents:berlin, agents:seelow). */
/** Вариант прогона для сравнения: что меняется и где готовый ход для браузера (npm run agents:berlin:variants). */
export interface VariantInfo { id: string; name: string; de?: StaffSource; su?: 'script' | 'doctrine'; withoutFires?: boolean; withoutWithdrawals?: boolean; trace: string }
export interface ScenarioInfo { id: string; name: string; path: string; trace: string; variants: VariantInfo[] }
const variantsOf = (dir: string): VariantInfo[] => [
  { id: 'doctrine', name: 'немецкие штабы по доктрине', de: 'doctrine', trace: `evals-out/agents/${dir}-doctrine/trace.json` },
  { id: 'su-doctrine', name: 'советские штабы по доктрине', su: 'doctrine', trace: `evals-out/agents/${dir}-su-doctrine/trace.json` },
  { id: 'both-doctrine', name: 'обе стороны по доктрине', de: 'doctrine', su: 'doctrine', trace: `evals-out/agents/${dir}-both-doctrine/trace.json` },
  { id: 'nofires', name: 'без артподготовки', withoutFires: true, trace: `evals-out/agents/${dir}-nofires/trace.json` },
  { id: 'nowithdraw', name: 'без отвода с первой позиции', withoutWithdrawals: true, trace: `evals-out/agents/${dir}-nowithdraw/trace.json` },
];
export const SCENARIOS: ScenarioInfo[] = [
  { id: 'berlin', name: 'Берлинская операция, 16.04–2.05', path: 'packages/sim/data/scenarios/agents/berlin-1945.json', trace: 'evals-out/agents/berlin/trace.json', variants: variantsOf('berlin') },
  { id: 'seelow', name: 'Зееловские высоты, 16–20.04', path: 'packages/sim/data/scenarios/agents/seelow-1945.json', trace: 'evals-out/agents/seelow/trace.json', variants: variantsOf('seelow') },
];
export const SCENARIO = SCENARIOS[0].path;
export const scenarioById = (id: string | null): ScenarioInfo => SCENARIOS.find((x) => x.id === id) ?? SCENARIOS[0];

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

/** Сводка готового прогона (agents-run пишет summary.json рядом с trace.json): сверка, вехи, потери по дням. */
export interface RunSummary {
  scenario: string; runs: number; seed: number; toleranceKm: number; info: string;
  perRun: { seed: number; divisions: number; armies: number; outOfTuning: number }[];
  outOfTuning: { n: number; agent: number; current: number };
  sectors: { sector: string; period: string; n: number; agent: number; current: number; tuned: boolean }[];
  milestones: { id: string; title: string; date: string; calc: string | null }[];
  losses: { day: string; su: number; de: number }[];
}
export async function loadSummary(tracePath: string): Promise<RunSummary> {
  return JSON.parse(await repoText(tracePath.replace(/trace\.json$/, 'summary.json'))) as RunSummary;
}

export async function loadRun(scenario = SCENARIO, opts: RunOptions = { seed: 1, de: 'script', llm: null }): Promise<RunData> {
  const history = JSON.parse(await repoText(scenario.replace(/\.json$/, '.history.json'))) as History;
  let trace: Trace;
  let live = false;
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    trace = await invoke<Trace>('run_scenario', { scenario, seed: opts.seed, de: opts.de, su: opts.su ?? 'script', llm: opts.de === 'llm' ? opts.llm : null, withoutFires: !!opts.withoutFires, withoutWithdrawals: !!opts.withoutWithdrawals });
    live = true;
  } else {
    trace = JSON.parse(await repoText(opts.traceFile ?? (SCENARIOS.find((x) => x.path === scenario) ?? SCENARIOS[0]).trace)) as Trace;
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

/** Ход ответа штаба на модели во время расчёта (событие staff-stream ядра). */
export interface StaffLiveMsg { hq: string; name: string; time: string; phase: 'wait' | 'think' | 'answer' | 'done' | 'error'; think: string; text: string; parts: number; secs: number }

/** Ответ модели целиком: текст, размышления, токены, время. */
export interface StreamResult { text: string; reasoning: string; tokens: number | null; secs: number; truncated: boolean }
export type StreamPart = 'think' | 'text';

/** Разделение потока на размышления и ответ по меткам <think>…</think>, приходящим по частям (как ThinkSplit в ядре). */
export class ThinkSplit {
  private pending = '';
  private inside = false;
  push(s: string, out: [StreamPart, string][]) {
    this.pending += s;
    for (;;) {
      const tag = this.inside ? '</think>' : '<think>';
      const part: StreamPart = this.inside ? 'think' : 'text';
      const k = this.pending.indexOf(tag);
      if (k >= 0) {
        if (k > 0) out.push([part, this.pending.slice(0, k)]);
        this.pending = this.pending.slice(k + tag.length);
        this.inside = !this.inside;
        continue;
      }
      let keep = 0;
      for (let n = tag.length - 1; n > 0; n--) if (this.pending.endsWith(tag.slice(0, n))) { keep = n; break; }
      const cut = this.pending.length - keep;
      if (cut > 0) { out.push([part, this.pending.slice(0, cut)]); this.pending = this.pending.slice(cut); }
      return;
    }
  }
  finish(out: [StreamPart, string][]) { if (this.pending) out.push([this.inside ? 'think' : 'text', this.pending]); this.pending = ''; }
}

let streamId = 0;

/**
 * Запрос к модели потоком: `onPart` получает размышления и ответ по мере прихода, `signal` останавливает. В приложении —
 * через ядро (llm_chat_stream), в браузере — напрямую через прокси сервера разработки.
 */
export async function chatStream(l: LlmRun, messages: { role: string; content: string }[], onPart: (p: StreamPart, s: string) => void, signal?: AbortSignal): Promise<StreamResult> {
  if (isTauri()) {
    const { invoke, Channel } = await import('@tauri-apps/api/core');
    const id = ++streamId;
    const ch = new Channel<{ part: StreamPart; s: string }>();
    ch.onmessage = (m) => onPart(m.part, m.s);
    const stop = () => { void invoke('llm_cancel', { id }); };
    signal?.addEventListener('abort', stop);
    try { return await invoke<StreamResult>('llm_chat_stream', { id, llm: l, messages: messages.map((m) => [m.role, m.content]), onEvent: ch }); }
    finally { signal?.removeEventListener('abort', stop); }
  }
  const t0 = performance.now();
  const body: Record<string, unknown> = { model: l.model, temperature: 0.2, stream: true, stream_options: { include_usage: true }, messages };
  if (l.maxTokens > 0) body.max_tokens = l.maxTokens;
  if (l.reasoning === 'off') {
    Object.assign(body, { reasoning_effort: 'low', chat_template_kwargs: { enable_thinking: false }, think: false });
    const last = [...messages].reverse().find((m) => m.role === 'user');
    body.messages = messages.map((m) => (m === last ? { ...m, content: `${m.content} /no_think` } : m));
  } else if (l.reasoning !== 'default') body.reasoning_effort = l.reasoning;
  const r = await fetch(`${l.url.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!r.ok) throw new Error(`модель ответила ${r.status}`);
  let text = '', reasoning = '', tokens: number | null = null, truncated = false, chunks = 0;
  const split = new ThinkSplit();
  const out: [StreamPart, string][] = [];
  const flush = () => { for (const [p, s] of out.splice(0)) { if (p === 'think') reasoning += s; else text += s; onPart(p, s); } };
  const take = (c: { finish_reason?: string; delta?: Record<string, string>; message?: Record<string, string> } | undefined, d: Record<string, string> | undefined) => {
    if (c?.finish_reason === 'length') truncated = true;
    if (!d) return;
    for (const k of ['reasoning_content', 'reasoning']) if (d[k]) { out.push(['think', d[k]]); chunks++; }
    if (d.content) { split.push(d.content, out); chunks++; }
    flush();
  };
  if ((r.headers.get('content-type') ?? '').includes('text/event-stream') && r.body) {
    const rd = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          if (j.usage?.completion_tokens) tokens = j.usage.completion_tokens;
          take(j.choices?.[0], j.choices?.[0]?.delta);
        } catch { /* неполная строка */ }
      }
    }
  } else {
    const j = await r.json();
    tokens = j.usage?.completion_tokens ?? null;
    take(j.choices?.[0], j.choices?.[0]?.message);
  }
  split.finish(out);
  flush();
  const k = text.indexOf('</think>');
  if (k >= 0) { reasoning += text.slice(0, k); text = text.slice(k + 8); }
  return { text: text.trim(), reasoning, tokens: tokens ?? (chunks || null), truncated, secs: (performance.now() - t0) / 1000 };
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
  /** Уровень размышлений в разговоре с агентом. */
  chatReasoning: Reasoning;
  /** Советские штабы: исторические приказы или по доктрине. */
  su: 'script' | 'doctrine';
}
export const chatRun = (s: Settings): LlmRun => ({ url: s.llmUrl, model: s.chatModel || 'local-model', reasoning: s.chatReasoning, maxTokens: 0, parallel: 1, sync: false, byArmy: false });
export const llmRun = (s: Settings): LlmRun => ({ url: s.llmUrl, model: s.staffModel, reasoning: s.reasoning, maxTokens: s.maxTokens, parallel: s.parallel, sync: s.sync, byArmy: s.byArmy });
export function loadSettings(): Settings {
  const d: Settings = { llmUrl: defaultLlmUrl(), staffModel: '', chatModel: '', de: 'script', reasoning: 'default', maxTokens: 0, parallel: 0, sync: true, byArmy: false, chatReasoning: 'default', su: 'script' };
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

/** Час вехи в прогоне: первая советская дивизия в радиусе пункта (reach) или дивизии обоих объединений (meet). */
export function milestoneHour(trace: Trace, m: Milestone): number | null {
  const parent = new Map(trace.hqs.map((h) => [h.id, h.parent]));
  const under = (hq: string, f: string) => { for (let x: string | null | undefined = hq, n = 0; x && n < 8; x = parent.get(x), n++) if (x === f) return true; return false; };
  const live = (g: string) => g !== 'pending' && g !== 'destroyed';
  if (m.kind === 'cut') {
    // отсечение: окружено не меньше 2/3 действующих дивизий названных соединений (как в agents-run)
    const mem = trace.divisions.flatMap((d, i) => ((m.formations ?? []).some((fm) => d.id === fm || under(d.hq, fm)) ? [i] : []));
    for (let h = 1; h < trace.frames.length; h++) {
      const f = trace.frames[h];
      const act = mem.filter((i) => live(stateGroup(f[i][2])));
      if (act.length && 3 * act.filter((i) => (f[i][10] ?? 0) > 0).length >= 2 * act.length) return h;
    }
    return null;
  }
  if (!m.at || (m.kind !== 'reach' && m.kind !== 'meet')) return null;
  const r = m.radiusKm ?? 8;
  for (let h = 1; h < trace.frames.length; h++) {
    const f = trace.frames[h];
    const near = (i: number) => live(stateGroup(f[i][2])) && km([f[i][0], f[i][1]], m.at!) <= r;
    const ok = m.kind === 'reach'
      ? trace.divisions.some((d, i) => d.side === 'su' && near(i))
      : (m.formations ?? []).every((fm) => trace.divisions.some((d, i) => under(d.hq, fm) && near(i)));
    if (ok) return h;
  }
  return null;
}

/** Потери стороны к часу: численность в начале минус к этому часу. */
export function lossesAt(trace: Trace, side: Side, h: number): number {
  const f0 = trace.frames[0], f = rowFrame(trace, h);
  return trace.divisions.reduce((s, d, i) => (d.side === side ? s + Math.max(0, f0[i][3] - f[i][3]) : s), 0);
}
const rowFrame = (trace: Trace, h: number) => trace.frames[Math.max(0, Math.min(trace.frames.length - 1, Math.round(h)))];

/** Час, с которого дивизия выбыла (небоеспособна или сведена в другую), — по кадрам прогона. */
export function lostAt(trace: Trace): (number | undefined)[] {
  return trace.divisions.map((_, i) => {
    const h = trace.frames.findIndex((f) => stateGroup(f[i][2]) === 'destroyed');
    return h < 0 ? undefined : h;
  });
}

/** Группа состояния — для цвета и диаграммы. */
export function stateGroup(label: string): 'reserve' | 'march' | 'deploy' | 'attack' | 'defense' | 'withdraw' | 'destroyed' | 'pending' {
  if (label.startsWith('не введена')) return 'pending';
  if (label.startsWith('марш')) return 'march';
  if (label.startsWith('развёрт')) return 'deploy';
  if (label.startsWith('наступ')) return 'attack';
  if (label.startsWith('оборона')) return 'defense';
  if (label.startsWith('отход') || label.startsWith('отступ') || label.startsWith('остатки')) return 'withdraw';
  if (label.startsWith('небоеспособ') || label.startsWith('сведена')) return 'destroyed';
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
