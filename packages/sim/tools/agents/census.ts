/**
 * Перепись агентов уровня дивизии для Берлинской операции (16.04–8.05.1945): что о каждой дивизии
 * реестра (docs/sources/berlin-1945-divisions.json) есть в наборах данных — численность, танки и
 * орудия (с лучшей достоверностью и датой), положения по дням, в каких наборах она встречается,
 * сколько раз названа в выписках ЦАМО. Данные не меняет, пишет отчёт.
 *
 *   npm run sim:census -- [--registry docs/sources/berlin-1945-divisions.json] [--doc docs/plans/agents-census.md]
 *                         [--json evals-out/census/census.json]
 *
 * Сопоставление: формирование набора относится к дивизии, если его id есть в реестре (id или aliases);
 * положения подчинённых формирований (бригад корпуса, полков, боевых групп дивизии) засчитываются
 * дивизии отдельно — «по частям». Упоминания в ЦАМО ищутся по обозначениям реестра (abbr — «250 сд»,
 * «11 гв. тк», «309 пд») и ключевым словам немецких дивизий («Мюнхеберг»).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeResolver, parseTokens, type Div, type Registry, type Rel } from './designations';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const registryPath = resolve(ROOT, opt('registry', 'docs/sources/berlin-1945-divisions.json')!);
const docOut = resolve(ROOT, opt('doc', 'docs/plans/agents-census.md')!);
const jsonOut = opt('json');

// ---------- типы ----------
interface Formation { id: string; parent?: string | null; side?: string; echelon?: string; name_ru?: string; [k: string]: unknown }
interface Position { formation: string; date: string; time?: string | null; approx_km?: number; reliability?: string; source?: string }
interface DataSet { formations: Formation[]; positions?: Position[]; source?: Record<string, { default_reliability?: string }>; sources?: Record<string, { default_reliability?: string }> }

interface Strength { kind: 'personnel' | 'tanks' | 'guns'; value: number; reliability: Rel; date: string | null; source: string; set: string; note?: string }
interface PosRec { date: string; set: string; own: boolean; approxKm: number | null; fallback?: boolean }
interface Mention { file: string; date: string | null }
interface Row {
  div: Div; sets: Set<string>; strength: Strength[]; pos: PosRec[]; corpsDays: Set<string>; mentions: Mention[];
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as T;
const reg = readJson<Registry>(registryPath);

const SETS: { key: string; file: string; label: string; kind?: 'tsamo' }[] = [
  { key: 'seelow', file: 'docs/sources/berlin-1945-seelow-divisions.json', label: 'seelow' },
  { key: 'halbe', file: 'docs/sources/berlin-1945-halbe.json', label: 'halbe' },
  { key: 'conquest', file: 'docs/sources/berlin-1945-conquest.json', label: 'conquest' },
  { key: 'positions', file: 'docs/sources/berlin-1945-positions.json', label: 'positions' },
  { key: 'city', file: 'docs/sources/berlin-1945-city-garrison.json', label: 'city' },
  { key: 'reichstag', file: 'docs/sources/berlin-1945-reichstag.json', label: 'reichstag' },
  // положения дивизий и корпусов, геокодированные из текста выписок ЖБД (npm run sim:geocode-tsamo)
  { key: 'tsamo-div', file: 'docs/sources/berlin-1945-tsamo/division-positions.json', label: 'tsamo-div', kind: 'tsamo' },
];
const TSAMO = {
  positions: 'docs/sources/berlin-1945-tsamo/positions.json',
  orders: 'docs/sources/berlin-1945-tsamo/orders.json',
  enemy: 'docs/sources/berlin-1945-tsamo/enemy.json',
};
const SCENARIO = 'packages/sim/data/scenarios/berlin-1945.json';

// дни операции
const DAYS: string[] = [];
for (let t = Date.UTC(1945, 3, 16); t <= Date.UTC(1945, 4, 8); t += 86400000) DAYS.push(new Date(t).toISOString().slice(0, 10));
const inOp = (d: string) => d >= DAYS[0] && d <= DAYS[DAYS.length - 1];

// ---------- реестр ----------
const rows = new Map<string, Row>();
const aliasOf = new Map<string, string>();
for (const d of reg.divisions) {
  rows.set(d.id, { div: d, sets: new Set(), strength: [], pos: [], corpsDays: new Set(), mentions: [] });
  aliasOf.set(d.id, d.id);
  for (const a of d.aliases) aliasOf.set(a, d.id);
}

// ---------- наборы: присутствие, численность, положения ----------
const REL_ORDER: Record<string, number> = { A: 3, B: 2, C: 1 };
const asRel = (r: unknown, dflt: Rel): Rel => (r === 'A' || r === 'B' || r === 'C' ? r : dflt);
const isoFromDdMm = (dd: string, mm: string) => `1945-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
const num = (s: string) => Number(s.replace(/[\s  ]/g, ''));

function kindOfKey(key: string): Strength['kind'] | null {
  if (/men|personnel|чел/i.test(key)) return 'personnel';
  if (/tank|tiger|panther|stug|pz|spg|sau/i.test(key)) return 'tanks';
  if (/gun|art/i.test(key)) return 'guns';
  return null;
}

/** Численность из полей формирования набора (у наборов разный формат). */
function strengthOf(f: Formation, set: string, dflt: Rel): Strength[] {
  const out: Strength[] = [];
  const obj = (kind: Strength['kind'], v: unknown, key: string = kind) => {
    if (!v || typeof v !== 'object') return;
    const o = v as { value?: unknown; reliability?: unknown; date?: unknown; source?: unknown; note?: unknown };
    if (typeof o.value !== 'number') return;
    const m = /_(\d\d)_(\d\d)$/.exec(key);
    out.push({
      kind, value: o.value, reliability: asRel(o.reliability, dflt),
      date: typeof o.date === 'string' ? o.date : m ? isoFromDdMm(m[1], m[2]) : null,
      source: typeof o.source === 'string' ? o.source : set, set, note: typeof o.note === 'string' ? o.note : undefined,
    });
  };
  obj('personnel', f.personnel); obj('tanks', f.tanks); obj('guns', f.guns);
  const s16 = f.strength_16_04 as Record<string, unknown> | undefined;
  if (s16) { obj('personnel', s16.personnel); obj('tanks', s16.tanks_spg); obj('guns', s16.guns); }
  const st = f.strength;
  if (st && typeof st === 'object') {
    for (const [k, v] of Object.entries(st as Record<string, unknown>)) { const kind = kindOfKey(k); if (kind) obj(kind, v, k); }
  } else if (typeof st === 'string') {
    const dm = /\((\d{1,2})\.(\d\d)\)|на (\d{1,2})\.(\d\d)/.exec(st);
    const date = dm ? isoFromDdMm(dm[1] ?? dm[3], dm[2] ?? dm[4]) : null;
    const pm = /(\d{1,3}(?:[\s ]\d{3})+|\d+)\s*чел/.exec(st);
    // число из свободного текста (может относиться к части дивизии) — не выше C
    if (pm) out.push({ kind: 'personnel', value: num(pm[1]), reliability: 'C', date, source: set, set, note: `из текста: ${st}` });
    let tanks = 0;
    for (const m of st.matchAll(/(\d+)\s*(?:«?Тигр|Pz|танк|САУ|штурмов)/g)) tanks += Number(m[1]);
    if (tanks) out.push({ kind: 'tanks', value: tanks, reliability: 'C', date, source: set, set, note: `из текста: ${st}` });
  }
  if (typeof f.share === 'number') {
    out.push({ kind: 'personnel', value: Math.round(f.share * 60000), reliability: 'C', date: null, source: set, set, note: 'доля от ~60 000 гарнизона' });
  }
  return out;
}

