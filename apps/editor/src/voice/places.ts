/**
 * Места и соединения по названию, сказанному вслух. Чистый модуль (без React): данные приходят из
 * TurnView.places, own, intel, groups.
 *  - findPlace: место по названию (рус. и исходное, падежи, огрехи распознавания) или 2–3 варианта;
 *  - parseRelative / nearestPlace / resolveRelative: «восемь километров северо-восточнее Зелова» → ближайший
 *    названный пункт (произвольная точка голосом не задаётся);
 *  - findUnit: соединение по номеру и названию («восьмая гвардейская», «29-й ск», «первый гвардейский танковый»).
 */
import type { LngLat } from '@def-ops/core';
import type { Place } from '../sim/game-protocol';
import { lev, norm, tolerance } from './fuzzy';
import aliasFile from './place-aliases.json';
import { cardinalGen, numberWords, ordinalWords } from './speech';

// ---------------------------------------------------------------- слова и основы

/** Основы слова для сравнения: без окончаний (падежей), «ё» → «е», латиница без диакритики. */
const stemMemo = new Map<string, string[]>();
function stems(w: string): string[] {
  let r = stemMemo.get(w);
  if (!r) stemMemo.set(w, (r = stemsOf(w)));
  return r;
}
function stemsOf(w: string): string[] {
  let base = w.normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss');
  if (!/\p{Script=Cyrillic}/u.test(base)) return [base];
  base = base.replace(/оу$/, 'ов'); // «Зелоу» как слышится — «Зелов»
  const cut = (x: string) => (x.replace(/[аеиоуыэюяйь]+$/u, '').length >= 2 ? x.replace(/[аеиоуыэюяйь]+$/u, '') : x);
  const out = new Set([cut(base)]);
  const noCase = base.replace(/(?:ами|ями|ыми|ими|ого|его|ому|ему|ом|ем|ах|ях|ам|ям|ой|ей|ою|ею|ых|их|ым|им|ую|юю)$/u, '');
  if (noCase.length >= 3 && noCase !== base) out.add(cut(noCase));
  return [...out];
}

/**
 * Фонетический ключ слова для сравнения написаний: «Коттбус» = «Котбус», «Леччин» = «Лечин», «Зеелов» = «Зелов»,
 * «Губин» = «Губен». Двойные буквы — одна, е/э/и/ы/й сходятся, на конце слова звонкие оглушаются, «оу» — «ов».
 */
const phonMemo = new Map<string, string>();
export function phon(w: string): string {
  let r = phonMemo.get(w);
  if (r === undefined) phonMemo.set(w, (r = phonOf(w)));
  return r;
}
function phonOf(w: string): string {
  if (!/\p{Script=Cyrillic}/u.test(w)) return w;
  return w
    .replace(/ё/g, 'е').replace(/[ьъ]/g, '').replace(/[эеыйи]/g, 'и').replace(/оу$/, 'ов')
    .replace(/(.)\1+/g, '$1')
    .replace(/[бвгдзж]$/, (c) => ({ б: 'п', в: 'ф', г: 'к', д: 'т', з: 'с', ж: 'ш' })[c]!);
}

/**
 * Слова совпали: основы равны, звучат одинаково или отличаются на допустимую для длины ошибку.
 * Число правок (0,5 — по звучанию) или null. Строгость растёт с коротким словом: до 7 букв — та же первая
 * согласная и близкая длина основы; звучание — только равенство ключей и только для слов от 5 букв.
 */
function wordDist(a: string, b: string): number | null {
  if (a === b) return 0;
  let best: number | null = null;
  const put = (d: number) => { if (best === null || d < best) best = d; };
  for (const x of stems(a)) for (const y of stems(b)) {
    const n = Math.min(x.length, y.length);
    if (x === y) { if (n >= 4) put(0); continue; }
    const gap = Math.abs(x.length - y.length);
    if (gap > 2) continue;
    const px = phon(x), py = phon(y);
    if (n <= 7 && px[0] !== py[0]) continue;
    if (px === py && n >= 5 && gap <= 1) put(0.5);
    const d = lev(x, y);
    if (d <= (n <= 7 ? tolerance(n - 2) : n <= 11 ? 1 : 2)) put(d);
  }
  return best;
}

