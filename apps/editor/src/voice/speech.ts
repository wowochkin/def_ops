/**
 * Текст для синтеза речи: числа словами по-русски, сокращения целиком, без разметки, коротко.
 * Модель просят писать числа словами, но она иногда нарушает правило — это страховка (как на стенде голоса).
 */

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', ...ONES_M.slice(3)];
const ONES_N = ['', 'одно', ...ONES_M.slice(2)];
/** Род числа: мужской, женский, средний. true — женский (как прежде). */
export type Gender = 'm' | 'f' | 'n';
const gOf = (g: Gender | boolean): Gender => (g === true ? 'f' : g === false ? 'm' : g);
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

/** Форма слова при числе: 1 — one, 2–4 — few, остальное — many. */
export function plural(n: number, [one, few, many]: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a >= 11 && a <= 14) return many;
  return b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}

function triad(n: number, g: Gender): string[] {
  const out = [HUNDREDS[Math.floor(n / 100)]];
  const r = n % 100;
  if (r >= 10 && r < 20) out.push(TEENS[r - 10]);
  else out.push(TENS[Math.floor(r / 10)], (g === 'f' ? ONES_F : g === 'n' ? ONES_N : ONES_M)[r % 10]);
  return out.filter(Boolean);
}

/** Целое число словами (именительный падеж); род — «одна», «две» / «одно». До миллиарда, больше — по цифрам. */
export function numberWords(n: number, gender: Gender | boolean = 'm'): string {
  const g = gOf(gender);
  if (!Number.isInteger(n) || n < 0) return String(n);
  if (n === 0) return 'ноль';
  if (n >= 1e9) return String(n).split('').map((d) => numberWords(+d)).join(' ');
  const mil = Math.floor(n / 1e6), th = Math.floor(n / 1000) % 1000, rest = n % 1000;
  const out: string[] = [];
  if (mil) out.push(...(mil === 1 ? [] : triad(mil, 'm')), plural(mil, ['миллион', 'миллиона', 'миллионов']));
  if (th) out.push(...(th === 1 ? [] : triad(th, 'f')), plural(th, ['тысяча', 'тысячи', 'тысяч']));
  out.push(...triad(rest, g));
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
const THOUSANDS_GEN = ['', '', 'двух', 'трёх', 'четырёх', 'пяти', 'шести', 'семи', 'восьми', 'девяти'];
const ENDINGS: Record<Kind, Record<string, string>> = {
  h: { й: 'ый', я: 'ая', е: 'ое', го: 'ого', му: 'ому', м: 'ом', ым: 'ым', х: 'ых', ю: 'ую', ми: 'ыми', fg: 'ой' },
  o: { й: 'ой', я: 'ая', е: 'ое', го: 'ого', му: 'ому', м: 'ом', ым: 'ым', х: 'ых', ю: 'ую', ми: 'ыми', fg: 'ой' },
  t: { й: 'ий', я: 'ья', е: 'ье', го: 'ьего', му: 'ьему', м: 'ьем', ым: 'ьим', х: 'ьих', ю: 'ью', ми: 'ьими', fg: 'ьей' },
};
/** Наращение после дефиса («-го», «-ая», «-му») → ключ окончания; 'fg' — женский род, косвенный падеж («второй линии»). */
const caseKey = (suf: string) => (suf === 'fg' ? 'fg' : /(го|му|ми)$/.exec(suf)?.[1] ?? (/[ыи]м$/.test(suf) ? 'ым' : suf.slice(-1)));

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
  else if (n < 10000 && n % 1000 === 0) { stem = `${THOUSANDS_GEN[n / 1000]}тысячн`; head = 0; } // «двухтысячный»
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
  [/^мин/, ['минута', 'минуты', 'минут'], true],
  [/^сек/, ['секунда', 'секунды', 'секунд'], true],
  [/^ч/, ['час', 'часа', 'часов'], false],
  [/^кг/, ['килограмм', 'килограмма', 'килограммов'], false],
  [/^м/, ['метр', 'метра', 'метров'], false],
];
/** Предлоги с родительным падежом: «до 2 линии» — это «до второй линии», «до 2 рот» — «до двух рот». */
const GEN_PREP = 'до|от|из|у|без|для|около|после|против|возле';
/** Единица при числе в тексте: сокращение целиком; точка после «мин.»/«ч.» съедается, только если фраза идёт дальше.
 * Предлог перед числом задаёт падеж: «до пяти километров», «через одну минуту». */
const anyCase = (ws: string) => ws.split('|').map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join('|');
const UNIT_RE = new RegExp(String.raw`((?<!\p{L})(?:${anyCase(`${GEN_PREP}|через|на|за|в`)})\s+)?(\d+(?:[.,]\d+)?)\s*(км(?!\p{L})|%|чел\.|тыс\.|(?:мин|сек|ч|кг|м)(?!\p{L})(?:\.(?=\s+[а-яё]))?)`, 'gu');