/** Численность дивизий из примечаний корпусов seelow: «60 сд — 4210», «230 сд (5 032)». */
function corpsNoteStrength(f: Formation, set: string): { key: string; s: Strength }[] {
  const p = f.personnel as { note?: string; reliability?: string; date?: string; source?: string } | null | undefined;
  if (!p?.note) return [];
  const out: { key: string; s: Strength }[] = [];
  for (const m of p.note.matchAll(/(\d+)\s*(гв\.\s*)?сд\s*(?:—\s*|\(\s*)(\d[\d\s ]*\d|\d)(?![\d])/g)) {
    out.push({
      key: `su_${m[1]}${m[2] ? 'gsd' : 'sd'}`,
      s: { kind: 'personnel', value: num(m[3]), reliability: asRel(p.reliability, 'B'), date: p.date ?? null, source: p.source ?? set, set, note: `по ведомости корпуса ${f.id}` },
    });
  }
  return out;
}

/** Нормализованный id стрелкового (кавалерийского) корпуса: su_47a_77rk → su_77sk, su_8gva_28gsk → su_28gsk, su_7gkk. */
function corpsKey(id: string): string | null {
  const m = /^su_(?:[a-z0-9]+_)?(\d+)(g|gv)?(sk|rk|kk)$/.exec(id);
  if (m) return `su_${m[1]}${m[2] ? 'g' : ''}${m[3] === 'kk' ? 'kk' : 'sk'}`;
  return id.startsWith('de_') ? id : null;
}

const corpsPos = new Map<string, Set<string>>(); // корпус → дни
const setFormations = new Map<string, number>();
/** Набор tsamo-div: записи с полем formation (id реестра или корпуса), echelon, date, approxKm. */
interface TsamoDivPos { formation: string; echelon: 'division' | 'corps'; date: string; approxKm: number; reliability: string; fallback?: 'army' }
function addTsamoDiv(s: { key: string; file: string }): number {
  const d = readJson<{ positions: TsamoDivPos[] }>(s.file);
  const seen = new Set<string>();
  for (const p of d.positions) {
    if (p.echelon === 'corps') {
      const ck = corpsKey(p.formation);
      if (ck) { if (!corpsPos.has(ck)) corpsPos.set(ck, new Set()); if (inOp(p.date)) corpsPos.get(ck)!.add(p.date); }
    }
    const id = aliasOf.get(p.formation);
    if (!id) continue;
    seen.add(id);
    // положение по координатам армии (пункты не найдены) — не положение дивизии: учитывается только в статистике набора
    rows.get(id)!.pos.push({ date: p.date, set: s.key, own: !p.fallback, approxKm: p.approxKm, fallback: !!p.fallback });
    rows.get(id)!.sets.add(s.key);
  }
  return seen.size;
}

for (const s of SETS) {
  if (s.kind === 'tsamo') { setFormations.set(s.key, addTsamoDiv(s)); continue; }
  const d = readJson<DataSet>(s.file);
  const srcs = d.source ?? d.sources ?? {};
  const dflt = asRel(Object.values(srcs)[0]?.default_reliability, 'B');
  const byId = new Map(d.formations.map((f) => [f.id, f]));
  // части: формирование не из реестра, но его старший по цепочке — дивизия реестра
  const compOf = new Map<string, string>();
  for (const f of d.formations) {
    if (aliasOf.has(f.id)) continue;
    let p = f.parent ? byId.get(f.parent) : undefined;
    for (let guard = 0; p && guard < 10; guard++) {
      const a = aliasOf.get(p.id);
      if (a) { compOf.set(f.id, a); break; }
      p = p.parent ? byId.get(p.parent) : undefined;
    }
  }
  let n = 0;
  for (const f of d.formations) {
    const a = aliasOf.get(f.id);
    if (a) { n++; const r = rows.get(a)!; r.sets.add(s.key); r.strength.push(...strengthOf(f, s.key, dflt)); }
    if (f.echelon === 'corps') for (const { key, s: st } of corpsNoteStrength(f, s.key)) rows.get(key)?.strength.push(st);
  }
  setFormations.set(s.key, n);
  for (const p of d.positions ?? []) {
    if (!p.date) continue;
    const ck = corpsKey(p.formation);
    if (ck && byId.get(p.formation)?.echelon === 'corps') {
      if (!corpsPos.has(ck)) corpsPos.set(ck, new Set());
      if (inOp(p.date)) corpsPos.get(ck)!.add(p.date);
    }
    const own = aliasOf.get(p.formation);
    const comp = own ? undefined : compOf.get(p.formation);
    const id = own ?? comp;
    if (!id) continue;
    rows.get(id)!.pos.push({ date: p.date, set: s.key, own: !!own, approxKm: typeof p.approx_km === 'number' ? p.approx_km : null });
    rows.get(id)!.sets.add(s.key);
  }
}
for (const r of rows.values()) {
  const c = r.div.subordination[0]?.corps;
  if (c) for (const day of corpsPos.get(c) ?? []) r.corpsDays.add(day);
}

// ---------- выписки ЦАМО: упоминания ----------
interface TsamoRec { file: keyof typeof TSAMO; date: string | null; army?: string; source?: string; texts: string[] }
const tsamo: TsamoRec[] = [];
{
  const pos = readJson<Record<string, unknown>[]>(TSAMO.positions);
  for (const r of pos) tsamo.push({ file: 'positions', date: (r.date as string) ?? null, army: r.army as string, source: r.source as string, texts: [r.place, r.note].filter((x): x is string => typeof x === 'string') });
  const ord = readJson<Record<string, unknown>[]>(TSAMO.orders);
  for (const r of ord) tsamo.push({ file: 'orders', date: (r.issued as string) ?? null, army: r.to as string, texts: [r.target, r.note, r.quote].filter((x): x is string => typeof x === 'string') });
  const en = readJson<Record<string, unknown>[]>(TSAMO.enemy);
  for (const r of en) tsamo.push({ file: 'enemy', date: (r.date as string) ?? null, texts: [r.formation, r.strengthNote, r.place, r.note].filter((x): x is string => typeof x === 'string') });
}

const resolveUnit = makeResolver(reg);

const unknownSu = new Map<string, { n: number; armies: Set<string> }>();
const unknownDe = new Map<string, number>();
function scan(rec: TsamoRec): Set<string> {
  const hit = new Set<string>();
  const enemy = rec.file === 'enemy';
  for (const text of rec.texts) {
    for (const tok of parseTokens(text)) {
      for (const u of tok.units) {
        const r = resolveUnit(u, enemy);
        if (r.id) { hit.add(r.id); continue; }
        if (r.corps) continue;
        if (r.side === 'de') unknownDe.set(u.label, (unknownDe.get(u.label) ?? 0) + 1);
        else if (r.side === 'su' && ['сд', 'вдд', 'кд', 'тк', 'мк'].includes(u.type)) {
          const un = unknownSu.get(u.label) ?? { n: 0, armies: new Set<string>() };
          un.n++; if (rec.army) un.armies.add(rec.army); unknownSu.set(u.label, un);
        }
      }
    }
    for (const d of reg.divisions) if (d.keywords?.some((k) => text.includes(k))) hit.add(d.id);
  }
  return hit;
}
const tsamoArmyRecs = new Map<string, number>(); // записи positions по армиям
const tsamoFonds = new Map<string, Set<string>>(); // армия → «ф. 233, оп. 2356, д. 739»
for (const rec of tsamo) {
  if (rec.file === 'positions' && rec.army) {
    tsamoArmyRecs.set(rec.army, (tsamoArmyRecs.get(rec.army) ?? 0) + 1);
    const fm = /ф\.\s*\d+,\s*оп\.\s*\d+,\s*д\.\s*\d+/.exec(rec.source ?? '');
    if (fm) { if (!tsamoFonds.has(rec.army)) tsamoFonds.set(rec.army, new Set()); tsamoFonds.get(rec.army)!.add(fm[0]); }
  }
  for (const id of scan(rec)) rows.get(id)!.mentions.push({ file: rec.file, date: rec.date });
}

// ---------- сводка ----------
const scenario = readJson<{ formations: { id: string; name: string; echelon: string }[] }>(SCENARIO);
const scenarioIds = new Set(scenario.formations.map((f) => f.id));
const NAMES: Record<string, string> = Object.fromEntries(scenario.formations.map((f) => [f.id, f.name]));
Object.assign(NAMES, {
  su_31a: '31-я армия', su_5gta: '5-я гвардейская танковая армия', su_59a: '59-я армия',
  de_berlin: 'Берлинский оборонительный район', de_12a: NAMES.de_12a ?? '12-я армия',
});
const FRONT_ORDER = ['su_1bf', 'su_1uf', 'su_2bf', 'de_hgr_weichsel', 'de_hgr_mitte', 'de_12a', 'de_berlin'];

const all = [...rows.values()];
const best = (r: Row, k: Strength['kind']): Strength | undefined =>
  r.strength.filter((s) => s.kind === k).sort((a, b) => (REL_ORDER[b.reliability] - REL_ORDER[a.reliability]) || (a.date ?? '9').localeCompare(b.date ?? '9'))[0];
const daysOwn = (r: Row) => new Set(r.pos.filter((p) => p.own && inOp(p.date)).map((p) => p.date));
const daysAll = (r: Row) => new Set(r.pos.filter((p) => !p.fallback && inOp(p.date)).map((p) => p.date));
const hasPers = (r: Row) => !!best(r, 'personnel');
const hasAnyStr = (r: Row) => r.strength.length > 0;
const nothing = (r: Row) => !hasAnyStr(r) && daysAll(r).size === 0 && r.mentions.length === 0;

/** Группа (армия) для таблиц: армия по первой записи подчинения; без армии — фронтовые / Берлин. */
function groupOf(d: Div): string {
  const s = d.subordination[0];
  if (s.army) return s.army;
  if (s.corps === 'de_berlin') return 'de_berlin';
  return `${s.front ?? '?'}:front`;
}
function frontOf(d: Div): string {
  const s = d.subordination[0];
  if (s.corps === 'de_berlin') return 'de_berlin';
  if (s.army === 'de_12a') return 'de_12a';
  return s.front ?? (s.army === 'de_12a' ? 'de_12a' : '?');
}
/** Краткое имя немецкого корпуса по сценарию: «XI танковый корпус СС» → «XI тк СС». */
const deCorps = (id: string) => (NAMES[id] ?? id)
  .replace(/Корпусная группа/, 'кгр').replace(/Армейский корпус/, 'ак').replace(/Танковый корпус/, 'тк')
  .replace(/армейский корпус/, 'ак').replace(/танковый корпус/, 'тк').replace(/горный корпус/, 'гк')
  .replace(/Берлинский оборонительный район.*/, 'Берлинский ОР').replace(/ \/ армейская группа Штайнера/, '');
const groupName = (g: string) => g.endsWith(':front') ? `${NAMES[g.split(':')[0]] ?? g.split(':')[0]}: фронтовые соединения` : NAMES[g] ?? g;

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 100, b = n % 10;
  return a >= 11 && a <= 14 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : '—');
