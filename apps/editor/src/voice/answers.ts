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

/**
 * Названия, подходящие к сказанному (номера в списке). Сначала — названное целиком: как написано, затем без регистра
 * и знаков («ветвь от хода 12 (…) — 2» — не «ветвь от хода 12 (…)»); иначе каждое сказанное слово есть в названии
 * (однобуквенные слова не в счёт, а числа — в счёт: «хода 1» — не «хода 12»). Нет слов — пусто.
 */
export function pickByName(said: string, names: string[]): number[] {
  const raw = said.trim();
  const same = names.indexOf(raw);
  if (raw && same >= 0) return [same];
  const full = norm(said);
  const whole = full ? names.findIndex((x) => norm(x) === full) : -1;
  if (whole >= 0) return [whole];
  const q = full.split(' ').filter((w) => (w.length > 1 || /^\d$/.test(w)) && !FILLER.has(w));
  if (!q.length) return [];
  const exact = names.findIndex((x) => norm(x) === q.join(' '));
  if (exact >= 0) return [exact];
  return names.flatMap((x, i) => {
    const ws = nameWords(x);
    return q.every((w) => ws.some((v) => near(w, v))) ? [i] : [];
  });
}

// числа 1–99 словами: десятки и «-надцать» — раньше единиц («пятнадцать», «пятьдесят» начинаются с «пят»)
const TEENS: [RegExp, number][] = [[/^одиннадцат/, 11], [/^двенадцат/, 12], [/^тринадцат/, 13], [/^четырнадцат/, 14], [/^пятнадцат/, 15],
  [/^шестнадцат/, 16], [/^семнадцат/, 17], [/^восемнадцат/, 18], [/^девятнадцат/, 19], [/^десят/, 10]];
const TENS: [RegExp, number][] = [[/^двадцат/, 20], [/^тридцат/, 30], [/^сорок/, 40], [/^пят[ьи]десят/, 50], [/^шест[ьи]десят/, 60],
  [/^сем[ьи]десят/, 70], [/^восем[ьи]десят|^восьмидесят/, 80], [/^девяност/, 90]];
const ONES: [RegExp, number][] = [[/^(?:один|одн|перв)/, 1], [/^(?:два|две|двух|втор)/, 2], [/^(?:три|трех|трет)/, 3], [/^(?:четыр|четверт)/, 4],
  [/^пят/, 5], [/^шест/, 6], [/^(?:сем|седьм)/, 7], [/^(?:восем|восьм)/, 8], [/^девят/, 9]];
const wordNum = (w: string, list: [RegExp, number][]) => list.find(([re]) => re.test(w))?.[1] ?? null;

/** Число 1–99 из реплики: цифрами («5», «5-му») или словами, количественное и порядковое («пять», «пятому», «двадцать первому»). */
export function spokenNumber(s: string): number | null {
  const ws = norm(s).split(' ').filter((w) => w && w !== 'номер');
  if (!ws.length) return null;
  const d = /^(\d{1,2})$/.exec(ws[0]);
  if (d) return ws.length === 1 || (ws.length === 2 && /^\p{L}{1,3}$/u.test(ws[1])) ? (+d[1] >= 1 ? +d[1] : null) : null;
  if (ws.length > 2) return null;
  const teen = wordNum(ws[0], TEENS);
  if (teen !== null) return ws.length === 1 ? teen : null;
  const tens = wordNum(ws[0], TENS);
  if (tens !== null) {
    if (ws.length === 1) return tens;
    const one = wordNum(ws[1], ONES);
    return one !== null && wordNum(ws[1], TEENS) === null && wordNum(ws[1], TENS) === null ? tens + one : null;
  }
  return ws.length === 1 ? wordNum(ws[0], ONES) : null;
}

/**
 * Ветвь игры: по коду (кнопки окна — id, без разбора названий); иначе по сказанному — по названию, не вышло — по номеру
 * хода развилки («ветвь от хода второго»).
 */
export function findLine<L extends { id: string | null; name: string; from: number | null }>(said: string, ls: L[], id?: string | null): L[] {
  if (id) return ls.filter((l) => l.id === id);
  const q = said;
  const hit = pickByName(q, ls.map((l) => l.name));
  if (hit.length) return hit.map((i) => ls[i]);
  const m = /(?:от|с) хода (.+)$/.exec(norm(q));
  const n = m ? spokenNumber(m[1]) : null;
  return n === null ? [] : ls.filter((l) => l.from === n);
}
