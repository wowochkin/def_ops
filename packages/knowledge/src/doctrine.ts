/**
 * Доктрина в базе: правила «условие → действие» с числами (вид факта `doctrine`) — группы, ступени, числа правила,
 * правило словами и ключ закрепления.
 */
import type { Claim, Entry, Fact, Reliability } from './schema';
import { claimFacts, pinKey, resolve, subjectOf, type Pins } from './resolve';
import { stems } from './search';

export type DoctrineClaim = Extract<Claim, { kind: 'doctrine' }>;

/** Группы правил доктрины (как в сводах docs/sources/*-doctrine-1945*.json). */
export const DOCTRINE_GROUPS: Record<string, string> = {
  frontage: 'ширина полос и участков прорыва', echelons: 'построение в эшелоны', depth: 'глубина задач', tempo: 'темп наступления',
  commit: 'ввод вторых эшелонов и подвижных групп', stop: 'остановка и переход к обороне', bypass: 'обход узлов обороны', regroup: 'перегруппировка',
  reserve: 'резервы', artillery: 'артиллерийское наступление', air: 'авиационное обеспечение', layout: 'построение обороны',
  counterattack: 'контратаки и контрудары', withdrawal: 'отход и отвод с первой позиции', reserves: 'резервы обороны', timing: 'сроки',
};

export const DOCTRINE_LEVELS = ['front', 'army', 'corps', 'division'] as const;
export const LEVEL_RU: Record<DoctrineClaim['level'], string> = { front: 'фронт', army: 'армия', corps: 'корпус', division: 'дивизия' };

type Value = number | [number, number];
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** Число или пара конечных чисел (диапазон «от–до», «от» не больше «до»); прочее — undefined. */
const valueOf = (x: unknown): Value | undefined => num(x) ? x
  : Array.isArray(x) && x.length === 2 && num(x[0]) && num(x[1]) && x[0] <= x[1] ? [x[0], x[1]] : undefined;

/**
 * Числа правила из свода или извлечения: число или пара (ключ value); словарь — его числа и пары, вложенный словарь —
 * плоскими ключами «ключ.подключ». Строки, null, логические, списки не из двух чисел, пары с «до» меньше «от»
 * (не диапазон, а перечень), глубже одного вложения — отбрасываются. Ничего не осталось — undefined.
 */
export function doctrineValues(raw: unknown): DoctrineClaim['values'] | undefined {
  const out: Record<string, Value> = {};
  const top = valueOf(raw);
  if (top !== undefined) out.value = top;
  else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const x = valueOf(v);
      if (x !== undefined) { out[k] = x; continue; }
      if (v && typeof v === 'object' && !Array.isArray(v))
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) { const y = valueOf(v2); if (y !== undefined) out[`${k}.${k2}`] = y; }
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const ru = (n: number) => String(n).replace('.', ',');
/** Число или диапазон правила словами: 0,33; 2–4. */
export const doctrineValueRu = (v: Value): string => Array.isArray(v) ? `${ru(v[0])}–${ru(v[1])}` : ru(v);

/** Правило словами: «Доктрина (нем., корпус, контратаки и контрудары): условие → действие; имя число, имя от–до». */
export function doctrineWords(c: DoctrineClaim): string {
  const head = `Доктрина (${c.side === 'de' ? 'нем.' : 'сов.'}, ${LEVEL_RU[c.level] ?? c.level}, ${DOCTRINE_GROUPS[c.group] ?? c.group})`;
  const body = c.condition ? `${c.condition} → ${c.action}` : c.action;
  const nums = Object.entries(c.values ?? {}).map(([k, v]) => `${k} ${doctrineValueRu(v)}`).join(', ');
  return `${head}: ${body}${nums ? `; ${nums}` : ''}`;
}

/** Ключ закрепления правила доктрины: doctrine|сторона:правило| (без даты). */
export const doctrineKey = (side: 'su' | 'de', rule: string): string => pinKey('doctrine', `${side}:${rule}`, '');