// римские номера соединений: «LVI танковый корпус» → «пятьдесят шестой танковый корпус»
const ROMAN = /^(?=[IVXLC])(X{0,3}|XL|L|LX{1,3}|XC|C{1,3})?(IX|IV|V?I{0,3})$/;
const ROMAN_VAL: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
function romanValue(r: string): number | null {
  if (!ROMAN.test(r)) return null;
  let n = 0;
  for (let i = 0; i < r.length; i++) {
    const v = ROMAN_VAL[r[i]], next = ROMAN_VAL[r[i + 1]] ?? 0;
    n += v < next ? -v : v;
  }
  return n || null;
}
/** Слово после номера, по которому видно, что это соединение. */
const FORMATION = /^(?:танков|армейск|моторизованн|механизированн|горн|пехотн|кавалерийск|резервн|стрелков|воздушн|корпус|арми|дивизи|тк$|ак$|мк$|ск$)/;
/** Наращение порядкового по слову после него: род и падеж. */
function caseOfNext(w: string): string {
  if (/^(?:тк|ак|мк|ск|корпус)$/.test(w) || /(?:ый|ий)$/.test(w)) return 'й';
  if (/(?:ая|ия)$/.test(w)) return 'я';
  if (/(?:ого|его|корпуса)$/.test(w)) return 'го';
  if (/(?:ому|ему|корпусу)$/.test(w)) return 'му';
  if (/(?:ым|им|корпусом)$/.test(w)) return 'ым';
  if (/(?:ом|ем|корпусе)$/.test(w)) return 'м';
  if (/(?:ой|ии|ией)$/.test(w)) return 'fg';
  if (/ую$/.test(w) || /ию$/.test(w)) return 'ю';
  return 'й';
}
const GEN_ONES = ['', 'одного', 'двух', 'трёх', 'четырёх', 'пяти', 'шести', 'семи', 'восьми', 'девяти'];
const GEN_TENS = ['', '', 'двадцати', 'тридцати', 'сорока', 'пятидесяти', 'шестидесяти', 'семидесяти', 'восьмидесяти', 'девяноста'];
/** Количественное в родительном падеже («двух», «пяти», «двадцати одной»), до 99; больше — null. */
export function cardinalGen(n: number, fem = false): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  const one = (d: number) => (d === 1 && fem ? 'одной' : GEN_ONES[d]);
  if (n < 10) return one(n);
  if (n < 20) return TEENS[n - 10].replace(/ь$/, 'и');
  return [GEN_TENS[Math.floor(n / 10)], n % 10 ? one(n % 10) : ''].filter(Boolean).join(' ');
}
/** Сокращения без числа. */
const ABBR: [RegExp, string][] = [
  [word('гв\\.'), 'гвардейская'], [word('уд\\.'), 'ударная'], [/(?<!\p{L})ТА(?!\p{L})/gu, 'танковая армия'],
  [word('сд'), 'стрелковая дивизия'], [word('ак'), 'армейский корпус'], [word('ск'), 'стрелковый корпус'], [word('тк'), 'танковый корпус'],
  [word('км'), 'километров'], [word('т\\.\\s?е\\.'), 'то есть'], [word('т\\.\\s?д\\.'), 'так далее'],
  [word('тыс\\.'), 'тысяч'], [word('чел\\.'), 'человек'], [/№\s*/g, 'номер '],
];
const minutes = (mm: string) => (mm === '00' ? 'ноль-ноль' : mm[0] === '0' ? `ноль ${numberWords(+mm[1])}` : numberWords(+mm));

/** Основы существительных женского и среднего рода, которые встречаются в докладах. */
const FEM = /^(?:дивизи|арми|бригад|рот[аыеу]?$|батаре|пушк|пушек|машин|недел|минут|секунд|позици|лини|колонн|групп|част[ьиея]|верст|тонн|атак|высот|деревн|переправ|единиц|операци|карт[аыеу]?$|ноч[ьиея]|сотн|танкетк|бомб|мин[аыеу]?$|флотили|эскадрили)/;
const NEU = /^(?:оруди|сражени|направлени|соединени|подразделени|отделени|учреждени|судн|сел[оаеу]?$|сёл|озер|мест[оа]?$|звен|крыл|утр[оа]?$|окн)/;
/** Род и само существительное после числа (прилагательные пропускаются); не узнан — мужской. */
function nounGender(tail: string): [Gender, string] {
  for (const w of tail.trim().toLowerCase().split(/\s+/)) {
    if (FEM.test(w)) return ['f', w];
    if (NEU.test(w)) return ['n', w];
    if (!/(?:ая|ые|ых|ое|ой|ую|ий|ый|ие|их|ым|ыми|ими|ого|его|ому|ему)$/.test(w)) return ['m', w]; // не прилагательное — дальше не смотрим
  }
  return ['m', ''];
}

export const SPEAK_MAX_CHARS = 300;
export const SPEAK_MAX_SENTENCES = 2;

