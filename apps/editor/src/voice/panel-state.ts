// Чистая логика панели голоса: состояние словами, настройки в localStorage, лента реплик.
// Без React и браузерных API — проверяется в vitest/node.
import type { BargeMode, VoiceSettings, VoiceStatus } from './protocol';

export const SETTINGS_KEY = 'def_ops.voice.settings';
/** Голос выключен человеком (кнопка или «Штаб, отбой»): 'false'; включён — 'true' или ключа нет. */
export const ENABLED_KEY = 'def_ops.voice.enabled';

/** Сохранённое «голос включён»: выключен только явным 'false' — мусор и пусто считаются «включён». */
export function parseEnabled(raw: string | null): boolean {
  return raw !== 'false';
}
/** Значения сервиса по умолчанию (services/voice/server.py): «По умолчанию» в тонкой настройке. */
export const DEFAULT_SETTINGS: VoiceSettings = { vad: 0.5, barge_vad: 0.8, barge_ms: 300, end_ms: 400, barge_mode: 'voice' };

type NumKey = Exclude<keyof VoiceSettings, 'barge_mode'>;
const BARGE_MODES: BargeMode[] = ['voice', 'word'];

/** Пределы регуляторов — как на стенде (talk.html). */
const LIMITS: Record<NumKey, [number, number]> = {
  vad: [0.05, 0.95], barge_vad: [0.05, 0.95], barge_ms: [50, 2000], end_ms: [20, 3000],
};

/** Сохранённые регуляторы: только известные поля, числа в пределах; мусор — пустой объект. */
export function parseSettings(raw: string | null): Partial<VoiceSettings> {
  let v: unknown;
  try { v = JSON.parse(raw ?? 'null'); } catch { return {}; }
  if (!v || typeof v !== 'object') return {};
  const out: Partial<VoiceSettings> = {};
  for (const k of Object.keys(LIMITS) as NumKey[]) {
    const x = (v as Record<string, unknown>)[k];
    const [lo, hi] = LIMITS[k];
    if (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi) out[k] = x;
  }
  const mode = (v as Record<string, unknown>).barge_mode;
  if (BARGE_MODES.includes(mode as BargeMode)) out.barge_mode = mode as BargeMode;
  return out;
}

export const BARGE_WORD_HINT = 'Перебить: скажите «Стоп»';

/** Подсказка, пока штаб говорит в режиме «словом» (громкость его не перебивает); иначе — null. */
export function bargeHint(speaking: boolean, mode: BargeMode): string | null {
  return speaking && mode === 'word' ? BARGE_WORD_HINT : null;
}

export type PanelKey = 'off' | 'unsupported' | 'disabled' | 'loading' | 'reconnecting' | 'error' | 'mic' | 'busy'
  | 'speaking' | 'listening' | 'thinking' | 'conversation' | 'idle';

export interface PanelInput {
  status: VoiceStatus;
  /** false — человек выключил голос (микрофон закрыт); по умолчанию включён */
  enabled?: boolean;
  micError?: string | null;
  /** калибровка или запись голоса — разговор стоит */
  busy?: string | null;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  conversation: boolean;
}

export const NOT_INSTALLED = 'Голос не установлен: services/voice/setup.sh';
/** Установленная программа, браузер, не Mac на Apple Silicon: голоса в этой версии нет — значок не показывается. */
export const UNSUPPORTED = 'Голос в этой версии недоступен';
export const VOICE_DISABLED = 'Голос выключен';

/** Состояние панели простыми словами (цвет значка — по `key`). */
export function panelState(s: PanelInput): { key: PanelKey; text: string } {
  if (s.status === 'unsupported') return { key: 'unsupported', text: UNSUPPORTED };
  // выключил сам человек — важнее любых сбоев: микрофон и не нужен
  if (s.enabled === false) return { key: 'disabled', text: VOICE_DISABLED };
  if (s.status === 'off') return { key: 'off', text: NOT_INSTALLED };
  if (s.status === 'error') return { key: 'error', text: 'Голос не запустился — перезапустите программу' };
  if (s.micError) return { key: 'mic', text: 'Микрофон не подключился' };
  if (s.status === 'reconnecting') return { key: 'reconnecting', text: 'Переподключаюсь' };
  if (s.status !== 'ready') return { key: 'loading', text: 'Голос загружается' };
  if (s.busy) return { key: 'busy', text: s.busy };
  if (s.speaking) return { key: 'speaking', text: 'Говорит начальник штаба' };
  if (s.listening) return { key: 'listening', text: 'Слушаю' };
  if (s.thinking) return { key: 'thinking', text: 'Думаю' };
  if (s.conversation) return { key: 'conversation', text: 'Разговор — можно без «штаб»' };
  return { key: 'idle', text: 'Жду обращения' };
}

// ---------------------------------------------------------------- лента

/**
 * echo — микрофон, похоже, поймал голос штаба из динамиков: показывается, но не исполняется;
 * fix — как понята реплика с огрехами распознавания («Услышано: … — понял: …»).
 */
export type FeedKind = 'heard' | 'me' | 'notme' | 'chief' | 'note' | 'echo' | 'fix';
export interface FeedItem {
  key: string;
  kind: FeedKind;
  text: string;
  /** номер реплики сервиса (для склейки `continues`) */
  utt?: number;
}

export const FEED_MAX = 40;

const cap = (xs: FeedItem[]) => (xs.length > FEED_MAX ? xs.slice(xs.length - FEED_MAX) : xs);

/** Новая запись в конец ленты (старые уходят за FEED_MAX). */
export function feedAdd(feed: FeedItem[], item: FeedItem): FeedItem[] {
  return cap([...feed, item]);
}

/** Услышанное, похожее на голос самого штаба из динамиков (сообщение сервиса `echo`); n — номер для ключа. */
export function feedEcho(feed: FeedItem[], text: string, n: number): FeedItem[] {
  return feedAdd(feed, { key: `x${n}`, kind: 'echo', text });
}

/** Распознанная реплика: склеенная (`continues`) заменяет прежнюю, иначе — новая запись «услышано». */
export function feedUtterance(feed: FeedItem[], u: { id: number; text: string; continues?: number }): FeedItem[] {
  const item: FeedItem = { key: `u${u.id}`, kind: 'heard', text: u.text, utt: u.id };
  const i = u.continues === undefined ? -1 : feed.findIndex((x) => x.utt === u.continues);
  if (i < 0) return feedAdd(feed, item);
  return [...feed.slice(0, i), ...feed.slice(i + 1), item];
}

/** Итог разбора реплики: «ignored» — не обращено к штабу («не мне»). */
export function feedResolve(feed: FeedItem[], id: number, result: 'ignored' | 'done' | 'unknown'): FeedItem[] {
  return feed.map((x) => (x.utt === id ? { ...x, kind: result === 'ignored' ? 'notme' : 'me' } : x));
}

/** Реплику поправили при разборе (огрехи распознавания): «Услышано: «…» — понял: «…»»; без поправок — лента как была. */
export function feedCorrection(feed: FeedItem[], id: number, heard: string, c: { fixes: string[]; understood: string }): FeedItem[] {
  if (!c.fixes.length) return feed;
  return feedAdd(feed, { key: `f${id}`, kind: 'fix', text: `Услышано: «${heard}» — понял: «${c.understood}»` });
}
