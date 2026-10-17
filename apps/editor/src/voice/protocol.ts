// Протокол голосового сервиса (спецификация голосового управления, раздел 2).
// Модуль чистый: без браузерных API, проверяется в vitest/node.

/** Настройки порогов (как на стенде): чувствительность, перебивание, пауза до ответа. */
export interface VoiceSettings {
  vad: number;
  barge_vad: number;
  barge_ms: number;
  end_ms: number;
}

export type VoiceRole = 'chief' | 'umpire';

export type CalibStep = 'noise' | 'speech' | 'echo' | 'over' | 'finish' | 'cancel';

/** Окно → сервис (JSON; микрофонные кадры идут двоичными). */
export type ClientMsg =
  | { type: 'hello'; settings: Partial<VoiceSettings> }
  | { type: 'say'; id: number; role: VoiceRole; text: string; more?: boolean }
  | { type: 'stop'; id?: number }
  | { type: 'played'; id: number }
  | ({ type: 'settings' } & Partial<VoiceSettings>)
  | { type: 'calib'; step: CalibStep; sec?: number }
  | { type: 'voice'; op: string; [k: string]: unknown };

/** Сервис → окно (JSON). Поля `voice_*` описаны отдельно, здесь — свободно. */
export type ServerMsg =
  | { type: 'ready'; voices?: unknown; roles?: unknown; loaded?: unknown; [k: string]: unknown }
  | { type: 'level'; p: number; busy: boolean }
  | { type: 'speech'; state: 'start' | 'end' }
  | { type: 'utterance'; id: number; text: string; audio_s: number; stt_ms: number; continues?: number }
  | { type: 'say-done'; id: number }
  | { type: 'barge'; id: number }
  | { type: 'settings'; [k: string]: unknown }
  | { type: 'calib_rec'; sec: number }
  | { type: 'calib_step'; [k: string]: unknown }
  | { type: 'calib_result'; [k: string]: unknown }
  | { type: `voice_${string}`; [k: string]: unknown }
  | { type: 'error'; text: string };

/** Звук фразы: `[0x01][id u32 LE][rate u32 LE][pcm int16 LE]`. */
export interface AudioChunk {
  id: number;
  rate: number;
  pcm: Int16Array;
}

const HEADER = 9;

export function parseAudio(buf: ArrayBuffer): AudioChunk {
  if (buf.byteLength < HEADER) throw new Error(`звук короче заголовка: ${buf.byteLength} байт`);
  const v = new DataView(buf);
  const id = v.getUint32(1, true);
  const rate = v.getUint32(5, true);
  // копия: смещение 9 не кратно 2, Int16Array на исходном буфере не получится
  const n = (buf.byteLength - HEADER) >> 1;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = v.getInt16(HEADER + i * 2, true);
  return { id, rate, pcm };
}

export type WsState = 'open' | 'closed' | 'connecting';
export type VoiceStatus = 'off' | 'loading' | 'connecting' | 'ready' | 'error' | 'reconnecting';

/**
 * Состояние голоса для панели. `api` — ответ шлюза `/api/voice` (null — шлюз не ответил),
 * `ready` — сервис присылал `ready` (и связь с тех пор не сбрасывали намеренно).
 */
export function voiceStatus(api: { state: string } | null, ws: WsState, ready: boolean): VoiceStatus {
  if (!api || api.state === 'off') return 'off';
  if (api.state === 'error') return 'error';
  if (ws === 'open') return ready ? 'ready' : 'connecting';
  if (ready) return 'reconnecting';
  return api.state === 'loading' ? 'loading' : 'connecting';
}

/** Идентификаторы фраз `say` растут с этого числа (0 в протоколе — «без фразы»). */
export const VOICE_SAY_IDS = { first: 1 } as const;
