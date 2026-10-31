/**
 * Предзапись голоса стенда: все заготовленные фразы озвучены заранее голосом начальника штаба командой подготовки
 * (`npm run expo:prepare -- --voice`). Клипы (Ogg Opus) и манифест лежат в папке данных приложения, `expo/voice/`;
 * в репозиторий не входят.
 *
 * Фраза без подстановок — один клип. Шаблон с подстановками: если сочетаний значений немного (до `WHOLE_MAX`), клип —
 * на каждую целую фразу; иначе шаблон режется на предложения (`templateUnits`), и каждое предложение озвучено со всеми
 * значениями своих подстановок, — фраза склеивается по границам предложений с паузой по знаку. Значения подстановок —
 * из данных стенда (`stageDomains`): даты операции, фронты, маршалы, переломы, заголовки карточек, события, звания.
 */
import { BANK } from './bank';
import { allLines, fillIn, LINES, templateUnits, type Lines, type Vars } from './lines';
import { MAP } from './map';
import { RANKS, dayMonth } from './score';
import { FRONT_NAMES } from './scenes';
import type { FrontId } from './settings';

/** Шаблон с не большим числом целых фраз озвучивается целыми фразами — склейки нет. */
export const WHOLE_MAX = 30;
/** Совпадения решений с маршалом (из трёх переломов) — словами: «два из трёх». */
export const MATCH_WORDS = ['ни одного', 'одно', 'два', 'три'];

export interface Clip { file: string; ms: number }
export interface VoiceManifest { version: 1; voice: string; engine: string; clips: Record<string, Clip> }

/** Подстановки, значения которых зависят от фронта. */
export interface FrontSlots { front: string; marshal: string; turn: string[]; title: string[] }
export interface Domains { fronts: FrontSlots[]; date: string[]; rank: string[]; matches: string[]; event: string[] }

/** Значения подстановок стенда; `start` и `hours` — начало и длительность сценария операции. */
export function stageDomains(start: string, hours: number): Domains {
  const t0 = Date.parse(`${start}Z`);
  const date = [...new Set(Array.from({ length: Math.ceil(hours / 24) + 1 }, (_, d) => dayMonth(new Date(t0 + d * 864e5).toISOString())))];
  const fronts = (Object.entries(BANK.fronts) as [FrontId, (typeof BANK.fronts)[FrontId]][]).map(([id, f]) => ({
    front: FRONT_NAMES[id],
    marshal: f.marshal,
    turn: f.turns.map((t) => t.title),
    title: BANK.cards.filter((c) => c.front === id).map((c) => c.title),
  }));
  return { fronts, date, rank: RANKS.map((r) => r.title), matches: MATCH_WORDS, event: MAP.events.map((e) => e.title) };
}

const slotsOf = (t: string) => [...new Set([...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];

function values(slot: string, f: FrontSlots, d: Domains): string[] {
  const v = (f as unknown as Record<string, unknown>)[slot] ?? (d as unknown as Record<string, unknown>)[slot];
  if (v === undefined || slot === 'fronts') throw new Error(`нет значений подстановки {${slot}}`);
  return Array.isArray(v) ? v : [String(v)];
}

/** Все тексты шаблона при значениях `d` (без повторов). */
export function expand(t: string, d: Domains): string[] {
  const out = new Set<string>();
  const slots = slotsOf(t);
  for (const f of d.fronts) {
    let combos: Vars[] = [{}];
    for (const s of slots) combos = combos.flatMap((c) => values(s, f, d).map((v) => ({ ...c, [s]: v })));
    for (const c of combos) {
      const x = fillIn(t, c);
      if (x) out.add(x);
    }
  }
  return [...out];
}

/** Тексты к озвучке: целые фразы и куски склейки. */
export function voiceTexts(d: Domains, lines: Lines = LINES): string[] {
  const out = new Set<string>();
  for (const t of allLines(lines)) {
    const whole = expand(t, d);
    if (whole.length <= WHOLE_MAX) whole.forEach((x) => out.add(x));
    else for (const u of templateUnits(t)) expand(u, d).forEach((x) => out.add(x));
  }
  return [...out];
}

/** Клипы фразы: целая фраза, иначе её куски склейки; чего-то нет — null. */
export function clipPlan(m: VoiceManifest | null, text: string, parts?: string[]): Clip[] | null {
  if (!m) return null;
  const whole = m.clips[text];
  if (whole) return [whole];
  if (!parts || parts.length < 2) return null;
  const cs = parts.map((p) => m.clips[p]);
  return cs.every(Boolean) ? cs : null;
}

/** Пауза после куска склейки по знаку в его конце, с. Края клипов при подготовке очищены от тишины и смягчены. */
export function joinGap(part: string): number {
  const c = part.replace(/[»")\s]+$/, '').slice(-1);
  return c === '…' ? 0.4 : c === '!' || c === '?' ? 0.35 : c === '.' ? 0.3 : c === ':' || c === ';' ? 0.2 : 0.12;
}

/** Манифест из JSON или null, если он не той формы. */
export function parseManifest(j: unknown): VoiceManifest | null {
  const m = j as VoiceManifest | null;
  if (!m || m.version !== 1 || typeof m.clips !== 'object' || !m.clips) return null;
  const ok = Object.values(m.clips).every((c) => typeof c?.file === 'string' && /^[0-9a-f]{8,64}\.ogg$/.test(c.file) && c.ms > 0);
  return ok && Object.keys(m.clips).length ? m : null;
}

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Манифест предзаписи: в приложении — командой ядра из папки данных, в браузере — через сервер разработки. */
export async function loadManifest(): Promise<VoiceManifest | null> {
  try {
    if (inApp()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const t = await invoke<string | null>('expo_voice_manifest');
      return t ? parseManifest(JSON.parse(t)) : null;
    }
    const r = await fetch('/expo-voice/manifest.json', { signal: AbortSignal.timeout(5000) });
    return r.ok ? parseManifest(await r.json()) : null;
  } catch {
    return null;
  }
}

export async function loadClip(file: string): Promise<ArrayBuffer> {
  if (inApp()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ArrayBuffer>('expo_voice_clip', { file });
  }
  const r = await fetch(`/expo-voice/clips/${file}`);
  if (!r.ok) throw new Error(`клип ${file}: ${r.status}`);
  return r.arrayBuffer();
}
