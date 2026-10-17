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

/** Основы названий разделов в падежах: «переигровку», «моделирование», «знаки»… */
const STEMS: [string, string][] = [
  ['редактор', 'editor'], ['переигровк', 'replay'], ['моделирован', 'modeling'], ['карт', 'maps'],
  ['знак', 'library'], ['знани', 'knowledge'], ['ии', 'staff'],
];
const sectionByWord = (w: string): string | null => {
  for (const [stem, id] of STEMS) if (w === stem || (stem.length > 2 && w.startsWith(stem))) return id;
  return SECTIONS.find((s) => norm(s.title) === w)?.id ?? null;
};

const OPEN = /^(?:открой|открыть|покажи|показать|перейди|перейти)(?: в| на| к)? (.+)$/;
const HINT = 'Пока понимаю команды: «открой переигровку», «что я могу сказать», «калибровка».';

export class Dispatcher {
  private spokeAt = -Infinity;
  private memory = new Map<number, string>();
  constructor(private opts: { now(): number; say(text: string): void; section(): string; stop?(): void }) {}

  /** Штаб договорил (событие say-done) — открывается окно разговора. */
  spoke(): void { this.spokeAt = this.opts.now(); }

  async utterance(text: string, id: number, continues?: number): Promise<'ignored' | 'done' | 'unknown'> {
    let full = text;
    if (continues !== undefined) {
      // прежняя реплика забыта, обрабатывается склеенная
      const prev = this.memory.get(continues);
      this.memory.delete(continues);
      if (prev && !norm(text).startsWith(norm(prev))) full = `${prev} ${text}`;
    }
    const addr = addressed(full);
    const inWindow = this.opts.now() - this.spokeAt <= CONVERSATION_S * 1000;
    if (!addr && !inWindow) return 'ignored';
    const rest = addr ? addr.rest : norm(full);
    this.memory.set(id, full);
    if (this.memory.size > 20) this.memory.delete(this.memory.keys().next().value as number);
    if (await this.rules(rest)) return 'done';
    this.opts.say(HINT);
    return 'unknown';
  }

  private async rules(rest: string): Promise<boolean> {
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
  const ex = actions(section).flatMap((a) => (a.available() === true ? a.say ?? [] : [])).slice(0, HELP_MAX);
  return ex.length ? `Можно сказать: ${ex.map((e) => `«${e}»`).join(', ')}.` : 'В этом разделе голосом пока только переходы между разделами.';
}
