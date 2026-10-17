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
const GEN_PREP = 'до|от|из|у|без|для|около|после|против|возле|более|менее|свыше|порядка';
/** Остальные предлоги, которые однозначно задают падеж соединения: «к 3 тбр», «при 5 УА», «с 4 УФ». */
const DAT_PREP = 'к|ко|по', PREP_PREP = 'о|об|обо|при', INS_PREP = 'с|со|перед|между';
/** Направление: винительный («за пятую армию», «через третью бригаду»). Место: «в/на» — предложный («в пятой армии»);
 * направление и место здесь не различить, поэтому для женского рода выбран предложный (так чаще в донесениях), для мужского остаётся именительный = винительный. */
const ACC_PREP = 'за|через|про', LOC_PREP = 'в|во|на';
/** Единица при числе в тексте: сокращение целиком; точка после «мин.»/«ч.» съедается, только если фраза идёт дальше.
 * Предлог перед числом задаёт падеж: «до пяти километров», «через одну минуту». */
const anyCase = (ws: string) => ws.split('|').map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join('|');
const UNIT_RE = new RegExp(String.raw`((?<!\p{L})(?:${anyCase(`${GEN_PREP}|через|на|за|в`)})\s+)?(\d+(?:[.,]\d+)?)\s*(км(?!\p{L})|%|чел\.|тыс\.|(?:мин|сек|ч|кг|м)(?!\p{L})(?:\.(?=\s+[а-яё]))?)`, 'gu');

// римские номера соединений: «LVI танковый корпус» → «пятьдесят шестой танковый корпус»
const ROMAN = /^(?=[IVXLC])(X{0,4}|XL|L|LX{1,3}|XC|C{1,3})?(IX|IV|V?I{0,3})$/; // у вермахта корпуса до XXXXVIII
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
const GEN_HUNDREDS = ['', 'ста', 'двухсот', 'трёхсот', 'четырёхсот', 'пятисот', 'шестисот', 'семисот', 'восьмисот', 'девятисот'];
/** Три разряда в родительном падеже («двухсот двадцати одной»). */
function genTriad(n: number, fem: boolean): string[] {
  const r = n % 100, d = r % 10;
  const tail = r >= 10 && r < 20 ? [TEENS[r - 10].replace(/ь$/, 'и')] : [GEN_TENS[Math.floor(r / 10)], d === 1 && fem ? 'одной' : GEN_ONES[d]];
  return [GEN_HUNDREDS[Math.floor(n / 100)], ...tail].filter(Boolean);
}
/** Количественное в родительном падеже («двух», «пяти», «двухсот», «тысячи пятисот», «двадцати одной»), от 1 до 999 999; иначе null. */
export function cardinalGen(n: number, fem = false): string | null {
  if (!Number.isInteger(n) || n < 1 || n > 999999) return null;
  const th = Math.floor(n / 1000), rest = n % 1000;
  const out: string[] = [];
  if (th === 1) out.push('тысячи');
  else if (th) out.push(...genTriad(th, true), th % 10 === 1 && th % 100 !== 11 ? 'тысячи' : 'тысяч');
  if (rest) out.push(...genTriad(rest, fem));
  return out.join(' ');
}

// ---------------------------------------------------------------- соединения: сокращения, род и падеж

type Cls = 'nom' | 'gen' | 'dat' | 'prep' | 'ins' | 'acc';
const CLASSES: Cls[] = ['nom', 'gen', 'dat', 'prep', 'ins', 'acc'];
/** Существительные соединений: формы по падежам (именительный, родительный, дательный, предложный, творительный, винительный). */
const NOUNS: Record<string, { g: Gender; forms: string[] }> = {
  корпус: { g: 'm', forms: ['корпус', 'корпуса', 'корпусу', 'корпусе', 'корпусом', 'корпус'] },
  полк: { g: 'm', forms: ['полк', 'полка', 'полку', 'полке', 'полком', 'полк'] },
  батальон: { g: 'm', forms: ['батальон', 'батальона', 'батальону', 'батальоне', 'батальоном', 'батальон'] },
  фронт: { g: 'm', forms: ['фронт', 'фронта', 'фронту', 'фронте', 'фронтом', 'фронт'] },
  дивизия: { g: 'f', forms: ['дивизия', 'дивизии', 'дивизии', 'дивизии', 'дивизией', 'дивизию'] },
  армия: { g: 'f', forms: ['армия', 'армии', 'армии', 'армии', 'армией', 'армию'] },
  бригада: { g: 'f', forms: ['бригада', 'бригады', 'бригаде', 'бригаде', 'бригадой', 'бригаду'] },
};
/** Слово → род и падеж (для «гв.» перед полным словом). */
const NOUN_FORM = new Map<string, [Gender, Cls]>();
for (const { g, forms } of Object.values(NOUNS)) forms.forEach((w, i) => { if (!NOUN_FORM.has(w)) NOUN_FORM.set(w, [g, CLASSES[i]]); });

