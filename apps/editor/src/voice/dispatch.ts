/**
 * Разборщик реплик: сначала правила (мгновенно, без модели) — обращение к штабу, окно разговора,
 * переходы между разделами, «что я могу сказать», калибровка, голоса, диктовка, фразы разделов с параметрами
 * (registry.registerParser: «покажи Зелов», «доложи о восьмой гвардейской»), стоп-слова (общий с сервисом голоса
 * список services/voice/stop_words.json), дословные примеры (`say`) доступных действий. Чего правила не поняли в обращённой реплике — разбирает модель (опция model),
 * если она подключена; её вызов действия проверяется по реестру. Модель недоступна — непонятая реплика сразу получает
 * честный ответ без модели; не чаще раза в RECHECK_MS при обращении связь перепроверяется (recheck).
 *
 * Без рук:
 * - необратимое (irreversible) голосом — только после «да»: штаб спрашивает confirm(p) и «Скажите да или нет»
 *   (pending); «нет», «отмена», молчание CONFIRM_MS, новая просьба — отмена с короткой фразой;
 * - «Штаб, отбой» — дежурный режим (standby): микрофон открыт, исполняется только «Штаб, на связь» (shell.wake);
 *   эхо собственной фразы штаба не будит;
 * - открыто окно, ждущее ответа (registry.openModal), — исполняются только его ответы, стоп-слова, «отбой» и
 *   «повтори»; прочее — «Сначала ответьте на вопрос: …»;
 * - ответ на вопрос поверх его чтения: перебивание «голосом» — как всякая реплика (сервис сам обрывает штаб);
 *   «словом» сервис присылает речь поверх штаба отдельно (over): ответ на вопрос — штаб замолкает и исполняет его;
 * - ответа нет REMIND_MS после того, как вопрос договорён, — короткое напоминание (один раз на вопрос).
 */
import stopFile from '../../../../services/voice/stop_words.json';
import { SECTIONS } from '../sections';
import { yesNo } from './answers';
import { parseDictation, stopReading } from './dictation';
import type { ModelReply } from './llm';
import { act, actions, forModel, getAction, listed, markVoice, parsePhrase, repeatTurn, topModal, turnDone, type Action, type SpeakRole, type VoiceModal } from './registry';
import { lev, norm, tolerance } from './fuzzy';
import { speakable } from './speech';

export const CONVERSATION_S = 12;
/** Модель недоступна — при обращении связь перепроверяется не чаще этого. */
export const RECHECK_MS = 30_000;
/** Перепроверка связи ждёт ответа не дольше этого. */
export const RECHECK_TIMEOUT_MS = 5_000;
/**
 * Ответ на вопрос окна или предложение штаба без «штаб» принимается столько после того, как штаб договорил (вопрос,
 * «повтори»); позже — только «Штаб, …»: брошенное в разговоре «да» не нажмёт «Удалить».
 */
export const ANSWER_MS = 30_000;
/** Подтверждение ждёт ответа столько после того, как вопрос договорён. */
export const CONFIRM_MS = 15_000;
/** Запас сверх длины фразы штаба (0,1 с на знак): пока она может звучать, её эхо в дежурном не будит. */
export const ECHO_MS = 3_000;
export const STANDBY_SAY = 'Дежурю. Скажите: «Штаб, на связь».';
export const WAKE_SAY = 'На связи.';
/**
 * Вопрос штаба кончается не словом-ответом: быстрый ответ «да» / «нет» сервис иначе принял бы за эхо хвоста фразы
 * (он сравнивает реплику с концом сказанного).
 */
export const WAIT_SAY = 'Жду ответа.';
export const YES_NO_SAY = `Скажите «да», чтобы подтвердить, или «нет» — чтобы отменить. ${WAIT_SAY}`;
/** Ответа нет столько после конца вопроса — напомнить (один раз). */
export const REMIND_MS = 8_000;
/** Напоминание о «да / нет» (вопрос кончается «Жду ответа.», а не словом-ответом). */
export const REMIND_YES_NO = `Да или нет? ${WAIT_SAY}`;
/** Речь поверх штаба (перебивание «словом») — ответ, только если она не длиннее этого (слов). */
const OVER_MAX_WORDS = 3;

/** Стоп-слова — ими перебивают штаб; тот же список проверяет сервис голоса (audio.py). */
export const STOP_WORDS: string[] = stopFile.stop;
const STOP_SET = new Set(STOP_WORDS);
export const HELP_MAX = 7;

const ADDRESS = ['товарищ полковник', 'товарищ генерал', 'штаб', 'штап'];

/** Обращение — только в начале фразы. rest — остаток в нормализованном виде. */
export function addressed(text: string): { rest: string } | null {
  const n = norm(text);
  for (const w of ADDRESS) {
    if (n === w) return { rest: '' };
    if (n.startsWith(w + ' ')) return { rest: n.slice(w.length + 1) };
  }
  return null;
}

/** Названия разделов во всех падежах, которые говорят вслух: слово целиком, а не начало слова. */
const FORMS: Record<string, string[]> = {
  editor: ['редактор', 'редактора', 'редактору', 'редакторе'],
  replay: ['переигровка', 'переигровку', 'переигровки', 'переигровке', 'переигровкой'],
  modeling: ['моделирование', 'моделирования', 'моделированию', 'моделированием', 'моделировании'],
  maps: ['карты', 'карту', 'карт', 'карте', 'картам', 'картами'],
  library: ['знаки', 'знаков', 'знакам', 'знаками', 'знаках'],
  knowledge: ['знания', 'знаний', 'знанию', 'знаниям', 'знаниями', 'знаниях'],
  staff: ['ии'],
};
const sectionByWord = (w: string): string | null => {
  for (const [id, forms] of Object.entries(FORMS)) if (forms.includes(w)) return id;
  return SECTIONS.find((s) => norm(s.title) === w)?.id ?? null;
};

