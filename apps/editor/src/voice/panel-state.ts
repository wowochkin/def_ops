// Чистая логика панели голоса: состояние словами, настройки в localStorage, лента реплик.
// Без React и браузерных API — проверяется в vitest/node.
import type { BargeMode, VoiceSettings, VoiceStatus } from './protocol';
import type { SpeakRole } from './registry';

export const SETTINGS_KEY = 'def_ops.voice.settings';
/** Голос выключен человеком (кнопка или «Штаб, отбой»): 'false'; включён — 'true' или ключа нет. */
export const ENABLED_KEY = 'def_ops.voice.enabled';
/** Звук (озвучка штаба, посредника, экскурсий) выключен человеком: 'off'; иначе включён. Не зависит от управления голосом. */
export const SOUND_KEY = 'def_ops.voice.sound';
export const parseSound = (raw: string | null): boolean => raw !== 'off';

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

/**
 * Что ещё хранится рядом с регуляторами: `aec` — при каком подавлении эха в сервисе они сняты (`ready.aec`),
 * `calib_mode` — какой режим перебивания выбрала последняя калибровка (к нему возвращает «По умолчанию»),
 * `aec_unknown` — регуляторы правили руками до ответа сервиса: подавление эха допишет его ответ (settleAec).
 */
interface Stored { aec?: boolean; calib_mode?: BargeMode; aec_unknown?: true }

function parseObj(raw: string | null): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw ?? 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}
function parseStored(raw: string | null): Stored {
  const v = parseObj(raw) ?? {};
  return {
    ...(typeof v.aec === 'boolean' ? { aec: v.aec } : {}),
    ...(BARGE_MODES.includes(v.calib_mode as BargeMode) ? { calib_mode: v.calib_mode as BargeMode } : {}),
    ...(v.aec_unknown === true && typeof v.aec !== 'boolean' ? { aec_unknown: true as const } : {}),
  };
}

/**
 * Строка для SETTINGS_KEY: регуляторы и режим перебивания cfg. Калибровка (`calibrated`) запоминает подавление эха
 * сервиса (`aec`) и свой режим; ручная правка их не трогает (нет их ещё — запоминается текущее подавление эха; сервис
 * ещё не ответил — отметка `aec_unknown`, подавление эха допишет его ответ).
 */
export function storeSettings(raw: string | null, cfg: VoiceSettings, o: { aec?: boolean; calibrated?: boolean }): string {
  const prev = parseStored(raw);
  const aec = o.calibrated ? o.aec : prev.aec ?? o.aec;
  const calib_mode = o.calibrated ? cfg.barge_mode : prev.calib_mode;
  const unknown = aec === undefined && (!raw || prev.aec_unknown);
  return JSON.stringify({ ...cfg, ...(aec !== undefined ? { aec } : {}), ...(calib_mode ? { calib_mode } : {}), ...(unknown ? { aec_unknown: true } : {}) });
}

/**
 * Регуляторы правили до ответа сервиса (`aec_unknown`): ответ пришёл — дописать, при каком подавлении эха они сняты.
 * Что сохранить заново; null — дописывать нечего.
 */
export function settleAec(raw: string | null, readyAec: boolean | undefined): string | null {
  if (readyAec === undefined || !parseStored(raw).aec_unknown) return null;
  const { aec_unknown: _, ...rest } = parseObj(raw) ?? {};
  return JSON.stringify({ ...rest, aec: readyAec });
}

/** Голос уже настраивали (калибровка или регуляторы руками): предлагать калибровку при запуске не нужно. */
export function wasCalibrated(raw: string | null): boolean {
  return Object.keys(parseSettings(raw)).length > 0;
}

/**
 * Подавление эха в сервисе не то, при котором сняты сохранённые регуляторы: 'on' — теперь включено, 'off' — теперь
 * выключено; null — совпадает, регуляторы не сохранялись или сервис ещё не ответил. Старые настройки без отметки
 * сняты без подавления эха.
 */
export function aecChange(raw: string | null, readyAec: boolean | undefined): 'on' | 'off' | null {
  if (readyAec === undefined || !Object.keys(parseSettings(raw)).length) return null;
  const st = parseStored(raw);
  if (st.aec_unknown) return null; // сняты до ответа сервиса — при нынешнем подавлении эха
  const was = st.aec ?? false;
  return was === readyAec ? null : readyAec ? 'on' : 'off';
}

