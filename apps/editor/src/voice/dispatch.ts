/**
 * Разборщик реплик: сначала правила (мгновенно, без модели) — обращение к штабу, окно разговора,
 * переходы между разделами, «что я могу сказать», калибровка, голоса, «стоп». Чего правила не поняли в обращённой
 * реплике — разбирает модель (опция model), если она подключена; её вызов действия проверяется по реестру.
 */
import { SECTIONS } from '../sections';
import type { ModelReply } from './llm';
import { act, actions, type Action } from './registry';
import { speakable } from './speech';

export const CONVERSATION_S = 12;
export const HELP_MAX = 7;

/** Нижний регистр, без знаков препинания, «ё» → «е», пробелы сжаты. */
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

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

/** Расстояние Левенштейна между словами. */
function lev(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** Допуск на ошибку распознавания: короткие слова — только точно, длинные — до двух правок. */
const tolerance = (len: number) => (len <= 4 ? 0 : len <= 7 ? 1 : 2);

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
  /^(?:отбой|(?:выключи|выключить|отключи|отключить) голос|что (?:я )?(?:могу|можно)|что (?:ты )?умеешь|помощь|калибровк\p{L}*|голоса?|стоп|тихо|хватит|замолчи)(?: |$)/u.test(rest);

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

/** Примеры доступных действий раздела. */
const examples = (section: string) => actions(section).flatMap((a) => (a.available() === true ? a.say ?? [] : []));

/** Три примера, ближайших по словам к сказанному; не хватает — добираются первые по списку. */
function closest(section: string, said: string, n = 3): string[] {
  const q = stems(said);
  const ex = [...new Set([...examples(section), ...DEFAULT_SAY])];
  return ex.map((e, i) => ({ e, i, sc: overlap(q, e) })).sort((x, y) => y.sc - x.sc || x.i - y.i).slice(0, n).map((x) => x.e);
}
const quote = (xs: string[]) => xs.map((e) => `«${e}»`).join(', ');

/** Крючок модели: реплика и действия раздела → ответ (signal — отмена новой репликой, onRetry — перед повтором запроса). */
export type ModelHook = (text: string, actions: Action[], ctx: { signal: AbortSignal; onRetry(n: number): void; section: string }) => Promise<ModelReply>;
export const RETRY_SAY = 'Связь с моделью прервалась, повторяю запрос.';
/** Необратимое действие (удаление и т. п.) модель голосом не исполняет: подтверждение — в следующей ступени. */
export const CONFIRM_SAY = 'Это нужно подтвердить, а голосом я пока такого не делаю. Сделайте это на экране.';

/** Слова, которыми перебивают штаб; в начале реплики со словами после них — снимаются: «Стоп, открой карты». */
const STOP_LEAD = /^(?:стоп|тихо|хватит|замолчи)(?: |$)/;

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
  private pending: AbortController | null = null;
  /**
   * model — модель за правилами (нет — честный ответ правил); thinking(true/false) — модель думает / ответила
   * (для состояния «Думаю» на панели; после отмены новой репликой — false сразу).
   */
  constructor(private opts: { now(): number; say(text: string): void; section(): string; stop?(): void; model?: ModelHook; thinking?(on: boolean): void }) {}

  /** Штаб договорил (событие say-done) — открывается окно разговора. */
  spoke(): void { this.spokeAt = this.opts.now(); }

  async utterance(text: string, id: number, continues?: number): Promise<'ignored' | 'done' | 'unknown'> {
    let raw = text;
    if (continues !== undefined) {
      const prev = this.memory.get(continues);
      this.memory.delete(continues);
      // исполненная реплика не повторяется: новая обрабатывается сама по себе
      if (prev && !prev.ran && !norm(text).startsWith(norm(prev.text))) raw = `${prev.text} ${text}`;
    }
    const fixed = normalizeCommand(raw);
    const addr = addressed(fixed.text);
    const inWindow = this.opts.now() - this.spokeAt <= CONVERSATION_S * 1000;
    if (!addr && !inWindow) { this.lastFixes = []; this.lastUnderstood = ''; return 'ignored'; }
    this.lastFixes = fixed.fixes;
    this.lastUnderstood = fixed.text;
    this.corrections.set(id, { fixes: fixed.fixes, understood: fixed.text });
    if (this.corrections.size > 20) this.corrections.delete(this.corrections.keys().next().value as number);
    let rest = addr ? addr.rest : fixed.text;
    // «Стоп, открой карты»: штаб замолкает, а просьба после «стоп» исполняется
    if (STOP_LEAD.test(rest) && rest.includes(' ')) {
      this.opts.stop?.();
      rest = rest.replace(STOP_LEAD, '').replace(/^(?:штаб|штап)(?: |$)/, '');
      // «Стоп, штаб» — просили замолчать, а не отозваться
      if (!rest) { this.cancelModel(); return 'done'; }
    }
    this.cancelModel(); // новая обращённая реплика — старый ответ модели уже не нужен
    const rec = { text: raw, ran: false };
    this.memory.set(id, rec);
    if (this.memory.size > 20) this.memory.delete(this.memory.keys().next().value as number);
    try {
      if (await this.rules(rest)) { rec.ran = true; return 'done'; }
    } catch {
      this.opts.say('Не удалось выполнить это сейчас.');
      return 'unknown';
    }
    if (this.opts.model) {
      const r = await this.viaModel(raw, rest);
      if (r === 'done') rec.ran = true;
      if (r !== 'fallback') return r;
    }
    this.opts.say(`Не понял вас. Можно сказать, например: ${quote(closest(this.opts.section(), rest))}.`);
    return 'unknown';
  }

  /** Отменить ожидание ответа модели (голос выключили): поздний ответ не звучит, действие не исполняется. */
  cancel(): void { this.cancelModel(); }

  private cancelModel(): void {
    if (!this.pending) return;
    this.pending.abort(new Error('новая реплика'));
    this.pending = null;
    this.opts.thinking?.(false);
  }

  /** Модель за правилами. 'fallback' — модель ничего не сказала: честный ответ правил. Отменённый ответ не звучит. */
  private async viaModel(raw: string, rest: string): Promise<'done' | 'unknown' | 'fallback'> {
    const ac = new AbortController();
    this.pending = ac;
    const live = () => this.pending === ac && !ac.signal.aborted;
    const section = this.opts.section();
    const list = actions(section);
    this.opts.thinking?.(true);
    let reply: ModelReply;
    let warned = false; // заготовленная фраза — один раз за запрос
    const onRetry = () => { if (live() && !warned) { warned = true; this.opts.say(RETRY_SAY); } };
    try {
      reply = await this.opts.model!(raw, list, { signal: ac.signal, section, onRetry });
    } catch (e) {
      if (!live()) return 'unknown';
      this.done(ac);
      if ((e as Error)?.name === 'ModelUnavailable') {
        this.opts.say(`Связи с моделью нет. Можно сказать, например: ${quote(closest(section, rest))}.`);
        return 'unknown';
      }
      return 'fallback';
    }
    if (!live()) return 'unknown';
    this.done(ac);
    const say = speakable(reply.say ?? '');
    if (!reply.call) {
      if (!say) return 'fallback';
      this.opts.say(say);
      return 'done';
    }
    // вызов проверяется по реестру: действие этого раздела (или общее) и доступно сейчас
    const a = list.find((x) => x.id === reply.call!.id);
    const av = a ? a.available() : null;
    if (!a || av === null) {
      this.opts.say(`Этого система пока не предусматривает. Могу: ${quote(closest(section, rest))}.`);
      return 'unknown';
    }
    if (av !== true) {
      this.opts.say(`Сейчас нельзя: ${av.replace(/[.!]+$/, '')}. Могу: ${quote(closest(section, rest))}.`);
      return 'unknown';
    }
    // параметры не разобрать или не хватает нужного — не гадаем, а переспрашиваем
    if (reply.call.broken || !paramsFit(a, reply.call.params)) {
      this.opts.say(`Не понял, что именно сделать. Можно сказать, например: ${quote(closest(section, rest))}.`);
      return 'unknown';
    }
    if (a.irreversible) { this.opts.say(CONFIRM_SAY); return 'unknown'; }
    if (say) this.opts.say(say);
    let report: string | void;
    try {
      report = await act(a.id, reply.call.params);
    } catch {
      this.opts.say('Не удалось выполнить это сейчас.');
      return 'unknown';
    }
    if (report) this.opts.say(speakable(report));
    else if (!say) this.opts.say('Сделано.');
    return 'done';
  }

  private done(ac: AbortController): void {
    if (this.pending !== ac) return;
    this.pending = null;
    this.opts.thinking?.(false);
  }

  private async rules(rest: string): Promise<boolean> {
    // одно обращение без просьбы — отозваться; ответ откроет окно разговора, дальше можно без «штаб»
    if (!rest) { this.opts.say('Слушаю.'); return true; }
    if (/^(?:отбой|(?:выключи|выключить|отключи|отключить) голос)$/.test(rest)) {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('voice:power', { detail: false }));
      this.opts.say('Голос выключен. Включить — кнопкой на панели.');
      return true;
    }
    const q = ASK.exec(rest);
    if (q) {
      const words = stems(q[1] ?? "");
      const hit = words.length ? actions(this.opts.section()).filter((a) => a.available() === true && a.say?.length)
        .map((a) => ({ a, sc: overlap(words, `${a.title} ${a.say!.join(' ')}`) })).sort((x, y) => y.sc - x.sc)[0] : undefined;
      if (hit && hit.sc > 0) this.opts.say(`Да, скажите: «${hit.a.say![0]}».`);
      else this.opts.say(`Этого система пока не предусматривает. Могу: ${quote(closest(this.opts.section(), '', 3))}.`);
      return true;
    }
    const m = OPEN.exec(rest) ?? (rest.split(' ').length <= 2 && sectionByWord(rest.split(' ')[0]) ? [rest, rest] : null);
    if (m) {
      const sec = sectionByWord(m[1].split(' ')[0]);
      if (!sec) return false;
      await act('shell.open', { section: sec });
      return true;
    }
    if (/^(?:что (?:я )?(?:могу|можно) (?:сказать|говорить)|что (?:я )?(?:могу|можно)$|что (?:ты )?умеешь|помощь$)/.test(rest)) {
      this.opts.say(helpText(this.opts.section()));
      return true;
    }
    if (/^калибровк/.test(rest)) { await act('shell.calibrate'); return true; }
    if (/^голос/.test(rest)) { await act('shell.voices'); return true; }
    if (/^(?:стоп|тихо|хватит|замолчи)$/.test(rest)) { this.opts.stop?.(); return true; }
    return false;
  }
}

/** Что можно сказать в разделе: не больше HELP_MAX примеров из реестра. */
export function helpText(section: string): string {
  const ex = examples(section).slice(0, HELP_MAX);
  return ex.length ? `Можно сказать: ${ex.map((e) => `«${e}»`).join(', ')}.` : 'В этом разделе голосом пока только переходы между разделами.';
}