/** Родственные слова, которыми раздел тоже называют: понимаются, но в ответе поправляются на название. */
const RELATED: Record<string, string> = { переиграть: 'replay', переиграй: 'replay', переиграйте: 'replay', переиграем: 'replay' };

/** Раздел по слову с поправкой на огрехи; word — как сказано, canon — каноничное написание (null, если сказано точно). */
function fuzzySection(w: string): { id: string; canon: string | null } | null {
  if (RELATED[w]) return { id: RELATED[w], canon: FORMS[RELATED[w]][0] };
  const exact = sectionByWord(w);
  if (exact) return { id: exact, canon: null };
  if (w.length < 5) return null;
  let best: { id: string; canon: string; d: number } | null = null;
  for (const [id, forms] of Object.entries(FORMS)) {
    for (const f of forms) {
      if (w[0] !== f[0]) continue;
      const d = lev(w, f);
      if (d <= Math.min(tolerance(Math.max(w.length, f.length)), tolerance(f.length)) && (!best || d < best.d)) best = { id, canon: forms[0], d };
    }
  }
  return best;
}

/** Фраза, которую система умеет разбирать без реестра: нужна, чтобы нестрогое обращение не принимало обычные слова. */
const isCommand = (rest: string) =>
  (OPEN_VERB.test(rest.split(' ')[0]) && !!sectionByWord(rest.split(' ').slice(1).find((w) => !PREP.has(w)) ?? '')) || (rest.split(' ').length <= 2 && !!sectionByWord(rest.split(' ')[0])) ||
  /^(?:отбой|на связь|подъем|включись|(?:выключи|выключить|отключи|отключить) голос|что (?:я )?(?:могу|можно)|что (?:ты )?умеешь|помощь|калибровк\p{L}*|голоса?)(?: |$)/u.test(rest) || STOP_SET.has(rest.split(' ')[0]);

const OPEN_VERB = /^(?:открой|открыть|покажи|показать|перейди|перейти)$/;
const PREP = new Set(['в', 'на', 'к']);

/**
 * Нестрогая поправка огрехов распознавания: обращение («штап», «шаб», «штат» → «штаб», только в начале фразы)
 * и название раздела после глагола или голое («пере игровку», «переигровк», «переиграть» → «переигровка»).
 * text — нормализованная фраза с исправлениями; fixes — «услышано → понял» по каждой поправке (пусто, если всё точно).
 */
export function normalizeCommand(text: string): { text: string; fixes: string[] } {
  const words = norm(text).split(' ').filter(Boolean);
  const fixes: string[] = [];
  let i = 0;
  let fuzzy = false;
  if (words.length) {
    const w = words[0];
    if (w === 'штаб') i = 1;
    else if (words.length > 1 && w.length >= 3 && w.length <= 5 && lev(w, 'штаб') === 1 && !sectionByWord(w)) {
      fixes.push(`${w} → штаб`);
      words[0] = 'штаб';
      fuzzy = true;
      i = 1;
    } else if (/^товарищ$/.test(w) && /^(?:полковник|генерал)$/.test(words[1] ?? '')) i = 2;
  }
  const hasAddr = i > 0;
  let j = i;
  const verb = OPEN_VERB.test(words[j] ?? '');
  if (verb) { j++; if (PREP.has(words[j] ?? '')) j++; }
  const tail = words.length - j;
  // голое название раздела — одно слово или два (склейка), с глаголом — любой хвост
  if (tail >= 1 && (verb || hasAddr) && (verb || tail <= 2)) {
    let r = fuzzySection(words[j]);
    let span = 1;
    if ((!r || r.canon) && tail >= 2 && (verb || tail === 2)) {
      const joined = fuzzySection(words[j] + words[j + 1]);
      if (joined) { r = joined; span = 2; }
    }
    if (r && (verb || tail <= span)) {
      const said = words.slice(j, j + span).join(' ');
      const canon = r.canon ?? (span === 2 ? words[j] + words[j + 1] : null);
      if (canon) {
        fixes.push(`${said} → ${canon}`);
        words.splice(j, span, canon);
      }
    }
  }
  // нестрогое обращение засчитывается, только если остаток — команда; иначе это обычная речь
  if (fuzzy && !isCommand(words.slice(i).join(' '))) return { text: norm(text), fixes: [] };
  return { text: words.join(' '), fixes };
}

const OPEN = /^(?:открой|открыть|покажи|показать|перейди|перейти)(?: в| на| к)? (.+)$/;
const ASK = /^(?:а )?(?:можешь|умеешь|можете|умеете|можно ли|можно)(?: (.*))?$/;
const DEFAULT_SAY = ['штаб, открой переигровку', 'штаб, что я могу?', 'штаб, калибровка'];

/** Общие слова не считаются совпадением. */
const STOP = new Set(['штаб', 'пожалуйста', 'что', 'как', 'мне', 'это', 'ли', 'и', 'в', 'на', 'ты', 'вы']);
/** Слова реплики по основам (первые 5 букв) — падежи и окончания не мешают. */
const stems = (t: string) => norm(t).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5));
const overlap = (q: string[], t: string) => { const ts = new Set(stems(t)); return q.filter((w) => ts.has(w)).length; };