const fmtN = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fmtD = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : 'б/д');
const fmtS = (s?: Strength) => (s ? `${fmtN(s.value)} (${s.reliability}, ${fmtD(s.date)})` : '—');
const TYPE_RU: Record<string, string> = {
  sd: 'стрелковые дивизии', vdd: 'воздушно-десантные дивизии', tk: 'танковые корпуса', mk: 'механизированные корпуса',
  kd: 'кавалерийские дивизии', ur: 'укреплённые районы', brigade: 'отдельные бригады', art: 'артиллерийские дивизии',
  pd: 'пехотные дивизии ВП', div: 'дивизии', kg: 'боевые группы, отдельные батальоны', stug: 'бригады штурмовых орудий', garrison: 'гарнизоны',
};
const SIDE_RU = { su: 'Красная армия и Войско Польское', de: 'Германия' };

function statRow(label: string, rs: Row[]): string {
  const c = (f: (r: Row) => boolean) => rs.filter(f).length;
  return `| ${label} | ${rs.length} | ${c(hasPers)} | ${c((r) => !!best(r, 'tanks'))} | ${c((r) => !!best(r, 'guns'))} | ${c((r) => daysOwn(r).size > 0)} | ${c((r) => daysAll(r).size > 0)} | ${c((r) => daysAll(r).size === 0 && r.corpsDays.size > 0)} | ${c((r) => r.mentions.length > 0)} | ${c(nothing)} |`;
}

