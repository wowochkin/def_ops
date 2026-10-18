/**
 * Ответы на вопросы штаба и окон: «да / нет» (с синонимами), вариант по номеру («второй», «вариант три»), по названию
 * (с поправкой на огрехи распознавания). Реплика — уже без обращения; регистр и знаки препинания не важны.
 */
import { numberWords } from './speech';

/** Нижний регистр, без знаков препинания, «ё» → «е», пробелы сжаты. */
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const YES = new Set(['да', 'да да', 'так точно', 'подтверждаю', 'да подтверждаю', 'так точно подтверждаю', 'верно', 'выполняй', 'выполняйте',
  'давай', 'давайте', 'ок', 'окей', 'хорошо', 'согласен', 'конечно', 'да конечно', 'принято', 'провожу', 'да провожу']);
const NO = new Set(['нет', 'нет нет', 'не', 'отмена', 'отменить', 'отмени', 'отмените', 'отставить', 'не надо', 'нет не надо', 'не нужно',
  'никак нет', 'не подтверждаю', 'нет отмена']);

/**
 * Явное «да» для необратимого: «хорошо», «верно», «принято», «давай», «конечно», «ок» для пожилых — знак «слышу, сейчас»,
 * а не приказ выполнять. Предложения штаба (тур, калибровка) принимают и мягкие слова (YES).
 */
const STRICT_YES = new Set(['да', 'да да', 'так точно', 'подтверждаю', 'да подтверждаю', 'так точно подтверждаю', 'выполняй', 'выполняйте', 'провожу', 'да провожу']);
export const strictYes = (rest: string): boolean => STRICT_YES.has(norm(rest));

/** «да» / «нет» — только вся реплика целиком («да, открой карты» — не ответ). */
export function yesNo(rest: string): 'yes' | 'no' | null {
  const n = norm(rest);
  return YES.has(n) ? 'yes' : NO.has(n) ? 'no' : null;
}

const ORD: RegExp[] = [/^(?:перв|один$|одна$|одно$|1$)/, /^(?:втор|два$|две$|2$)/, /^(?:трет|три$|3$)/, /^(?:четв|четыре$|4$)/,
  /^(?:пят|5$)/, /^(?:шест|6$)/, /^(?:седьм|семь$|7$)/, /^(?:восьм|восемь$|8$)/, /^(?:девят|9$)/, /^(?:десят|10$)/];
const FILLER = new Set(['вариант', 'варианта', 'номер', 'под', 'номером', 'голос', 'пункт']);

/** Номер варианта (с нуля) из «второй», «вариант три», «номер 2», «последний» (n — сколько вариантов); иначе null. */
export function ordinalIndex(rest: string, n?: number): number | null {
  const words = norm(rest).split(' ').filter((w) => w && !FILLER.has(w));
  if (words.length !== 1) return null;
  const w = words[0];
  if (/^последн/.test(w)) return n ? n - 1 : null;
  const i = ORD.findIndex((re) => re.test(w));
  return i < 0 ? null : i;
}

/** Одно и то же слово с поправкой на окончания и огрехи: равны или общее начало почти во всё короткое слово. */
function near(a: string, b: string): boolean {
  if (a === b) return true;
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k >= Math.max(4, Math.min(a.length, b.length) - 2);
}
/** Слова названия: числа — и словами («14» → «четырнадцать»). */
const nameWords = (name: string) => norm(name).split(' ').filter(Boolean).flatMap((w) => (/^\d+$/.test(w) ? [w, numberWords(+w)] : [w]));

/** Названия, подходящие к сказанному (номера в списке): каждое сказанное слово есть в названии. Нет слов — пусто. */
export function pickByName(said: string, names: string[]): number[] {
  const q = norm(said).split(' ').filter((w) => w.length > 1 && !FILLER.has(w));
  if (!q.length) return [];
  const exact = names.findIndex((x) => norm(x) === q.join(' '));
  if (exact >= 0) return [exact];
  return names.flatMap((x, i) => {
    const ws = nameWords(x);
    return q.every((w) => ws.some((v) => near(w, v))) ? [i] : [];
  });
}