/** Общих примеров среди примеров раздела — не больше. */
const GLOBAL_EXAMPLES = 2;
/** Примеры доступных сейчас действий (без ярлыков): сначала раздела (по состоянию — available), затем общие (их не больше двух, если у раздела свои есть). */
function examples(section: string): string[] {
  const live = listed(actions(section)).filter((a) => a.available() === true);
  const own = live.filter((a) => a.section !== 'global').flatMap((a) => a.say ?? []);
  const common = live.filter((a) => a.section === 'global').flatMap((a) => a.say ?? []);
  return own.length ? [...own.slice(0, HELP_MAX - Math.min(GLOBAL_EXAMPLES, common.length)), ...common.slice(0, GLOBAL_EXAMPLES)] : common;
}

/** Три примера, ближайших по словам к сказанному; не хватает — добираются первые по списку. */
function closest(section: string, said: string, n = 3): string[] {
  const q = stems(said);
  // и первые фразы ярлыков («штаб, открой вкладку калибровка»): в конце — подсказываются, только если близки по словам
  const shortcuts = actions(section).filter((a) => a.shortcut && a.available() === true).flatMap((a) => a.say?.slice(0, 1) ?? []);
  const ex = [...new Set([...examples(section), ...DEFAULT_SAY, ...shortcuts])];
  return ex.map((e, i) => ({ e, i, sc: overlap(q, e) })).sort((x, y) => y.sc - x.sc || x.i - y.i).slice(0, n).map((x) => x.e);
}
const quote = (xs: string[]) => xs.map((e) => `«${e}»`).join(', ');

/** Крючок модели: реплика и действия раздела → ответ (signal — отмена новой репликой, onRetry — перед повтором запроса). */
export type ModelHook = (text: string, actions: Action[], ctx: { signal: AbortSignal; onRetry(n: number): void; section: string }) => Promise<ModelReply>;
export const RETRY_SAY = 'Связь с моделью прервалась, повторяю запрос.';
/** Модель недоступна (сбой запроса или проверка связи в «ИИ» не прошла): ответ сразу, без модели. */
export const MODEL_DOWN_SAY = 'Не понял вас. Языковая модель сейчас недоступна — говорите готовыми командами, например:';

const OFF = /^(?:отбой|(?:выключи|выключить|отключи|отключить) голос)$/;
const WAKE = /^(?:на связь|на связи|подъем|включись|проснись|включи голос)$/;
const REPEAT = /^(?:повтори|повторите|повтори еще раз|повторите еще раз|еще раз|что|что что|не расслышал|не расслышала|не расслышал повтори|повтори вопрос)$/;
const MORE = /^(?:дальше|далее|продолжай|продолжайте|читай дальше)$/;

/** Ждущее подтверждения: что исполнить на «да», вопрос и до какого времени (now) ждать. */
export interface Pending { action: string; params: unknown; text: string; until: number }

/**
 * Стоп-слова (и обращение между ними) в начале реплики: сколько слов снять. 0 — реплика не начинается со стоп-слова.
 * «Подождите, открой карты» — 1; «Стоп, штаб» — 2 (вся реплика — просьба замолчать).
 */
function stopLead(words: string[]): number {
  let k = 0;
  while (k < words.length && (STOP_SET.has(words[k]) || (k > 0 && /^(?:штаб|штап)$/.test(words[k])))) k++;
  return k;
}

/** Параметры вызова модели годятся для действия: объект, если у действия есть схема, и все обязательные поля на месте. */
export function paramsFit(a: Action, p: unknown): boolean {
  const schema = a.params as { type?: string; properties?: object; required?: unknown } | undefined;
  if (!schema) return true;
  if (p === undefined && !Array.isArray(schema.required)) return true;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  const req = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  const o = p as Record<string, unknown>;
  if (!req.every((k) => o[k] !== undefined && o[k] !== null && o[k] !== '')) return false;
  // значения из перечня и простые типы — по схеме: «раздел music» не исполняется
  const props = (schema.properties ?? {}) as Record<string, { enum?: unknown[]; type?: string }>;
  return Object.entries(props).every(([k, d]) => {
    const v = o[k];
    if (v === undefined || !d) return true;
    if (Array.isArray(d.enum) && !d.enum.includes(v)) return false;
    if (d.type === 'string' && typeof v !== 'string') return false;
    if ((d.type === 'number' || d.type === 'integer') && typeof v !== 'number') return false;
    if (d.type === 'boolean' && typeof v !== 'boolean') return false;
    return true;
  });
}

