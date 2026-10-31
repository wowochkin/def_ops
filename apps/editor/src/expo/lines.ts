/**
 * Заготовленные фразы сеанса (режим «Без ИИ» и запас «С ИИ»): правила выбирают заготовку и подставляют числа, даты и
 * названия из хода, своих текстов не сочиняют. Подстановки без значения — заготовка не годится (берётся другая).
 */
import linesJson from './bank-data/berlin-1945.lines.json';
import { norm } from '../voice/fuzzy';

export interface Answer { keys: string[]; q: string; a: string }
export interface Lines {
  say: Record<string, string[]>;
  comment: Record<'historical' | 'own' | 'delay' | 'event', string[]>;
  answers: Answer[];
  ambient: string[];
  thinking: string[];
  stop: string[];
}
export const LINES = linesJson as Lines;

export type Vars = Record<string, string | number | undefined>;

/** Подставить {имя}; нет значения — null. */
export function fillIn(t: string, vars: Vars): string | null {
  let ok = true;
  const out = t.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined || v === '') ok = false;
    return String(v ?? '');
  });
  return ok ? out : null;
}

/** Случайная годная заготовка из списка. */
export function pick(ts: string[] | undefined, vars: Vars = {}, rnd: () => number = Math.random): string | null {
  const ok = (ts ?? []).map((t) => fillIn(t, vars)).filter((t): t is string => t !== null);
  return ok.length ? ok[Math.floor(rnd() * ok.length)] : null;
}

/** Готовый ответ на вопрос: больше всего совпавших ключей (не меньше двух, или один при одном ключе). */
export function answerFor(question: string, lines: Lines = LINES): Answer | null {
  const words = norm(question).split(' ');
  let best: Answer | null = null;
  let score = 0;
  for (const a of lines.answers) {
    if (norm(a.q) === norm(question)) return a;
    const s = a.keys.filter((k) => words.some((w) => w.startsWith(norm(k)))).length;
    if (s > score && s >= Math.min(2, a.keys.length)) [best, score] = [a, s];
  }
  return best;
}

/** Ошибки текста заготовки: длина (~15 с вслух — до 220 знаков), стоп-слова, двойные пробелы. */
export function textErrors(t: string, lines: Lines = LINES): string[] {
  const out: string[] = [];
  if (t.length > 220) out.push(`длиннее 220 знаков: «${t.slice(0, 40)}…»`);
  for (const s of lines.stop) if (t.toLowerCase().includes(s)) out.push(`стоп-слово «${s}»: «${t.slice(0, 40)}…»`);
  if (/\s{2,}/.test(t)) out.push(`двойной пробел: «${t.slice(0, 40)}…»`);
  return out;
}

/** Все заготовки (для проверки и предозвучки). */
export function allLines(lines: Lines = LINES): string[] {
  return [
    ...Object.values(lines.say).flat(),
    ...Object.values(lines.comment).flat(),
    ...lines.answers.map((a) => a.a),
    ...lines.ambient,
    ...lines.thinking,
  ];
}