const L: string[] = [];
L.push('# Перепись агентов уровня дивизии: Берлинская операция 16.04–8.05.1945', '');
L.push('Что есть в данных о каждом будущем агенте-дивизии (план — [agents.md](agents.md)). Ожидаемый состав — реестр',
  '`docs/sources/berlin-1945-divisions.json` (боевой состав по OOB: «Боевой состав СА», ч. V, на 1.04.45, у 3, 28, 31 А — на 1.05.45;',
  'немцы — OOB, раздел 2, и наборы по Зееловским высотам, Хальбе и гарнизону Берлина). Наборы: seelow, halbe, conquest, positions,',
  'city, reichstag (`docs/sources/berlin-1945-*.json`), tsamo-div (из выписок); выписки ЦАМО — `docs/sources/berlin-1945-tsamo/`. Собирается',
  '`npm run sim:census`, данные не меняет.', '');
L.push('Как читать: «положение» — точка формирования в наборе за день операции; «по частям» — положение подчинённой части',
  '(бригады корпуса, полка, боевой группы дивизии); «корпус» — есть только положение стрелкового корпуса, в который входит',
  'дивизия по OOB. Численность — лучшая по достоверности (A > B > C), при равной — более ранняя запись. Упоминания ЦАМО —',
  'число записей выписок, где дивизия названа по обозначению («250 сд», «11 гв. тк», «309 пд», «Мюнхеберг»). Набор tsamo-div —',
  'положения дивизий и корпусов, извлечённые из текста выписок и геокодированные (`berlin-1945-tsamo/division-positions.json`,',
  '`npm run sim:geocode-tsamo`); положение по координатам армии (пункт не найден, достоверность C) тоже считается положением.', '');