export class Dispatcher {
  private spokeAt = -Infinity;
  /** Что говорили и исполнялось ли это (склеивать можно только неисполненное). */
  private memory = new Map<number, { text: string; ran: boolean }>();
  /**
   * Поправки последней реплики для ленты: «Услышано: «{heard}» — понял: «{lastUnderstood}»», когда lastFixes не пуст.
   * lastFixes — «услышано → понял» по каждому слову; lastUnderstood — исправленная фраза.
   */
  lastFixes: string[] = [];
  lastUnderstood = '';
  private corrections = new Map<number, { fixes: string[]; understood: string }>();
  /**
   * Поправки реплики с номером id — без гонок между репликами (читать можно в любой момент после await).
   * Пусто, если реплика проигнорирована или распознана точно. lastFixes/lastUnderstood — то же для последней реплики.
   */
  correction(id: number): { fixes: string[]; understood: string } { return this.corrections.get(id) ?? { fixes: [], understood: '' }; }
  /** Ожидание ответа модели: новая обращённая реплика его отменяет. */
  private waiting: AbortController | null = null;
  /** Номер заготовленной фразы «повторяю запрос» текущего ожидания: при отмене она гасится. */
  private retryId: number | undefined;
  /** Запрос к модели не удался: модель недоступна до перепроверки связи. */
  private down = false;
  /** Когда (now) связь проверялась последний раз. */
  private checkedAt = -Infinity;
  /** Номер обращённой реплики: перепроверка связи, обогнанная новой репликой, молчит. */
  private seq = 0;
  /** Ждёт подтверждения (null — ничего). */
  pending: Pending | null = null;
  /** Дежурный режим: исполняется только «Штаб, на связь». */
  standby = false;
  /** Последняя фраза штаба (чьим голосом) и когда сказана (now): «повтори» и эхо в дежурном режиме. */
  private last: { text: string; at: number; role?: SpeakRole } | null = null;
  /** Чего ждёт ответа (подтверждение или окно с напоминанием), с какого времени и напомнили ли уже. */
  private awaiting: { what: object; since: number; reminded: boolean } | null = null;
  /**
   * say — фраза штаба (quiet — заготовленная фраза о модели: окно разговора она заново не открывает; role — чьим голосом:
   * посредник докладывает итоги хода); вернуть может
   * номер фразы — им unsay гасит фразу (звучащую или ждущую очереди). stop — штаб замолкает (стоп-слово).
   * supersede — новая реплика разобрана: ждущие очереди старые ответы больше не нужны.
   * model — модель за правилами (нет — честный ответ правил); modelReady — false, если проверка связи в «ИИ» не прошла
   * (модель не зовётся); recheck — проверить связь заново (true — есть); thinking(true/false) — модель думает /
   * ответила (для «Думаю»; после отмены — false сразу). onPending — подтверждение ждёт ответа / снято (для панели);
   * onStandby — дежурный режим включён / снят.
   */
  constructor(private opts: {
    now(): number; say(text: string, o?: { quiet?: boolean; keep?: boolean; role?: SpeakRole }): number | void; section(): string; stop?(): void;
    unsay?(id: number): void; supersede?(): void;
    model?: ModelHook; modelReady?(): boolean; recheck?(): Promise<boolean>; thinking?(on: boolean): void;
    onPending?(p: Pending | null): void; onStandby?(on: boolean): void;
  }) {}

  /** Связь с моделью проверена заново (настройки сменились или проверка прошла): недоступность забыта. */
  modelBack(): void { this.down = false; this.checkedAt = this.opts.now(); }

  private modelDown(): boolean {
    return this.down || this.opts.modelReady?.() === false;
  }

  /** Фраза штаба: запоминается для «повтори» и для распознавания эха. */
  private say(text: string, o?: { quiet?: boolean; keep?: boolean; role?: SpeakRole }): number | void {
    if (!o?.quiet) this.last = { text, at: this.opts.now(), ...(o?.role ? { role: o.role } : {}) };
    return this.opts.say(text, o);
  }

  /** Фраза для других модулей (окно зачитывает вопрос, чтение по частям): в дежурном режиме штаб молчит. Номер фразы. */
  announce(text: string, o?: { keep?: boolean; role?: SpeakRole }): number | void { if (!this.standby && text) return this.say(text, o); }
  /** Снять фразу id (модуль: ответ больше не нужен): ждёт — снимается, звучит — гасится. */
  retract(id: number): void { this.opts.unsay?.(id); }

  /** Штаб договорил (событие say-done) — открывается окно разговора; ожидание подтверждения — 15 с от этого. */
  spoke(): void {
    this.spokeAt = this.opts.now();
    if (this.pending) this.pending.until = Math.max(this.pending.until, this.spokeAt + CONFIRM_MS);
  }

  /**
   * Часы (раз в секунду): подтверждения не было CONFIRM_MS — отмена; ответа на вопрос нет REMIND_MS после того, как
   * штаб договорил (и больше ничего не говорит), — напоминание, один раз на вопрос.
   */
  tick(): void {
    if (this.pending && this.opts.now() > this.pending.until) {
      this.setPending(null);
      this.say('Отменяю — подтверждения не было.');
    }
    const m = topModal();
    const what = this.pending ?? (m?.remind ? m : null);
    if (!what) { this.awaiting = null; return; }
    if (this.awaiting?.what !== what) this.awaiting = { what, since: this.opts.now(), reminded: false };
    const w = this.awaiting;
    const now = this.opts.now();
    const talking = !!this.last && this.last.at > this.spokeAt; // фраза сказана, но ещё не договорена
    if (w.reminded || this.standby || talking || this.spokeAt <= w.since || now - this.spokeAt < REMIND_MS) return;
    w.reminded = true;
    this.say(this.pending ? REMIND_YES_NO : m!.remind!);
  }

  private setPending(p: Pending | null): void {
    this.pending = p;
    if (p) this.awaiting = { what: p, since: this.opts.now(), reminded: false };
    this.opts.onPending?.(p);
  }

  /**
   * Речь поверх штаба при перебивании «словом» (сервис штаб не оборвал: без подавления эха её не отличить от его же
   * голоса). Ответ на вопрос (подтверждение «да / нет», ответ открытого окна) — не длиннее OVER_MAX_WORDS слов и не
   * эхо — принимается: штаб замолкает, ответ исполняется. Эхо — слова, идущие подряд во фразе штаба chief (два и
   * больше), и «да», если штаб сам его говорит (подтверждение необратимого не должно сработать от динамиков).
   * Прочее — не реплика: без ответа и без следа.
   */
  async over(text: string, id: number, chief: string): Promise<'ignored' | 'done' | 'unknown'> {
    if (this.standby) return 'ignored';
    const whole = norm(text);
    const words = whole.split(' ').filter(Boolean);
    if (!words.length || words.length > OVER_MAX_WORDS) return 'ignored';
    const asked = topModal();
    const yn = yesNo(whole);
    const answer = (this.pending && yn !== null) || (!!asked && (asked.isAnswer ? asked.isAnswer(whole) : yn !== null));
    if (!answer) return 'ignored';
    const said = norm(chief).split(' ').filter(Boolean);
    const run = words.some((w, i) => i > 0 && said.some((c, j) => j > 0 && c === w && said[j - 1] === words[i - 1]));
    if (run || (yn === 'yes' && words.some((w) => said.includes(w)))) return 'ignored';
    this.opts.stop?.();
    this.spoke(); // перебил — дальше разговор
    return this.utterance(text, id);
  }

