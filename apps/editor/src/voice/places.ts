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
import { cardinalGen, numberWords, ordinalWords } from './speech';

// ---------------------------------------------------------------- слова и основы

/** Основы слова для сравнения: без окончаний (падежей), «ё» → «е», латиница без диакритики. */
function stems(w: string): string[] {
  const base = w.normalize('NFD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss');
  if (!/\p{Script=Cyrillic}/u.test(base)) return [base];
  const cut = (x: string) => (x.replace(/[аеиоуыэюяйь]+$/u, '').length >= 2 ? x.replace(/[аеиоуыэюяйь]+$/u, '') : x);
  const out = new Set([cut(base)]);
  const noCase = base.replace(/(?:ами|ями|ыми|ими|ого|его|ому|ему|ом|ем|ах|ях|ам|ям|ой|ей|ою|ею|ых|их|ым|им|ую|юю)$/u, '');
  if (noCase.length >= 3 && noCase !== base) out.add(cut(noCase));
  return [...out];
}

/** Слова совпали: основы равны или отличаются на допустимую для длины ошибку распознавания. Возвращает число правок или null. */
function wordDist(a: string, b: string): number | null {
  if (a === b) return 0;
  let best: number | null = null;
  for (const x of stems(a)) for (const y of stems(b)) {
    const d = lev(x, y);
    if (d <= tolerance(Math.min(x.length, y.length) - 2) && (best === null || d < best)) best = d;
  }
  return best;
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

/** Названия пункта: русское и исходное (из скобок), а также латинский идентификатор района. */
function keysOf(p: Place): string[][] {
  const out: string[] = [];
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(p.title);
  if (m) out.push(m[1], m[2]); else out.push(p.title);
  if (ascii(p.id)) out.push(p.id.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'));
  if (p.title.startsWith('Берлин-')) out.push(p.title.slice(7));
  const seen = new Set<string>();
  return out.map((s) => norm(s.normalize('NFD').replace(/\p{M}/gu, '')).split(' ').filter(Boolean)).filter((k) => k.length && !seen.has(k.join(' ')) && seen.add(k.join(' ')));
}
const keyed = (places: Place[]): Keyed[] => {
  let k = keyCache.get(places);
  if (!k) keyCache.set(places, (k = places.map((place) => ({ place, keys: keysOf(place) }))));
  return k;
};

/** Оценка совпадения названия: больше — лучше; 0 — не совпало. Целиком (3 − правки/10), часть названия (1). */
function scoreKey(q: string[], key: string[]): number {
  if (q.length === key.length) {
    let d = 0;
    for (let i = 0; i < q.length; i++) { const x = wordDist(q[i], key[i]); if (x === null) return partial(q, key); d += x; }
    return 3 - d / 10;
  }
  return partial(q, key);
}
/** Сказана часть длинного названия («Франкфурт» ↔ «Франкфурт-на-Одере»): слова по порядку, не короче четырёх букв. */
function partial(q: string[], key: string[]): number {
  if (q.length >= key.length || q.some((w) => w.length < 4)) return 0;
  let j = 0;
  for (const w of q) {
    while (j < key.length && wordDist(w, key[j]) === null) j++;
    if (j === key.length) return 0;
    j++;
  }
  return 1;
}

const MAX_OPTIONS = 3;

/**
 * Место по названию. Однозначно — place (options пусты); несколько похожих — 2–3 options без place;
 * нет такого — пусто. Понимает русское и исходное название, падежи, «ё», дефисы, огрехи распознавания.
 */
export function findPlace(text: string, places: Place[]): { place?: Place; options: Place[] } {
  let q = norm(text.normalize('NFD').replace(/\p{M}/gu, '')).split(' ').filter(Boolean);
  while (q.length > 1 && PREP.has(q[0])) q = q.slice(1);
  if (!q.length || (q.length === 1 && PREP.has(q[0]))) return { options: [] };
  const scored: { place: Place; s: number }[] = [];
  for (const { place, keys } of keyed(places)) {
    const s = Math.max(...keys.map((k) => scoreKey(q, k)));
    if (s > 0) scored.push({ place, s });
  }
  if (!scored.length) return { options: [] };
  scored.sort((a, b) => b.s - a.s);
  if (scored.length === 1 || scored[0].s - scored[1].s > 0.05) return { place: scored[0].place, options: [] };
  const top = scored[0].s;
  return { options: scored.filter((x) => top - x.s <= 0.05).slice(0, MAX_OPTIONS).map((x) => x.place) };
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
  const t = norm(text).replace(/(?<=^|\s)(северо|юго) /gu, '$1').split(' ').filter(Boolean);
  let i = 0;
  while (FILLER.has(t[i])) i++;
  const num = numberAt(t, i);
  if (!num || num.ordinal) return null;
  i += num.len;
  if (!/^(?:км|километр\p{L}*)$/u.test(t[i] ?? '')) return null;
  i++;
  if (t[i] === 'к' || t[i] === 'на' || t[i] === 'в') i++;
  const dir = DIRS.find(([re]) => re.test(t[i] ?? ''))?.[1];
  if (!dir) return null;
  i++;
  if (t[i] === 'от') i++;
  const ref = t.slice(i).join(' ');
  return ref ? { km: num.n, dir, ref } : null;
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
export function resolveRelative(text: string, places: Place[]): { place?: Place; options: Place[]; from?: Place } {
  const rel = parseRelative(text);
  if (!rel) return { options: [] };
  const ref = findPlace(rel.ref, places);
  if (!ref.place) return { options: ref.options };
  return { place: nearestPlace(offsetPoint(ref.place.at, rel.km, rel.dir), places), options: [], from: ref.place };
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
const GENERIC = new Set(['гвардейск', 'ударн', 'танков', 'стрелков', 'армейск', 'пехотн', 'моторизованн', 'механизированн', 'кавалерийск', 'общевойсков', ...Object.keys(TYPE_RANK)]);
const STOP = new Set(['и', 'в', 'на', 'по', 'с', 'со', 'к', 'о', 'об', 'про', 'то', 'ой']);
const TYPE_STEM: [RegExp, string][] = [[/^арм/, 'армия'], [/^корпус/, 'корпус'], [/^дивиз/, 'дивизия'], [/^фронт/, 'фронт'], [/^групп/, 'группа']];

/** Номер и значимые слова названия (без скобок, с раскрытыми сокращениями). */
function parts(name: string): { num?: number; words: string[] } {
  const raw = name.replace(/\(.*?\)/g, ' ').split(/[\s\-«»"“”.,/;:]+/).filter(Boolean);
  const t = raw.map((w) => norm(w));
  let num: number | undefined;
  const words: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = roman(raw[i]);
    if (r !== null && raw[i].length >= 1 && !/^\p{Script=Cyrillic}/u.test(raw[i])) { num ??= r; continue; }
    const n = numberAt(t, i);
    if (n) { num ??= n.n; i += n.len - 1; continue; }
    const abbr = ABBR[t[i]];
    if (abbr && (t[i] !== 'а' || i === raw.length - 1 || /^[А-Я]+$/.test(raw[i]))) { words.push(...abbr); continue; }
    if (!t[i] || STOP.has(t[i]) || /^\d+$/.test(t[i])) continue;
    const stem = stems(t[i])[0];
    words.push(TYPE_STEM.find(([re]) => re.test(stem))?.[1] ?? stem);
  }
  return { num, words };
}
const wordMatch = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) || wordDist(a, b) !== null;

/**
 * Соединение по названию: номер словами или цифрами («восьмая», «8-я», «29-й»), порядок слов любой,
 * сокращения («гв.», «ск», «ТА»). Одно подходящее — unit; несколько — 2–3 options; нет — пусто.
 * Номер без уточнения читается как армия («восьмая гвардейская» — 8-я гвардейская армия).
 */
export function findUnit<U extends { id: string; name: string }>(text: string, units: U[]): { unit?: U; options: U[] } {
  const q = parts(text);
  if (q.num === undefined && q.words.every((w) => GENERIC.has(w))) return { options: [] };
  const exact = norm(text);
  const scored: { u: U; s: number }[] = [];
  for (const u of units) {
    if (norm(u.name.replace(/\(.*?\)/g, ' ')) === exact) return { unit: u, options: [] };
    const d = parts(u.name);
    if (q.num !== undefined && d.num !== q.num) continue;
    const used = new Set<number>();
    let ok = true;
    for (const w of q.words) {
      const j = d.words.findIndex((x, k) => !used.has(k) && wordMatch(w, x));
      if (j < 0) { ok = false; break; }
      used.add(j);
    }
    if (!ok) continue;
    let s = q.words.length;
    d.words.forEach((w, k) => { if (!used.has(k)) s -= w in TYPE_RANK ? (q.words.some((x) => x in TYPE_RANK) ? 0.5 : TYPE_RANK[w]) : 0.25; });
    scored.push({ u, s });
  }
  if (!scored.length) return { options: [] };
  scored.sort((a, b) => b.s - a.s);
  if (scored.length === 1 || scored[0].s - scored[1].s >= 0.15) return { unit: scored[0].u, options: [] };
  const top = scored[0].s;
  return { options: scored.filter((x) => top - x.s < 0.15).slice(0, MAX_OPTIONS).map((x) => x.u) };
}