/** Готовит ответ к озвучке: числа словами, сокращения целиком, без разметки; не больше двух предложений и 300 знаков. */
export function speakable(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[*#`_]+/g, '');
  t = t.replace(/\s*\([^)]*[A-Za-z][^)]*\)/g, ''); // английские пояснения в скобках
  // марки техники: «T-34», «КВ-1», «Pz IV» — буквы и число словами («Т тридцать четыре»)
  t = t.replace(/(?<![\p{L}\d])Pz\.?\s?(?:Kpfw\.?\s?)?(I{1,3}|IV|VI?)(?![\p{L}\d])/gu, (_m, r: string) => `Т ${numberWords(romanValue(r) ?? 0)}`);
  t = t.replace(/(?<![\p{L}\d])(T|[А-ЯЁ][А-ЯЁа-яё]{0,2})-(\d{1,3})(?![\d\p{L}])/gu, (_m, l: string, n: string) => `${l === 'T' ? 'Т' : l} ${numberWords(+n)}`);
  t = t.replace(/(?<![\p{L}\d])([IVXLC]+)(\s+)(\p{L}+)/gu, (m, r: string, sp: string, w: string) => {
    const n = romanValue(r);
    return n && FORMATION.test(w.toLowerCase()) ? `${ordinalWords(n, caseOfNext(w.toLowerCase()))}${sp}${w}` : m;
  });
  t = t.replace(/(?<![\p{L}\d])[A-Za-z][A-Za-z0-9_.-]*[A-Za-z0-9_]|(?<![\p{L}\d])[A-Za-z](?![\p{L}\d])/gu, ''); // прочая латиница
  t = t.replace(/(\d)[\s ](?=\d{3}(?!\d))/g, '$1'); // «1 250»
  // даты: «16.04», «16.04.1945», «16 апреля»
  t = t.replace(/(?<![\d.,])(\d{1,2})\.(\d{2})(?:\.(\d{4}))?(?![\d.,]\d)(?!\s*(?:(?:км|м|кг|т|л|ч|мин|раз)(?!\p{L})|%|чел\.|тыс\.|метр|километр|процент|тонн|час|минут))/gu, (m, d, mo, y) =>
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
  t = t.replace(UNIT_RE, (_m, prep: string | undefined, n: string, u: string) => {
    const [, forms, fem] = UNITS.find(([re]) => re.test(u))!;
    const frac = /[.,]/.test(n);
    const p = prep ?? '';
    const pw = p.trim().toLowerCase();
    const one = +n % 10 === 1 && +n % 100 !== 11;
    if (!frac && new RegExp(`^(?:${GEN_PREP})$`).test(pw)) {
      const g = cardinalGen(+n, fem);
      if (g) return `${p}${g} ${one ? forms[1] : forms[2]}`;
    }
    // винительный после «через/на/за/в»: «через одну минуту»
    if (!frac && fem && one && /^(?:через|на|за|в)$/.test(pw)) return `${p}${numberWords(+n, fem).replace(/одна$/, 'одну')} ${forms[0].replace(/а$/, 'у')}`;
    return `${p}${frac ? decimalWords(n) : numberWords(+n, fem)} ${frac ? forms[1] : plural(+n, forms)}`;
  });
  t = t.replace(/\d+[.,]\d+/g, (m) => decimalWords(m));
  // «до 2 линии», «до 3 рубежа»: после предлога с родительным существительное в единственном числе — порядковое
  t = t.replace(new RegExp(`(?<!${L})(${GEN_PREP})\\s+(\\d{1,3})\\s+(${L}+)`, 'giu'), (m, p: string, n: string, w: string) => {
    const lw = w.toLowerCase();
    const [g] = nounGender(` ${lw}`);
    if (g === 'f' && /[иы]$/.test(lw)) return `${p} ${ordinalWords(+n, 'fg')} ${w}`;
    if (g !== 'f' && /[ая]$/.test(lw) && !/(?:ая|яя)$/.test(lw)) return `${p} ${ordinalWords(+n, 'го')} ${w}`;
    // множественное число: «до двух рот», «от пяти дивизий»
    const cg = /[^аеёиоуыэюя]$/.test(lw) ? cardinalGen(+n, g === 'f') : null;
    return cg ? `${p} ${cg} ${w}` : m;
  });
  // род по существительному после числа (через одно-два прилагательных): «одна дивизия», «две армии», «одно орудие»
  t = t.replace(new RegExp(`(?<![\\d.,])(\\d+)((?:\\s+${L}+){1,3})`, 'gu'), (m, n: string, tail: string) => {
    const [g, noun] = nounGender(tail);
    if (g === 'm') return m;
    const w = numberWords(+n, g);
    // винительный: «одну дивизию»
    return (g === 'f' && /[ую]$/.test(noun) ? w.replace(/одна$/, 'одну') : w) + tail;
  });
  t = t.replace(/\d+/g, (m) => numberWords(+m));
  for (const [re, rep] of ABBR) t = t.replace(re, rep);
  t = t.replace(/\s+/g, ' ').replace(/\s+([.,!?…:;])/g, '$1').replace(/[,;:]+(?=[.!?…]|$)/g, '').trim();
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