  /** Спросить «да / нет»; на «да» — действие id с params (предложение штаба или подтверждение необратимого). */
  propose(text: string, id: string, params?: unknown): void {
    this.setPending({ action: id, params, text, until: this.opts.now() + CONFIRM_MS });
    this.say(`${text} ${YES_NO_SAY}`);
  }

  /** Ответ на подтверждение (голосом или кнопкой «Да» / «Нет»). Ждать нечего — ничего. */
  async answer(yes: boolean): Promise<void> {
    const p = this.pending;
    if (!p) return;
    this.setPending(null);
    if (!yes) { this.say('Отменено.'); return; }
    const a = getAction(p.action);
    const av = a ? a.available() : 'этого действия уже нет';
    if (av !== true) { this.say(`Сейчас нельзя: ${av.replace(/[.!]+$/, '')}.`); return; }
    let report: string | void;
    try {
      report = await act(p.action, p.params);
    } catch {
      this.say('Не удалось выполнить это сейчас.');
      return;
    }
    this.say(report ? speakable(report, { full: true }) : 'Выполнено.');
  }

  /**
   * Дежурный режим: включить — ожидание модели и подтверждения сняты, «Дежурю…»; снять — «На связи.» (и вопрос
   * открытого окна — заново). Повторно — без фраз.
   */
  setStandby(on: boolean, o: { quiet?: boolean } = {}): void {
    if (this.standby === on) return;
    if (o.quiet) { this.standby = on; if (on && this.pending) this.setPending(null); this.opts.onStandby?.(on); return; }
    if (on) {
      this.cancelModel();
      this.opts.supersede?.();
      if (this.pending) this.setPending(null);
      stopReading();
      this.say(STANDBY_SAY);
      this.standby = true;
    } else {
      this.standby = false;
      const m = topModal();
      this.say(m ? `${WAKE_SAY} ${m.read ?? m.question}` : WAKE_SAY);
    }
    this.opts.onStandby?.(on);
  }

  /**
   * Реплика — эхо последней фразы штаба: целиком в ней, и фраза ещё звучит (не дольше, чем её можно произнести).
   * Договорена — дальше это человек: хвост эха после конца фразы отсекает сервис (сообщение `echo`).
   */
  private echo(n: string): boolean {
    const l = this.last;
    if (!l || !n) return false;
    const now = this.opts.now();
    const playing = this.spokeAt < l.at && now - l.at <= ECHO_MS + l.text.length * 100;
    return playing && norm(l.text).includes(n);
  }

  async utterance(text: string, id: number, continues?: number): Promise<'ignored' | 'done' | 'unknown'> {
    // реплика разобрана целиком — модулям: вопрос, на который она не ответила, снимается (turnDone)
    try { return await this.handle(text, id, continues); } finally { turnDone(); }
  }