// ---------------------------------------------------------------- буквы вслух

/** Как говорят буквы обозначений («сектор А», «группа армий А», «зет»): слово → латинская буква. */
const LETTER: Record<string, string> = {
  а: 'a', бэ: 'b', бе: 'b', цэ: 'c', це: 'c', дэ: 'd', де: 'd', е: 'e', э: 'e', эф: 'f', еф: 'f', гэ: 'g', ге: 'g', ха: 'h', аш: 'h', хэ: 'h',
  и: 'i', йот: 'j', жи: 'j', ка: 'k', эль: 'l', эл: 'l', эм: 'm', эн: 'n', о: 'o', пэ: 'p', пе: 'p', ку: 'q', эр: 'r', эс: 's', тэ: 't', те: 't',
  у: 'u', вэ: 'v', ве: 'v', икс: 'x', игрек: 'y', зет: 'z', зэт: 'z',
};
/** Слова, после которых одиночная буква — обозначение, а не союз или сокращение. */
const BEFORE_LETTER = new Set(['сектор', 'сектора', 'секторе', 'участок', 'участка', 'участке', 'армий', 'группа', 'группы', 'группе', 'обороны', 'оборону', 'буква', 'литера']);
/** Буквы-обозначения в «#x»: латинская буква или сказанная вслух — после слов-признаков («сектор обороны А»). */
export function lettered(t: string[]): string[] {
  return t.map((w, i) => {
    if (!BEFORE_LETTER.has(t[i - 1] ?? '')) return w;
    if (/^[a-z]$/.test(w)) return '#' + w;
    return LETTER[w] ? '#' + LETTER[w] : w;
  });
}

// ---------------------------------------------------------------- числа словами

type Atom = { value: number; cls: 1 | 2 | 3 };
const clsOf = (n: number): 1 | 2 | 3 => (n < 10 ? 1 : n < 100 ? 2 : 3);
const ATOMS = [...Array.from({ length: 19 }, (_, i) => i + 1), 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900];
/** Количественные одним словом (все роды, родительный падеж — «в пяти километрах»). */
const CARDINAL = new Map<string, Atom>();
/** Порядковые: основа → значение. */
const ORDINAL: [string, Atom][] = [];
for (const n of ATOMS) {
  const atom = { value: n, cls: clsOf(n) };
  for (const g of ['m', 'f', 'n'] as const) CARDINAL.set(norm(numberWords(n, g)), atom);
  const gen = n < 100 ? cardinalGen(n) : null;
  if (gen) { CARDINAL.set(norm(gen), atom); if (n === 1) CARDINAL.set('одной', atom); }
  ORDINAL.push([norm(ordinalWords(n)).replace(/(?:ый|ой|ий)$/, ''), atom]);
}
ORDINAL.sort((a, b) => b[0].length - a[0].length);
const ORD_END = /^(?:ый|ой|ий|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ом|ем|ых|их|ую|юю|ыми|ими|ья|ье|ью|ьей|ьего|ьему|ьим|ьем|ьих|ьими|ьи)$/;
const ordinalAtom = (w: string): Atom | null => {
  for (const [stem, atom] of ORDINAL) if (w.startsWith(stem) && ORD_END.test(w.slice(stem.length))) return atom;
  return null;
};
/** Наращение после цифры: «8-я», «29-й», «8-го». */
const SUFFIX = /^(?:й|я|е|го|му|м|ю|х|ой|ая|ый|ое|ого|ым|ом|ми|ых)$/;

/** Римская цифра без строгой проверки (в названиях встречается «XXXXVI»). */
function roman(s: string): number | null {
  if (!/^[IVXLC]+$/.test(s)) return null;
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  let n = 0;
  for (let i = 0; i < s.length; i++) n += v[s[i]] < (v[s[i + 1]] ?? 0) ? -v[s[i]] : v[s[i]];
  return n || null;
}