// 1. Сводка
L.push('## 1. Сводка', '');
L.push('| Сторона, тип | Ожидается | Численность (люди) | Танки | Орудия | Положение (своё) | Положение (с частями) | Только корпус | В выписках ЦАМО | Нет ничего |',
  '|---|---|---|---|---|---|---|---|---|---|');
for (const side of ['su', 'de'] as const) {
  const rs = all.filter((r) => r.div.side === side);
  L.push(statRow(`**${SIDE_RU[side]}**`, rs));
  const types = [...new Set(rs.map((r) => r.div.type))];
  for (const t of types) L.push(statRow(`— ${(side === 'de' && t === 'art' ? 'народные артиллерийские корпуса' : TYPE_RU[t]) ?? t}`, rs.filter((r) => r.div.type === t)));
}
L.push(statRow('**Всего**', all), '');

const su = all.filter((r) => r.div.side === 'su'), de = all.filter((r) => r.div.side === 'de');
const divDays = (rs: Row[], f: (r: Row) => Set<string>) => rs.reduce((s, r) => s + f(r).size, 0);
L.push(`Покрытие дивизие-днями (${DAYS.length} ${plural(DAYS.length, 'день', 'дня', 'дней')} операции × число дивизий): Красная армия — ${pct(divDays(su, daysOwn), su.length * DAYS.length)} своими положениями, ` +
  `${pct(divDays(su, daysAll), su.length * DAYS.length)} с частями; Германия — ${pct(divDays(de, daysOwn), de.length * DAYS.length)} и ${pct(divDays(de, daysAll), de.length * DAYS.length)}.`, '');

// сверка с Кривошеевым / БС СА
const sdOf = (front: string, armies?: string[]) => su.filter((r) => ['sd', 'vdd'].includes(r.div.type) && frontOf(r.div) === front && (!armies || armies.includes(r.div.subordination[0].army ?? ''))).length;
L.push('Сверка числа стрелковых дивизий реестра со справочными итогами (OOB, разделы 1.1, 1.3–1.5):', '');
L.push('| Фронт | сд и вдд в реестре | Кривошеев (участвовавшие объединения) | «Боевой состав СА» по фронту целиком |', '|---|---|---|---|');
L.push(`| 1 БФ | ${sdOf('su_1bf')} | 72 | 63 на 1.04, 72 на 1.05 (с 3 А) |`);
L.push(`| 2 БФ | ${sdOf('su_2bf')} (без 19 А — ${sdOf('su_2bf', ['su_2ua', 'su_65a', 'su_70a', 'su_49a'])}) | 33 (без 19 А) | 45 на 1.04, 57 на 1.05 |`);
L.push(`| 1 УФ | ${sdOf('su_1uf')} (в т. ч. 28 и 31 А — ${sdOf('su_1uf', ['su_28a', 'su_31a'])}) | 44 + 9 (28 А) + 9 (31 А) | 68 и 1 вдд на 1.04, 77 на 1.05 (с левым крылом) |`, '');