/** Подсказка на панели при расхождении (aecChange). */
export function aecHint(c: 'on' | 'off'): string {
  return `Подавление эха ${c === 'on' ? 'включено' : 'выключено'} после настройки — пройдите калибровку заново.`;
}

/**
 * «По умолчанию»: регуляторы — как у сервиса, а режим перебивания — тот, что выбрала калибровка (нет отметки, но
 * сохранено «словом» — «словом»: безопасно при громких динамиках). stored — что сохранить (null — стереть).
 */
export function resetStored(raw: string | null): { cfg: VoiceSettings; stored: string | null } {
  const prev = parseStored(raw);
  const mode = prev.calib_mode ?? (parseSettings(raw).barge_mode === 'word' ? 'word' : undefined);
  if (!mode) return { cfg: DEFAULT_SETTINGS, stored: null };
  const cfg: VoiceSettings = { ...DEFAULT_SETTINGS, barge_mode: mode };
  return { cfg, stored: JSON.stringify({ ...cfg, ...prev }) };
}

/** Сколько фраза штаба ждёт конца речи человека, если конца так и не пришло (сервис не прислал `speech end`). */
export const HOLD_MAX_MS = 8_000;
/** Сколько после конца речи фраза ждёт реплику (распознавание): после кашля реплики не будет. */
export const UTT_WAIT_MS = 2_000;

/**
 * Фразы штаба не начинаются, пока человек говорит: сервис прислал `speech start` — фраза ждёт `speech end` (не дольше
 * HOLD_MAX_MS), а после него — реплику (`utterance`, не дольше UTT_WAIT_MS): реплика может оказаться новой просьбой,
 * и тогда разборщик снимет старый ответ (drop), не дав ему прозвучать. Ждущие — по порядку. Если штаб уже говорит
 * (busy), очередная фраза его ответа не ждёт: речь в микрофоне тогда — скорее его же голос из динамиков.
 */
export class SayGate {
  private queue: { id: number; text: string; keep: boolean; role?: SpeakRole }[] = [];
  private since: number | null = null;
  /** Речь кончилась в это время, реплики ещё нет. */
  private ended: number | null = null;
  /** onDrop — номера снятых ждущих фраз (drop, clear): кто ждал их конца (тур), узнаёт, что они не прозвучат. */
  constructor(private send: (id: number, text: string, role?: SpeakRole) => void, private now: () => number, private busy: () => boolean,
    private onDrop?: (ids: number[]) => void) {}

  /** keep — фраза не устаревает от новой реплики (dropStale её оставляет): поздний ответ советника; role — чьим голосом. */
  say(id: number, text: string, keep = false, role?: SpeakRole): void {
    if (this.holding() && !this.busy()) this.queue.push({ id, text, keep, role });
    else this.send(id, text, role);
  }
  /** Речь человека началась / кончилась (сообщение сервиса `speech`). */
  speech(on: boolean): void {
    if (on) { this.since ??= this.now(); this.ended = null; return; }
    if (this.since === null) return;
    this.since = null;
    this.ended = this.now();
  }
  /** Реплика пришла и разобрана (после supersede) — или это «не мне», эхо: ждущие фразы уходят. */
  utterance(): void {
    this.ended = null;
    if (this.since === null) this.flush();
  }
  /** Проверка по часам: речь «идёт» дольше HOLD_MAX_MS или реплики нет дольше UTT_WAIT_MS — фразы уходят. */
  tick(): void {
    if (this.since !== null && this.now() - this.since >= HOLD_MAX_MS) { this.since = null; this.ended = null; this.flush(); }
    if (this.ended !== null && this.now() - this.ended >= UTT_WAIT_MS) { this.ended = null; this.flush(); }
    // ждать больше нечего (clear с keep, истёкшее ожидание) — оставшиеся фразы уходят, не отстают от новых
    if (this.queue.length && !this.holding()) this.flush();
  }
  /** Снять ждущую фразу id или все; true — такая ждала. */
  drop(id?: number): boolean {
    const gone = this.queue.filter((x) => id === undefined || x.id === id).map((x) => x.id);
    this.queue = this.queue.filter((x) => !gone.includes(x.id));
    if (gone.length) this.onDrop?.(gone);
    return gone.length > 0;
  }
  /** Новая просьба: ждущие ответы на прежние уходят, кроме несрочных, но не устаревающих (keep). */
  dropStale(): boolean {
    const gone = this.queue.filter((x) => !x.keep).map((x) => x.id);
    this.queue = this.queue.filter((x) => x.keep);
    if (gone.length) this.onDrop?.(gone);
    return gone.length > 0;
  }
  /**
   * Всё забыть: очередь и ожидание (выключение, обрыв связи, окно калибровки или голосов). keep — открытие и закрытие
   * окна: фразы, не устаревающие от новой реплики (готов ответ советника, «Разбор готов»), остаются в очереди и уходят
   * по часам (tick).
   */
  clear(o: { keep?: boolean } = {}): void {
    if (o.keep) this.dropStale(); else this.drop();
    this.since = null;
    this.ended = null;
  }