/** Триггеры обстановки для отбора доктрины: окружение своих, вклинение противника, давление, свой удар, резервы в тылу. */
export type DoctrineTrigger = 'encircled' | 'penetration' | 'pressure' | 'attack' | 'reserves';
/** Группы доктрины по триггеру и стороне (в порядке важности). */
export const TRIGGER_GROUPS: Record<DoctrineTrigger, Record<'su' | 'de', string[]>> = {
  encircled: { de: ['withdrawal', 'counterattack'], su: ['bypass'] },
  penetration: { de: ['counterattack', 'reserves'], su: ['reserve', 'stop'] },
  pressure: { de: ['withdrawal', 'layout'], su: ['stop', 'regroup'] },
  attack: { de: ['counterattack'], su: ['echelons', 'commit', 'tempo', 'depth'] },
  reserves: { de: ['reserves'], su: ['reserve', 'commit'] },
};
/** Группы без триггеров: построение обороны / ширина полос и эшелоны. */
export const DEFAULT_GROUPS: Record<'su' | 'de', string[]> = { de: ['layout'], su: ['frontage', 'echelons'] };

const MONTHS_RU = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Даты в тексте (ISO-дни): 1945-04-18; 18.04.1945 (и 18.04.45); 18.04; «18 апреля» (и с годом); 18-apr (как в id
 * правил). Без года — год момента, прошлого или следующего, ближайший к моменту. Число не дата (день 0, месяц 00,
 * десятичная дробь с одной цифрой после точки) — пропускается.
 */
export function datesIn(text: string, moment: string): string[] {
  const day = moment.slice(0, 10), year = Number(moment.slice(0, 4));
  const out: string[] = [];
  const ok = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31;
  const near = (m: number, d: number) => {
    const t = Date.parse(day);
    return [year - 1, year, year + 1].map((y) => iso(y, m, d)).sort((a, b) => Math.abs(Date.parse(a) - t) - Math.abs(Date.parse(b) - t))[0];
  };
  const push = (d: number, m: number, y?: number) => { if (ok(m, d)) out.push(y ? iso(y, m, d) : near(m, d)); };
  for (const x of text.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) push(+x[3], +x[2], +x[1]);
  for (const x of text.matchAll(/(?<![\d.])(\d{1,2})\.(\d{2})(?:\.(\d{4}|\d{2}))?(?![\d]|\.\d)/g))
    push(+x[1], +x[2], x[3] ? (x[3].length === 2 ? 1900 + +x[3] : +x[3]) : undefined);
  for (const x of text.toLowerCase().matchAll(/(?<!\d)(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+(\d{4}))?/g))
    push(+x[1], MONTHS_RU.findIndex((m) => x[2].startsWith(m)) + 1, x[3] ? +x[3] : undefined);
  for (const x of text.toLowerCase().matchAll(/(?<![\da-z])(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?![a-z])/g))
    push(+x[1], MONTHS_EN.indexOf(x[2]) + 1);
  return out;
}

/**
 * Факт доктрины написан позже момента хода: в условии, действии, id правила, тексте факта или страницах источника есть
 * дата позже дня момента (правило — приказ или опыт после хода; штаб его знать не может). Без момента — false.
 */
export function doctrineAfter(f: Pick<Fact, 'value' | 'pages' | 'claim'>, moment?: string): boolean {
  if (!moment || f.claim?.kind !== 'doctrine') return false;
  const c = f.claim;
  const day = moment.slice(0, 10);
  return datesIn([c.rule, c.condition, c.action, f.value, f.pages ?? ''].join('\n'), moment).some((d) => d > day);
}

/** По кругу по группам 0…n-1 (в каждой — прежний порядок), затем элементы вне групп (g < 0). */
function roundRobin<T extends { g: number }>(xs: T[], n: number): T[] {
  const by = Array.from({ length: n }, (_, g) => xs.filter((x) => x.g === g));
  const out: T[] = [];
  for (let k = 0; by.some((l) => l.length > k); k++) for (const l of by) if (l[k]) out.push(l[k]);
  return [...out, ...xs.filter((x) => x.g < 0)];
}