/** Число с позиции i (слова нормализованы): цифры, «двадцать девятая», «пяти»; len — сколько слов заняло. */
function numberAt(t: string[], i: number): { n: number; len: number; ordinal: boolean } | null {
  if (/^\d+$/.test(t[i] ?? '')) {
    const ord = SUFFIX.test(t[i + 1] ?? '');
    return { n: +t[i], len: ord ? 2 : 1, ordinal: ord };
  }
  let n = 0, last = 4, len = 0;
  for (let j = i; j < t.length; j++) {
    const card = CARDINAL.get(t[j]);
    const ord = ordinalAtom(t[j]);
    const a = card ?? ord;
    if (!a || a.cls >= last) break;
    n += a.value; last = a.cls; len++;
    if (!card && ord) return { n, len, ordinal: true };
    if (a.value >= 11 && a.value <= 19) last = 1;
  }
  return len ? { n, len, ordinal: false } : null;
}

// ---------------------------------------------------------------- места

const PREP = new Set(['в', 'во', 'на', 'у', 'к', 'ко', 'от', 'из', 'около', 'возле', 'под', 'за', 'через', 'до', 'районе', 'район', 'город', 'городе', 'пункт', 'окрестностях']);
const ascii = (s: string) => /^[\x00-\x7f]*$/.test(s);

interface Keyed { place: Place; keys: string[][] }
const keyCache = new WeakMap<Place[], Keyed[]>();
const aliases = aliasFile as unknown as Record<string, string[]>;
/** Латиница без диакритики («ü» → «u»); кириллицу не трогает («й» не должна стать «и»). */
const fold = (s: string) => s.replace(/[\u00c0-\u024f]+/g, (c) => c.normalize('NFD').replace(/\p{M}/gu, '')).replace(/ß/g, 'ss');