// 2. Покрытие по дням
L.push('## 2. Покрытие по дням операции', '');
L.push('Число дивизий, у которых есть положение за день (в скобках — доля от ожидаемых по стороне).', '');
L.push(`| День | СССР: своё | СССР: с частями | СССР: с частями или корпусом | Германия: своё | Германия: с частями |`, '|---|---|---|---|---|---|');
for (const day of DAYS) {
  const c = (rs: Row[], f: (r: Row) => boolean) => { const n = rs.filter(f).length; return `${n} (${pct(n, rs.length)})`; };
  L.push(`| ${fmtD(day)} | ${c(su, (r) => daysOwn(r).has(day))} | ${c(su, (r) => daysAll(r).has(day))} | ${c(su, (r) => daysAll(r).has(day) || r.corpsDays.has(day))} | ${c(de, (r) => daysOwn(r).has(day))} | ${c(de, (r) => daysAll(r).has(day))} |`);
}
const before = all.filter((r) => r.pos.some((p) => p.date < DAYS[0])).length;
L.push('', `Дивизий с положением до 16.04 (исходным): ${before}. Положения по наборам (записей, отнесённых к дивизиям реестра): ` +
  SETS.map((s) => `${s.label} — ${all.reduce((n, r) => n + r.pos.filter((p) => p.set === s.key).length, 0)}`).join(', ') + '.', '');

// 3. По армиям
L.push('## 3. По армиям', '');
L.push('Столбцы: численность, танки, орудия — значение (достоверность, дата); положения — дней со своим положением / с частями,',
  'первый и последний день; «корпус» — дней с положением корпуса; наборы — где дивизия названа; ЦАМО — записей (дней).', '');
const groups = new Map<string, Row[]>();
for (const r of all) { const g = groupOf(r.div); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(r); }
const groupFront = (g: string) => frontOf(groups.get(g)![0].div);
const orderedGroups = [...groups.keys()].sort((a, b) => FRONT_ORDER.indexOf(groupFront(a)) - FRONT_ORDER.indexOf(groupFront(b)));
let lastFront = '';
for (const g of orderedGroups) {
  const rs = groups.get(g)!;
  const f = groupFront(g);
  if (f !== lastFront) { L.push(`### ${NAMES[f] ?? f}`, ''); lastFront = f; }
  const inScen = g.includes(':') || g === 'de_berlin' ? '' : scenarioIds.has(g) ? '' : ' — *нет в сценарии*';
  L.push(`#### ${groupName(g)}${inScen}`, '');
  L.push(`Агентов ${rs.length}; численность у ${rs.filter(hasPers).length}; хотя бы одно положение у ${rs.filter((r) => daysAll(r).size > 0).length}; в выписках ЦАМО — ${rs.filter((r) => r.mentions.length > 0).length}.`, '');
  L.push('| Дивизия | Корпус | Люди | Танки | Орудия | Положения | Корпус, дней | Наборы | ЦАМО |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of rs) {
    const d = r.div; const s0 = d.subordination[0];
    const own = daysOwn(r), allD = [...daysAll(r)].sort();
    const posTxt = allD.length ? `${own.size} / ${allD.length}: ${fmtD(allD[0])}–${fmtD(allD[allD.length - 1])}` : '—';
    const corps = s0.corps_name ?? (s0.corps?.startsWith('de_') ? deCorps(s0.corps) : '');
    const alt = d.subordination.length > 1 ? ' ⚠' : '';
    const md = new Set(r.mentions.map((m) => m.date).filter(Boolean));
    L.push(`| ${d.abbr[0] ?? d.name_ru} \`${d.id}\`${d.note ? ' ⚑' : ''} | ${corps || '—'}${alt} | ${fmtS(best(r, 'personnel'))} | ${fmtS(best(r, 'tanks'))} | ${fmtS(best(r, 'guns'))} | ${posTxt} | ${r.corpsDays.size || '—'} | ${[...r.sets].join(', ') || '—'} | ${r.mentions.length ? `${r.mentions.length} (${md.size})` : '—'} |`);
  }
  L.push('');
}
L.push('⚠ — у дивизии несколько записей подчинения (изменение по датам или расхождение OOB и Le Tissier); ⚑ — примечание в реестре (расхождение в наименовании).', '');

// 4. Пробелы
L.push('## 4. Главные пробелы', '');
L.push('### 4.1. Состав (из реестра)', '');
for (const gp of reg.gaps) L.push(`- **${gp.area}** (${gp.kind}). ${gp.text}`);
L.push('');
L.push('### 4.2. Дивизии, о которых нет ничего', '');
L.push('Ни численности, ни положения (своего или по частям), ни упоминания в выписках ЦАМО:', '');
for (const g of orderedGroups) {
  const rs = groups.get(g)!.filter(nothing);
  if (rs.length) L.push(`- ${groupName(g)} (${rs.length} из ${groups.get(g)!.length}): ${rs.map((r) => r.div.abbr[0] ?? r.div.name_ru).join(', ')}`);
}
L.push('');
L.push('### 4.3. Названы в выписках ЦАМО, но нет в реестре', '');
const suUnk = [...unknownSu.entries()].sort((a, b) => b[1].n - a[1].n);
L.push(`Советские (${suUnk.length}): ` + (suUnk.map(([k, v]) => `${k} — ${v.n} (${[...v.armies].join(', ')})`).join('; ') || 'нет') + '.', '');
L.push('Часть из них — дивизии армий, не участвовавших в операции (6 А у Бреслау), или номера, прочитанные из списков с другим типом;',
  'каждую нужно сверить с «Боевым составом СА» прежде, чем вносить в реестр.', '');