  private holding(): boolean {
    return (this.since !== null && this.now() - this.since < HOLD_MAX_MS) || (this.ended !== null && this.now() - this.ended < UTT_WAIT_MS);
  }
  private flush(): void {
    const q = this.queue;
    this.queue = [];
    q.forEach((x) => this.send(x.id, x.text, x.role));
  }
}

/**
 * Штаб говорит по-настоящему: звучит хоть одна фраза, кроме тихих (заготовленные фразы о модели — «повторяю запрос»).
 * Пока звучит только тихая, ответ модели ждёт конца речи человека, как всякий другой.
 */
export function chiefTalking(speaking: Set<number>, quiet: Set<number>): boolean {
  for (const id of speaking) if (!quiet.has(id)) return true;
  return false;
}

export const BARGE_WORD_HINT = 'Перебить: скажите «Стоп»';

/** Подсказка, пока штаб говорит в режиме «словом» (громкость его не перебивает); иначе — null. */
export function bargeHint(speaking: boolean, mode: BargeMode): string | null {
  return speaking && mode === 'word' ? BARGE_WORD_HINT : null;
}

export type PanelKey = 'off' | 'unsupported' | 'disabled' | 'loading' | 'reconnecting' | 'error' | 'mic' | 'busy'
  | 'standby' | 'speaking' | 'listening' | 'thinking' | 'conversation' | 'idle';

export interface PanelInput {
  status: VoiceStatus;
  /** false — человек выключил голос (микрофон закрыт); по умолчанию включён */
  enabled?: boolean;
  /** true — человек выключил звук (озвучка молчит); по умолчанию звук включён */
  muted?: boolean;
  micError?: string | null;
  /** калибровка или запись голоса — разговор стоит */
  busy?: string | null;
  /** дежурный режим («Штаб, отбой»): микрофон открыт, штаб ждёт только «Штаб, на связь» */
  standby?: boolean;
  speaking: boolean;
  listening: boolean;
  thinking: boolean;
  conversation: boolean;
}

export const NOT_INSTALLED = 'Голос не установлен: services/voice/setup.sh';
/** Установленная программа, браузер, не Mac на Apple Silicon: голоса в этой версии нет — значок не показывается. */
export const UNSUPPORTED = 'Голос в этой версии недоступен';
export const VOICE_DISABLED = 'Голос выключен';
/** Выключено только управление (микрофон): звук посредника и экскурсий остаётся. */
export const CONTROL_DISABLED = 'Управление голосом выключено';
export const SOUND_OFF_TAIL = ' · звук выключен';
export const STANDBY_TEXT = 'Дежурю. Скажите: «Штаб, на связь»';