/** Названия пункта: русское и исходное (из скобок), латинский идентификатор района, другие русские названия. */
function keysOf(p: Place): string[][] {
  const out: string[] = [];
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(p.title);
  if (m) out.push(m[1], m[2]); else out.push(p.title);
  if (/^Берлин, /.test(p.title)) out.push((m ? m[1] : p.title).replace(/^Берлин, /, ''));
  if (ascii(p.id)) out.push(p.id.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
  if (p.title.startsWith('Берлин-')) out.push(p.title.slice(7));
  if (Array.isArray(aliases[p.id])) out.push(...aliases[p.id]);
  const seen = new Set<string>();
  return out.map((s) => lettered(norm(fold(s)).split(' ').filter(Boolean))).filter((k) => k.length && !seen.has(k.join(' ')) && seen.add(k.join(' ')));
}
const keyed = (places: Place[]): Keyed[] => {
  let k = keyCache.get(places);
  if (!k) keyCache.set(places, (k = places.map((place) => ({ place, keys: keysOf(place) }))));
  return k;
};

const oneEnding = (w: string) => { const x = w.replace(/(?:ами|ом|ем|ой|ей|ам|ям|ах|ях|а|я|у|ю|е|ы|и|о)$/, ''); return x.length >= 4 ? x : w; };
/** Доля слов запроса, совпавших с названием буква в букву (1) или с точностью до одного падежного окончания (0,6). */
const rawEq = (q: string[], key: string[]) =>
  q.reduce((n, w, i) => n + (key[i] === w || key.includes(w) ? 1 : key.some((k) => oneEnding(k) === w || oneEnding(w) === k) ? 0.6 : 0), 0) / q.length;

/**
 * Оценка совпадения названия: больше — лучше; 0 — не совпало. Целиком (3 минус правки/10), часть названия (1);
 * слова, совпавшие буква в букву, прибавляют до 0,5 — точное название побеждает однокоренное длинное.
 */
function scoreKey(q: string[], key: string[]): number {
  if (q.length === key.length) {
    let d = 0;
    for (let i = 0; i < q.length; i++) { const x = wordDist(q[i], key[i]); if (x === null) return partial(q, key); d += x; }
    return 3 - d / 10 + rawEq(q, key) / 2;
  }
  return partial(q, key);
}
/** Родовые слова: сами по себе не называют пункт («мост», «озеро», «часть»). */
const COMMON = new Set(['мост', 'озеро', 'леса', 'лес', 'район', 'часть', 'станция', 'остров', 'река', 'аэродром', 'канал', 'шоссе', 'высота', 'высоты', 'плацдарм', 'гора', 'порт', 'вокзал', 'площадь', 'парк', 'кладбище', 'казармы', 'завод', 'город', 'деревня', 'станции']);
const COMMON_STEMS = new Set([...COMMON].map(oneEnding));
/** Слово запроса — то же слово названия буква в букву или с одним падежным окончанием. */
const linked = (w: string, k: string) => w === k || oneEnding(k) === w || oneEnding(w) === k || oneEnding(w) === oneEnding(k);
/**
 * Сказана начальная часть длинного названия («Франкфурт» ↔ «Франкфурт-на-Одере»): слова по порядку с первого,
 * не короче четырёх букв, без родовых слов и без опечаток (частичное совпадение строже полного).
 */
function partial(q: string[], key: string[]): number {
  if (q.length >= key.length || q.some((w) => w.length < 4 && !w.startsWith('#')) || q.every((w) => COMMON_STEMS.has(oneEnding(w)))) return 0;
  let j = 0;
  for (const w of q) {
    while (j < key.length && !linked(w, key[j])) { if (j === 0) return 0; j++; }
    if (j === key.length) return 0;
    j++;
  }
  return 1 + rawEq(q, key) / 2;
}

const MAX_OPTIONS = 3;
const coreTitle = (t: string) => t.replace(/^Берлин(?:, |-)\s*/, '').replace(/\s*\([^()]*\)\s*$/, '').toLowerCase();
const geoKm = (a: LngLat, b: LngLat) => Math.sqrt(km2(a, b));

/** «Берлин, X» и «X» в одном месте — один пункт: остаётся тот, что без «Берлин, ». */
function collapse(ps: Place[]): Place[] {
  const out: Place[] = [];
  for (const p of ps) {
    const i = out.findIndex((q) => coreTitle(q.title) === coreTitle(p.title) && geoKm(q.at, p.at) < 3);
    if (i < 0) out.push(p);
    else if (/^Берлин(?:, |-)/.test(out[i].title) && !/^Берлин(?:, |-)/.test(p.title)) out[i] = p;
  }
  return out;
}
/** Подписи вариантов для переспроса: названия; если совпадают — с идентификатором района. */
function labelsOf<T>(items: T[], name: (x: T) => string, extra: (x: T) => string): string[] {
  const names = items.map(name);
  return items.map((x, i) => (names.filter((n) => n === names[i]).length > 1 ? `${names[i]} (${extra(x)})` : names[i]));
}

/**
 * Место по названию. Однозначно — place (options пусты); несколько похожих — 2–3 options без place и labels —
 * подписи для переспроса; нет такого — пусто. Понимает русское и исходное название, другие русские названия
 * (place-aliases.json), падежи, «ё», дефисы, огрехи распознавания и разное написание.
 */
export function findPlace(text: string, places: Place[]): { place?: Place; options: Place[]; labels: string[] } {
  let q = lettered(norm(fold(text)).split(' ').filter(Boolean));
  while (q.length > 1 && PREP.has(q[0])) q = q.slice(1);
  if (!q.length || (q.length === 1 && PREP.has(q[0]))) return { options: [], labels: [] };
  const scored: { place: Place; s: number }[] = [];
  for (const { place, keys } of keyed(places)) {
    const s = Math.max(...keys.map((k) => scoreKey(q, k)));
    if (s > 0) scored.push({ place, s });
  }
  if (!scored.length) return { options: [], labels: [] };
  scored.sort((a, b) => b.s - a.s);
  const top = scored[0].s;
  const near = collapse(scored.filter((x) => top - x.s <= 0.05).map((x) => x.place));
  if (near.length === 1) return { place: near[0], options: [], labels: [] };
  const options = near.slice(0, MAX_OPTIONS);
  return { options, labels: labelsOf(options, (p) => p.title, (p) => p.id) };
}

// ---------------------------------------------------------------- «N км <сторона> от …»

export type Rumb = 'С' | 'СВ' | 'В' | 'ЮВ' | 'Ю' | 'ЮЗ' | 'З' | 'СЗ';
const BEARING: Record<Rumb, number> = { С: 0, СВ: 45, В: 90, ЮВ: 135, Ю: 180, ЮЗ: 225, З: 270, СЗ: 315 };
const DIRS: [RegExp, Rumb][] = [
  [/^(?:северовост|св$)/, 'СВ'], [/^(?:северозап|сз$)/, 'СЗ'], [/^(?:юговост|юв$)/, 'ЮВ'], [/^(?:югозап|юз$)/, 'ЮЗ'],
  [/^север/, 'С'], [/^(?:юг|южн)/, 'Ю'], [/^вост/, 'В'], [/^запад/, 'З'],
];
const FILLER = new Set(['в', 'на', 'примерно', 'около', 'почти', 'где', 'то', 'ориентировочно']);

/**
 * «Восемь километров северо-восточнее Зелова», «в 5 км к западу от …» → расстояние, сторона и название опорного
 * места (ref — как сказано). Не похоже на такую фразу — null.
 */
export function parseRelative(text: string): { km: number; dir: Rumb; ref: string } | null {
  const t = norm(text.replace(/(\d)[.,](\d)/g, '$1д$2')).replace(/(?<=^|\s)(северо|юго) /gu, '$1').split(' ').filter(Boolean);
  let i = 0;
  while (FILLER.has(t[i])) i++;
  let km: number;
  if (/^\d+д\d+$/.test(t[i] ?? '')) { km = +t[i].replace('д', '.'); i++; }
  else if (t[i] === 'полтора' || t[i] === 'полторы') { km = 1.5; i++; }
  else {
    const num = numberAt(t, i);
    if (!num || num.ordinal) return null;
    km = num.n; i += num.len;
    if (t[i] === 'с' && /^половин/.test(t[i + 1] ?? '')) { km += 0.5; i += 2; }
  }
  if (!/^(?:км|километр\p{L}*)$/u.test(t[i] ?? '')) return null;
  i++;
  if (t[i] === 'к' || t[i] === 'на' || t[i] === 'в') i++;
  const dir = DIRS.find(([re]) => re.test(t[i] ?? ''))?.[1];
  if (!dir) return null;
  i++;
  if (t[i] === 'от') i++;
  const ref = t.slice(i).join(' ');
  return ref ? { km, dir, ref } : null;
}

const KM_LAT = 110.574, KM_LNG = 111.32;
/** Точка в km километрах от from по стороне dir. */
export function offsetPoint(from: LngLat, km: number, dir: Rumb): LngLat {
  const b = (BEARING[dir] * Math.PI) / 180;
  const lat = from[1] + (km * Math.cos(b)) / KM_LAT;
  return [from[0] + (km * Math.sin(b)) / (KM_LNG * Math.cos((from[1] * Math.PI) / 180)), lat];
}
const km2 = (a: LngLat, b: LngLat) => {
  const dx = (a[0] - b[0]) * KM_LNG * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), dy = (a[1] - b[1]) * KM_LAT;
  return dx * dx + dy * dy;
};