/** Прилагательное по роду и падежу; hard — «-ый» (стрелковый), иначе «-ий» (гвардейский). */
function adjective(stem: string, hard: boolean, g: Gender, c: Cls): string {
  const f = g === 'f';
  if (c === 'nom' || (c === 'acc' && !f)) return stem + (f ? 'ая' : g === 'n' ? 'ое' : hard ? 'ый' : 'ий');
  if (c === 'acc') return `${stem}ую`;
  if (f) return `${stem}ой`;
  return stem + { gen: 'ого', dat: 'ому', prep: 'ом', ins: hard ? 'ым' : 'им' }[c];
}
/** Наращение порядкового (ключ для ordinalWords) по роду и падежу. */
function ordKey(g: Gender, c: Cls): string {
  if (g === 'f') return { nom: 'я', acc: 'ю' }[c as 'nom'] ?? 'fg';
  if (c === 'nom' || c === 'acc') return g === 'n' ? 'е' : 'й';
  return { gen: 'го', dat: 'му', prep: 'м', ins: 'ым' }[c];
}
const GV: Record<string, [string, boolean]> = { гв: ['гвардейск', false], уд: ['ударн', true] };

/** Сокращения соединений: прилагательные (основа, твёрдое ли) и существительное. */
const FORMS: Record<string, { adj: [string, boolean][]; noun: string }> = {
  ск: { adj: [['стрелков', true]], noun: 'корпус' }, тк: { adj: [['танков', true]], noun: 'корпус' }, мк: { adj: [['механизированн', true]], noun: 'корпус' },
  кк: { adj: [['кавалерийск', false]], noun: 'корпус' }, ак: { adj: [['армейск', false]], noun: 'корпус' },
  сд: { adj: [['стрелков', true]], noun: 'дивизия' }, пд: { adj: [['пехотн', true]], noun: 'дивизия' }, тд: { adj: [['танков', true]], noun: 'дивизия' },
  мд: { adj: [['моторизованн', true]], noun: 'дивизия' }, мсд: { adj: [['мотострелков', true]], noun: 'дивизия' }, кд: { adj: [['кавалерийск', false]], noun: 'дивизия' },
  пгд: { adj: [['панцергренадёрск', false]], noun: 'дивизия' }, нгд: { adj: [['народно-гренадёрск', false]], noun: 'дивизия' },
  а: { adj: [], noun: 'армия' }, та: { adj: [['танков', true]], noun: 'армия' }, уа: { adj: [['ударн', true]], noun: 'армия' }, ва: { adj: [['воздушн', true]], noun: 'армия' },
  бр: { adj: [], noun: 'бригада' }, тбр: { adj: [['танков', true]], noun: 'бригада' }, сбр: { adj: [['стрелков', true]], noun: 'бригада' }, мбр: { adj: [['механизированн', true]], noun: 'бригада' },
  сп: { adj: [['стрелков', true]], noun: 'полк' }, тп: { adj: [['танков', true]], noun: 'полк' }, пп: { adj: [['пехотн', true]], noun: 'полк' }, ап: { adj: [['артиллерийск', false]], noun: 'полк' },
  отсап: { adj: [['отдельн', true], ['сапёрн', true]], noun: 'батальон' },
  бф: { adj: [['Белорусск', false]], noun: 'фронт' }, уф: { adj: [['Украинск', false]], noun: 'фронт' },
};
/** Без числа и без «гв.» раскрываются только эти строчные сокращения (прочие — лишь заглавными: «ТА», «УА»). */
const SAFE_LOWER = new Set(['ск', 'мк', 'кк', 'сд', 'пд', 'тд', 'мд', 'мсд', 'кд', 'пгд', 'нгд', 'тбр', 'сбр', 'мбр', 'отсап']);
const PREPS = `${GEN_PREP}|${DAT_PREP}|${PREP_PREP}|${INS_PREP}|${ACC_PREP}|${LOC_PREP}`;
/** [предлог] [номер[-наращение]] [гв./уд.] сокращение: «из 29 гв. ск», «к 3-й тбр», «ТА». */
const FORM_RE = new RegExp(String.raw`(?<![\p{L}\d])(?:(${PREPS})\s+)?(?:(\d+)(?:-([а-яё]{1,4}))?\s*)?((?:(?:гв|уд)\.\s*)*)(\p{L}{1,5})(?![\p{L}\d])`, 'giu');
const SUFFIX_CLS: Record<string, Cls> = { й: 'nom', я: 'nom', е: 'nom', го: 'gen', му: 'dat', м: 'prep', ым: 'ins', ю: 'acc' };