/** Состояние панели простыми словами (цвет значка — по `key`). */
export function panelState(s: PanelInput): { key: PanelKey; text: string } {
  if (s.status === 'unsupported') return { key: 'unsupported', text: UNSUPPORTED };
  // выключил сам человек — важнее любых сбоев: микрофон и не нужен
  if (s.enabled === false) return { key: 'disabled', text: s.muted ? VOICE_DISABLED : CONTROL_DISABLED };
  if (s.status === 'off') return { key: 'off', text: NOT_INSTALLED };
  if (s.status === 'error') return { key: 'error', text: 'Голос не запустился — перезапустите программу' };
  if (s.micError) return { key: 'mic', text: 'Микрофон не подключился' };
  if (s.status === 'reconnecting') return { key: 'reconnecting', text: 'Переподключаюсь' };
  if (s.status !== 'ready') return { key: 'loading', text: 'Голос загружается' };
  if (s.standby) return { key: 'standby', text: STANDBY_TEXT };
  if (s.busy) return { key: 'busy', text: s.busy };
  if (s.speaking) return { key: 'speaking', text: 'Говорит начальник штаба' };
  if (s.listening) return { key: 'listening', text: 'Слушаю' };
  if (s.thinking) return { key: 'thinking', text: 'Думаю' };
  if (s.conversation) return { key: 'conversation', text: 'Разговор — можно без «штаб»' };
  return { key: 'idle', text: s.muted ? `Жду обращения${SOUND_OFF_TAIL}` : 'Жду обращения' };
}

// ---------------------------------------------------------------- лента

/**
 * echo — микрофон, похоже, поймал голос штаба из динамиков: показывается, но не исполняется;
 * fix — как понята реплика с огрехами распознавания («Услышано: … — понял: …»).
 */
export type FeedKind = 'heard' | 'me' | 'notme' | 'chief' | 'umpire' | 'note' | 'echo' | 'fix';
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

// ---------------------------------------------------------------- вид панели: значок, полоса, развёрнута

/**
 * icon — значок (свернул человек); compact — полоса: состояние словами, последняя фраза штаба, «Развернуть»;
 * full — развёрнута: лента, кнопки, «Что можно сказать», тонкая настройка.
 */
export type PanelMode = 'icon' | 'compact' | 'full';
/** Сохранённый вид: 'icon', 'full'; прочее (и прежнее 'open') — полоса. */
export function parsePanelMode(raw: string | null): PanelMode {
  return raw === 'icon' || raw === 'full' ? raw : 'compact';
}
/** Полоса, раскрытая сама, снова обрезает фразу через столько тишины (штаб договорил, вопроса нет). */
export const COLLAPSE_MS = 10_000;
/** Знаков в строке полосы (18 px, ширина полосы) и строк под фразу штаба. */
export const STRIP_LINE_CHARS = 44;
export const STRIP_LINES = 2;
/** Фраза штаба помещается в полосу (две строки) целиком. */
export function fitsStrip(text: string): boolean {
  return text.length <= STRIP_LINE_CHARS * STRIP_LINES;
}
/** Знаков в строке узкой полосы (при открытом окне — 380 px). */
export const STRIP_OVER_CHARS = 36;
/** Строк под фразу штаба: при открытом окне развернуть панель нельзя — фраза до трёх строк. */
export function stripLines(modal: boolean): number { return modal ? 3 : STRIP_LINES; }
/** Фраза в полосе обрезана (тогда — кнопка «Повторить» и «скажите «повтори»»). */
export function stripCut(text: string, modal: boolean): boolean {
  return text.length > (modal ? STRIP_OVER_CHARS : STRIP_LINE_CHARS) * stripLines(modal);
}

/**
 * Вид панели. Выбранный человеком (set) — как выбран. Сама панель не разворачивается: когда штаб говорит длинное
 * (chief) или ждёт «да / нет» (update с pending), полоса показывает фразу целиком (whole), из значка на вопрос —
 * полоса (нужны кнопки); через COLLAPSE_MS тишины фраза снова обрезана, значок — снова значок.
 * Открыто окно (view(true)) — панель не больше полосы: окно не закрывается.
 */
export class PanelSize {
  /** Полоса раскрыта сама (фраза целиком), не человеком. */
  private auto = false;
  /** Открыто окно: его вопрос читает штаб — панель от этого не разворачивается. */
  private modal = false;
  /** С какого времени тихо: штаб не говорит и вопроса нет (null — не тихо). */
  private quietAt: number | null = null;
  constructor(public mode: PanelMode, private now: () => number) {}