/** Ближайший к точке названный пункт (places не пуст). */
export function nearestPlace(at: LngLat, places: Place[]): Place {
  if (!places.length) throw new RangeError('нет названных пунктов');
  let best = places[0], bd = Infinity;
  for (const p of places) { const d = km2(at, p.at); if (d < bd) { bd = d; best = p; } }
  return best;
}

/**
 * Полная фраза «N км <сторона> от <места>» → ближайший к этой точке названный пункт. Опорное место неясно —
 * его варианты (options); фраза не такая — пусто.
 */
export function resolveRelative(text: string, places: Place[]): { place?: Place; options: Place[]; labels: string[]; from?: Place } {
  const rel = parseRelative(text);
  if (!rel) return { options: [], labels: [] };
  const ref = findPlace(rel.ref, places);
  if (!ref.place) return { options: ref.options, labels: ref.labels };
  return { place: nearestPlace(offsetPoint(ref.place.at, rel.km, rel.dir), places), options: [], labels: [], from: ref.place };
}

// ---------------------------------------------------------------- соединения

/** Сокращения, которые говорят и пишут: «гв.», «ск», «ТА», «А» → полные слова. */
const ABBR: Record<string, string[]> = {
  гв: ['гвардейск'], уд: ['ударн'], а: ['армия'], та: ['танков', 'армия'], ка: ['кавалерийск', 'армия'],
  ск: ['стрелков', 'корпус'], тк: ['танков', 'корпус'], мк: ['механизированн', 'корпус'], ак: ['армейск', 'корпус'], кк: ['кавалерийск', 'корпус'],
  гск: ['гвардейск', 'стрелков', 'корпус'], гтк: ['гвардейск', 'танков', 'корпус'], гта: ['гвардейск', 'танков', 'армия'], гва: ['гвардейск', 'армия'],
  сд: ['стрелков', 'дивизия'], пд: ['пехотн', 'дивизия'], тд: ['танков', 'дивизия'], мд: ['моторизованн', 'дивизия'],
};
const TYPE_RANK: Record<string, number> = { армия: 0, фронт: 0.05, группа: 0.1, корпус: 0.2, дивизия: 0.3 };
const GENERIC = new Set(['гвардейск', 'ударн', 'танков', 'стрелков', 'армейск', 'пехотн', 'моторизованн', 'механизированн', 'кавалерийск', 'общевойсков', 'гарнизон', 'крепост', 'отряд', 'оборонительн', ...Object.keys(TYPE_RANK)]);
const STOP = new Set(['и', 'в', 'на', 'по', 'с', 'со', 'к', 'о', 'об', 'про', 'то', 'ой']);
const TYPE_STEM: [RegExp, string][] = [[/^арм/, 'армия'], [/^корпус/, 'корпус'], [/^дивиз/, 'дивизия'], [/^фронт/, 'фронт'], [/^групп/, 'группа']];