  private async handle(text: string, id: number, continues?: number): Promise<'ignored' | 'done' | 'unknown'> {
    let raw = text;
    if (continues !== undefined) {
      const prev = this.memory.get(continues);
      this.memory.delete(continues);
      // исполненная реплика не повторяется: новая обрабатывается сама по себе
      if (prev && !prev.ran && !norm(text).startsWith(norm(prev.text))) raw = `${prev.text} ${text}`;
    }
    const fixed = normalizeCommand(raw);
    const addr = addressed(fixed.text);
    // дежурный режим: только «Штаб, на связь» (не эхо собственной фразы штаба); прочее — не исполняется и без ответа
    if (this.standby) {
      this.lastFixes = []; this.lastUnderstood = '';
      if (!addr || !WAKE.test(addr.rest) || this.echo(fixed.text)) return 'ignored';
      this.opts.supersede?.();
      try { if (getAction('shell.wake')) await act('shell.wake'); } catch { /* разбудить — важнее */ }
      if (typeof window !== 'undefined' && !getAction('shell.wake')) window.dispatchEvent(new CustomEvent('voice:standby', { detail: false }));
      this.setStandby(false);
      return 'done';
    }
    // подтверждение ждёт ответа — истекло без часов: отмена (без фразы — её скажет новый ответ)
    if (this.pending && this.opts.now() > this.pending.until) this.setPending(null);
    const pending = this.pending;
    // ответ на вопрос (подтверждение «да / нет», ответ открытого окна) принимается и без обращения, и после окна
    // разговора; прочая речь без обращения — только в окне разговора, а при ждущем вопросе — не принимается вовсе
    const whole = addr ? addr.rest : fixed.text;
    const asked = topModal();
    const offered = getAction('tour.yes')?.available() === true; // предложение тура («Показать раздел?»)
    const answers = (pending && yesNo(whole) !== null)
      || (this.opts.now() - this.spokeAt <= ANSWER_MS
        && ((!!asked && (asked.isAnswer ? asked.isAnswer(whole) : yesNo(whole) !== null)) || (offered && yesNo(whole) !== null)));
    const inWindow = this.opts.now() - this.spokeAt <= CONVERSATION_S * 1000;
    if (!addr && !inWindow && !answers) { this.lastFixes = []; this.lastUnderstood = ''; return 'ignored'; }
    if (!addr && pending && !answers && !stopLead(whole.split(' ').filter(Boolean))) { this.lastFixes = []; this.lastUnderstood = ''; return 'ignored'; }
    markVoice();
    this.lastFixes = fixed.fixes;
    this.lastUnderstood = fixed.text;
    this.corrections.set(id, { fixes: fixed.fixes, understood: fixed.text });
    if (this.corrections.size > 20) this.corrections.delete(this.corrections.keys().next().value as number);
    const seq = ++this.seq;
    let rest = whole;
    const words = rest.split(' ').filter(Boolean);
    // старый ответ модели и ждущие очереди фразы больше не нужны — один раз, до любой новой фразы этой реплики
    let cleared = false;
    const clear = () => { if (cleared) return; cleared = true; this.cancelModel(); this.opts.supersede?.(); };
    // «отставить» в ответ на вопрос (подтверждение, окно) — это «нет», а не стоп-слово
    const lead = (pending || asked) && yesNo(rest) ? 0 : stopLead(words);
    // ждёт подтверждения: «да» — исполнить, «нет / отмена / отставить» — отменить; новая просьба — прежнее отменено
    if (pending) {
      const yn = yesNo(rest);
      if (yn) {
        this.opts.stop?.();
        clear();
        await this.answer(yn === 'yes');
        return 'done';
      }
      if (lead && lead === words.length) { this.opts.stop?.(); return 'done'; } // «стоп» — штаб замолкает, вопрос ждёт
      clear(); // сначала снять старое, потом сказать: иначе фразу снимут вместе со старыми ответами
      this.setPending(null);
      this.say('Прежнее отменено.');
    }
    // стоп-слова в начале: штаб замолкает; «Подождите», «Штаб, подожди», «Стоп, штаб» — и только (без модели и без
    // ответа), «Стоп, открой карты» — просьба после них исполняется; «Отставить …» — остаток правилами не исполняется
    if (lead) {
      this.opts.stop?.();
      rest = words.slice(lead).join(' ');
      if (!rest) {
        clear();
        if (getAction('read.stop')) await act('read.stop').catch(() => undefined);
        // стоп-слово, которое само — пример доступного сейчас действия («хватит» в туре, и в «стоп, хватит»), ещё и
        // исполняет его
        const a = words.slice(0, lead).reverse().map((w) => this.bySay(w)).find(Boolean);
        if (!a) repeatTurn(); // «подожди» — не ответ и не новая просьба: вопрос штаба ждёт дальше
        if (a) try { await this.runSay(a); } catch { /* штаб уже замолчал — этого достаточно */ }
        return 'done';
      }
      if (words.slice(0, lead).includes('отставить')) { clear(); return this.countermand(raw); }
    }
    clear(); // новая обращённая реплика — старый ответ модели и ждущие очереди старые ответы уже не нужны
    const rec = { text: raw, ran: false };
    this.memory.set(id, rec);
    if (this.memory.size > 20) this.memory.delete(this.memory.keys().next().value as number);
    let modal = topModal();
    // сообщение с одной кнопкой: посторонняя команда закрывает его и исполняется как обычно
    if (modal?.dismiss && !modal.parse(rest) && !OFF.test(rest) && !REPEAT.test(rest)) { modal.dismiss(); modal = topModal(); }
    if (modal) {
      const r = await this.inModal(modal, rest);
      if (r === 'done') rec.ran = true;
      return r;
    }
    try {
      if (await this.rules(rest, raw)) { rec.ran = true; return 'done'; }
    } catch {
      this.say('Не удалось выполнить это сейчас.');
      return 'unknown';
    }
    if (this.opts.model && this.modelDown() && !(await this.recheckModel())) {
      if (this.seq !== seq) return 'unknown'; // перепроверку обогнала новая реплика
      // модель недоступна — не ждать её: честный ответ сразу, без «Думаю»
      this.say(`${MODEL_DOWN_SAY} ${quote(closest(this.opts.section(), rest, 2))}.`, { quiet: true });
      return 'unknown';
    }
    if (this.opts.model) {
      const r = await this.viaModel(raw, rest);
      if (r === 'done') rec.ran = true;
      if (r !== 'fallback') return r;
    }
    this.say(`Не понял вас. Можно сказать, например: ${quote(closest(this.opts.section(), rest))}.`);
    return 'unknown';
  }

  /**
   * «Отставить …» с остатком: по-военному — отменить сказанное, а не исполнить остаток. Штаб уже замолк; фраза
   * целиком — модели (если она на связи), иначе «Отставлено».
   */
  private async countermand(raw: string): Promise<'done' | 'unknown'> {
    if (this.opts.model && !this.modelDown()) {
      const r = await this.viaModel(raw, '');
      if (r !== 'fallback') return r;
    }
    this.say('Отставлено.');
    return 'done';
  }

  /** Открыто окно, ждущее ответа: его ответы, «отбой», «повтори»; прочее — «Сначала ответьте на вопрос». */
  private async inModal(m: VoiceModal, rest: string): Promise<'done' | 'unknown'> {
    if (OFF.test(rest)) { await this.standbyByVoice(); return 'done'; }
    if (REPEAT.test(rest)) { repeatTurn(); this.say(m.read ?? m.question); return 'done'; }
    if (MORE.test(rest) && getAction('read.next')) return this.execute('read.next'); // длинный вопрос — частями
    const hit = m.parse(rest);
    if (!hit) {
      this.say(`Сначала ответьте на вопрос: ${m.question}`);
      return 'unknown';
    }
    return this.execute(hit.id, hit.params);
  }

