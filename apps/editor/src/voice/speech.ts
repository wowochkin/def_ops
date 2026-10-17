/**
 * Текст для синтеза речи: числа словами по-русски, сокращения целиком, без разметки, коротко.
 * Модель просят писать числа словами, но она иногда нарушает правило — это страховка (как на стенде голоса).
 */

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', ...ONES_M.slice(3)];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

/** Форма слова при числе: 1 — one, 2–4 — few, остальное — many. */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a >= 11 && a <= 14) return many;
  return b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}

function triad(n: number, fem: boolean): string[] {
  const out = [HUNDREDS[Math.floor(n / 100)]];
  const r = n % 100;
  if (r >= 10 && r < 20) out.push(TEENS[r - 10]);
  else out.push(TENS[Math.floor(r / 10)], (fem ? ONES_F : ONES_M)[r % 10]);
  return out.filter(Boolean);
}

/** Целое число словами (именительный падеж); fem — женский род («одна», «две»). До миллиарда, больше — по цифрам. */
export function numberWords(n: number, fem = false): string {
  if (!Number.isInteger(n) || n < 0) return String(n);
  if (n === 0) return 'ноль';
  if (n >= 1e9) return String(n).split('').map((d) => numberWords(+d)).join(' ');
  const mil = Math.floor(n / 1e6), th = Math.floor(n / 1000) % 1000, rest = n % 1000;
  const out: string[] = [];
  if (mil) out.push(...(mil === 1 ? [] : triad(mil, false)), plural(mil, ['миллион', 'миллиона', 'миллионов']));
  if (th) out.push(...(th === 1 ? [] : triad(th, true)), plural(th, ['тысяча', 'тысячи', 'тысяч']));
  out.push(...triad(rest, fem));
  return out.join(' ');
}

/** Дробь словами: «две целых пять десятых» (до трёх знаков после запятой). */
export function decimalWords(s: string): string {
  const [i, f0] = s.replace(',', '.').split('.');
  const f = f0.slice(0, 3);
  const whole = +i, frac = +f;
  if (!frac) return numberWords(whole);
  const den = [['десятая', 'десятых', 'десятых'], ['сотая', 'сотых', 'сотых'], ['тысячная', 'тысячных', 'тысячных']][f.length - 1] as [string, string, string];
  return `${numberWords(whole, true)} ${plural(whole, ['целая', 'целых', 'целых'])} ${numberWords(frac, true)} ${plural(frac, den)}`;
}

// ---------------------------------------------------------------- порядковые

type Kind = 'h' | 'o' | 't'; // «-ый», «-ой», «третий»
const ORD_ONES: [string, Kind][] = [['', 'h'], ['перв', 'h'], ['втор', 'o'], ['трет', 't'], ['четвёрт', 'h'], ['пят', 'h'], ['шест', 'o'], ['седьм', 'o'], ['восьм', 'o'], ['девят', 'h']];
const ORD_TEENS = ['десят', 'одиннадцат', 'двенадцат', 'тринадцат', 'четырнадцат', 'пятнадцат', 'шестнадцат', 'семнадцат', 'восемнадцат', 'девятнадцат'];
const ORD_TENS: [string, Kind][] = [['', 'h'], ['', 'h'], ['двадцат', 'h'], ['тридцат', 'h'], ['сороков', 'o'], ['пятидесят', 'h'], ['шестидесят', 'h'], ['семидесят', 'h'], ['восьмидесят', 'h'], ['девяност', 'h']];
const ORD_HUNDREDS = ['', 'сот', 'двухсот', 'трёхсот', 'четырёхсот', 'пятисот', 'шестисот', 'семисот', 'восьмисот', 'девятисот'];
const ENDINGS: Record<Kind, Record<string, string>> = {
  h: { й: 'ый', я: 'ая', е: 'ое', го: 'ого', му: 'ому', м: 'ом', ым: 'ым', х: 'ых', ю: 'ую', ми: 'ыми' },
  o: { й: 'ой', я: 'ая', е: 'ое', го: 'ого', му: 'ому', м: 'ом', ым: 'ым', х: 'ых', ю: 'ую', ми: 'ыми' },
  t: { й: 'ий', я: 'ья', е: 'ье', го: 'ьего', му: 'ьему', м: 'ьем', ым: 'ьим', х: 'ьих', ю: 'ью', ми: 'ьими' },
};
/** Наращение после дефиса («-го», «-ая», «-му») → ключ окончания. */
const caseKey = (suf: string) => (/(го|му|ми)$/.exec(suf)?.[1] ?? (/[ыи]м$/.test(suf) ? 'ым' : suf.slice(-1)));

/** Порядковое числительное: suf — наращение («й», «го», «му», «ю», …), задаёт род и падеж. */
export function ordinalWords(n: number, suf = 'й'): string {
  const key = caseKey(suf);
  const r = n % 100;
  let stem: string, kind: Kind = 'h', head: number;
  if (r >= 10 && r < 20) { stem = ORD_TEENS[r - 10]; head = n - r; }
  else if (r % 10) { [stem, kind] = ORD_ONES[r % 10]; head = n - (r % 10); }
  else if (r) { [stem, kind] = ORD_TENS[r / 10]; head = n - r; }
  else if (n % 1000) { stem = ORD_HUNDREDS[Math.floor(n / 100) % 10]; head = n - (n % 1000); }
  else if (n === 1000) { stem = 'тысячн'; head = 0; }
  else return numberWords(n);
  const end = ENDINGS[kind][key] ?? ENDINGS[kind]['й'];
  return `${head ? numberWords(head) + ' ' : ''}${stem}${end}`;
}

