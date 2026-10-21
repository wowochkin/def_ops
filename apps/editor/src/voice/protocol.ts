// Протокол голосового сервиса (спецификация голосового управления, раздел 2).
// Модуль чистый: без браузерных API, проверяется в vitest/node.

/**
 * Как перебить штаб: `voice` — речью громче порога дольше заданного; `word` — стоп-словом («Стоп», «Штаб…»):
 * динамики слышно громко, и громкость своей речи от голоса штаба не отличить (выбирает калибровка).
 */
export type BargeMode = 'voice' | 'word';

/** Настройки порогов (как на стенде): чувствительность, перебивание, пауза до ответа; режим перебивания. */
export interface VoiceSettings {
  vad: number;
  barge_vad: number;
  barge_ms: number;
  end_ms: number;
  barge_mode: BargeMode;
}

export type VoiceRole = 'chief' | 'umpire';

export type CalibStep = 'noise' | 'speech' | 'echo' | 'over' | 'finish' | 'cancel';

/** Окно → сервис (JSON; микрофонные кадры идут двоичными). */
export type ClientMsg =
  | { type: 'hello'; settings: Partial<VoiceSettings> }
  | { type: 'say'; id: number; role: VoiceRole; text: string; more?: boolean }
  /** Заготовить звук фразы заранее: `say` того же текста тем же голосом сыграет его без синтеза. */
  | { type: 'prepare'; id: number; role: VoiceRole; text: string }
  | { type: 'stop'; id?: number }
  | { type: 'played'; id: number }
  | ({ type: 'settings' } & Partial<VoiceSettings>)
  | { type: 'calib'; step: CalibStep; sec?: number }
  | { type: 'voice'; op: string; [k: string]: unknown };

/** Образец голоса в хранилище сервиса. */
export interface VoiceInfo {
  id: string;
  name: string;
  text: string;
  source: string;
  builtin: boolean;
  date: string;
}

export type VoiceRoles = Record<VoiceRole, string>;

/** Проверка записи нового голоса: причины — коротко, для «перечитайте». */
export interface VoiceCheck {
  ok: boolean;
  reasons: string[];
  heard: string;
  audio_s?: number;
  peak_db?: number;
  snr_db?: number;
  wer?: number;
}

/** Сервис → окно (JSON). */
export type ServerMsg =
  | { type: 'ready'; voices: VoiceInfo[]; roles: VoiceRoles; loaded: boolean; record_text?: string; rate?: number; aec?: boolean }
  | { type: 'level'; p: number; busy: boolean }
  | { type: 'speech'; state: 'start' | 'end' }
  | { type: 'utterance'; id: number; text: string; audio_s: number; stt_ms: number; continues?: number }
  | { type: 'echo'; text: string }
  /** Перебивание «словом»: речь поверх штаба (он не оборван); chief — что он уже сказал. Окно принимает только ответ на вопрос. */
  | { type: 'over'; id: number; text: string; chief: string }
  | { type: 'say-done'; id: number; stopped?: boolean }
  /** Заготовка `prepare` готова (audio_s — длина звука) или не вышла (error: фраза потом синтезируется как обычно). */
  | { type: 'prepared'; id: number; audio_s?: number; error?: string }
  | { type: 'barge'; id: number }
  | ({ type: 'settings' } & VoiceSettings)
  | { type: 'calib_rec'; step: CalibStep; sec: number }
  | { type: 'calib_step'; step: CalibStep; frames: number }
  | { type: 'calib_result'; error?: string; cfg?: VoiceSettings; stats?: Record<string, number | null>; warn?: string[] }
  | { type: 'voice_list'; voices: VoiceInfo[]; roles: VoiceRoles }
  | { type: 'voice_recording'; text: string }
  | ({ type: 'voice_check' } & VoiceCheck)
  | { type: 'voice_saved'; id: string }
  | { type: 'voice_discarded' }
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

/** Первый байт кадра «микрофон + опора»: `[0x02][микрофон int16 LE][опора int16 LE]`, каналы одной длины. */
export const MIC_REF = 0x02;

/**
 * Кадр микрофона окна → сервис. Без опоры — отсчёты int16 LE как есть (чётная длина, без заголовка). С опорой
 * (сервис подавляет эхо, `ready.aec`) — `[MIC_REF][микрофон][опора]`: опора — звук, который в тот же миг ушёл
 * в динамики, по отсчётам вровень с микрофоном.
 */