  /** Исполнить действие реестра голосом: недоступное — причина; необратимое — сначала «да»; доклад — словами. */
  private async execute(id: string, params?: unknown): Promise<'done' | 'unknown'> {
    const a = getAction(id);
    if (!a) { this.say('Этого сейчас сделать нельзя.'); return 'unknown'; }
    const av = a.available();
    if (av !== true) { this.say(`Сейчас нельзя: ${av.replace(/[.!]+$/, '')}.`); return 'unknown'; }
    const ok = a.check ? a.check(params as never) : true;
    if (typeof ok === 'string') { this.say(ok); return 'unknown'; }
    // вместо исполнения — предложение («Ход проводить рано: … Составить черновик донесения?»): на «да» — его действие
    if (ok !== true) { this.propose(ok.offer, ok.id, ok.params); return 'done'; }
    if (a.irreversible) {
      this.propose(a.confirm?.(params as never) ?? `${a.title}?`, a.id, params);
      return 'done';
    }
    let report: string | void;
    try {
      report = await act(a.id, params);
    } catch {
      this.say('Не удалось выполнить это сейчас.');
      return 'unknown';
    }
    if (report) this.say(speakable(report, { full: true }));
    return 'done';
  }

  /** «Отбой» голосом: действие shell.standby (событие окна), дежурный режим — в любом случае. */
  private async standbyByVoice(): Promise<void> {
    try { if (getAction('shell.standby')) await act('shell.standby'); } catch { /* дежурить — важнее */ }
    if (typeof window !== 'undefined' && !getAction('shell.standby')) window.dispatchEvent(new CustomEvent('voice:standby', { detail: true }));
    this.setStandby(true);
  }