function prepClass(p: string | undefined, g: Gender): Cls | null {
  if (!p) return null;
  const w = p.toLowerCase();
  const has = (list: string) => list.split('|').includes(w);
  return has(GEN_PREP) ? 'gen' : has(DAT_PREP) ? 'dat' : has(PREP_PREP) ? 'prep' : has(INS_PREP) ? 'ins' : has(ACC_PREP) ? 'acc' : has(LOC_PREP) && g === 'f' ? 'prep' : null;
}

/** Раскрывает сокращение соединения с порядковым и «гвардейским» в роде и падеже существительного; не узнано — исходный текст. */
function formationText(m: string, prep: string | undefined, num: string | undefined, suf: string | undefined, gv: string, abbr: string, before: string): string {
  const key = abbr.toLowerCase().replace(/^a$/, 'а'); // латинская «A» после номера — армия
  const def = FORMS[key];
  if (!def) return m;
  if (key === 'а' && (num === undefined || !/^[АA]$/.test(abbr))) return m;
  if (num === undefined && !gv && !(SAFE_LOWER.has(key) ? true : abbr.length > 1 && abbr === abbr.toUpperCase())) return m;
  const noun = NOUNS[def.noun];
  const pc = prepClass(prep, noun.g);
  let c: Cls = pc ?? 'nom';
  // то же слово уже стоит перед сокращением («фронт 3 УФ») — не повторяем, падеж берём у него
  const prev = !prep ? /(\p{L}+)\s+$/u.exec(before)?.[1].toLowerCase() : undefined;
  const same = prev !== undefined && noun.forms.includes(prev);
  if (same && suf === undefined) c = NOUN_FORM.get(prev!)![1];
  if (suf !== undefined) {
    const k = caseKey(suf);
    const sc = SUFFIX_CLS[k];
    if (!sc && k !== 'fg') return m; // множественное («2-х ск») — не трогаем
    if (k === 'fg' || (k === 'й' && noun.g === 'f')) c = pc && pc !== 'nom' ? pc : 'gen'; // «3-й тбр» — «третьей бригады» (падеж — по предлогу)
    else c = k === 'м' && pc === 'ins' ? 'ins' : sc;
  }
  const words = [
    ...(num !== undefined ? [ordinalWords(+num, ordKey(noun.g, c))] : []),
    ...(gv.match(/гв|уд/gi) ?? []).map((k) => adjective(...GV[k.toLowerCase()], noun.g, c)),
    ...def.adj.map(([stem, hard]) => adjective(stem, hard, noun.g, c)),
    ...(same ? [] : [noun.forms[CLASSES.indexOf(c)]]),
  ];
  return `${prep ? `${prep} ` : ''}${words.join(' ')}`;
}

