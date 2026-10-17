/**
 * Разборщик реплик на правилах (без языковой модели): обращение к штабу, окно разговора,
 * переходы между разделами, «что я могу сказать», калибровка, голоса, «стоп».
 */
import { SECTIONS } from '../sections';
import { act, actions } from './registry';

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

const OPEN = /^(?:открой|открыть|покажи|показать|перейди|перейти)(?: в| на| к)? (.+)$/;
const ASK = /^(?:а )?(?:можешь|умеешь|можете|умеете|можно ли|можно)(?: (.*))?$/;
const DEFAULT_SAY = ['штаб, открой переигровку', 'штаб, что я могу сказать', 'штаб, калибровка'];

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

export class Dispatcher {
  private spokeAt = -Infinity;
  /** Что говорили и исполнялось ли это (склеивать можно только неисполненное). */
  private memory = new Map<number, { text: string; ran: boolean }>();
  constructor(private opts: { now(): number; say(text: string): void; section(): string; stop?(): void }) {}

  /** Штаб договорил (событие say-done) — открывается окно разговора. */
  spoke(): void { this.spokeAt = this.opts.now(); }

  async utterance(text: string, id: number, continues?: number): Promise<'ignored' | 'done' | 'unknown'> {
    let full = text;
    if (continues !== undefined) {
      const prev = this.memory.get(continues);
      this.memory.delete(continues);
      // исполненная реплика не повторяется: новая обрабатывается сама по себе
      if (prev && !prev.ran && !norm(text).startsWith(norm(prev.text))) full = `${prev.text} ${text}`;
    }
    const addr = addressed(full);
    const inWindow = this.opts.now() - this.spokeAt <= CONVERSATION_S * 1000;
    if (!addr && !inWindow) return 'ignored';
    const rest = addr ? addr.rest : norm(full);
    const rec = { text: full, ran: false };
    this.memory.set(id, rec);
    if (this.memory.size > 20) this.memory.delete(this.memory.keys().next().value as number);
    try {
      if (await this.rules(rest)) { rec.ran = true; return 'done'; }
    } catch {
      this.opts.say('Не удалось выполнить это сейчас.');
      return 'unknown';
    }
    this.opts.say(`Не понял вас. Можно сказать, например: ${quote(closest(this.opts.section(), rest))}.`);
    return 'unknown';
  }

  private async rules(rest: string): Promise<boolean> {
    const q = ASK.exec(rest);
    if (q) {
      const words = stems(q[1] ?? "");
      const hit = words.length ? actions(this.opts.section()).filter((a) => a.available() === true && a.say?.length)
        .map((a) => ({ a, sc: overlap(words, `${a.title} ${a.say!.join(' ')}`) })).sort((x, y) => y.sc - x.sc)[0] : undefined;
      if (hit && hit.sc > 0) this.opts.say(`Да, скажите: «${hit.a.say![0]}».`);
      else this.opts.say(`Этого система пока не предусматривает. Могу: ${quote(closest(this.opts.section(), '', 3))}.`);
      return true;
    }
    const m = OPEN.exec(rest);
    if (m) {
      const sec = sectionByWord(m[1].split(' ')[0]);
      if (!sec) return false;
      await act('shell.open', { section: sec });
      return true;
    }
    if (/^что (?:я )?(?:могу|можно) (?:сказать|говорить)|^что умеешь|^помощь$/.test(rest)) {
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