export function micFrame(mic: Int16Array, ref?: Int16Array): ArrayBuffer {
  if (!ref) return mic.buffer.slice(mic.byteOffset, mic.byteOffset + mic.byteLength) as ArrayBuffer;
  if (ref.length !== mic.length) throw new Error(`микрофон и опора разной длины: ${mic.length} и ${ref.length}`);
  const buf = new ArrayBuffer(1 + mic.length * 4);
  const v = new DataView(buf);
  v.setUint8(0, MIC_REF);
  for (let i = 0; i < mic.length; i++) v.setInt16(1 + i * 2, mic[i], true);
  const o = 1 + mic.length * 2;
  for (let i = 0; i < ref.length; i++) v.setInt16(o + i * 2, ref[i], true);
  return buf;
}

/**
 * Захват микрофона. Сервис подавляет эхо сам (`aec`) — обработка браузера выключена: его эхоподавление, шумоподавление
 * и АРУ меняют эхо нелинейно, и подавление по опоре не сходится. Иначе — с обработкой браузера, как раньше.
 */
export function micConstraints(aec: boolean): MediaTrackConstraints {
  const on = !aec;
  return { echoCancellation: on, noiseSuppression: on, autoGainControl: on, channelCount: 1 };
}

export type WsState = 'open' | 'closed' | 'connecting';
export type VoiceStatus = 'off' | 'unsupported' | 'loading' | 'connecting' | 'ready' | 'error' | 'reconnecting';

/**
 * Состояние голоса для панели. `api` — ответ шлюза `/api/voice` (null — шлюз не ответил: состояние неизвестно),
 * `ready` — сервис присылал `ready` (и связь с тех пор не сбрасывали намеренно), `failed` — последняя попытка
 * подключиться к сервису не удалась (связь так и не открылась).
 *
 * `serviceError` — сервис ответил ошибкой вместо `ready` (модели не загрузились).
 *
 * Открытая связь важнее шлюза: сервис, запущенный вручную (шлюза нет или он о сервисе не знает), — работает,
 * пропущенный опрос шлюза не «выключает» живой голос. «Не установлен» — только когда и шлюз не знает о
 * сервисе, и подключиться не удалось; «недоступен» (`unsupported`) — шлюз говорит, что голоса в этой версии нет.
 */
export function voiceStatus(api: { state: string } | null, ws: WsState, ready: boolean, failed = false, serviceError = false): VoiceStatus {
  if (ws === 'open') return ready ? 'ready' : serviceError ? 'error' : 'connecting';
  if (ready) return 'reconnecting';
  const state = api?.state ?? 'unknown';
  if (state === 'unsupported') return 'unsupported';
  if (state === 'error') return 'error';
  if (state === 'loading') return 'loading';
  if (state === 'ready') return 'connecting';
  // шлюз молчит или о сервисе не знает: решает попытка подключиться
  return failed ? 'off' : 'connecting';
}

/**
 * Пауза перед очередной попыткой подключиться. `fails` — неудачных попыток подряд (от 1), `everOpened` — связь в
 * этот раз уже была: тогда сервис перезапускается, ждём его часто; не было ни разу — пауза растёт до 30 с.
 */
export function reconnectDelay(fails: number, everOpened: boolean): number {
  return everOpened ? 2000 : Math.min(30000, 2000 * 2 ** Math.max(0, fails - 1));
}

/** Идентификаторы фраз `say` растут с этого числа (0 в протоколе — «без фразы»). */
export const VOICE_SAY_IDS = { first: 1 } as const;

/**
 * Отменённые фразы: звук, пришедший после `stop`/`barge`, не должен снова зазвучать.
 * Идентификаторы растут, поэтому «остановить всё» = отменить всё до последнего отправленного.
 */
export class CancelledIds {
  private ids = new Set<number>();
  private floor = 0;
  add(id: number) { this.ids.add(id); }
  /** Отменить все фразы с номерами до `last` включительно. */
  addUpTo(last: number) { this.floor = Math.max(this.floor, last); this.ids.clear(); }
  /** Новая фраза с этим номером: прежняя отмена не касается. */
  revive(id: number) { this.ids.delete(id); if (id <= this.floor) this.floor = id - 1; }
  has(id: number): boolean { return id <= this.floor || this.ids.has(id); }
}