const deUnk = [...unknownDe.entries()].sort((a, b) => b[1] - a[1]);
L.push(`Германские (${deUnk.length}): ` + (deUnk.map(([k, n]) => `${k} — ${n}`).join('; ') || 'нет') + '.', '');
L.push('Это в основном соединения 4 ТА и 17 А перед 1 УФ, которых нет в OOB, и обозначения из советских разведсводок',
  '(«56 тк» в советском списке — немецкий LVI тк);',
  'их принадлежность к операции и номер (например, «337 пд» = 391 охранная дивизия) нужно сверить.', '');

// 5. Что добирать из ЦАМО
L.push('## 5. Что добирать из ЦАМО в первую очередь', '');
const TSAMO_ARMY: Record<string, string[]> = {
  su_61a: ['61 А'], su_1pa: ['1 ПА'], su_47a: ['47 А'], su_3ua: ['3 УА'], su_5ua: ['5 УА'], su_8gva: ['8 гв. А'], su_69a: ['69 А'],
  su_33a: ['33 А'], su_3a: ['3 А'], su_1gta: ['1 гв. ТА'], su_2gta: ['2 гв. ТА'], su_3gva: ['3 гв. А'], su_13a: ['13 А'],
  su_5gva: ['5 гв. А'], su_52a: ['52 А'], su_2pa: ['2 АВП', '2 А ВП'], su_3gta: ['3 гв. ТА'], su_4gta: ['4 гв. ТА'], su_28a: ['28 А'], su_31a: ['31 А'],
  'su_1bf:front': ['7 гв. кк', '2 гв. кк'], 'su_1uf:front': ['1 гв. кк'],
};
/** «ф. 236, оп. 2673, д. 2583» ×2 → «ф. 236, оп. 2673, д. 2583, 2609». */
function compressFonds(list: string[]): string[] {
  const by = new Map<string, Set<string>>();
  for (const x of list) {
    const m = /^(ф\.\s*\d+,\s*оп\.\s*\d+),\s*д\.\s*(\d+)$/.exec(x);
    if (!m) continue;
    if (!by.has(m[1])) by.set(m[1], new Set());
    by.get(m[1])!.add(m[2]);
  }
  return [...by].map(([k, v]) => `${k}, д. ${[...v].sort().join(', ')}`).sort();
}
interface Prio { g: string; n: number; withPos: number; cover: number; ment: number; recs: number; pers: number; fonds: string[] }
const prio: Prio[] = orderedGroups.filter((g) => groupFront(g).startsWith('su_')).map((g) => {
  const rs = groups.get(g)!;
  return {
    g, n: rs.length, withPos: rs.filter((r) => daysAll(r).size > 0).length,
    cover: divDays(rs, daysAll) / (rs.length * DAYS.length), ment: rs.filter((r) => r.mentions.length > 0).length,
    recs: (TSAMO_ARMY[g] ?? []).reduce((s, a) => s + (tsamoArmyRecs.get(a) ?? 0), 0), pers: rs.filter(hasPers).length,
    fonds: compressFonds((TSAMO_ARMY[g] ?? []).flatMap((a) => [...(tsamoFonds.get(a) ?? [])])),
  };
}).sort((a, b) => (b.n * (1 - b.cover)) - (a.n * (1 - a.cover)));
L.push('Советская сторона: армии по недостающим дивизие-дням (число дивизий × непокрытая доля дней).', '');
L.push('| Армия | Дивизий | С положением | Покрытие дивизие-дней | С численностью | Названы в выписках ЦАМО | Записей армии в выписках (дела) | Что делать |', '|---|---|---|---|---|---|---|---|');
for (const p of prio) {
  const unit = p.g.endsWith(':front') ? 'корпусов' : 'армии';
  const todo = p.recs === 0
    ? `выписать ЖБД ${unit} или фронта (в выписках ${unit === 'армии' ? 'армии' : 'их'} нет)`
    : p.ment > 0 ? `дни без положения в tsamo-div — из ЖБД ${unit}; проверить ненайденные пункты в gazetteer.json` : `ЖБД ${unit}: в записях фронта дивизии не названы`;
  L.push(`| ${groupName(p.g)} | ${p.n} | ${p.withPos} | ${pct(Math.round(p.cover * 1000), 1000)} | ${p.pers} | ${p.ment} | ${p.recs}${p.fonds.length ? ` (${p.fonds.join('; ')})` : ''} | ${todo} |`);
}
L.push('');
const mentSu = su.filter((r) => r.mentions.some((m) => m.file !== 'enemy'));
const noPosMent = mentSu.filter((r) => daysAll(r).size === 0);
const deMent = de.filter((r) => r.mentions.length > 0);
const noPers = prio.filter((p) => p.pers === 0 && !p.g.includes(':')).map((p) => groupName(p.g).replace(/ армия$/, ' А').replace('армия Войска Польского', 'А ВП'));
const armiesTotal = prio.filter((p) => !p.g.includes(':')).length;
const tsamoDivRecs = all.reduce((n, r) => n + r.pos.filter((p) => p.set === 'tsamo-div').length, 0);
const tsamoDivC = all.reduce((n, r) => n + r.pos.filter((p) => p.set === 'tsamo-div' && p.fallback).length, 0);
const tsamoDivStat = `${tsamoDivRecs} положений у ${all.filter((r) => r.sets.has('tsamo-div')).length} формирований, из них ${tsamoDivC} по координатам армии`;
L.push('Предложение по очереди работ:', '');
L.push(`1. **Положения из уже выписанного.** В выписках ЖБД 1 БФ (ф. 233, оп. 2356, д. 739), 1 УФ (ф. 236, оп. 2673), 3 А (ф. 310) и 33 А (ф. 388) названы ` +
  `${mentSu.length} ${plural(mentSu.length, 'советская дивизия', 'советские дивизии', 'советских дивизий')} реестра; ${noPosMent.length} из них не имеют ни одного положения в наборах. Места дивизий («260 сд — Хайнрихсдорф») ` +
  `геокодированы в набор tsamo-div (${tsamoDivStat}); пункты, которые не нашлись по газеттирам и Nominatim, ` +
  'перечислены в `berlin-1945-tsamo/gazetteer.json` с null — их можно дописать вручную (source: "manual").');