interface Desc { num?: number; words: string[]; cardinal?: boolean }

/** Номер и значимые слова фразы (с раскрытыми сокращениями и буквами-обозначениями). */
function describeText(text: string): Desc {
  const raw = text.split(/[\s\-«»"“”.,/;:]+/).filter(Boolean);
  const t = lettered(raw.map((w) => norm(w)));
  let num: number | undefined, cardinal = false;
  const words: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (t[i].startsWith('#')) { words.push(t[i]); continue; }
    const r = roman(raw[i]);
    if (r !== null && !/^\p{Script=Cyrillic}/u.test(raw[i])) { num ??= r; continue; }
    const n = numberAt(t, i);
    if (n) { if (num === undefined) { num = n.n; cardinal = !n.ordinal && !/^\d/.test(t[i]); } i += n.len - 1; continue; }
    const abbr = ABBR[t[i]];
    if (abbr && (t[i] !== 'а' || i === raw.length - 1 || /^[А-Я]+$/.test(raw[i]))) { words.push(...abbr); continue; }
    if (!t[i] || STOP.has(t[i]) || /^\d+$/.test(t[i])) continue;
    const stem = stems(t[i])[0];
    words.push(TYPE_STEM.find(([re]) => re.test(stem))?.[1] ?? stem);
  }
  return { num, words, cardinal };
}

/**
 * Название соединения: основное (без скобок) и прозвища из скобок. Прозвище — то, что в «…» («армия Венка»,
 * «Герман Геринг»), «группа/армия + Фамилия» («группа Неринга») и, если в скобках перечислены составные части
 * с кавычками, их номера («603 пд»). Описательные скобки («части», «штурмовая», «Верховное командование») — нет.
 */
function describeName(name: string): { main: Desc; aliases: Desc[] } {
  const aliases: Desc[] = [];
  for (const m of name.matchAll(/\(([^()]*)\)/g)) {
    const composite = /«/.test(m[1]);
    for (const seg of m[1].split(',')) {
      const quoted = [...seg.matchAll(/«([^»]*)»/g)].map((x) => x[1]);
      for (const x of quoted) { const d = describeText(x); if (d.words.length && /\p{Script=Cyrillic}/u.test(x)) aliases.push({ words: d.words }); }
      const plain = seg.replace(/«[^»]*»/g, ' ').trim();
      if (!quoted.length && composite && /\d/.test(plain)) { const d = describeText(plain); if (d.num !== undefined && d.words.length) aliases.push(d); }
      else if (!quoted.length && /^(?:группа|армия|корпус)\s+\p{Lu}\p{L}+$/u.test(plain)) aliases.push({ words: describeText(plain).words });
    }
  }
  return { main: describeText(name.replace(/\(.*?\)/g, ' ')), aliases };
}
const wordMatch = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) || wordDist(a, b) !== null;
const plainName = (n: string) => norm(n.replace(/\(.*?\)/g, ' '));
const SIDE_RU: Record<string, string> = { su: 'СССР', de: 'Германия' };