// ---------------------------------------------------------------- текст

const L = '\\p{L}';
const word = (w: string) => new RegExp(`(?<!${L})${w}(?!${L})`, 'gu');
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** Единицы при числе: формы для 1 / 2–4 / 5+; дробное число — форма «few». fem — женский род числа. */
const UNITS: [RegExp, [string, string, string], boolean][] = [
  [/^км$/, ['километр', 'километра', 'километров'], false],
  [/^%$/, ['процент', 'процента', 'процентов'], false],
  [/^чел\.$/, ['человек', 'человека', 'человек'], false],
  [/^тыс\.$/, ['тысяча', 'тысячи', 'тысяч'], true],
];
/** Сокращения без числа. */
const ABBR: [RegExp, string][] = [
  [word('гв\\.'), 'гвардейская'], [word('уд\\.'), 'ударная'], [/(?<!\p{L})ТА(?!\p{L})/gu, 'танковая армия'],
  [word('сд'), 'стрелковая дивизия'], [word('ск'), 'стрелковый корпус'], [word('тк'), 'танковый корпус'],
  [word('км'), 'километров'], [word('т\\.\\s?е\\.'), 'то есть'], [word('т\\.\\s?д\\.'), 'так далее'],
  [word('тыс\\.'), 'тысяч'], [word('чел\\.'), 'человек'], [/№\s*/g, 'номер '],
];
const minutes = (mm: string) => (mm === '00' ? 'ноль-ноль' : mm[0] === '0' ? `ноль ${numberWords(+mm[1])}` : numberWords(+mm));

export const SPEAK_MAX_CHARS = 300;
export const SPEAK_MAX_SENTENCES = 2;

/** Готовит ответ к озвучке: числа словами, сокращения целиком, без разметки; не больше двух предложений и 300 знаков. */
export function speakable(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[*#`_]+/g, '');
  t = t.replace(/\s*\([^)]*[A-Za-z][^)]*\)/g, ''); // английские пояснения в скобках
  t = t.replace(/(\d)[\s ](?=\d{3}(?!\d))/g, '$1'); // «1 250»
  // даты: «16.04», «16.04.1945», «16 апреля»
  t = t.replace(/(?<![\d.,])(\d{1,2})\.(\d{2})(?:\.(\d{4}))?(?![\d.,]\d)/g, (m, d, mo, y) =>
    +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31 ? `${ordinalWords(+d, 'го')} ${MONTHS[+mo - 1]}${y ? ` ${ordinalWords(+y, 'го')} года` : ''}` : m);
  t = t.replace(new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${MONTHS.join('|')})(?!${L})`, 'gu'), (_m, d, mo) => `${ordinalWords(+d, 'го')} ${mo}`);
  // годы: «в 1945 году», «1945 года», «1945 г.»
  t = t.replace(new RegExp(`(?<!\\d)(\\d{3,4})\\s*(года|году|годом|год|г\\.)(?!${L})`, 'gu'), (_m, y, g) => {
    const noun = g === 'г.' ? 'года' : g;
    return `${ordinalWords(+y, { года: 'го', году: 'м', годом: 'ым', год: 'й' }[noun as 'года'])} ${noun}`;
  });
  t = t.replace(/(?<![\d:])(\d{1,2}):(\d{2})(?![\d:])/g, (_m, h, mm) => `${numberWords(+h)} ${minutes(mm)}`); // время
  t = t.replace(new RegExp(`(\\d+)-(ый|ий|ой|ая|ое|ье|ья|ого|его|ому|ему|ым|ом|ем|ых|их|ую|ыми|й|я|е|го|му|м|х|ю|ми)(?!${L})`, 'gu'), (_m, n, s) => ordinalWords(+n, s));
  // число с единицей: «10 км», «30%», «5 тыс.»
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*(км(?![\p{L}])|%|чел\.|тыс\.)/gu, (_m, n: string, u: string) => {
    const [, forms, fem] = UNITS.find(([re]) => re.test(u))!;
    const frac = /[.,]/.test(n);
    return `${frac ? decimalWords(n) : numberWords(+n, fem)} ${frac ? forms[1] : plural(+n, forms)}`;
  });
  t = t.replace(/\d+[.,]\d+/g, (m) => decimalWords(m));
  t = t.replace(/\d+/g, (m) => numberWords(+m));
  for (const [re, rep] of ABBR) t = t.replace(re, rep);
  t = t.replace(/\s+/g, ' ').replace(/\s+([.,!?…:;])/g, '$1').trim();
  return shorten(t);
}

/** Не больше двух предложений и 300 знаков; обрезка — по слову, с точкой в конце. */
function shorten(t: string): string {
  const sentences = t.match(/[^.!?…]+[.!?…]+["»]?|[^.!?…]+$/g) ?? [t];
  let s = sentences.slice(0, SPEAK_MAX_SENTENCES).map((x) => x.trim()).join(' ');
  if (s.length > SPEAK_MAX_CHARS) {
    s = s.slice(0, SPEAK_MAX_CHARS - 1);
    const sp = s.lastIndexOf(' ');
    if (sp > SPEAK_MAX_CHARS / 2) s = s.slice(0, sp);
    s = s.replace(/[\s,;:—–-]+$/, '') + '.';
  }
  return s;
}