const firstArmies = prio.filter((p) => p.recs > 0 && !p.g.includes(':')).slice(0, 6).map((p) => groupName(p.g).replace(/ армия$/, ' А'));
L.push(`2. **ЖБД армий 1 БФ и 1 УФ.** Первыми — армии с наибольшим числом непокрытых дивизие-дней: ${firstArmies.join(', ')}. ` +
  'ЖБД армии даёт положения дивизий по дням и разграничительные линии между ними. Армейские ЖБД начаты только для 3 А ' +
  '(ф. 310, оп. 4376, д. 461) и 33 А (ф. 388, оп. 8712, д. 1114); фонды остальных армий найти на «Памяти народа».');
L.push('3. **2 БФ.** В выписках ЦАМО нет ни одной записи по 2 БФ (2 УА, 65, 70, 49, 19 А, 5 гв. ТА) — нужен ЖБД 2 БФ за 16.04–8.05 (главные силы — с 20.04) ' +
  'хотя бы на уровне армий, затем корпусов. Положения дивизий 2 БФ в наборах отсутствуют полностью.');
L.push(`4. **Численность.** Ведомости боевого и численного состава на 5–15.04 (по Исаеву, seelow) есть только для части армий 1 БФ; ` +
  `ни одной цифры численности дивизий нет в ${noPers.length} ${plural(noPers.length, 'армии', 'армиях', 'армиях')} из ${armiesTotal}: ${noPers.join(', ')}. Нужны донесения о боевом и численном составе армий на 10–15.04 и на 1.05.`);
L.push('5. **Подчинение.** Для дивизий с ⚠ (расхождение OOB и Le Tissier) — сверить по ЖБД армий, в каком корпусе дивизия была на 16.04 и когда её передали.');
L.push(`6. **Германская сторона.** ${deMent.length} из ${de.length} немецких формирований реестра названы в выписках (разведсводки и ЖБД фронтов); ` +
  `${deUnk.length} обозначений немецких соединений в выписках не сопоставлены с реестром. Источник состава и численности по датам — ` +
  'трофейные документы (ЦАМО, ф. 500): AOK 9, PzAOK 3, AOK 12, PzAOK 4; в первую очередь 9 А (14 дивизий против 1 БФ) и 4 ТА, у которой в реестре почти нет дивизий.', '');

// ---------- запись ----------
mkdirSync(dirname(docOut), { recursive: true });
writeFileSync(docOut, L.join('\n'));
if (jsonOut) {
  const p = resolve(ROOT, jsonOut);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(all.map((r) => ({
    id: r.div.id, side: r.div.side, type: r.div.type, group: groupOf(r.div), sets: [...r.sets],
    personnel: best(r, 'personnel') ?? null, tanks: best(r, 'tanks') ?? null, guns: best(r, 'guns') ?? null,
    daysOwn: [...daysOwn(r)].sort(), daysAll: [...daysAll(r)].sort(), corpsDays: [...r.corpsDays].sort(),
    tsamo: { records: r.mentions.length, days: [...new Set(r.mentions.map((m) => m.date).filter(Boolean))].sort() },
  })), null, 1));
}
console.log(`Реестр: ${all.length} (СССР ${su.length}, Германия ${de.length}); численность у ${all.filter(hasPers).length}; ` +
  `положение у ${all.filter((r) => daysAll(r).size > 0).length}; в выписках ЦАМО ${all.filter((r) => r.mentions.length > 0).length}; ничего — ${all.filter(nothing).length}`);
console.log(`Сопоставлено формирований по наборам: ${[...setFormations].map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`отчёт: ${join(docOut)}`);