/**
 * Соединение по названию: номер словами или цифрами («восьмая», «8-я», «29-й»), порядок слов любой, сокращения
 * («гв.», «ск», «ТА»), прозвища из скобок, буквы («группа армий А»). Одно подходящее — unit; несколько — 2–3 options
 * с подписями labels (при одинаковых названиях у разных сторон — со стороной); нет — пусто.
 * Номер без типа читается как армия, но если армий с этим номером несколько («третья» при 3-й, 3-й гв., 3-й уд.) —
 * переспрос. opts.side оставляет только соединения этой стороны (поле side).
 */
export function findUnit<U extends { id: string; name: string; side?: string }>(
  text: string, units: U[], opts: { side?: string; sideNames?: Record<string, string> } = {},
): { unit?: U; options: U[]; labels: string[] } {
  const none = { options: [] as U[], labels: [] as string[] };
  const q = describeText(text);
  if (q.num === undefined && q.words.every((w) => GENERIC.has(w)) && q.words.length < 2) return none;
  if (q.cardinal && !q.words.length) return none; // «шесть» — не «шестая»
  const pool = opts.side ? units.filter((u) => u.side === undefined || u.side === opts.side) : units;
  const sideName = (s: string) => opts.sideNames?.[s] ?? SIDE_RU[s] ?? s;
  const result = (found: U[]) => {
    if (found.length === 1) return { unit: found[0], options: [] as U[], labels: [] as string[] };
    const options = found.slice(0, MAX_OPTIONS);
    return { options, labels: labelsOf(options, (u) => u.name, (u) => (u.side ? sideName(u.side) : u.id)) };
  };
  const exact = plainName(text);
  const same = pool.filter((u) => plainName(u.name) === exact);
  if (same.length) return result(same);
  const typed = q.words.some((w) => w in TYPE_RANK);
  const cands: { u: U; extra: number; rank: number }[] = [];
  for (const u of pool) {
    const { main, aliases } = describeName(u.name);
    let best: { extra: number; rank: number } | null = null;
    for (const d of [main, ...aliases]) {
      if (q.num !== undefined && d.num !== q.num) continue;
      const used = new Set<number>();
      if (!q.words.every((w) => { const j = d.words.findIndex((x, n) => !used.has(n) && wordMatch(w, x)); if (j >= 0) used.add(j); return j >= 0; })) continue;
      const extra = d.words.filter((w, n) => !used.has(n) && !(w in TYPE_RANK)).length;
      const rank = Math.min(5, ...d.words.filter((w) => w in TYPE_RANK).map((w) => TYPE_RANK[w]));
      if (!best || extra < best.extra) best = { extra, rank };
    }
    if (best) cands.push({ u, ...best });
  }
  if (!cands.length) return none;
  // тип назван («армия», «корпус») — берём самое полное совпадение; не назван — самый старший тип (армия), но не молча при нескольких
  // по одному имени («Берлин») без номера и типа предпочтений нет — все подходящие
  const key = (c: { extra: number; rank: number }) => (typed ? c.extra : q.num === undefined ? 0 : c.rank);
  const lead = Math.min(...cands.map(key));
  const top = cands.filter((c) => key(c) === lead).sort((a, b) => a.extra - b.extra).map((c) => c.u);
  // одно название у двух сторон — не молча
  if (top.length === 1) {
    const twins = cands.filter((c) => c.u !== top[0] && plainName(c.u.name) === plainName(top[0].name)).map((c) => c.u);
    return result(twins.length ? [top[0], ...twins] : top);
  }
  return result(top);
}