  /**
   * Модель «недоступна»: не чаще раза в RECHECK_MS при обращении — перепроверить связь (не дольше RECHECK_TIMEOUT_MS,
   * «Думаю»). true — связь есть, модель можно звать.
   */
  private async recheckModel(): Promise<boolean> {
    const now = this.opts.now();
    if (!this.opts.recheck || now - this.checkedAt <= RECHECK_MS) return false;
    this.checkedAt = now;
    this.opts.thinking?.(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ok = false;
    try {
      ok = await Promise.race([
        this.opts.recheck(),
        new Promise<boolean>((r) => { timer = setTimeout(() => r(false), RECHECK_TIMEOUT_MS); }),
      ]);
    } catch { ok = false; } finally { clearTimeout(timer); }
    this.opts.thinking?.(false);
    if (ok) this.down = false;
    return ok;
  }

  /**
   * Отменить ожидание ответа модели (голос выключили, открыта калибровка или «Голоса»): поздний ответ не звучит,
   * действие не исполняется, «повторяю запрос» гасится.
   */
  cancel(): void { this.cancelModel(); }

  private cancelModel(): void {
    if (!this.waiting) return;
    this.waiting.abort(new Error('новая реплика'));
    this.waiting = null;
    if (this.retryId !== undefined) this.opts.unsay?.(this.retryId);
    this.retryId = undefined;
    this.opts.thinking?.(false);
  }

  /** Модель за правилами. 'fallback' — модель ничего не сказала: честный ответ правил. Отменённый ответ не звучит. */
  private async viaModel(raw: string, rest: string): Promise<'done' | 'unknown' | 'fallback'> {
    const ac = new AbortController();
    this.waiting = ac;
    const live = () => this.waiting === ac && !ac.signal.aborted;
    const section = this.opts.section();
    const list = actions(section);
    this.opts.thinking?.(true);
    let reply: ModelReply;
    let warned = false; // заготовленная фраза — один раз за запрос
    const onRetry = () => {
      if (live() && !warned) { warned = true; this.retryId = this.say(RETRY_SAY, { quiet: true }) ?? undefined; }
    };
    try {
      reply = await this.opts.model!(raw, list, { signal: ac.signal, section, onRetry });
    } catch (e) {
      if (!live()) return 'unknown';
      this.done(ac);
      if ((e as Error)?.name === 'ModelUnavailable') {
        // помнится до перепроверки связи (RECHECK_MS): дальше непонятое — сразу честный ответ, эта фраза — раз за сбой
        this.down = true;
        this.checkedAt = this.opts.now();
        this.say(`Связи с моделью нет. Можно сказать, например: ${quote(closest(section, rest))}.`, { quiet: true });
        return 'unknown';
      }
      return 'fallback';
    }
    if (!live()) return 'unknown';
    this.done(ac);
    const say = speakable(reply.say ?? '');
    if (!reply.call) {
      if (!say) return 'fallback';
      this.say(say);
      return 'done';
    }
    // вызов проверяется по реестру: действие этого раздела (или общее) и доступно сейчас
    const a = forModel(list).find((x) => x.id === reply.call!.id); // кнопки экрана (model: false) модели не даны
    const av = a ? a.available() : null;
    if (!a || av === null) {
      this.say(`Этого система пока не предусматривает. Могу: ${quote(closest(section, rest))}.`);
      return 'unknown';
    }
    if (av !== true) {
      this.say(`Сейчас нельзя: ${av.replace(/[.!]+$/, '')}. Могу: ${quote(closest(section, rest))}.`);
      return 'unknown';
    }
    // параметры не разобрать или не хватает нужного — не гадаем, а переспрашиваем
    if (reply.call.broken || !paramsFit(a, reply.call.params)) {
      this.say(`Не понял, что именно сделать. Можно сказать, например: ${quote(closest(section, rest))}.`);
      return 'unknown';
    }
    // необратимое — как и словами: сначала «да» (ответ модели «Удаляю» не звучит — ещё ничего не сделано)
    if (a.irreversible) return this.execute(a.id, reply.call.params);
    if (say) this.say(say);
    let report: string | void;
    try {
      report = await act(a.id, reply.call.params);
    } catch {
      this.say('Не удалось выполнить это сейчас.');
      return 'unknown';
    }
    if (report) this.say(speakable(report, { full: true }));
    else if (!say) this.say('Сделано.');
    return 'done';
  }

  private done(ac: AbortController): void {
    if (this.waiting !== ac) return;
    this.waiting = null;
    this.retryId = undefined;
    this.opts.thinking?.(false);
  }

  private async rules(rest: string, raw = rest): Promise<boolean> {
    // одно обращение без просьбы — отозваться; ответ откроет окно разговора, дальше можно без «штаб»
    if (!rest) { this.say('Слушаю.'); return true; }
    // «отбой» — дежурный режим: микрофон открыт, штаб ждёт «Штаб, на связь» (выключить микрофон — кнопкой)
    if (OFF.test(rest)) { await this.standbyByVoice(); return true; }
    if (WAKE.test(rest)) { this.say('На связи.'); return true; }
    // переспрос — вопрос ждёт; повторяется тем же голосом (доклад посредника — посредником)
    if (REPEAT.test(rest)) { repeatTurn(); this.say(this.last?.text ?? 'Я ещё ничего не говорил.', this.last?.role ? { role: this.last.role } : undefined); return true; }
    const yn = yesNo(rest);
    if (yn) {
      // штаб только что предложил (тур: «Показать раздел?») — «да» в любых словах соглашается
      if (yn === 'yes' && getAction('tour.yes')?.available() === true) { await this.execute('tour.yes'); return true; }
      // «нет» на предложение тура — снять его (tour.no): потом «да» уже ничего не запустит
      if (yn === 'no' && getAction('tour.no')?.available() === true) { await this.execute('tour.no'); this.say('Хорошо.'); return true; }
      // «нет» на вопрос действия раздела («Куда?» приказа) — его отказ (answer.no доступно, только пока вопрос ждёт)
      if (yn === 'no' && getAction('answer.no')?.available() === true) { await this.execute('answer.no'); return true; }
      this.say('Подтверждать сейчас нечего.');
      return true;
    }
    if (MORE.test(rest) && getAction('read.next')) { await this.execute('read.next'); return true; }
    const dict = parseDictation(rest, raw);
    if (dict) { await this.execute(dict.id, dict.params); return true; }
    const q = ASK.exec(rest);
    if (q) {
      const words = stems(q[1] ?? "");
      const hit = words.length ? actions(this.opts.section()).filter((a) => a.available() === true && a.say?.length)
        .map((a) => ({ a, sc: overlap(words, `${a.title} ${a.say!.join(' ')}`) })).sort((x, y) => y.sc - x.sc)[0] : undefined;
      if (hit && hit.sc > 0) this.say(`Да, скажите: «${hit.a.say![0]}».`);
      else this.say(`Этого система пока не предусматривает. Могу: ${quote(closest(this.opts.section(), '', 3))}.`);
      return true;
    }
    const m = OPEN.exec(rest) ?? (rest.split(' ').length <= 2 && sectionByWord(rest.split(' ')[0]) ? [rest, rest] : null);
    const sec = m ? sectionByWord(m[1].split(' ')[0]) : null;
    // фразы разделов с параметрами («покажи на карте Зелов», «открой приказы»); раздел одним словом — переход
    const phrase = parsePhrase(rest, this.opts.section(), raw);
    if (sec && !(phrase && m![1].split(' ').length > 1)) {
      await act('shell.open', { section: sec });
      return true;
    }
    if (phrase) {
      if ('say' in phrase) this.say(speakable(phrase.say, { full: true }));
      else {
        // действие другого раздела («рассчитай операцию» из «Знаний») — сначала туда; раздел мог ещё не открываться
        if (phrase.section && phrase.section !== this.opts.section()) {
          await act('shell.open', { section: phrase.section });
          for (let i = 0; i < 30 && (this.opts.section() !== phrase.section || !getAction(phrase.id)); i++) await new Promise((r) => setTimeout(r, 100));
        }
        await this.execute(phrase.id, phrase.params);
      }
      return true;
    }
    if (/^(?:что (?:я )?(?:могу|можно) (?:сказать|говорить)|что (?:я )?(?:могу|можно)$|что (?:ты )?умеешь|помощь$)/.test(rest)) {
      this.say(helpText(this.opts.section()));
      return true;
    }
    if (/^калибровк/.test(rest)) { await act('shell.calibrate'); return true; }
    if (/^голос/.test(rest)) { await act('shell.voices'); return true; }
    const a = this.bySay(rest);
    if (!a) return false;
    await this.runSay(a);
    return true;
  }

  /**
   * Реплика дословно (без обращения) совпадает с примером `say` действия, доступного сейчас, — оно исполняется
   * без модели: «дальше», «назад» в туре. Только действия без обязательных параметров и не необратимые.
   */
  private bySay(rest: string): Action | undefined {
    if (!rest) return undefined;
    return actions(this.opts.section()).find((x) => !x.irreversible && !(x.params as { required?: unknown[] } | undefined)?.required?.length
      && x.say?.some((s) => { const n = norm(s); return (addressed(n)?.rest ?? n) === rest; }) && x.available() === true);
  }

  private async runSay(a: Action): Promise<void> {
    const report = await act(a.id);
    if (report) this.say(speakable(report, { full: true }));
  }
}

/** Что можно сказать в разделе: не больше HELP_MAX примеров из реестра. */
export function helpText(section: string): string {
  const ex = examples(section).slice(0, HELP_MAX);
  return ex.length ? `Можно сказать: ${ex.map((e) => `«${e}»`).join(', ')}.` : 'В этом разделе голосом пока только переходы между разделами.';
}