/** «гв.»/«уд.» перед полным словом: род и падеж — по следующему слову («гв. армия» — «гвардейская», «гв. корпуса» — «гвардейского»). */
function guardsBeforeWord(k: string, next: string): string {
  const w = next.toLowerCase();
  const [stem, hard] = GV[k.toLowerCase()];
  const plural = /(?:ые|ие)$/.exec(w) ? 'е' : /(?:ых|их)$/.exec(w) ? 'х' : '';
  if (plural) return cap(k, stem + (hard ? 'ы' : 'и') + (plural === 'е' ? 'е' : 'х'));
  let form: [Gender, Cls] | undefined = NOUN_FORM.get(w);
  if (!form) {
    const e = /(ая|ой|ую|ое|ого|его|ому|ему|ым|им|ом|ем|ый|ий)$/.exec(w)?.[1];
    form = e ? ({ ая: ['f', 'nom'], ой: ['f', 'gen'], ую: ['f', 'acc'], ое: ['n', 'nom'], ого: ['m', 'gen'], его: ['m', 'gen'], ому: ['m', 'dat'], ему: ['m', 'dat'], ым: ['m', 'ins'], им: ['m', 'ins'], ом: ['m', 'prep'], ем: ['m', 'prep'], ый: ['m', 'nom'], ий: ['m', 'nom'] } as Record<string, [Gender, Cls]>)[e] : undefined;
  }
  const [g, c] = form ?? ['f', 'nom'];
  const a = adjective(...GV[k.toLowerCase()], g, c);
  return cap(k, a);
}
const cap = (k: string, a: string) => (k[0] === k[0].toUpperCase() ? a[0].toUpperCase() + a.slice(1) : a);
/** Сокращения без числа. */
const ABBR: [RegExp, string][] = [
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

/**
 * Готовит ответ к озвучке: числа словами, сокращения целиком, без разметки; не больше двух предложений и 300 знаков
 * (full — без этого предела: доклады действий и чтение по частям, где длину держит вызывающий).
 */
export function speakable(text: string, o: { full?: boolean } = {}): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/[*#`_]+/g, '');
  t = t.replace(/\s*\([^)]*[A-Za-z][^)]*\)/g, ''); // английские пояснения в скобках
  // марки техники: «T-34», «КВ-1», «Pz IV» — буквы и число словами («Т тридцать четыре»)
  t = t.replace(/(?<![\p{L}\d])Pz\.?\s?(?:Kpfw\.?\s?)?(I{1,3}|IV|VI?)(?![\p{L}\d])/gu, (_m, r: string) => `Т ${numberWords(romanValue(r) ?? 0)}`);
  t = t.replace(/(?<![\p{L}\d])(T|[А-ЯЁ][А-ЯЁа-яё]{0,2})-(\d{1,3})(?![\d\p{L}])/gu, (_m, l: string, n: string) => `${l === 'T' ? 'Т' : l} ${numberWords(+n)}`);
  t = t.replace(/(?<![\p{L}\d])([IVXLC]+)(\s+)(\p{L}+)/gu, (m, r: string, sp: string, w: string) => {
    const n = romanValue(r);
    if (n && ((FORMS[w.toLowerCase()] && w.length > 1) || /^(?:гв|уд)$/i.test(w))) return `${n}${sp}${w}`; // «LVI тк», «XXIII гв. ск» — дальше как «56 тк»
    return n && FORMATION.test(w.toLowerCase()) ? `${ordinalWords(n, caseOfNext(w.toLowerCase()))}${sp}${w}` : m;
  });
  t = t.replace(FORM_RE, (...a) => formationText(a[0], a[1], a[2], a[3], a[4], a[5], (a[a.length - 1] as string).slice(0, a[a.length - 2] as number)));
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
  t = t.replace(new RegExp(`(?<!${L})(${GEN_PREP})\\s+(\\d{1,6})\\s+(${L}+)`, 'giu'), (m, p: string, n: string, w: string) => {
    const lw = w.toLowerCase();
    const [g] = nounGender(` ${lw}`);
    if (p.toLowerCase() === 'около') { // «около 21 пушки», «около 200 танков» — только количество
      const cg = cardinalGen(+n, g === 'f');
      return cg ? `${p} ${cg} ${w}` : m;
    }
    if (+n < 1000 && g === 'f' && /[иы]$/.test(lw)) return `${p} ${ordinalWords(+n, 'fg')} ${w}`;
    if (+n < 1000 && g !== 'f' && /[ая]$/.test(lw) && !/(?:ая|яя)$/.test(lw)) return `${p} ${ordinalWords(+n, 'го')} ${w}`;
    // множественное число: «до двух рот», «от пяти дивизий», «более двухсот танков»
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
  t = t.replace(/(?<!\p{L})(гв|уд)\.\s*(\p{L}+)/giu, (m, k: string, next: string) => m.replace(/^\p{L}+\./u, guardsBeforeWord(k, next)));
  for (const [re, rep] of ABBR) t = t.replace(re, rep);
  t = t.replace(/\s+/g, ' ').replace(/\s+([.,!?…:;])/g, '$1').replace(/[,;:]+(?=[.!?…]|$)/g, '').trim();
  return o.full ? t : shorten(t);
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