  /** Человек выбрал вид кнопкой: развёрнутая вручную сама не сворачивается, раскрытая сама полоса — обрезана сразу. */
  set(mode: PanelMode): void { this.mode = mode; this.auto = false; }
  /** Штаб сказал фразу: не помещается в полосу — показать её целиком (из значка — нет: значок выбрал человек). */
  chief(text: string): void {
    if (!fitsStrip(text) && this.mode === 'compact' && !this.modal) { this.auto = true; this.quietAt = null; }
  }
  /** Окно открылось или закрылось; закрылось — раскрытая сама полоса обрезана сразу (говорить уже не о чем). */
  setModal(on: boolean): void {
    if (this.modal && !on) this.auto = false;
    this.modal = on;
  }
  /** Часы и события: говорит ли штаб и ждёт ли вопрос ответа. */
  update(s: { speaking: boolean; pending: boolean }): void {
    if (s.pending && this.mode !== 'full') this.auto = true;
    if (s.speaking || s.pending) { this.quietAt = null; return; }
    this.quietAt ??= this.now();
    if (this.auto && this.now() - this.quietAt >= COLLAPSE_MS) this.auto = false;
  }
  /** Что показать; modal — открыто окно. */
  view(modal: boolean): PanelMode {
    const v: PanelMode = this.auto && this.mode === 'icon' ? 'compact' : this.mode;
    return modal && v === 'full' ? 'compact' : v;
  }
  /** Полоса показывает фразу штаба целиком, без обрезки (раскрыта сама); при открытом окне — нет. */
  whole(modal: boolean): boolean { return this.auto && !modal && this.view(modal) === 'compact'; }
}

/** Колонка разделов слева: панель — по центру свободной области правее неё. */
export const RAIL_W = 84;
/** Зазор под верхней полосой кнопок. */
const GAP = 8;

/**
 * Место панели: сверху по центру свободной области справа от колонки разделов, сразу под верхней полосой кнопок
 * (anchor — её нижний край, 0 — полосы нет). Полоса, значок и развёрнутая панель — отсюда же (развёрнутая — вниз).
 */
export function topPlace(vw: number, width: number, anchor: number): { left: number; top: number } {
  return { left: Math.max(RAIL_W, Math.round(RAIL_W + (vw - RAIL_W - width) / 2)), top: anchor + GAP };
}

/** Нижний край верхней полосы кнопок: видимые шапки, что начинаются у самого верха экрана (нет — 0). */
export function anchorBottom(bars: { top: number; bottom: number; width: number }[]): number {
  return bars.filter((b) => b.width > 0 && b.top < 24 && b.bottom < 160).reduce((m, b) => Math.max(m, Math.round(b.bottom)), 0);
}

/** Высота развёрнутой панели (не больше 520 px): низ экрана (~400 px) остаётся подписи тура и окнам. */
export function fullHeight(vh: number, top: number): number {
  return Math.min(520, Math.max(260, vh - top - 400));
}


// ---------------------------------------------------------------- значок: перетаскивание мышью

/** Куда человек перетащил значок микрофона (JSON {left, top}); нет — значок на своём месте (сверху по центру). */
export const ICON_POS_KEY = 'def_ops.voice.iconPos';
export interface IconPos { left: number; top: number }
/** Сдвиг, меньше которого нажатие — щелчок, а не перетаскивание. */
export const DRAG_PX = 5;

export function parseIconPos(raw: string | null): IconPos | null {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<IconPos> | null;
    return v && Number.isFinite(v.left) && Number.isFinite(v.top) ? { left: v.left as number, top: v.top as number } : null;
  } catch { return null; }
}

/** Значок размером size целиком в окне vw × vh (с полем 4 px): за край не уйдёт и не потеряется после уменьшения окна. */
export function clampIcon(p: IconPos, vw: number, vh: number, size: number): IconPos {
  const m = 4;
  return {
    left: Math.round(Math.min(Math.max(p.left, m), Math.max(m, vw - size - m))),
    top: Math.round(Math.min(Math.max(p.top, m), Math.max(m, vh - size - m))),
  };
}

/** Подпись значка («Голос выключен», «Дежурю») — слева от него, если он в правой половине окна, иначе справа. */
export const iconCapLeft = (p: IconPos | null, vw: number): boolean => !!p && p.left + 28 > vw / 2;
