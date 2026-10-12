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

export interface Trace {
  scenario: string; name: string; start: string; hours: number; seed: number; theatre: string;
  divisions: DivisionInfo[]; hqs: HqInfo[]; frames: Row[][]; journal: JournalEvent[];
}
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

export async function loadRun(scenario = SCENARIO, seed = 1): Promise<RunData> {
  const history = JSON.parse(await repoText(scenario.replace(/\.json$/, '.history.json'))) as History;
  let trace: Trace;
  let live = false;
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    trace = await invoke<Trace>('run_scenario', { scenario, seed });
    live = true;
  } else {
    trace = JSON.parse(await repoText('evals-out/agents/seelow/trace.json')) as Trace;
  }
  const theatre = JSON.parse(await repoText(`packages/sim/data/theatres/${trace.theatre}.json`)) as TheatreData;
  return { trace, history, theatre, live };
}

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