/** Правило доктрины для промпта: адрес факта, ключ закрепления, правило, надёжность, заголовок записи, строка. */
export interface DoctrineRule { entry: string; index: number; key: string; claim: DoctrineClaim; reliability?: Reliability; title: string; line: string }

const REL = { A: 0, B: 1, C: 2 } as const;

/**
 * Доктрина стороны к обстановке: по каждому правилу — один факт (закрепление → надёжность → свежесть; 'none' — правила
 * нет), отбор по ступеням; сначала правила групп триггеров (по порядку групп, затем по числу общих с запросом основ,
 * надёжности, имени правила), затем — правила других групп, у которых есть общие с запросом основы. Берутся по порядку,
 * пока правил не больше max и текст не длиннее chars; первое правило длиннее предела обрезается с «…». moment — момент
 * хода: правила с датой позже его дня не берутся (doctrineAfter); spread — группы триггеров по кругу.
 */
export function doctrineFor(entries: Entry[], pins: Pins, side: 'su' | 'de', triggers: DoctrineTrigger[], query: string,
  o: { levels?: DoctrineClaim['level'][]; max?: number; chars?: number; moment?: string; spread?: boolean } = {}): { rules: DoctrineRule[]; text: string } {
  const max = o.max ?? 8, chars = o.chars ?? 4000;
  const facts = claimFacts(entries).filter((f) => f.fact.claim!.kind === 'doctrine' && (f.fact.claim as DoctrineClaim).side === side && !doctrineAfter(f.fact, o.moment));
  const titles = new Map(entries.map((e) => [e.id, e.title]));
  const q = new Set(stems(query));
  const groups = triggers.length ? [...new Set(triggers.flatMap((t) => TRIGGER_GROUPS[t][side]))] : DEFAULT_GROUPS[side];

  const picked: (DoctrineRule & { g: number; common: number })[] = [];
  for (const subject of new Set(facts.map((f) => subjectOf(f.fact.claim!)))) {
    const chosen = resolve(facts, 'doctrine', subject, '', pins).chosen;
    if (!chosen) continue;
    const claim = chosen.fact.claim as DoctrineClaim;
    if (o.levels && !o.levels.includes(claim.level)) continue;
    const g = groups.indexOf(claim.group);
    const common = new Set(stems(`${claim.condition} ${claim.action}`).filter((w) => q.has(w))).size;
    if (g < 0 && common === 0) continue;
    const reliability = chosen.fact.reliability;
    picked.push({
      entry: chosen.entry, index: chosen.index, key: pinKey('doctrine', subject, ''), claim, ...(reliability ? { reliability } : {}),
      title: titles.get(chosen.entry) ?? chosen.entry, line: `${doctrineWords(claim)}${reliability ? ` [${reliability}]` : ''}`, g, common,
    });
  }
  const order = (x: { g: number }) => x.g < 0 ? groups.length : x.g;
  picked.sort((a, b) => order(a) - order(b) || b.common - a.common
    || (a.reliability ? REL[a.reliability] : 3) - (b.reliability ? REL[b.reliability] : 3)
    || (a.claim.rule < b.claim.rule ? -1 : a.claim.rule > b.claim.rule ? 1 : 0));
  // spread: правила групп триггеров по кругу (первое каждой группы, второе каждой…), чтобы одна большая группа
  // не заняла все места; правила других групп — после
  const ordered = o.spread ? roundRobin(picked, groups.length) : picked;

  const rules: DoctrineRule[] = [];
  let len = 0;
  for (const { g: _g, common: _c, ...r } of ordered) {
    if (rules.length >= max) break;
    const item = `- ${r.line}`;
    const add = (rules.length ? 1 : 0) + item.length;
    if (len + add > chars) {
      // первое правило длиннее предела — обрезается, чтобы доктрина не пропала совсем
      if (!rules.length) rules.push({ ...r, line: `${item.slice(0, chars - 1)}…`.slice(2) });
      break;
    }
    rules.push(r);
    len += add;
  }
  return { rules, text: rules.map((r) => `- ${r.line}`).join('\n') };
}
