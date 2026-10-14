/**
 * Начальное наполнение базы знаний — из собранных с источниками данных проекта:
 *  - docs/sources/*.json — формирования (с численностью, командирами, приказами), события (по дням),
 *    потери, рубежи и секторы обороны, нормативы и темпы (калибровка), пробелы, расхождения источников;
 *  - docs/sources/berlin-1945-oob.md — сводка боевого состава Берлинской операции (разделы — в запись операции);
 *  - профили сторон (services/staff/profiles), устройство модели (docs/system.md, часть II);
 *  - data/curated/*.json — краткие описания операций, сражений, местности, техники (черновики — проверить);
 *  - docs/sources (выписки ЦАМО: vistula-oder-1945-tsamo, berlin-1945-tsamo) — выписки из документов ЦАМО: дела (источники), положения по дням, приказы,
 *    разведка, горючее и боеприпасы — в записи формирований, операций и хронологию (короткие пересказы со ссылкой на лист).
 * Результат — data/seed.json. Запуск: npm run kb:seed
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Claim, Entry, Fact, Reliability, Relation } from '../src/schema';
import { defaultRubrics, RUBRIC_CODES } from '../src/rubrics';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SRC = join(ROOT, 'docs/sources');
const read = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const entries = new Map<string, Entry>();
const put = (e: Entry) => {
  const old = entries.get(e.id);
  if (!old) { entries.set(e.id, { ...e, origin: 'seed' }); return; }
  // слияние: факты и связи — объединением, текст — первый непустой
  old.facts = dedupeFacts([...(old.facts ?? []), ...(e.facts ?? [])]);
  old.relations = dedupeRel([...(old.relations ?? []), ...(e.relations ?? [])]);
  old.sections = [...(old.sections ?? []), ...(e.sections ?? []).filter((s) => !(old.sections ?? []).some((o) => o.title === s.title))];
  old.aliases = [...new Set([...(old.aliases ?? []), ...(e.aliases ?? [])])];
  if (!old.summary && e.summary) old.summary = e.summary;
};
/** Повторы по тексту убираются; формальная часть повтора (и её надёжность) переходит к оставшемуся факту без неё. */
const dedupeFacts = (l: Fact[]) => {
  const out: Fact[] = [];
  for (const f of l) {
    const i = out.findIndex((g) => g.key === f.key && g.value === f.value && g.source === f.source);
    if (i < 0) out.push(f);
    else if (f.claim && !out[i].claim) out[i] = { ...out[i], claim: f.claim, ...(f.reliability ? { reliability: f.reliability } : {}) };
  }
  return out;
};
const dedupeRel = (l: Relation[]) => l.filter((r, i) => l.findIndex((g) => g.type === r.type && g.target === r.target) === i);
const rel = (v: unknown): Reliability | undefined => (v === 'A' || v === 'B' || v === 'C' ? v : undefined);
const slug = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60);
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayRu = (d: string) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
const ECH: Record<string, string> = { high_command: 'высшее командование', front: 'фронт', army_group: 'группа армий', army: 'армия', corps: 'корпус', division: 'дивизия', brigade: 'бригада', regiment: 'полк', battalion: 'батальон', group: 'группа', fleet: 'флот', flotilla: 'флотилия' };
const SIDE: Record<string, string> = { su: 'СССР (Красная армия и Войско Польское)', de: 'Германия (вермахт, войска СС, фольксштурм)', pl: 'Польша (Войско Польское)', us: 'США' };

/** Число норматива: 4, [35, 37] → 35–37, { bridges: 25, ferries: 40 } → bridges 25, ferries 40. */
function normValue(v: unknown): string {
  if (Array.isArray(v)) return v.join('–');
  if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k.replace(/_/g, ' ')} ${normValue(x)}`).join(', ');
  return String(v);
}

/* ───────────── источники ───────────── */
/** Краткое название источника: «Википедия (de): «Статья»» или «Автор. Название» без выходных данных. */
function sourceTitle(ref: string): string {
  const w = /^(\w\w)\.wikipedia:?\s*«([^»]+)»/.exec(ref);
  if (w) return `Википедия (${w[1]}): «${w[2]}»`;
  return ref.replace(/\s\((?:ed|ред)\.\)/, '').split(/\s+—\s+|\s\(|[.,]\s*(?:М\.|M\.|L\.|London|New York|СПб|Berlin|Stuttgart|Washington|Frank Cass|Sutton|Pen & Sword)(?=[\s:,.)]|$)|;\s/)[0].trim().slice(0, 90);
}
const SOURCE_FILES = ['berlin-1945-positions.json', 'vistula-oder-1945.json', 'berlin-1945-halbe.json', 'berlin-1945-reichstag.json', 'berlin-1945-conquest.json', 'berlin-1945-seelow-divisions.json'];
for (const f of SOURCE_FILES) {
  const d = read(`docs/sources/${f}`);
  const s = d.sources ?? d.source ?? {};
  for (const [k, v] of Object.entries(s as Record<string, { ref: string; default_reliability?: string; note?: string }>)) {
    const web = /wikipedia|wiki|\.ru\b|\.com|\.org|http/i.test(v.ref);
    put({ id: `src:${k}`, category: 'sources', group: web ? 'web' : 'books', title: sourceTitle(v.ref) || k, aliases: [k], summary: v.ref, status: 'checked',
      facts: [{ key: 'ref', value: v.ref }, ...(v.default_reliability ? [{ key: 'reliability', value: v.default_reliability }] : []), ...(v.note ? [{ key: 'covers', value: v.note }] : []), { key: 'covers', value: `набор данных ${f}` }] });
  }
}
for (const s of (read('docs/sources/vistula-oder-1945-divisions.json').meta?.sources ?? []) as { id: string; title: string }[]) {
  put({ id: `src:${s.id}`, category: 'sources', group: /wiki|http/i.test(s.title) ? 'web' : 'books', title: s.title.slice(0, 90), aliases: [s.id], summary: s.title, status: 'checked', facts: [{ key: 'ref', value: s.title }] });
}
const srcId = (s?: string) => {
  if (!s) return undefined;
  const k = s.split(/[\s;,]/)[0];
  return entries.has(`src:${k}`) ? `src:${k}` : undefined;
};

/* ───────────── формальные части фактов (claim) ───────────── */
// Формальная часть берётся из тех же наборов docs/sources, из которых собраны сценарии; текст фактов не меняется:
// claim добавляется к факту, который сид и так пишет (тот же смысл), иначе — новым фактом с ключом того же рода.
// Формирования — только те, что есть в сценариях (общих и агентных): остальным модель не пользуется.
const SCENARIO_IDS = new Set<string>();
const OP_START: Record<'berlin' | 'vistula', string> = { berlin: '', vistula: '' };
for (const [op, s] of [['berlin', 'berlin-1945'], ['vistula', 'vistula-oder-1945']] as const) {
  const sc = read(`packages/sim/data/scenarios/${s}.json`);
  OP_START[op] = String(sc.start).slice(0, 10);
  for (const f of sc.formations as { id: string }[]) SCENARIO_IDS.add(f.id);
  const ag = read(`packages/sim/data/scenarios/agents/${s}.json`);
  for (const f of [...ag.hqs, ...ag.divisions] as { id: string }[]) SCENARIO_IDS.add(f.id);
}
const inScenario = (id?: string | null): id is string => !!id && SCENARIO_IDS.has(id);
/** Операция по имени файла набора. */
const opOfFile = (file: string): 'berlin' | 'vistula' => (file.startsWith('vistula') ? 'vistula' : 'berlin');
const claimSkipped = new Map<string, number>();
const skipClaim = (why: string) => claimSkipped.set(why, (claimSkipped.get(why) ?? 0) + 1);
/** Момент ISO: дата с временем из записи («start» — 05:00 начала сценария, «end» и «к исходу дня» — 23:59), иначе день. */
const momentOf = (date: string, time?: string | null): string => {
  const d = date.slice(0, 10);
  if (date.length > 10) return date.slice(0, 16);
  const t = time ?? '';
  if (t === 'start') return `${d}T05:00`;
  if (t === 'end' || /исход/.test(t)) return `${d}T23:59`;
  const m = /^~?(\d{1,2})[:.](\d\d)/.exec(t);
  return m ? `${d}T${m[1].padStart(2, '0')}:${m[2]}` : d;
};
const cutc = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
const addClaimFacts = (entryId: string, facts: Fact[]): boolean => {
  const e = entries.get(entryId);
  if (!e) { skipClaim('нет записи'); return false; }
  e.facts = dedupeFacts([...(e.facts ?? []), ...facts]);
  return true;
};
const RELW = { A: 0, B: 1, C: 2 } as const;
/** Наименее надёжная из достоверностей (объединённая оценка по нескольким полям). */
const worstRel = (l: (Reliability | undefined)[]): Reliability | undefined => {
  const k = l.filter((x): x is Reliability => !!x);
  return k.length ? k.reduce((a, b) => (RELW[b] > RELW[a] ? b : a)) : undefined;
};

type StrengthField = { value?: number | null; source?: string; reliability?: string; note?: string };
/** Численность на начало операции: formations[].strength_16_04 / strength_12_01 (танки — «танки и САУ») → strength на дату старта сценария. */
function strengthClaims(): { entry: string; fact: Fact }[] {
  const out: { entry: string; fact: Fact }[] = [];
  for (const file of ['berlin-1945-positions.json', 'vistula-oder-1945.json']) {
    const at = OP_START[opOfFile(file)];
    for (const f of read(`docs/sources/${file}`).formations as (F & Record<string, unknown>)[]) {
      const key = Object.keys(f).find((k) => k.startsWith('strength_'));
      if (!key || !inScenario(f.id)) continue;
      const st = f[key] as Record<'personnel' | 'tanks_spg' | 'guns', StrengthField | undefined>;
      const num = (x?: StrengthField) => (typeof x?.value === 'number' ? x.value : undefined);
      const personnel = num(st.personnel), tanks = num(st.tanks_spg), guns = num(st.guns);
      if (personnel == null && tanks == null && guns == null) continue;
      const parts = [personnel != null ? `людей ${personnel.toLocaleString('ru')}` : '', tanks != null ? `танков и САУ ${tanks.toLocaleString('ru')}` : '', guns != null ? `орудий и миномётов ${guns.toLocaleString('ru')}` : ''].filter(Boolean);
      const used = (['personnel', 'tanks_spg', 'guns'] as const).map((k) => st[k]).filter((x): x is StrengthField => typeof x?.value === 'number');
      const claim: Claim = { kind: 'strength', subject: f.id, at, ...(personnel != null ? { personnel } : {}), ...(tanks != null ? { tanks } : {}), ...(guns != null ? { guns } : {}) };
      out.push({ entry: `f:${f.id}`, fact: { key: 'personnel', value: `на ${dayRu(at)}: ${parts.join(', ')}`, source: srcId(used[0]?.source), pages: cutc(used.map((x) => x.source).filter(Boolean).join('; '), 200) || undefined, reliability: worstRel(used.map((x) => rel(x.reliability))), claim } });
    }
  }
  return out;
}

/** Подчинённость по строкам реестра дивизий: на каждую дату строки — ближайший вышестоящий, известный сценарию (корпус, армия, фронт). */
function parentClaims(d: { id: string; subordination?: { date?: string; front?: string; army?: string; corps?: string; source?: string; reliability?: string }[] }, name: (id: string) => string): Fact[] {
  const out: Fact[] = [];
  if (!inScenario(d.id)) return out;
  for (const row of d.subordination ?? []) {
    const parent = [row.corps, row.army, row.front].find(inScenario);
    if (!parent) { skipClaim('подчинённость: вышестоящий не в сценариях'); continue; }
    const from = row.date ? row.date.slice(0, 10) : OP_START.berlin;
    out.push({ key: 'parent', value: `${name(parent)} (с ${from.slice(8, 10)}.${from.slice(5, 7)})`, source: srcId(row.source), reliability: rel(row.reliability), claim: { kind: 'parent', subject: d.id, from, parent } });
  }
  return out;
}

type PosIn = { subject: string; date: string; time?: string | null; place: string; lng?: number | null; lat?: number | null; approxKm?: number | null; source?: string; reliability?: string; src?: string; pages?: string };
/** Положение формирования: position; факт — в «боевой путь». */
function positionClaim(p: PosIn): Fact {
  const at = momentOf(p.date, p.time);
  const place = p.place.replace(/_/g, ' ');
  const claim: Claim = { kind: 'position', subject: p.subject, at, place: cutc(place, 200), ...(typeof p.lng === 'number' && typeof p.lat === 'number' ? { lngLat: [p.lng, p.lat] as [number, number] } : {}), ...(typeof p.approxKm === 'number' ? { uncertaintyKm: p.approxKm } : {}) };
  return { key: 'path', value: `${p.date.slice(8, 10)}.${p.date.slice(5, 7)}${at.length > 10 ? ` ${at.slice(11)}` : ''}: ${cutc(place, 200)}${typeof p.approxKm === 'number' ? ` (±${p.approxKm} км)` : ''}`, source: p.src ?? srcId(p.source), pages: p.pages, reliability: rel(p.reliability), claim };
}
const POSITION_FILES = ['berlin-1945-positions.json', 'vistula-oder-1945.json', 'berlin-1945-halbe.json', 'berlin-1945-reichstag.json', 'berlin-1945-conquest.json', 'berlin-1945-seelow-divisions.json', 'vistula-oder-1945-divisions.json', 'berlin-1945-city-garrison.json', 'berlin-1945-research-de.json', 'berlin-1945-research-su.json'];
/** positions[] наборов и исходные положения (start-positions-1945.json) → position. */
function positionClaims(): { entry: string; fact: Fact }[] {
  const out: { entry: string; fact: Fact }[] = [];
  for (const file of POSITION_FILES) {
    for (const p of (read(`docs/sources/${file}`).positions ?? []) as { formation: string; date: string; time?: string; place: string; lng?: number; lat?: number; approx_km?: number; source?: string; reliability?: string; page?: string }[]) {
      if (!inScenario(p.formation) || !/^\d{4}-\d\d-\d\d/.test(p.date)) { skipClaim('положение: формирования нет в сценариях'); continue; }
      out.push({ entry: `f:${p.formation}`, fact: positionClaim({ subject: p.formation, date: p.date, time: p.time, place: p.place, lng: p.lng, lat: p.lat, approxKm: p.approx_km, source: p.source, reliability: p.reliability, pages: p.page }) });
    }
  }
  const sp = read('docs/sources/start-positions-1945.json') as Record<string, { formation: string; time: string; place: string; approxKm?: number; source?: string; reliability?: string }[] | string>;
  for (const k of ['berlin_su', 'berlin_de', 'vistula_su', 'vistula_de']) {
    for (const p of (sp[k] ?? []) as Exclude<(typeof sp)[string], string>) {
      if (!inScenario(p.formation)) { skipClaim('положение: формирования нет в сценариях'); continue; }
      out.push({ entry: `f:${p.formation}`, fact: positionClaim({ subject: p.formation, date: p.time, place: p.place, approxKm: p.approxKm, source: p.source, reliability: p.reliability }) });
    }
  }
  return out;
}

/** Разграничительная линия двух объединений (оба — в сценариях); воздушная линия и линии без формаций claim не выпускают. */
function boundaryClaim(b: { right: string; left: string; from?: string; until?: string | null; points: { place: string }[]; inclusive?: string; kind?: string }): Claim | undefined {
  if (b.kind === 'air' || !b.from || !inScenario(b.right) || !inScenario(b.left)) { skipClaim('линия: не между формированиями сценариев'); return undefined; }
  return { kind: 'boundary', between: [b.right, b.left], from: b.from, ...(b.until ? { to: b.until } : {}), points: b.points.map((x) => x.place), ...(b.inclusive ? { inclusive: b.inclusive } : {}) };
}

const CROSSING_STATE: Record<string, 'open' | 'destroyed' | 'built'> = { pontoon: 'built', captured: 'open', intact: 'open', blown: 'destroyed' };
/** Состояние моста на дату → crossing (повреждённый мост в три состояния не укладывается — без claim). */
function crossingClaim(bridgeId: string, st: { date: string; state: string }): Claim | undefined {
  const state = CROSSING_STATE[st.state];
  if (!state) { skipClaim(`переправа: состояние «${st.state}» не сводится к open/destroyed/built`); return undefined; }
  return { kind: 'crossing', subject: bridgeId, from: st.date.slice(0, 10), state };
}

/** Потери формирования за период (own_losses): period «от/до» или день date…date_end. Без известного формирования — без claim. */
/**
 * Частичная запись — потери не всего формирования, а одного рода войск или части: примечание записи начинается
 * со слова «только» («ТОЛЬКО АРТИЛЛЕРИЙСКИЕ ЧАСТИ армии…», «Только артиллерия…», «Только 62-я гв. тбр…») — так
 * составитель наборов помечает охват. Контрольной точкой потерь формирования она быть не может (расчёт считает
 * потери всего формирования), поэтому формальной части не даёт; сам факт остаётся справкой.
 */
const partialLosses = (note?: string) => /^\s*только(?!\p{L})/iu.test(note ?? '');

function lossesClaim(r: { kind: string; formation: string | null; date?: string; date_end?: string; period?: string; values?: Record<string, unknown>; note?: string }): Claim | undefined {
  if (r.kind !== 'own_losses') return undefined;
  if (!inScenario(r.formation)) { skipClaim('потери: формирования нет в сценариях'); return undefined; }
  if (partialLosses(r.note)) { skipClaim('потери: только часть формирования (род войск, отдельная часть)'); return undefined; }
  const [a, b] = r.period ? r.period.split('/') : [r.date, r.date_end ?? r.date];
  const from = (a ?? r.date ?? '').slice(0, 10), to = (b ?? a ?? r.date ?? '').slice(0, 10);
  if (!from) return undefined;
  const n = (k: string) => (typeof r.values?.[k] === 'number' ? (r.values[k] as number) : undefined);
  const [killed, wounded, missing, total] = [n('killed'), n('wounded'), n('missing'), n('total')];
  // записи только с техникой или процентами claim не дают
  if (killed == null && wounded == null && missing == null && total == null) { skipClaim('потери: нет числа людей'); return undefined; }
  return { kind: 'losses', subject: r.formation, from, to, ...(killed != null ? { killed } : {}), ...(wounded != null ? { wounded } : {}), ...(missing != null ? { missing } : {}), ...(total != null ? { total } : {}) };
}

/** События операции (events[]) → event в записи операции. */
function eventClaims(): { entry: string; fact: Fact }[] {
  const out: { entry: string; fact: Fact }[] = [];
  for (const file of ['berlin-1945-positions.json', 'vistula-oder-1945.json']) {
    const op = opOfFile(file);
    (read(`docs/sources/${file}`).events as { date: string; time?: string; title: string; place?: string; source?: string; reliability?: string }[]).forEach((ev, i) => {
      if (!/^\d{4}-\d\d-\d\d/.test(ev.date)) { skipClaim('событие: нет ISO-даты'); return; }
      const at = /^\d{1,2}:\d\d$/.test(ev.time ?? '') ? momentOf(ev.date, ev.time) : ev.date.slice(0, 16);
      const place = ev.place?.replace(/_/g, ' ');
      out.push({ entry: op === 'berlin' ? 'op:berlin' : 'op:vistula-oder', fact: { key: 'event', value: `${dayRu(ev.date.slice(0, 10))}: ${cutc(ev.title, 300)}${place ? ` (${place})` : ''}`, source: srcId(ev.source), reliability: rel(ev.reliability),
        claim: { kind: 'event', id: `${op}-${ev.date.slice(0, 10)}-${i}`, at, title: ev.title, ...(place ? { place } : {}) } } });
    });
  }
  return out;
}

/* ───────────── формирования и командиры ───────────── */
type F = Record<string, unknown> & { id: string; side?: string; echelon?: string; parent?: string | null; commander?: string; name_ru?: string; name?: string; name_orig?: string; name_de?: string; source?: string; note?: string };
const allF: { f: F; file: string; src?: string }[] = [];
for (const file of ['berlin-1945-positions.json', 'vistula-oder-1945.json', 'berlin-1945-halbe.json', 'berlin-1945-reichstag.json', 'berlin-1945-conquest.json', 'berlin-1945-seelow-divisions.json', 'vistula-oder-1945-divisions.json', 'berlin-1945-city-garrison.json']) {
  const d = read(`docs/sources/${file}`);
  for (const f of (d.formations ?? []) as F[]) allF.push({ f, file });
  for (const f of (d.new_corps ?? []) as F[]) allF.push({ f, file });
}
const fname = new Map<string, string>();
for (const { f } of allF) if (!fname.has(f.id)) fname.set(f.id, (f.name_ru ?? f.name ?? f.id) as string);
const commanders = new Map<string, { name: string; side?: string; posts: { f: string; source?: string; note?: string }[]; ranks: Set<string> }>();
const RANKS = /^(гл\. маршал авиации|главный маршал авиации|маршал советского союза|маршал|ген\.?-фельдм\.|генерал-фельдмаршал|ген\.? ?-?полк\.|ген\.?-лейт\.|ген\.?-м\.|ген\.? арм\.|ген\.? арт\.|ген\.? танк\.? войск|ген\.? пех\.|ген\.? авиации|генерал[а-я-]*( [а-я.]+)?|ген\.|полк\.\/ген\.-м\.|полк\.|подп\.|м-р|кап\.|ст\. лейт\.|лейт\.|контр-адм\.|адм\.|(обер|бригаде|группен|штандартен|оберштурмбанн|штурмбанн|ober|brigade)?(фюрер|führer)( сс| ss)?|оберфюрер сс|д-р|ген\.-м\.\/ген\.-лейт\.)\s*/i;
/** Командир из свободного текста: несколько лиц (через →, /, ;), звания и пометки снимаются. */
function parsePersons(raw: string, side?: string): { id: string; name: string; rank?: string; note?: string }[] {
  const out: { id: string; name: string; rank?: string; note?: string }[] = [];
  // пометки в скобках снимаются до деления на лица (внутри них бывают «;» и «/»)
  for (let part of raw.replace(/\([^)]*\)/g, ' ').replace(/\s*\([^)]*$/, '').split(/→|\/(?![\wа-я]\.)|;|\|/)) {
    const notes = '';
    part = part.replace(/\(.*?\)/g, ' ').replace(/«[^»]*»/g, ' ').replace(/\b(с|до|после)\s+~?\d{1,2}\.\d{2}.*$/i, ' ').replace(/[?⚠]/g, ' ').replace(/,.*$/, '').trim();
    let rank = '';
    for (let k = 0; k < 4; k++) { const m = RANKS.exec(part); if (!m || !m[0]) break; rank = (rank ? rank + ' ' : '') + m[0].trim(); part = part.slice(m[0].length).trim(); }
    const words = part.split(/\s+/).filter(Boolean);
    const last = [...words].reverse().find((w) => /^[А-ЯЁA-Z][а-яёa-zäöüß-]{2,}$/.test(w) && !/^(Нордланд|Мюнхеберг|Берлин|План|СС)$/.test(w));
    if (!last || /^(план|нет)$/i.test(part)) continue;
    const ini = (words.find((w) => /^[А-ЯЁA-Z]\.$/.test(w)) ?? '').replace('.', '');
    const iniKey = side === 'de' ? ini.replace('Х', 'Г') : ini;
    const id = `cmd:${slug(last)}${iniKey ? '-' + slug(iniKey) : ''}`;
    out.push({ id, name: words.slice(words.indexOf(words.find((w) => /^[А-ЯЁA-Z]\.$/.test(w)) ?? last)).join(' '), rank: rank || undefined, note: notes || undefined });
  }
  return out;
}
// у кого в реестре дивизий подчинённость датирована раньше начала операции, перечень набора без даты её не перебивает:
// иначе он, отнесённый к началу, оказался бы «позже» и вытеснил датированный факт; на одну дату — решает надёжность
const datedParent = new Set<string>();
for (const d of ((): { id: string; subordination?: { date?: string; front?: string; army?: string; corps?: string }[] }[] => { try { return read('docs/sources/berlin-1945-divisions.json').divisions ?? []; } catch { return []; } })())
  if ((d.subordination ?? []).some((r) => r.date && r.date.slice(0, 10) < OP_START.berlin && [r.corps, r.army, r.front].some(inScenario))) datedParent.add(d.id);
for (const { f, file } of allF) {
  const facts: Fact[] = [];
  const src = srcId(f.source as string) ?? undefined;
  if (f.side) facts.push({ key: 'side', value: SIDE[f.side] ?? f.side, source: src });
  if (f.echelon) facts.push({ key: 'echelon', value: ECH[f.echelon] ?? f.echelon, source: src });
  if (f.parent) {
    // подчинённость в наборе формирований действует с начала операции
    const claim: Claim | undefined = inScenario(f.id) && inScenario(f.parent) && !(opOfFile(file) === 'berlin' && datedParent.has(f.id)) ? { kind: 'parent', subject: f.id, from: OP_START[opOfFile(file)], parent: f.parent } : undefined;
    facts.push({ key: 'parent', value: fname.get(f.parent) ?? f.parent, source: src, ...(claim ? { claim } : {}) });
  }
  if (f.commander) facts.push({ key: 'commander', value: f.commander, source: src });
  for (const k of ['personnel', 'tanks', 'guns'] as const) {
    const v = f[k] as unknown;
    if (v == null) continue;
    if (typeof v === 'object') { const o = v as { value: number | null; source?: string; reliability?: string; date?: string; note?: string }; if (o.value == null) continue; facts.push({ key: k, value: `${o.value.toLocaleString('ru')}${o.date ? ` (на ${o.date})` : ''}${o.note ? ` — ${o.note}` : ''}`, source: srcId(o.source) ?? o.source, reliability: rel(o.reliability) }); }
    else facts.push({ key: k, value: String(v), source: src });
  }
  // численность: число или { value, source, reliability, note, date }; САУ — к танкам, самолёты — к составу
  type Num = number | { value: number | null; source?: string; reliability?: string; note?: string; date?: string };
  const st = f.strength as (Record<string, Num | string | undefined> & { reliability?: string; source?: string }) | undefined;
  if (st) for (const [k, key, label] of [['personnel', 'personnel', ''], ['tanks', 'tanks', ''], ['spg', 'tanks', 'САУ: '], ['guns', 'guns', ''], ['aircraft', 'composition', 'самолётов: ']] as const) {
    const v = st[k] as Num | undefined;
    if (v == null) continue;
    if (typeof v === 'number') facts.push({ key, value: `${label}${v.toLocaleString('ru')}`, source: srcId(st.source) ?? st.source, reliability: rel(st.reliability) });
    else if (v.value != null) facts.push({ key, value: `${label}${v.value.toLocaleString('ru')}${v.date ? ` (на ${v.date})` : ''}${v.note ? ` — ${v.note}` : ''}`, source: srcId(v.source ?? st.source) ?? v.source, reliability: rel(v.reliability ?? st.reliability) });
  }
  if (f.divisions) facts.push({ key: 'composition', value: `${f.divisions} дивизий`, source: src });
  const relations: Relation[] = [];
  if (f.parent) relations.push({ type: 'part_of', target: `f:${f.parent}` });
  if (f.commander) {
    for (const person of parsePersons(String(f.commander), f.side)) {
      relations.push({ type: 'commanded_by', target: person.id });
      const c = commanders.get(person.id) ?? { name: person.name, side: f.side, posts: [], ranks: new Set<string>() };
      if (person.name.length > c.name.length) c.name = person.name;
      if (person.rank) c.ranks.add(person.rank);
      c.posts.push({ f: f.id, source: src, note: person.note });
      commanders.set(person.id, c);
    }
  }
  const name = (f.name_ru ?? f.name ?? f.id) as string;
  put({ id: `f:${f.id}`, category: 'formations', group: f.side === 'de' ? 'de' : 'su', title: name, aliases: [f.name_orig, f.name_de, f.id].filter(Boolean) as string[],
    summary: [ECH[f.echelon ?? ''] ? `${ECH[f.echelon!]}` : '', f.side ? (f.side === 'de' ? 'германской стороны' : 'советской стороны') : '', f.parent ? `в составе: ${fname.get(f.parent) ?? f.parent}` : '', f.commander ? `командир — ${f.commander}` : ''].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase()) + '.',
    facts, relations, status: 'checked',
    sections: f.note ? [{ title: `Примечание (${file})`, text: String(f.note) }] : [] });
}
// фамилия без инициала — к единственному полному варианту той же стороны
for (const [id, c] of [...commanders]) {
  if (/-[a-zа-я]$/.test(id)) continue;
  const full = [...commanders.keys()].filter((k) => k.startsWith(`${id}-`) && commanders.get(k)!.side === c.side);
  if (full.length !== 1) continue;
  const t = commanders.get(full[0])!;
  t.posts.push(...c.posts); c.ranks.forEach((r) => t.ranks.add(r));
  commanders.delete(id);
  for (const { f } of c.posts) { const e = entries.get(`f:${f}`); if (e) e.relations = (e.relations ?? []).map((r) => (r.target === id ? { ...r, target: full[0] } : r)); }
}
for (const [id, c] of commanders) {
  c.posts = c.posts.filter((p, i) => c.posts.findIndex((q) => q.f === p.f) === i);
  put({ id, category: 'commanders', group: c.side === 'de' ? 'de' : 'su', title: c.name, summary: `Командовал: ${[...new Set(c.posts.map((p) => fname.get(p.f) ?? p.f))].slice(0, 6).join('; ')}.`, status: 'checked',
    facts: [{ key: 'side', value: SIDE[c.side ?? ''] ?? c.side ?? '' }, ...[...c.ranks].map((r) => ({ key: 'rank', value: r })), ...c.posts.map((p) => ({ key: 'post', value: `${fname.get(p.f) ?? p.f}${p.note ? ` (${p.note})` : ''}`, source: p.source }))],
    relations: c.posts.map((p) => ({ type: 'commands' as const, target: `f:${p.f}` })) });
}

/* ───────────── приказы → формирования ───────────── */
for (const file of ['berlin-1945-halbe.json', 'berlin-1945-reichstag.json', 'berlin-1945-conquest.json']) {
  for (const o of (read(`docs/sources/${file}`).orders ?? []) as { date: string; issuer: string; recipient: string; summary_ru?: string; source?: string; reliability?: string }[]) {
    if (!o.summary_ru || !entries.has(`f:${o.recipient}`)) continue;
    const e = entries.get(`f:${o.recipient}`)!;
    const sec = e.sections!.find((s) => s.title === 'Приказы в операции') ?? (e.sections!.push({ title: 'Приказы в операции', text: '' }), e.sections![e.sections!.length - 1]);
    sec.text += `${sec.text ? '\n' : ''}- ${o.date.slice(8, 10)}.${o.date.slice(5, 7)} — от ${fname.get(o.issuer) ?? o.issuer}: ${o.summary_ru} [${o.source ?? ''}${o.reliability ? `, ${o.reliability}` : ''}]`;
  }
}

/* ───────────── хронология по дням ───────────── */
const days = new Map<string, { op: 'berlin' | 'vistula'; items: string[]; srcs: Set<string> }>();
for (const file of ['berlin-1945-positions.json', 'berlin-1945-halbe.json', 'berlin-1945-reichstag.json', 'berlin-1945-conquest.json', 'vistula-oder-1945.json']) {
  const op = file.startsWith('vistula') ? 'vistula' : 'berlin';
  for (const ev of (read(`docs/sources/${file}`).events ?? []) as { date: string; time?: string; title: string; place?: string; source?: string; reliability?: string }[]) {
    if (!/^\d{4}-\d\d-\d\d/.test(ev.date)) continue;
    const d = ev.date.slice(0, 10);
    const k = `${op}:${d}`;
    const day = days.get(k) ?? { op, items: [], srcs: new Set() };
    const line = `${ev.time ? `${ev.time} — ` : ''}${ev.title}${ev.place ? ` (${ev.place.replace(/_/g, ' ')})` : ''} [${ev.source ?? ''}${ev.reliability ? `, ${ev.reliability}` : ''}]`;
    if (!day.items.includes(line)) day.items.push(line);
    if (ev.source) day.srcs.add(ev.source.split(/[\s;,]/)[0]);
    days.set(k, day);
  }
}
for (const [k, d] of [...days].sort()) {
  const date = k.split(':')[1];
  put({ id: `day:${k}`, category: 'chronology', group: d.op, title: `${dayRu(date)} — ${d.op === 'berlin' ? 'Берлинская операция' : 'Висло-Одерская операция'}`, period: { from: date, to: date }, status: 'checked',
    summary: `${d.items.length} событий за день по собранным источникам.`, facts: [{ key: 'date', value: date }],
    sections: [{ title: 'События', text: d.items.sort().map((x) => `- ${x}`).join('\n') }],
    relations: [{ type: 'part_of', target: d.op === 'berlin' ? 'op:berlin' : 'op:vistula-oder' }, ...[...d.srcs].filter((s) => entries.has(`src:${s}`)).map((s) => ({ type: 'source' as const, target: `src:${s}` }))] });
}

/* ───────────── рубежи, секторы обороны ───────────── */
const rq = read('docs/sources/berlin-1945-reichstag.json');
for (const l of rq.defence_lines ?? []) put({ id: `line:berlin-${slug(l.name_ru)}`, category: 'terrain', group: 'lines', title: l.name_ru, aliases: [l.name_de].filter(Boolean), summary: l.description_ru ?? '', status: 'checked', facts: [{ key: 'kind', value: 'оборонительный рубеж Берлина', source: 'src:LT_RACE' }, { key: 'location', value: 'Берлин' }], relations: [{ type: 'related', target: 'ter:berlin' }] });
for (const s of rq.defence_sectors ?? []) put({ id: `line:berlin-sector-${s.id}`, category: 'terrain', group: 'lines', title: `Сектор обороны Берлина «${s.id}»`, summary: s.area_ru ?? '', status: 'checked', facts: [{ key: 'kind', value: 'сектор обороны', source: 'src:LT_RACE' }, ...(s.commandant ? [{ key: 'features', value: `коменданты: ${s.commandant}`, source: 'src:LT_RACE' }] : [])], relations: [{ type: 'related', target: 'ter:berlin' }] });
for (const b of read('docs/sources/berlin-1945-seelow-divisions.json').belts ?? []) put({ id: `line:${b.id}`, category: 'terrain', group: 'lines', title: b.name_ru, aliases: [b.name_de].filter(Boolean), summary: b.note ?? b.description_ru ?? `Полоса обороны 9-й армии на Одере: ${b.places?.slice(0, 8).join(', ')}…`, status: 'checked', facts: [{ key: 'kind', value: 'полоса обороны (Одерский фронт)' }, ...(b.places ? [{ key: 'location', value: b.places.join(', ').replace(/_/g, ' ') }] : [])], relations: [{ type: 'related', target: 'battle:seelow' }] });

/* ───────────── потери → сражения и операции ───────────── */
const lossTarget = (scope: string) => /Зеелов|Одер|16\.04[–-]19/.test(scope) ? 'battle:seelow' : /Хальбе|котл|9[-‑ ]й арм|9 А/.test(scope) ? 'battle:halbe' : /Рейхстаг/.test(scope) ? 'battle:reichstag' : /Берлин|город|штурм/i.test(scope) ? 'battle:berlin-storm' : 'op:berlin';
const losses: { target: string; fact: Fact }[] = [];
for (const l of rq.losses ?? []) losses.push({ target: lossTarget(`${l.scope ?? ''} ${l.item_ru ?? ''}`), fact: { key: 'losses', value: `${l.side === 'de' ? 'Германия' : 'СССР'}, ${l.scope ?? ''}: ${l.item_ru ?? ''} — ${typeof l.value === 'number' ? l.value.toLocaleString('ru') : l.value}${l.note ? ` (${l.note})` : ''}`, source: 'src:LT_RACE', reliability: rel(l.reliability) } });
for (const l of read('docs/sources/berlin-1945-halbe.json').losses ?? []) losses.push({ target: lossTarget(`${l.period ?? ''} ${l.note ?? ''} ${l.formation === 'de_9a' ? '9 А' : ''}`), fact: { key: 'losses', value: `${fname.get(l.formation) ?? l.formation}, ${l.period ?? ''}: ${typeof l.value === 'number' ? l.value.toLocaleString('ru') : l.value}${l.note ? ` — ${l.note}` : ''}`, source: 'src:LT_HALBE' } });

/* ───────────── нормативы и темпы (калибровка), артиллерия ───────────── */
const KIND: Record<string, string> = { advance: 'Темпы наступления', density: 'Плотности сил и средств', engineer: 'Инженерное обеспечение', crossing: 'Переправы', loss: 'Потери в бою', supply: 'Тыл и снабжение', delay: 'Управление и задержки', other: 'Прочие нормативы' };
const cal = read('docs/sources/berlin-1945-conquest.json').calibration ?? [];
for (const [k, title] of Object.entries(KIND)) {
  const items = cal.filter((c: { kind: string }) => c.kind === k);
  if (!items.length) continue;
  put({ id: `org:su-${k}`, category: 'organization', group: 'su', title: `${title}: опыт 1-го Белорусского фронта (апрель 1945)`, status: 'checked',
    summary: `${items.length} фактов из воспоминаний командиров (Катуков, Бабаджанян и др.) в сборнике Le Tissier «Soviet Conquest».`,
    facts: items.map((c: { value: unknown; unit?: string; context_ru?: string; reliability?: string; terrain?: string }) => ({ key: 'numbers', value: `${normValue(c.value)} ${c.unit ?? ''}${c.terrain ? ` (${c.terrain})` : ''} — ${c.context_ru ?? ''}`, source: 'src:LT_CONQ', reliability: rel(c.reliability) })),
    relations: [{ type: 'source', target: 'src:LT_CONQ' }] });
}
const art = rq.artillery ?? [];
if (art.length) put({ id: 'org:su-artillery', category: 'organization', group: 'su', title: 'Артиллерийское обеспечение штурма Берлина', status: 'checked', summary: 'Организация и плотности артиллерии 1-го Белорусского фронта (по Le Tissier, «Race for the Reichstag», прил. 3).',
  facts: art.map((a: { item_ru: string; value: unknown; unit?: string; note?: string; issuer?: string }) => ({ key: 'numbers', value: `${a.item_ru}: ${a.value} ${a.unit ?? ''}${a.note ? ` — ${a.note}` : ''}`, source: 'src:LT_RACE' })), relations: [{ type: 'source', target: 'src:LT_RACE' }] });

/* ───────────── профили сторон и устройство модели ───────────── */
for (const [side, file, title] of [['su', 'rkka-1945', 'Красная армия весной 1945 г.: общие черты'], ['de', 'wehrmacht-1945', 'Вермахт весной 1945 г.: общие черты']] as const) {
  const text = readFileSync(join(ROOT, `services/staff/profiles/${file}.md`), 'utf8');
  put({ id: `org:${side}-profile`, category: 'organization', group: side, title, status: 'draft', summary: text.split('\n')[0], sections: [{ title: 'Положения', text: text.split('\n').slice(1).join('\n').trim() }], facts: [{ key: 'side', value: SIDE[side] }] });
}
{
  // устройство модели — часть II описания системы (разделы без номеров: id записей не зависят от нумерации)
  const md = readFileSync(join(ROOT, 'docs/system.md'), 'utf8').split(/\n# Часть II[^\n]*\n/)[1] ?? '';
  const parts = md.split(/\n## /).slice(1);
  for (const p of parts) {
    const [head, ...rest] = p.split('\n');
    const t = head.replace(/^\d+\.\s*/, '').trim();
    put({ id: `model:${slug(t)}`, category: 'organization', group: 'model', title: `Модель: ${t}`, status: 'checked', summary: rest.join('\n').trim().split('\n\n')[0].slice(0, 400), sections: [{ title: t, text: rest.join('\n').trim() }] });
  }
}

{
  // что модель берёт из профилей сторон и откалиброванных правил: типы объединений, марш, расход и подвоз, задержки приказов,
  // переправы, местность, укрепления, потери — записи «Как это устроено в модели» с рубрикой темы (числа модели, не история)
  const cutm = (t: string, n = 480) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const MOB: Record<string, string> = { foot: 'пешие', motor: 'моторизованные', tracked: 'гусеничные' };
  const TER: Record<string, string> = { open: 'открытая', forest: 'лес', marsh: 'болото', urban: 'город', hills: 'высоты', water: 'вода' };
  const ECH: Record<string, string> = { front: 'фронту', army: 'армии', corps: 'корпусу', division: 'дивизии', brigade: 'бригаде', regiment: 'полку' };
  const POS: Record<string, string> = { attack: 'наступление', defend: 'оборона', march: 'марш', withdraw: 'отход', reserve: 'резерв' };
  for (const [side, file] of [['su', 'rkka-1945'], ['de', 'wehrmacht-1945']] as const) {
    const pr = read(`packages/sim/data/profiles/${file}.json`) as {
      unitTypes: Record<string, { name: string; mobility: string; quality: number; frontageKm?: number }>; offRoad: Record<string, Record<string, number>>; road: Record<string, number>;
      consumption: Record<string, { ammo: number; fuel: number }>; orderDelayHours: Record<string, number>; supply: { ammoPerDay: number; fuelPerDay: number; maxAmmo: number; maxFuel: number; rangeHours: number };
      _supply_note?: string; _frontage_note?: string; engineering?: { parks?: number };
    };
    const who = side === 'su' ? 'Красная армия' : 'Вермахт';
    const m = (id: string, title: string, rubrics: string[], summary: string, facts: Fact[]) =>
      put({ id: `org:model-${side}-${id}`, category: 'organization', group: 'model', rubrics, title: `Модель, ${who}: ${title}`, status: 'checked', summary, facts: [{ key: 'side', value: SIDE[side] }, ...facts], relations: [{ type: 'related', target: `org:${side}-profile` }] });
    m('unit-types', 'типы объединений и соединений', ['9.7', side === 'su' ? '2.1' : '2.2'], 'Типы формирований в профиле стороны: подвижность, качество (множитель боевой силы) и ширина полосы обороны.',
      Object.values(pr.unitTypes).map((u) => ({ key: 'numbers', value: `${u.name}: ${MOB[u.mobility] ?? u.mobility}, качество ×${u.quality}${u.frontageKm ? `, полоса обороны ${u.frontageKm} км` : ''}` }))
        .concat(pr._frontage_note ? [{ key: 'principles', value: cutm(pr._frontage_note) }] : []));
    m('march', 'скорости марша по дорогам и местности', ['9.7', '5.2', '6.2'], 'Сколько километров в сутки проходят пешие, моторизованные и гусеничные части по дорогам и вне дорог в модели.',
      [...Object.entries(pr.road).map(([k, v]) => ({ key: 'numbers', value: `${MOB[k] ?? k}, по дороге: ${v} км/сут` })),
        ...Object.entries(pr.offRoad).map(([k, t]) => ({ key: 'numbers', value: `${MOB[k] ?? k}, вне дорог: ${Object.entries(t).filter(([, v]) => v > 0).map(([g, v]) => `${TER[g] ?? g} ${v}`).join(', ')} км/сут` }))]);
    m('supply', 'расход и подвоз', ['9.7', '5.1'], 'Расход боеприпасов и горючего по видам действий, пополнение в сутки, запасы и предельное плечо подвоза в модели.',
      [...Object.entries(pr.consumption).map(([k, c]) => ({ key: 'numbers', value: `${POS[k] ?? k}: боеприпасы ${c.ammo} бк/сут, горючее ${c.fuel} запр./сут` })),
        { key: 'numbers', value: `подвоз в сутки: боеприпасы ${pr.supply.ammoPerDay} бк, горючее ${pr.supply.fuelPerDay} запр.; запас до ${pr.supply.maxAmmo} бк и ${pr.supply.maxFuel} запр.; плечо подвоза до ${pr.supply.rangeHours} ч пути` },
        ...(pr._supply_note ? [{ key: 'principles', value: cutm(pr._supply_note) }] : [])]);
    m('delays', 'задержки доведения приказов', ['9.7', '7.3', '3.4.4'], 'Через сколько часов приказ доходит до исполнителя в модели — по ступени управления.',
      Object.entries(pr.orderDelayHours).map(([k, h]) => ({ key: 'numbers', value: `приказ ${ECH[k] ?? k}: ${h} ч` })));
  }
  const cal = read('packages/sim/data/rules/ww2-berlin-cal.json') as Record<string, unknown>;
  const cm = (id: string, title: string, rubrics: string[], summary: string, facts: Fact[]) =>
    put({ id: `org:model-cal-${id}`, category: 'organization', group: 'model', rubrics, title: `Модель: ${title}`, status: 'checked', summary, facts });
  const note = (k: string) => (typeof cal[`_${k}_note`] === 'string' ? [{ key: 'principles', value: cutm(cal[`_${k}_note`] as string) }] : []);
  const at = cal.advanceTerrain as Record<string, number>;
  cm('terrain', 'местность и темп наступления', ['9.7', '6.2', '3.4.1'], 'Во сколько раз местность замедляет наступление и усиливает оборону в откалиброванных правилах Берлинской операции.',
    [...Object.entries(at).map(([g, v]) => ({ key: 'numbers', value: `темп наступления, ${TER[g] ?? g}: ×${v}` })),
      ...Object.entries((cal.defense as { terrain: Record<string, number> }).terrain).filter(([, v]) => v !== 1).map(([g, v]) => ({ key: 'numbers', value: `сила обороны, ${TER[g] ?? g}: ×${v}` })), ...note('advanceTerrain')]);
  const d = cal.defense as { prepared: number; prepareHours: number; fortificationPerLevel: number };
  cm('fortification', 'подготовленная оборона и укреплённые полосы', ['9.7', '6.4', '3.2.2'], 'Как в модели действуют подготовленная оборона и укреплённые полосы: усиление, срок подготовки, темп «прогрызания».',
    [{ key: 'numbers', value: `подготовленная оборона: ×${d.prepared} после ${d.prepareHours} ч на месте` }, { key: 'numbers', value: `укреплённая полоса: +${d.fortificationPerLevel} к силе обороны за уровень` },
      { key: 'numbers', value: `темп через полосу уровня 1–3: ${(cal.fortAdvanceKm as number[]).slice(1).join(', ')} км/сут; пересечение рубежа — ${cal.fortCrossHours} ч` }, ...note('fortAdvance')]);
  cm('crossing', 'форсирование рек', ['9.7', '6.1', '3.2.4'], 'Сколько часов модель отводит на форсирование реки без переправы.',
    [{ key: 'numbers', value: `форсирование реки без моста или переправы: ${cal.riverCrossHours} ч` }]);
  const loss = (l: [number, number][], who: string) => l.map(([r, v]) => `${r}:1 — ${(v * 100).toFixed(1)} %`).join(', ') + ` (${who})`;
  cm('losses', 'потери в бою по соотношению сил', ['9.7', '3.4.3'], 'Доля потерь за сутки боя у наступающего и обороняющегося в зависимости от соотношения сил — откалиброванные таблицы.',
    [{ key: 'numbers', value: `наступающий: ${loss(cal.attackerLoss as [number, number][], 'потери в сутки при соотношении')}` }, { key: 'numbers', value: `обороняющийся: ${loss(cal.defenderLoss as [number, number][], 'потери в сутки при соотношении')}` }]);
  const sf = cal.supplyFlow as { fullHours: number; fuelPer100km: number };
  cm('supply-flow', 'подвоз как пропускная способность', ['9.7', '5.1', '5.2'], 'Подвоз полный, если путь от базы не длиннее заданного; горючее на марш — по пройденному пути.',
    [{ key: 'numbers', value: `подвоз полный при пути от базы до ${sf.fullHours} ч; горючее — ${sf.fuelPer100km} запр. на 100 км марша` }, ...note('supplyFlow')]);
}

/* ───────────── сводка боевого состава (oob.md) → операция ───────────── */
const curated: Entry[] = readdirSync(join(ROOT, 'packages/knowledge/data/curated')).filter((f) => f.endsWith('.json')).flatMap((f) => read(`packages/knowledge/data/curated/${f}`));
for (const e of curated) put(e);
{
  const md = readFileSync(join(SRC, 'berlin-1945-oob.md'), 'utf8');
  const secs = md.split(/\n### /).slice(1).map((p) => { const [h, ...r] = p.split('\n'); return { title: h.trim(), text: r.join('\n').split(/\n## /)[0].trim() }; });
  const op = entries.get('op:berlin')!;
  op.sections = [...(op.sections ?? []), ...secs];
}
for (const [op, file] of [['op:berlin', 'berlin-1945-halbe.json'], ['op:berlin', 'berlin-1945-reichstag.json'], ['op:berlin', 'berlin-1945-conquest.json'], ['op:berlin', 'berlin-1945-seelow-divisions.json'], ['op:vistula-oder', 'vistula-oder-1945-divisions.json']] as const) {
  const d = read(`docs/sources/${file}`);
  const e = entries.get(op)!;
  e.sections ??= [];
  if (d.gaps?.length) e.sections!.push({ title: `Пробелы в данных (${file})`, text: d.gaps.map((g: string) => `- ${g}`).join('\n') });
  if (d.contradictions_with_existing?.length) e.sections!.push({ title: `Расхождения источников (${file})`, text: d.contradictions_with_existing.map((c: { topic: string; existing: string; race: string; source?: string }) => `- **${c.topic}**: ранее — ${c.existing}; по книге — ${c.race} [${c.source ?? ''}]`).join('\n') });
}
for (const l of losses) { const e = entries.get(l.target); if (e) e.facts = dedupeFacts([...(e.facts ?? []), l.fact]); }

// разграничительные линии фронтов: директивы Ставки ВГК (документы — «Русский архив»), линия 2 БФ — по мемуарам
{
  const d = read('docs/sources/berlin-1945-boundaries.json');
  put({ id: 'src:RA_15', category: 'sources', group: 'books', title: 'Русский архив: Великая Отечественная. Т. 15 (4-5). Битва за Берлин', aliases: ['RA_15', 'Русский архив т. 15'], status: 'checked',
    summary: 'Сборник документов: директивы Ставки ВГК и Генштаба, боевые распоряжения и донесения фронтов и армий в Берлинской операции (с архивными шифрами ЦА МО и АП РФ).',
    facts: [{ key: 'ref', value: 'Русский архив: Великая Отечественная. Т. 15 (4-5). Битва за Берлин (Красная Армия в поверженной Германии). М.: Терра, 1995' }, { key: 'reliability', value: 'A' }, { key: 'covers', value: 'директивы о разграничительных линиях фронтов (№ 11059, 11060, 11074, 11077, 11078, 10850)' }] });
  put({ id: 'src:ROK_SD', category: 'sources', group: 'books', title: 'Рокоссовский К. К. Солдатский долг', aliases: ['ROK_SD'], status: 'checked',
    summary: 'Мемуары командующего 2-м Белорусским фронтом; пересказ директивы Ставки на Берлинскую операцию.',
    facts: [{ key: 'ref', value: 'Рокоссовский К. К. Солдатский долг. М.: Воениздат, 1988' }, { key: 'reliability', value: 'B' }, { key: 'covers', value: 'разграничительная линия 2 БФ / 1 БФ' }] });
  const nm = (id: string) => entries.get(`f:${id}`)?.title ?? id;
  for (const b of d.boundaries as { id: string; kind: string; right: string; left: string; title: string; from: string; until: string | null; points: { place: string }[]; inclusive?: string; inclusiveNote?: string; beyondEnd?: string; quote: string; source: { doc: string; archive?: string; reliability: string } }[]) {
    const src = b.source.reliability === 'A' ? 'src:RA_15' : 'src:ROK_SD';
    const pair = b.kind === 'air' ? 'советские ВВС / ВВС союзников' : `${nm(b.right)} / ${nm(b.left)}`;
    const value = `${pair} с ${b.from.slice(8, 10)}.${b.from.slice(5, 7)}${b.until ? ` до ${b.until.slice(8, 10)}.${b.until.slice(5, 7)}` : ''}: ${b.points.map((x) => x.place).join(' — ')}${b.inclusiveNote ? ` (${b.inclusiveNote})` : ''} — ${b.source.doc}`;
    const fact: Fact = { key: 'boundary', value, source: src, pages: b.source.archive, reliability: rel(b.source.reliability), quote: b.quote };
    const claim = boundaryClaim(b as Parameters<typeof boundaryClaim>[0]);
    const targets = b.kind === 'air' ? ['op:berlin'] : [`f:${b.right}`, `f:${b.left}`, 'op:berlin'];
    for (const t of targets) { const e = entries.get(t); if (e) { const withClaim = claim && t !== 'op:berlin'; e.facts = dedupeFacts([...(e.facts ?? []), withClaim ? { ...fact, claim } : fact]); } }
    const day = b.from.slice(0, 10);
    put({ id: `bnd:${b.id}`, category: 'chronology', group: 'berlin', title: `${dayRu(day)} — разграничительная линия: ${pair}`, period: { from: day, to: day }, status: 'checked',
      summary: `${b.title}: ${b.points.map((x) => x.place).join(' — ')}.${b.beyondEnd ? ` ${b.beyondEnd[0].toUpperCase()}${b.beyondEnd.slice(1)}.` : ''}`,
      facts: [{ key: 'date', value: day }, { key: 'event', value: `${b.source.doc}: ${b.title.toLowerCase()}`, source: src, pages: b.source.archive, reliability: rel(b.source.reliability), quote: b.quote }, { key: 'place', value: b.points.map((x) => x.place).join(', ') }],
      relations: [{ type: 'related', target: 'op:berlin' }, ...(b.kind === 'air' ? [] : [{ type: 'related' as const, target: `f:${b.right}` }, { type: 'related' as const, target: `f:${b.left}` }]), { type: 'source', target: src }] });
  }
  const op = entries.get('op:berlin')!;
  op.sections = [...(op.sections ?? []), { title: 'Разграничительные линии фронтов: пробелы в данных', text: (d.gaps as { what: string; why: string; where: string }[]).map((g) => `- **${g.what}** — ${g.why}. Где искать: ${g.where}.`).join('\n') }];
}

/* ───────────── архивные документы (ЦАМО): выписки по схеме docs/tsamo-agent-task.md ───────────── */
// Тексты документов в базу не попадают — только короткие пересказы и рубежи из выписок, со ссылкой на фонд, опись, дело и лист.
{
  type Pos = { army: string; unit: string; date: string | null; time?: string | null; kind: string; place: string; source: string; url?: string; lat?: number | null; lon?: number | null; approxKm?: number | null };
  type Ord = { to: string; from: string; issued: string | null; received?: string | null; task: string; target: string; deadline?: string | null; source: string; note?: string | null };
  type Enm = { date: string; formation: string; german?: string; personnel?: number | null; tanks?: number | null; guns?: number | null; strengthNote?: string; place?: string; against?: string; docType?: string; source: string; note?: string };
  type Sup = { army: string; date: string; fuel?: number | null; ammo?: number | null; units?: string | null; event: string; text: string; distanceKm?: number | null; source: string };
  type Man = { fond: string; opis: string; delo: string; title: string; dates: string; url?: string; readSheets?: string; covers?: string[]; gaps?: string };
  const opt = <T,>(f: string): T[] => { try { return read(`docs/sources/${f}`) as T[]; } catch { return []; } };
  const positions = [...opt<Pos>('vistula-oder-1945-tsamo.json'), ...opt<Pos>('vistula-oder-1945-tsamo-2/positions.json'), ...opt<Pos>('berlin-1945-tsamo/positions.json')];
  const orders = [...opt<Ord>('vistula-oder-1945-tsamo-2/orders.json'), ...opt<Ord>('berlin-1945-tsamo/orders.json')];
  const enemy = [...opt<Enm>('vistula-oder-1945-tsamo-2/enemy.json'), ...opt<Enm>('berlin-1945-tsamo/enemy.json')];
  const supply = opt<Sup>('vistula-oder-1945-tsamo-2/supply.json');
  const manifest = opt<Man>('vistula-oder-1945-tsamo-2/manifest.json');
  const opOf = (d?: string | null) => (d && /^1945-0[45]/.test(d) ? 'berlin' : 'vistula');
  const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  const cut = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  // источник: «ЦАМО, ф. 233, оп. 2356, д. 739, л. 211» → src:camo-233-2356-739 и лист
  const docOf = (src: string) => {
    const m = /ф\.\s*([\dА-Яа-я-]+),\s*оп\.\s*([\dА-Яа-я-]+),\s*д\.\s*([\dА-Яа-я-]+)(?:,\s*(.*))?/.exec(src);
    return m ? { id: `src:camo-${m[1]}-${m[2]}-${m[3]}`, ref: `ЦАМО, ф. ${m[1]}, оп. ${m[2]}, д. ${m[3]}`, pages: m[4]?.trim() } : null;
  };
  const used = new Map<string, Set<string>>();
  const useDoc = (src: string, what: string) => { const d = docOf(src); if (!d) return undefined; (used.get(d.id) ?? used.set(d.id, new Set()).get(d.id)!).add(what); if (!entries.has(d.id)) put({ id: d.id, category: 'sources', group: 'books', title: d.ref, aliases: [d.ref], summary: d.ref, status: 'checked', facts: [{ key: 'ref', value: d.ref }, { key: 'reliability', value: 'A' }] }); return d; };
  for (const m of manifest) {
    const ref = `ЦАМО, ф. ${m.fond}, оп. ${m.opis}, д. ${m.delo}`;
    put({ id: `src:camo-${m.fond}-${m.opis}-${m.delo}`, category: 'sources', group: 'books', title: cut(`${ref} — ${m.title}`, 140), aliases: [ref], summary: `${m.title} (${m.dates}).`, status: 'checked',
      facts: [{ key: 'ref', value: `${ref}${m.url ? ` — ${m.url}` : ''}` }, { key: 'reliability', value: 'A' }, { key: 'covers', value: `${m.dates}; прочитано: ${m.readSheets ?? '—'}` }],
      sections: m.gaps ? [{ title: 'Что не прочитано или отсутствует', text: m.gaps }] : [] });
  }
  // формирования базы по сокращению: «47-я армия» → «47 А», «1-й Белорусский фронт» → «1 БФ», «344-я пехотная дивизия» → «344 пд»
  const abbr = (name: string): string | null => {
    const m = /^(\d+)-[яйе]\s+(.*?)(?:\s*\(.*)?$/.exec(name.trim());
    if (!m) return null;
    const [, n, rest] = m; const gv = /гвардейск/.test(rest) ? 'гв. ' : ''; const r = rest.replace(/гвардейск\S*\s*/, '');
    const T: [RegExp, string][] = [[/Польск/, 'ПА'], [/^Белорусский фронт/, 'БФ'], [/^Украинский фронт/, 'УФ'], [/^ударная армия/, 'УА'], [/^танковая армия/, `${gv}ТА`], [/^армия/, `${gv}А`],
      [/^танковый корпус/, `${gv}тк`], [/^механизированный корпус/, `${gv}мк`], [/^кавалерийский корпус/, `${gv}кк`], [/^стрелковый корпус/, `${gv}ск`],
      [/^пехотная дивизия/, 'пд'], [/^танковая дивизия/, 'тд'], [/^(панцергренадерская|моторизованная)/, 'мд'], [/^горнопехотная|^горно-?егерская|^егерская/, 'гсд'], [/^лёгкая пехотная|^легкая пехотная/, 'лпд'], [/^народно-гренадерская/, 'нгд']];
    for (const [re, a] of T) if (re.test(r)) return `${n} ${a}`;
    return null;
  };
  const idx = new Map<string, string[]>();
  for (const e of entries.values()) if (e.category === 'formations') { const a = abbr(e.title); if (a) idx.set(`${e.group}:${a}`, [...(idx.get(`${e.group}:${a}`) ?? []), e.id]); }
  const norm = (n: string) => n.replace(/\s*Уд\.\s*А$/, ' УА').replace(/\s*А\s?ВП$/, ' ПА').replace(/\s+/g, ' ').trim();
  const findF = (side: 'su' | 'de', name: string, op: string) => {
    const c = idx.get(`${side}:${norm(name)}`) ?? (side === 'de' ? idx.get(`de:${norm(name).replace(/ (нгд|пгд)$/, ' пд')}`) : undefined);
    if (!c) return undefined;
    return [...c].sort((a, b) => (op === 'vistula' ? +!a.endsWith('_vo') - +!b.endsWith('_vo') : +a.endsWith('_vo') - +b.endsWith('_vo')) || (entries.get(b)!.facts?.length ?? 0) - (entries.get(a)!.facts?.length ?? 0))[0];
  };
  const addLine = (id: string, title: string, line: string) => {
    const e = entries.get(id)!; e.sections ??= [];
    const s = e.sections.find((x) => x.title === title) ?? (e.sections.push({ title, text: '' }), e.sections[e.sections.length - 1]);
    s.text += `${s.text ? '\n' : ''}- ${line}`;
  };
  const link = (id: string, src?: string) => { if (!src) return; const e = entries.get(id)!; e.relations = dedupeRel([...(e.relations ?? []), { type: 'source', target: src }]); };
  const OP_ID = { berlin: 'op:berlin', vistula: 'op:vistula-oder' } as const;
  const cite = (src: string) => src.replace(/^ЦАМО,\s*/, '');
  // положения по дням → армии и корпуса; главные силы армий → хронология
  const days2 = new Map<string, string[]>();
  for (const p of [...positions].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))) {
    if (!p.date) continue;
    const op = opOf(p.date); const army = /^армия/.test(p.unit); const name = army ? p.army : p.unit;
    const d = useDoc(p.source, 'положения');
    const f = findF('su', name, op);
    const line = `${ddmm(p.date)}${p.time && p.time !== 'к исходу дня' ? ` (${p.time})` : ''}${p.kind !== 'главные силы' ? ` — ${p.kind}` : ''}: ${cut(p.place, 220)} [${cite(p.source)}]`;
    if (f) {
      addLine(f, 'Положения по дням (документы ЦАМО)', line); link(f, d?.id);
      if (inScenario(f.slice(2))) addClaimFacts(f, [positionClaim({ subject: f.slice(2), date: p.date, time: p.time, place: cut(p.place, 200), lng: p.lon, lat: p.lat, approxKm: p.approxKm, reliability: 'A', src: d?.id, pages: d?.pages })]);
      else skipClaim('положение: формирования нет в сценариях');
    }
    if (army && p.kind === 'главные силы') { const k = `${op}:${p.date.slice(0, 10)}`; days2.set(k, [...(days2.get(k) ?? []), `${p.army}: ${cut(p.place, 140)} [${cite(p.source)}]`]); }
  }
  for (const [k, items] of [...days2].sort()) {
    const [op, date] = k.split(':');
    put({ id: `day:${k}`, category: 'chronology', group: op, title: `${dayRu(date)} — ${op === 'berlin' ? 'Берлинская операция' : 'Висло-Одерская операция'}`, period: { from: date, to: date }, status: 'checked',
      summary: `Рубежи армий за день по журналам боевых действий (ЦАМО).`, facts: [{ key: 'date', value: date }],
      sections: [{ title: 'Рубежи армий по документам ЦАМО', text: items.map((x) => `- ${x}`).join('\n') }], relations: [{ type: 'part_of', target: OP_ID[op as 'berlin' | 'vistula'] }] });
    const e = entries.get(`day:${k}`)!;
    if (!e.sections!.some((s) => s.title === 'Рубежи армий по документам ЦАМО')) e.sections!.push({ title: 'Рубежи армий по документам ЦАМО', text: items.map((x) => `- ${x}`).join('\n') });
  }
  // приказы → адресат (армия, корпус, фронт) и операция
  for (const o of [...orders].sort((a, b) => (a.issued ?? '').localeCompare(b.issued ?? ''))) {
    const op = opOf(o.issued ?? o.deadline); const d = useDoc(o.source, 'приказы');
    const when = o.issued ? `${ddmm(o.issued)}${o.issued.length > 10 ? ` ${o.issued.slice(11, 16)}` : ''}` : 'дата не указана';
    const line = `${when} — от ${o.from} (${o.task}): ${cut(o.target, 300)}${o.deadline ? `; срок — ${ddmm(o.deadline)}` : ''} [${cite(o.source)}${o.note ? `; ${cut(o.note, 100)}` : ''}]`;
    const targets = o.to.split(/;\s*|,\s*(?=\d)/).map((t) => findF('su', t, op)).filter((x): x is string => !!x);
    for (const f of targets) { addLine(f, 'Приказы и распоряжения (документы ЦАМО)', line); link(f, d?.id); }
    addLine(OP_ID[op], 'Приказы и распоряжения по документам ЦАМО', `${o.to}: ${line}`); link(OP_ID[op], d?.id);
  }
  // разведка → немецкие дивизии (если запись об одной дивизии) и операция
  for (const x of [...enemy].sort((a, b) => a.date.localeCompare(b.date))) {
    const op = opOf(x.date); const d = useDoc(x.source, 'противник');
    const nums = [x.personnel != null ? `${x.personnel.toLocaleString('ru')} чел.` : '', x.tanks != null ? `танков ${x.tanks}` : '', x.guns != null ? `орудий ${x.guns}` : ''].filter(Boolean).join(', ');
    const line = `${ddmm(x.date)} — ${x.formation}${x.place ? ` (${cut(x.place, 120)})` : ''}${nums ? `: ${nums}` : ''}${x.strengthNote ? ` — ${cut(x.strengthNote, 260)}` : ''} [${x.docType ?? 'документ'}; ${cite(x.source)}]`;
    addLine(OP_ID[op], 'Противник по разведсводкам и журналам (документы ЦАМО)', line); link(OP_ID[op], d?.id);
    const one = /^\d+\s+\S+$/.test(x.formation.replace(/\s*\(.*\)$/, '').trim()) ? findF('de', x.formation.replace(/\s*\(.*\)$/, ''), op) : undefined;
    if (one) {
      const e = entries.get(one)!;
      const facts: Fact[] = [];
      for (const [k, v] of [['personnel', x.personnel], ['tanks', x.tanks], ['guns', x.guns]] as const) if (v != null) facts.push({ key: k, value: `${v.toLocaleString('ru')} (на ${ddmm(x.date)}.${x.date.slice(0, 4)}, по разведке${x.against ? ` перед ${x.against}` : ''})`, source: d?.id, pages: d?.pages, reliability: 'B' });
      e.facts = dedupeFacts([...(e.facts ?? []), ...facts]);
      addLine(one, 'Разведка (документы ЦАМО)', line); link(one, d?.id);
    }
  }
  // снабжение → армии
  for (const x of [...supply].sort((a, b) => a.date.localeCompare(b.date))) {
    const op = opOf(x.date); const d = useDoc(x.source, 'снабжение');
    const f = findF('su', x.army, op);
    const line = `${ddmm(x.date)} — ${x.event}: ${cut(x.text, 300)} [${cite(x.source)}]`;
    if (f) { addLine(f, 'Горючее и боеприпасы (документы ЦАМО)', line); link(f, d?.id); }
    else { addLine(OP_ID[op], 'Горючее и боеприпасы по документам ЦАМО', `${x.army}: ${line}`); link(OP_ID[op], d?.id); }
  }
  for (const [id, what] of used) { const e = entries.get(id); if (e) e.facts = dedupeFacts([...(e.facts ?? []), { key: 'covers', value: `в базе: ${[...what].join(', ')}` }]); }
}

/* ───────────── всё, чем пользуется модель: доктрины, нормативы, параметры, силы и тыл, объекты, потери ───────────── */
// Источники каждого файла — свои записи-источники; ключ, уже занятый другой библиографической записью, — с префиксом файла.
{
  const cutx = (t: string, n = 480) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
  const fileSrc = new Map<string, Map<string, string>>();
  const regSources = (file: string, dict: Record<string, { ref?: string; title?: string; url?: string; default_reliability?: string; note?: string }> | undefined) => {
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(dict ?? {})) {
      const ref = (v.ref ?? v.title ?? k).trim();
      const old = entries.get(`src:${k}`);
      const same = old && (old.facts ?? []).some((f) => f.key === 'ref' && f.value === ref);
      const id = !old || same ? `src:${k}` : `src:${slug(file.replace(/\.json$/, ''))}-${slug(k)}`;
      const web = /wikipedia|wiki|\.ru\b|\.com|\.org|http/i.test(`${ref} ${v.url ?? ''}`);
      put({ id, category: 'sources', group: web ? 'web' : 'books', title: sourceTitle(ref) || k, aliases: [k], summary: ref, status: 'checked',
        facts: [{ key: 'ref', value: ref }, ...(v.url ? [{ key: 'ref', value: v.url }] : []), ...(v.default_reliability ? [{ key: 'reliability', value: v.default_reliability }] : []), ...(v.note ? [{ key: 'covers', value: cutx(v.note, 300) }] : []), { key: 'covers', value: `набор данных ${file}` }] });
      m.set(k, id);
    }
    fileSrc.set(file, m);
  };
  const sref = (file: string, s?: string | null) => { if (!s) return undefined; const k = String(s).split(/[\s;,(]/)[0]; return fileSrc.get(file)?.get(k) ?? srcId(String(s)); };
  const addFacts = (id: string, fs: Fact[]) => { const e = entries.get(id); if (e) e.facts = dedupeFacts([...(e.facts ?? []), ...fs]); return !!e; };
  const addSection = (id: string, title: string, lines: string[]) => {
    const e = entries.get(id); if (!e || !lines.length) return;
    const old = (e.sections ?? []).find((s) => s.title === title);
    if (old) old.text = `${old.text}\n${lines.join('\n')}`; else e.sections = [...(e.sections ?? []), { title, text: lines.join('\n') }];
  };
  const ensureF = (id: string, title: string, side: string, more: Partial<Entry> = {}) => {
    if (!entries.has(`f:${id}`)) put({ id: `f:${id}`, category: 'formations', group: side === 'de' ? 'de' : 'su', title, status: 'draft', summary: '', facts: [{ key: 'side', value: SIDE[side] ?? side }], relations: [], ...more });
    return `f:${id}`;
  };
  const ddmm2 = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}${d.length > 10 ? ` ${d.slice(11, 16)}` : ''}` : '');
  const opt = <T,>(f: string): T | null => { try { return read(`docs/sources/${f}`) as T; } catch { return null; } };

  // реестр дивизий-агентов: каждая дивизия — запись формирования
  const reg = opt<{ divisions: { id: string; side: string; name_ru: string; abbr?: string[]; aliases?: string[]; subordination?: { parent?: string; army?: string; corps?: string; from?: string }[]; kind?: string; note?: string }[] }>('berlin-1945-divisions.json');
  for (const d of reg?.divisions ?? []) {
    const id = ensureF(d.id, d.name_ru, d.side, { aliases: [...(d.abbr ?? []), ...(d.aliases ?? [])].filter(Boolean) });
    const sub = (d.subordination ?? [])[0] as Record<string, string> | undefined;
    const parent = sub ? sub.corps ?? sub.army ?? sub.parent : undefined;
    // claim первой строки — на уже пишущийся факт (тот же вышестоящий), остальные строки — новыми фактами
    const pcs = parentClaims(d, (x) => fname.get(x) ?? x);
    const same = pcs.find((f) => f.claim?.kind === 'parent' && f.claim.parent === parent && f.claim.from === (sub?.date ?? '').slice(0, 10));
    addFacts(id, [{ key: 'echelon', value: 'дивизия' }, ...(parent ? [{ key: 'parent', value: fname.get(parent) ?? parent, ...(same ? { claim: same.claim, reliability: same.reliability } : {}) }] : []), ...(d.note ? [{ key: 'path', value: cutx(d.note, 300) }] : [])]);
    if (parent && entries.has(`f:${parent}`)) { const e = entries.get(id)!; e.relations = dedupeRel([...(e.relations ?? []), { type: 'part_of', target: `f:${parent}` }]); }
    addClaimFacts(id, pcs.filter((f) => f !== same));
  }

  // доктрины сторон (свод правил «условие → действие» с нормативами); рубрики — по теме группы правил
  const DOCTRINE_RUBRICS: Record<string, string[]> = {
    frontage: ['3.1.1', '3.4.2'], echelons: ['3.1.1', '3.2.1'], depth: ['3.1.1'], tempo: ['3.4.1', '3.1.3'], commit: ['3.1.3', '3.3.2'],
    stop: ['3.2.2', '3.1.4'], bypass: ['3.1.3', '3.2.1'], regroup: ['3.1.4', '7.3'], reserve: ['3.1.4'], artillery: ['3.3.1'], air: ['3.3.3'],
    layout: ['3.2.2', '6.4'], counterattack: ['3.1.4', '3.2.2'], withdrawal: ['3.2.2'], reserves: ['3.1.4', '3.2.2'], timing: ['3.4.4', '7.3'],
  };
  const GROUP_RU: Record<string, string> = { frontage: 'ширина полос и участков прорыва', echelons: 'построение в эшелоны', depth: 'глубина задач', tempo: 'темп наступления', commit: 'ввод вторых эшелонов и подвижных групп', stop: 'остановка и переход к обороне', bypass: 'обход узлов обороны', regroup: 'перегруппировка', reserve: 'резервы', artillery: 'артиллерийское наступление', air: 'авиационное обеспечение', layout: 'построение обороны', counterattack: 'контратаки и контрудары', withdrawal: 'отход и отвод с первой позиции', reserves: 'резервы обороны', timing: 'сроки' };
  const LEVEL_RU: Record<string, string> = { front: 'фронт', army: 'армия', corps: 'корпус', division: 'дивизия' };
  for (const file of ['soviet-offensive-doctrine-1945.json', 'soviet-offensive-doctrine-1945-tsamo.json', 'german-defence-doctrine-1945.json']) {
    const d = opt<{ meta?: { title?: string }; sources?: Record<string, { ref: string }>; rules: { id: string; group: string; level?: string; condition?: string; action: string; values?: unknown; source?: string; page?: string; reliability?: string; note?: string }[]; examples?: Record<string, unknown>[]; gaps?: unknown[] }>(file);
    if (!d) continue;
    regSources(file, d.sources);
    const side = file.startsWith('german') ? 'de' : 'su';
    const tsamo = file.includes('tsamo');
    const groups = [...new Set(d.rules.map((r) => r.group))];
    for (const g of groups) {
      const rs = d.rules.filter((r) => r.group === g);
      const id = `org:${side}-doctrine-${g}`;
      put({ id, category: 'organization', group: side, rubrics: DOCTRINE_RUBRICS[g] ?? ['3.1'], title: `${side === 'su' ? 'Наступление Красной армии, 1945' : 'Оборона вермахта, 1945'}: ${GROUP_RU[g] ?? g}`, status: 'checked',
        summary: `Положения доктрины и практики ${side === 'su' ? 'наступления фронтов, армий, корпусов и дивизий' : 'обороны армий, корпусов и дивизий'} с нормативами — по уставам, исследованиям${tsamo ? ' и документам ЦАМО' : ''}; на них опираются штабы агентной модели.`,
        facts: [{ key: 'side', value: SIDE[side] }, { key: 'topic', value: GROUP_RU[g] ?? g },
          ...rs.map((r) => ({ key: 'principles', value: cutx(`${r.level ? `[${LEVEL_RU[r.level] ?? r.level}] ` : ''}${r.condition ? `${r.condition} → ` : ''}${r.action}${r.values ? ` (${normValue(r.values)})` : ''}${r.note ? `. ${r.note}` : ''}`), source: sref(file, r.source), pages: r.page, reliability: rel(r.reliability) })),
          ...(tsamo ? [{ key: 'covers', value: 'практика 1-го Белорусского фронта по документам ЦАМО' }] : [])],
        relations: [...new Set(rs.map((r) => sref(file, r.source)).filter(Boolean) as string[])].map((t) => ({ type: 'source' as const, target: t })) });
    }
    const top = `org:${side}-doctrine-${groups[0]}`;
    addSection(top, `Примеры из операций (${file})`, (d.examples ?? []).map((x) => `- ${cutx(Object.entries(x).filter(([k]) => !/^(id|source|page|reliability)$/.test(k)).map(([, v]) => (typeof v === 'object' ? normValue(v) : String(v))).join('; '), 400)}${x.source ? ` [${x.source}${x.page ? `, ${x.page}` : ''}]` : ''}`));
    addSection(top, `Пробелы (${file})`, (d.gaps ?? []).map((x) => `- ${typeof x === 'string' ? x : normValue(x)}`));
  }

  // нормативы боя дивизии (ширина, темп, артиллерия, потери, соотношения, сроки, срыв)
  const NG: Record<string, string> = { frontage: 'ширина полосы', pace: 'темп продвижения', artillery: 'артиллерия', losses: 'потери в бою', ratio: 'соотношение сил', timing: 'сроки и задержки', breakpoint: 'предел потерь (срыв атаки, утрата боеспособности)' };
  const dn = opt<{ sources?: Record<string, { ref: string }>; norms: { id: string; group: string; title: string; value: unknown; unit?: string; context?: string; source?: string; page?: string; reliability?: string; note?: string }[]; gaps?: string[] }>('division-combat-norms.json');
  if (dn) {
    regSources('division-combat-norms.json', dn.sources);
    for (const g of [...new Set(dn.norms.map((n) => n.group))]) {
      const ns = dn.norms.filter((n) => n.group === g);
      put({ id: `org:norms-division-${g}`, category: 'organization', group: 'su', rubrics: ({ frontage: ['3.4.2', '3.2.1'], pace: ['3.4.1'], artillery: ['3.3.1', '3.4.2'], losses: ['3.4.3'], ratio: ['3.4.2', '3.2.1'], timing: ['3.4.4'], breakpoint: ['3.4.3', '3.2.2'] } as Record<string, string[]>)[g] ?? ['3.4'], title: `Нормативы боя дивизии: ${NG[g] ?? g}`, status: 'checked',
        summary: 'Нормативы для дивизий 1944–1945 гг. (советские уставы и исследования, западные расчёты Дюпюи и HERO) — на них настроены параметры агентной модели.',
        facts: [{ key: 'topic', value: NG[g] ?? g }, ...ns.map((n) => ({ key: 'numbers', value: cutx(`${n.title}: ${normValue(n.value)}${n.unit ? ` ${n.unit}` : ''}${n.context ? ` — ${n.context}` : ''}`), source: sref('division-combat-norms.json', n.source), pages: n.page, reliability: rel(n.reliability) }))],
        relations: [{ type: 'related', target: 'org:model-agents-params' }] });
    }
    if (dn.gaps?.length) addSection(`org:norms-division-${dn.norms[0].group}`, 'Пробелы в нормативах', dn.gaps.map((x) => `- ${x}`));
  }

  // распад и остатки дивизий (пороги, сведение остатков)
  const rm = opt<{ rules: { id: string; side: string; topic: string; fact: string; value?: unknown; unit?: string; source?: string; url?: string; reliability?: string }[]; examples?: { division: string; side: string; date?: string; what: string; source?: string; reliability?: string }[] }>('division-remnants-1945.json');
  if (rm) for (const side of ['su', 'de']) {
    const rs = rm.rules.filter((r) => r.side === side);
    if (!rs.length) continue;
    put({ id: `org:${side}-remnants`, category: 'organization', group: side, rubrics: ['3.4.3', '3.2.2'], title: `${side === 'su' ? 'Красная армия' : 'Вермахт'}, 1945: когда дивизия теряет боеспособность и что с остатками`, status: 'checked',
      summary: 'Пороги боеспособности, сроки, рассеяние и сведение остатков разбитых дивизий — основа правил распада в агентной модели.',
      facts: [{ key: 'side', value: SIDE[side] }, ...rs.map((r) => ({ key: r.value != null ? 'numbers' : 'principles', value: cutx(`${({ threshold: 'порог боеспособности', remnants: 'остатки', timing: 'сроки', dispersal: 'рассеяние' } as Record<string, string>)[r.topic] ?? r.topic}: ${r.fact}${r.value != null ? ` (${normValue(r.value)}${r.unit ? ` ${r.unit}` : ''})` : ''}`), source: srcId(r.source ?? '') , reliability: rel(r.reliability), ...(r.source ? { pages: cutx(r.source, 160) } : {}) })),
        ...(rm.examples ?? []).filter((x) => x.side === side).map((x) => ({ key: 'numbers', value: cutx(`${x.division}${x.date ? `, ${ddmm2(x.date)}` : ''}: ${x.what}`), reliability: rel(x.reliability), ...(x.source ? { pages: cutx(x.source, 160) } : {}) }))] });
  }

  // параметры агентной модели: значение, источник или допущение
  {
    const ag = read('packages/sim/data/rules/agents-v0.json');
    const facts: Fact[] = [];
    const walk = (o: unknown, path: string) => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return;
      const r = o as Record<string, unknown>;
      if ('value' in r) {
        const how = [r.source ? `источник: ${r.source}` : '', r.assumption ? `допущение: ${r.assumption}` : '', r.norm ? `норматив ${r.norm}` : '', r.rule ? `правило ${r.rule}` : ''].filter(Boolean).join('; ');
        facts.push({ key: 'numbers', value: cutx(`${path} = ${normValue(r.value)}${r.unit ? ` ${r.unit}` : ''}${how ? ` — ${how}` : ''}`, 600), reliability: rel(r.reliability) });
        return;
      }
      for (const [k, v] of Object.entries(r)) if (!k.startsWith('_') && k !== 'id') walk(v, path ? `${path}.${k}` : k);
    };
    walk(ag, '');
    put({ id: 'org:model-agents-params', category: 'organization', group: 'model', title: 'Агентная модель: параметры, их источники и допущения', status: 'checked',
      summary: `Все числовые параметры агентной модели (packages/sim/data/rules/agents-v0.json): ${facts.length} значений; у каждого — источник с достоверностью или пометка «допущение» с обоснованием.`, facts });
    const nm = read('packages/sim/data/rules/norms.json') as { norms: { id: string; title: string; source?: string; reliability?: string; historical?: string; expect?: [number, number]; unit?: string; rules?: string[]; note?: string }[]; findings?: string[] };
    put({ id: 'org:model-norms-check', category: 'organization', group: 'model', title: 'Модель: проверка нормативами (что должно получаться в расчёте)', status: 'checked',
      summary: 'Исторические нормативы и темпы, с которыми сверяется расчёт нынешней модели (npm run sim:norms): исторический показатель, ожидаемый диапазон результата модели и правила, которые он проверяет.',
      facts: nm.norms.map((n) => ({ key: 'numbers', value: cutx(`${n.title}: по истории — ${n.historical ?? '—'}; ожидается в расчёте ${n.expect ? `${n.expect[0]}–${n.expect[1]}` : '—'}${n.unit ? ` ${n.unit}` : ''}${n.rules?.length ? `; правила: ${n.rules.join(', ')}` : ''}`), source: srcId(n.source), reliability: rel(n.reliability) })),
      sections: nm.findings?.length ? [{ title: 'Выводы проверки', text: nm.findings.map((f) => `- ${f}`).join('\n') }] : undefined });
  }

  // сроки отдачи приказов и исходные положения → формирования
  for (const o of (opt<{ orders: { order: string; issuedAt: string; reliability?: string; source?: string; quote?: string }[] }>('orders-timing-1945.json')?.orders ?? [])) {
    const [fid, rest] = o.order.split('@');
    addFacts(`f:${fid}`, [{ key: 'path', value: cutx(`приказ ${rest?.split(':').pop() ?? ''} отдан ${ddmm2(o.issuedAt)} (МСК) — ${o.source ?? ''}`, 300), reliability: rel(o.reliability), quote: o.quote }]);
  }
  const sp = opt<Record<string, { formation: string; time: string; place: string; approxKm?: number; reliability?: string; source?: string; quote?: string }[]>>('start-positions-1945.json');
  for (const [k, rows] of Object.entries(sp ?? {})) if (Array.isArray(rows)) for (const p of rows)
    addFacts(`f:${p.formation}`, [{ key: 'path', value: cutx(`исходное положение ${ddmm2(p.time)} (${k.startsWith('berlin') ? 'Берлинская операция' : 'Висло-Одерская операция'}): ${p.place}${p.approxKm ? ` (±${p.approxKm} км)` : ''}`, 300), pages: p.source ? cutx(p.source, 160) : undefined, reliability: rel(p.reliability), quote: p.quote }]);

  // артподготовка 16 апреля, отвод с первой позиции
  const ap = opt<{ sources?: Record<string, { ref: string }>; withdrawal?: Record<string, unknown>[]; prep?: Record<string, unknown>[]; effect?: Record<string, unknown>[]; gaps?: string[] }>('berlin-1945-artillery-prep.json');
  if (ap) {
    regSources('berlin-1945-artillery-prep.json', ap.sources);
    const s = (x: Record<string, unknown>) => sref('berlin-1945-artillery-prep.json', x.source as string);
    const line = (x: Record<string, unknown>, skip: string[]) => cutx(Object.entries(x).filter(([k, v]) => v != null && v !== '' && !['source', 'page', 'reliability', ...skip].includes(k)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? normValue(v) : v}`).join('; '));
    put({ id: 'org:su-artillery-prep-16apr', category: 'organization', group: 'su', title: 'Артиллерийская подготовка 16 апреля 1945 г. и отвод немцев с первой позиции', status: 'checked',
      summary: 'Артподготовка 1-го Белорусского и 1-го Украинского фронтов: начало, продолжительность, плотность, прожекторы; заблаговременный отвод войск 9-й армии с первой позиции и действенность огня — для сценариев агентной модели.',
      facts: [...(ap.prep ?? []).map((x) => ({ key: 'numbers', value: line(x, []), source: s(x), pages: x.page as string, reliability: rel(x.reliability) })),
        ...(ap.withdrawal ?? []).map((x) => ({ key: 'principles', value: `отвод: ${line(x, [])}`, source: s(x), pages: x.page as string, reliability: rel(x.reliability) })),
        ...(ap.effect ?? []).map((x) => ({ key: 'numbers', value: `действенность: ${line(x, [])}`, source: s(x), pages: x.page as string, reliability: rel(x.reliability) }))],
      relations: [{ type: 'related', target: 'battle:seelow' }], sections: ap.gaps?.length ? [{ title: 'Пробелы', text: ap.gaps.map((g) => `- ${g}`).join('\n') }] : undefined });
  }

  // суточные потери, огонь, численность по армиям (16–20.04)
  for (const file of ['berlin-1945-losses-daily.json', 'berlin-1945-losses-daily-tsamo.json']) {
    const d = opt<{ sources?: Record<string, { ref: string }>; records: { date?: string; date_end?: string; period?: string; side: string; formation: string; name?: string; kind: string; values?: Record<string, unknown>; target?: string; source?: string; page?: string; reliability?: string; note?: string }[] }>(file);
    if (!d) continue;
    regSources(file, d.sources);
    const KR: Record<string, string> = { own_losses: 'потери', enemy_claimed: 'потери противника (по донесению)', strength: 'численность', fire: 'огонь' };
    for (const r of d.records) {
      const when = r.period ?? `${ddmm2(r.date)}${r.date_end && r.date_end !== r.date ? `–${ddmm2(r.date_end)}` : ''}`;
      const v = r.values ? Object.entries(r.values).filter(([, x]) => x != null).map(([k, x]) => `${({ killed: 'убито', wounded: 'ранено', missing: 'пропало', total: 'всего', personnel: 'людей', tanks: 'танков', guns: 'орудий', other_reasons: 'по другим причинам', crew_killed_wounded: 'экипажей убито и ранено' } as Record<string, string>)[k] ?? k} ${typeof x === 'number' ? x.toLocaleString('ru') : normValue(x)}`).join(', ') : '';
      const fact: Fact = { key: r.kind === 'strength' ? 'personnel' : 'losses', value: cutx(`${KR[r.kind] ?? r.kind}, ${when}: ${v}${r.target ? ` — ${r.target}` : ''}${r.note ? ` (${r.note})` : ''}`, 360), source: sref(file, r.source), pages: r.page, reliability: rel(r.reliability) };
      const lc = lossesClaim(r);
      if (lc) fact.claim = lc;
      if (!addFacts(`f:${r.formation}`, [fact])) addFacts('battle:seelow', [{ ...fact, value: `${r.name ?? r.formation}: ${fact.value}` }]);
    }
  }

  // немецкие силы: численность по датам, части вне дивизий, итоги
  const gf = opt<{ sources?: Record<string, { ref: string }>; strength?: { date: string; formation: string; formation_name?: string; values: Record<string, unknown>; source?: string; page?: string; reliability?: string; note?: string }[]; nondivisional?: Record<string, unknown>[]; totals?: { formation: string; date: string; what: string; value: unknown; source?: string; reliability?: string; page?: string }[]; gaps?: string[] }>('berlin-1945-german-forces.json');
  const unitEntry = (file: string, u: Record<string, unknown>, what: string) => {
    const id = ensureF(String(u.id), String(u.name ?? u.id), 'de');
    const e = entries.get(id)!;
    if (!e.summary) e.summary = cutx(`${what}${u.kind ? `: ${u.kind}` : ''}${u.area ? `, ${u.area}` : ''}${u.note ? `. ${u.note}` : ''}`, 400);
    const src = sref(file, u.source as string);
    addFacts(id, [
      ...(u.subordination ? [{ key: 'parent', value: fname.get(String(u.subordination)) ?? String(u.subordination), source: src }] : []),
      ...(u.personnel != null ? [{ key: 'personnel', value: `${Number(u.personnel).toLocaleString('ru')}${u.date ? ` (на ${ddmm2(String(u.date))})` : ''}`, source: src, pages: u.page as string, reliability: rel(u.reliability) }] : []),
      ...(u.guns != null ? [{ key: 'guns', value: String(u.guns), source: src, reliability: rel(u.reliability) }] : []),
      ...(u.tanks != null ? [{ key: 'tanks', value: String(u.tanks), source: src, reliability: rel(u.reliability) }] : []),
      ...(u.fate ? [{ key: 'path', value: cutx(String(u.fate), 400), source: src, reliability: rel(u.reliability) }] : []),
      { key: 'composition', value: `${what}${u.kind ? ` (${u.kind})` : ''}` },
    ]);
    if (u.subordination && entries.has(`f:${u.subordination}`)) e.relations = dedupeRel([...(e.relations ?? []), { type: 'part_of', target: `f:${u.subordination}` }]);
  };
  if (gf) {
    regSources('berlin-1945-german-forces.json', gf.sources);
    for (const s of gf.strength ?? []) {
      const id = ensureF(s.formation, s.formation_name ?? fname.get(s.formation) ?? s.formation, 'de');
      addFacts(id, [{ key: 'personnel', value: cutx(`${Object.entries(s.values).map(([k, v]) => `${k} ${typeof v === 'number' ? v.toLocaleString('ru') : normValue(v)}`).join(', ')} (на ${ddmm2(s.date)})${s.note ? ` — ${s.note}` : ''}`, 360), source: sref('berlin-1945-german-forces.json', s.source), pages: s.page, reliability: rel(s.reliability) }]);
    }
    for (const u of gf.nondivisional ?? []) unitEntry('berlin-1945-german-forces.json', u, 'часть вне дивизий');
    for (const t of gf.totals ?? []) addFacts(entries.has(`f:${t.formation}`) ? `f:${t.formation}` : 'op:berlin', [{ key: 'forces', value: cutx(`${fname.get(t.formation) ?? t.formation}, ${ddmm2(t.date)}: ${t.what} — ${typeof t.value === 'number' ? t.value.toLocaleString('ru') : normValue(t.value)}`), source: sref('berlin-1945-german-forces.json', t.source), pages: t.page, reliability: rel(t.reliability) }]);
    if (gf.gaps?.length) addSection('op:berlin', 'Немецкие силы: пробелы в данных', gf.gaps.map((g) => `- ${g}`));
  }
  const gr = opt<{ sources?: Record<string, { ref: string }>; units?: Record<string, unknown>[]; totals?: { what: string; value: unknown; range?: string; source?: string; reliability?: string; note?: string }[]; gaps?: string[] }>('berlin-1945-german-rear.json');
  if (gr) {
    regSources('berlin-1945-german-rear.json', gr.sources);
    for (const u of gr.units ?? []) unitEntry('berlin-1945-german-rear.json', u, 'немецкий тыл: запасная, учебная или тревожная часть');
    addSection('op:berlin', 'Немецкий тыл: учебные, запасные и тревожные части', (gr.totals ?? []).map((t) => `- ${t.what}: ${normValue(t.value)}${t.range ? ` (${t.range})` : ''}${t.note ? ` — ${t.note}` : ''} [${t.source ?? ''}, ${t.reliability ?? '—'}]`));
    if (gr.gaps?.length) addSection('op:berlin', 'Немецкий тыл: пробелы в данных', gr.gaps.map((g) => `- ${g}`));
  }

  // объекты театра: мосты и переправы (состояние по датам), полосы обороны, крепости, узлы снабжения
  const ob = opt<{ sources?: Record<string, { ref: string }>; bridges?: { id: string; name_ru: string; name_orig?: string; river?: string; kind?: string; capacity_t?: number; states?: { date: string; state: string; by?: string; source?: string; reliability?: string; note?: string }[]; source?: string; note?: string }[]; belts?: { id: string; name_ru: string; name_orig?: string; places?: string[]; built_by?: string; source?: string; reliability?: string; note?: string }[]; fortresses?: { id: string; names?: string[] | string; garrison?: unknown; declared?: string; fell?: string; source?: string; reliability?: string; note?: string }[]; supply?: { id: string; kind: string; side: string; name_ru: string; dates?: string; source?: string; reliability?: string; note?: string }[]; gaps?: string[] }>('berlin-1945-objects.json');
  if (ob) {
    const F = 'berlin-1945-objects.json';
    regSources(F, ob.sources);
    const KINDB: Record<string, string> = { pontoon: 'понтонный мост', bridge: 'мост', rail: 'железнодорожный мост', ferry: 'паромная переправа', ford: 'брод', road: 'автодорожный мост' };
    for (const b of ob.bridges ?? []) put({ id: `obj:${b.id}`, category: 'terrain', group: 'rivers', title: `${b.name_ru}${b.river ? ` (${b.river})` : ''}`, aliases: [b.name_orig].filter(Boolean) as string[], status: 'checked',
      summary: cutx(`${KINDB[b.kind ?? ''] ?? b.kind ?? 'переправа'}${b.capacity_t ? `, грузоподъёмность ${b.capacity_t} т` : ''}${b.note ? `. ${b.note}` : ''}`, 400),
      facts: [{ key: 'kind', value: KINDB[b.kind ?? ''] ?? b.kind ?? 'переправа', source: sref(F, b.source) }, ...(b.river ? [{ key: 'location', value: `река ${b.river}` }] : []),
        ...(b.states ?? []).map((st) => { const claim = crossingClaim(b.id, st); return { key: 'crossings', value: cutx(`${ddmm2(st.date)}: ${st.state}${st.by ? ` (${fname.get(st.by) ?? st.by})` : ''}${st.note ? ` — ${st.note}` : ''}`, 360), source: sref(F, st.source), reliability: rel(st.reliability), ...(claim ? { claim } : {}) }; })],
      relations: [{ type: 'related', target: 'op:berlin' }] });
    for (const b of ob.belts ?? []) put({ id: `line:obj-${b.id}`, category: 'terrain', group: 'lines', title: b.name_ru, aliases: [b.name_orig].filter(Boolean) as string[], status: 'checked', summary: cutx(b.note ?? '', 400),
      facts: [{ key: 'kind', value: 'полоса обороны', source: sref(F, b.source), reliability: rel(b.reliability) }, ...(b.places?.length ? [{ key: 'location', value: b.places.join(', ').replace(/_/g, ' ') }] : []), ...(b.built_by ? [{ key: 'defense', value: `строили: ${b.built_by}` }] : [])], relations: [{ type: 'related', target: 'op:berlin' }] });
    for (const f of ob.fortresses ?? []) {
      const names = Array.isArray(f.names) ? f.names : [String(f.names ?? f.id)];
      put({ id: `ter:fort-${f.id}`, category: 'terrain', group: 'cities', title: `Крепость ${names[0]}`, aliases: names.slice(1), status: 'checked', summary: cutx(f.note ?? '', 400),
        facts: [{ key: 'kind', value: 'город-крепость (Festung)', source: sref(F, f.source), reliability: rel(f.reliability) }, ...(f.declared ? [{ key: 'defense', value: `объявлена крепостью ${ddmm2(f.declared)}.${f.declared.slice(0, 4)}` }] : []), ...(f.fell ? [{ key: 'defense', value: `пала ${ddmm2(f.fell)}.${f.fell.slice(0, 4)}` }] : []), ...(f.garrison ? [{ key: 'defense', value: `гарнизон: ${normValue(f.garrison)}` }] : [])],
        relations: [{ type: 'related', target: 'op:berlin' }] });
    }
    for (const s of ob.supply ?? []) put({ id: `ter:supply-${s.id}`, category: 'terrain', group: 'areas', title: s.name_ru, status: 'checked', summary: cutx(s.note ?? '', 400),
      facts: [{ key: 'kind', value: `узел снабжения (${s.kind}), ${s.side === 'su' ? 'советский' : 'немецкий'}`, source: sref(F, s.source), reliability: rel(s.reliability) }, ...(s.dates ? [{ key: 'features', value: `когда: ${s.dates}` }] : [])], relations: [{ type: 'related', target: 'op:berlin' }] });
    if (ob.gaps?.length) addSection('op:berlin', 'Объекты театра (мосты, полосы, крепости, снабжение): пробелы', ob.gaps.map((g) => `- ${g}`));
  }

  // исследования составов: подчинённость по датам, численность, положения по дням
  for (const [file, side] of [['berlin-1945-research-de.json', 'de'], ['berlin-1945-research-su.json', 'su']] as const) {
    const d = opt<{ sources?: Record<string, { ref: string }>; formations?: { id: string; name_ru: string; name_orig?: string; echelon?: string; parent_by_date?: { date: string; parent: string; source?: string }[]; source?: string; reliability?: string; note?: string }[]; composition?: { corps: string; army?: string; front?: string; date: string; divisions: string[]; source?: string; reliability?: string; page?: string }[]; strength?: Record<string, unknown>[]; positions?: { formation: string; date: string; time?: string; place: string; approx_km?: number; source?: string; reliability?: string; page?: string }[]; gaps?: string[] }>(file);
    if (!d) continue;
    regSources(file, d.sources);
    for (const f of d.formations ?? []) {
      const id = ensureF(f.id, f.name_ru, side, { aliases: [f.name_orig].filter(Boolean) as string[] });
      addFacts(id, [...(f.echelon ? [{ key: 'echelon', value: ECH[f.echelon] ?? f.echelon }] : []), ...(f.parent_by_date ?? []).map((p) => ({ key: 'parent', value: `${fname.get(p.parent) ?? p.parent} (с ${ddmm2(p.date)})`, source: sref(file, p.source) })), ...(f.note ? [{ key: 'path', value: cutx(f.note, 300), source: sref(file, f.source), reliability: rel(f.reliability) }] : [])]);
    }
    for (const c of d.composition ?? []) addFacts(entries.has(`f:${c.corps}`) ? `f:${c.corps}` : ensureF(c.corps, fname.get(c.corps) ?? c.corps, side), [{ key: 'composition', value: `${ddmm2(c.date)}: ${c.divisions.map((x) => fname.get(x) ?? x).join(', ')}${c.army ? ` (в ${fname.get(c.army) ?? c.army})` : ''}`, source: sref(file, c.source), pages: c.page, reliability: rel(c.reliability) }]);
    for (const s of d.strength ?? []) {
      const fid = String(s.formation);
      const parts = ['personnel', 'tanks', 'stug', 'spg', 'guns', 'mortars'].filter((k) => s[k] != null).map((k) => `${{ personnel: 'людей', tanks: 'танков', stug: 'штурмовых орудий', spg: 'САУ', guns: 'орудий', mortars: 'миномётов' }[k]} ${Number(s[k]).toLocaleString('ru')}`);
      if (parts.length) addFacts(ensureF(fid, fname.get(fid) ?? fid, side), [{ key: 'personnel', value: cutx(`${parts.join(', ')} (на ${ddmm2(String(s.date))})${s.note ? ` — ${s.note}` : ''}`, 300), source: sref(file, s.source as string), pages: s.page as string, reliability: rel(s.reliability) }]);
    }
    const byF = new Map<string, string[]>();
    for (const p of d.positions ?? []) byF.set(p.formation, [...(byF.get(p.formation) ?? []), `- ${ddmm2(p.date)}${p.time ? ` ${p.time}` : ''}: ${cutx(p.place, 200)}${p.approx_km ? ` (±${p.approx_km} км)` : ''} [${p.source ?? ''}${p.page ? `, ${p.page}` : ''}; ${p.reliability ?? '—'}]`]);
    for (const [fid, lines] of byF) addSection(ensureF(fid, fname.get(fid) ?? fid, side), 'Положения по дням (исследование источников)', lines);
    if (d.gaps?.length) addSection('op:berlin', `Пробелы (${file})`, d.gaps.map((g) => `- ${g}`));
  }

  // немецкие разграничительные линии армий и групп армий
  const gb = opt<{ boundaries: { id: string; kind: string; side: string; right: string; left: string; title: string; from: string; until?: string | null; points: { place: string }[]; inclusiveNote?: string; source?: { doc?: string } | string; reliabilityNote?: string; note?: string }[]; gaps?: unknown[] }>('german-1945-boundaries.json');
  for (const b of gb?.boundaries ?? []) {
    const pair = `${fname.get(b.right) ?? b.right} / ${fname.get(b.left) ?? b.left}`;
    const doc = typeof b.source === 'string' ? b.source : b.source?.doc ?? '';
    const value = cutx(`${pair} с ${ddmm2(b.from)}${b.until ? ` до ${ddmm2(b.until)}` : ''}: ${b.points.map((x) => x.place).join(' — ')}${b.inclusiveNote ? ` (${b.inclusiveNote})` : ''}${doc ? ` — ${doc}` : ''}`, 400);
    const claim = boundaryClaim(b);
    for (const t of [`f:${b.right}`, `f:${b.left}`]) addFacts(t, [{ key: 'boundary', value, reliability: 'C', ...(claim ? { claim } : {}) }]);
    const day = b.from.slice(0, 10);
    put({ id: `bnd:${b.id}`, category: 'chronology', group: day.startsWith('1945-0') && +day.slice(5, 7) >= 4 ? 'berlin' : 'vistula', title: `${dayRu(day)} — немецкая разграничительная линия: ${pair}`, period: { from: day, to: day }, status: 'draft',
      summary: `${b.title}: ${b.points.map((x) => x.place).join(' — ')}.${b.reliabilityNote ? ` ${b.reliabilityNote}` : ''}`, facts: [{ key: 'date', value: day }, { key: 'event', value: b.title }, { key: 'place', value: b.points.map((x) => x.place).join(', ') }],
      relations: [{ type: 'related', target: `f:${b.right}` }, { type: 'related', target: `f:${b.left}` }] });
  }

  // линия фронта в центре Берлина по советской карте
  const pf = opt<{ title: string; date: string; dateNote?: string; source?: { ref: string; reliability?: string }; armies?: string[] }>('berlin-1945-plan-frontline.json');
  if (pf) addFacts('op:berlin', [{ key: 'outcome', value: cutx(`${pf.title} (${pf.date}${pf.dateNote ? `; ${pf.dateNote}` : ''})${pf.armies ? ` — армии: ${Array.isArray(pf.armies) ? pf.armies.join(', ') : normValue(pf.armies)}` : ''}`), reliability: rel(pf.source?.reliability), pages: pf.source?.ref }]);

  // исследовательские отчёты (марш, автотранспорт, преследование, немецкая оборона на Висле) — разделами
  for (const [dir, id, title, group] of [['infantry-mobility-1944-45', 'org:research-mobility', 'Подвижность пехоты, автотранспорт и тыл 1944–1945 гг. (исследование для модели)', 'su'], ['german-defence-vistula-1945', 'org:research-de-vistula', 'Немецкая оборона перед Висло-Одерской операцией (исследование для модели)', 'de']] as const) {
    let files: string[] = [];
    try { files = readdirSync(join(SRC, dir)).filter((f) => f.endsWith('.md')); } catch { continue; }
    put({ id, category: 'organization', group, title, rubrics: id === 'org:research-mobility' ? ['5.1', '5.2'] : ['3.2.2', '6.4'], status: 'checked', summary: 'Отчёты по источникам с оценкой достоверности (A/B/C): что прочитано, таблицы фактов, расхождения, чего не найдено и что взято в модель.',
      sections: files.map((f) => ({ title: f.replace(/\.md$/, ''), text: readFileSync(join(SRC, dir, f), 'utf8').trim() })) });
  }
}

// формальные части фактов, у которых нет «своего» факта в сиде: численность на старт, положения, события
for (const { entry, fact } of [...strengthClaims(), ...positionClaims(), ...eventClaims()]) addClaimFacts(entry, [fact]);

// связи «включает» для родительских формирований и операций
for (const e of entries.values()) for (const r of e.relations ?? []) {
  if (r.type !== 'part_of') continue;
  const p = entries.get(r.target);
  if (p && !(p.relations ?? []).some((x) => x.type === 'includes' && x.target === e.id)) p.relations = [...(p.relations ?? []), { type: 'includes', target: e.id }];
}
// висячие ссылки — убрать
for (const e of entries.values()) e.relations = (e.relations ?? []).filter((r) => entries.has(r.target));

/* ───────────── нормативы модели → факты param/outcome ───────────── */
// Каждая строка packages/sim/data/rules/norms.json — факт в записи kb (иначе — в «Нормативы модели»): значение правила
// (param), допущение (param без надёжности, why) или итог прогона (outcome); «не моделируется» — текстовый факт.
// Сведения, нужные sim:norms (замер, правила, история, примечание), лежат в fact.norm — по ним норматив собирается обратно.
{
  const NORM_SIDE: Record<string, 'su' | 'de'> = { 'stockDays.fortress': 'de' };
  const SU_PARAM = /^(foot\.|orderDelay\.|bridgeHours)/;
  const nt = read('packages/sim/data/rules/norms.json') as { norms: {
    id: string; title: string; kb: string; source: string; reliability: string; historical: string; expect?: [number, number]; unit?: string; rules: string[]; note?: string; operations?: string[];
    measure: Record<string, string> & { kind: string };
  }[] };
  // путь входа без отображения: «%» в конце и «/n» (значение дано на 1/n входа) — не часть пути
  const cleanPath = (e: string) => e.replace(/\/\d+$/, '').replace(/%$/, '');
  const scaleOf = (e: string) => { const k = /\/(\d+)$/.exec(e); return k ? +k[1] : undefined; };
  const KNOWN_KB = (id: string) => entries.has(id);
  for (const n of nt.norms) {
    const m = n.measure;
    const target = KNOWN_KB(n.kb) ? n.kb : 'gen:model-norms';
    if (target === 'gen:model-norms' && !entries.has(target)) put({ id: target, category: 'organization', group: 'model', title: 'Нормативы модели', status: 'checked',
      summary: 'Нормативы модели, чьей записи в базе нет: значения правил и профилей, допущения и итоги прогонов.', facts: [] });
    const extra: Record<string, string> = {};
    let claim: Claim | undefined;
    const range: [number, number] | undefined = n.expect ? [n.expect[0], n.expect[1]] : undefined;
    const unit = n.unit || undefined;
    const rng = range ? (range[0] === range[1] ? { value: range[0] } : { range }) : {};
    if (m.kind === 'param') {
      const side = NORM_SIDE[m.expr] ?? (SU_PARAM.test(m.expr) ? 'su' : undefined);
      claim = { kind: 'param', param: cleanPath(m.expr), ...(scaleOf(m.expr) ? { scale: scaleOf(m.expr) } : {}), ...rng, ...(unit ? { unit } : {}), ...(side ? { side } : {}) };
    } else if (m.kind === 'assumption') {
      claim = { kind: 'param', param: cleanPath(m.expr), ...(unit ? { unit } : {}), why: m.why };
    } else if (m.kind === 'pace' || m.kind === 'loss') {
      claim = { kind: 'outcome', measure: m.kind, scenario: m.scenario, subject: m.kind === 'pace' ? m.formation : m.parent, from: m.from, to: m.to, range: range!, unit: unit! };
    } else if (m.kind === 'frontage') {
      // ширина полосы — состояние на начало сценария
      const start = String(read(`packages/sim/data/scenarios/${m.scenario}.json`).start);
      claim = { kind: 'outcome', measure: 'frontage', scenario: m.scenario, from: start, to: start, range: range!, unit: unit!, ...(m.side ? { side: m.side } : {}), ...(m.echelon ? { echelon: m.echelon } : {}), ...(m.near ? { near: m.near } : {}) };
    } else if (m.kind === 'unmodelled') extra.why = m.why;
    else throw new Error(`норматив ${n.id}: неизвестный замер ${m.kind}`);
    const what = claim?.kind === 'outcome' ? `ожидается в расчёте ${n.expect![0]}–${n.expect![1]} ${n.unit}` : claim?.kind === 'param'
      ? (m.kind === 'assumption' ? `допущение: ${m.why}` : n.expect ? `по источнику ${n.expect[0] === n.expect[1] ? n.expect[0] : `${n.expect[0]}–${n.expect[1]}`}${n.unit ? ` ${n.unit}` : ''}` : 'значение правила') : `не моделируется: ${m.why}`;
    const fact: Fact = {
      key: 'numbers', value: cutc(`${n.title} — ${what}${n.historical && n.historical !== '—' ? `; по истории: ${n.historical}` : ''}`, 600),
      ...(srcId(n.source) ? { source: srcId(n.source) } : {}), ...(m.kind !== 'assumption' && rel(n.reliability) ? { reliability: rel(n.reliability) } : {}),
      ...(claim ? { claim } : {}),
      norm: { id: n.id, title: n.title, kb: n.kb, src: n.source, historical: n.historical, ...(m.expr && cleanPath(m.expr) !== m.expr ? { expr: m.expr } : {}), ...(m.kind === 'assumption' && n.reliability ? { reliability: n.reliability } : {}), rules: n.rules, ...(n.note ? { note: n.note } : {}), ...(n.operations ? { operations: n.operations } : {}), ...(Object.keys(extra).length ? { extra } : {}) },
    };
    const e = entries.get(target)!;
    e.facts = [...(e.facts ?? []), fact];
  }
}

// рубрики: сражения — по месту в операции и теме; прочие — по категории (rubrics.ts)
const BATTLE_RUBRICS: Record<string, string[]> = {
  'battle:vo-breakthrough': ['1.1.1', '3.1.1'], 'battle:warsaw': ['1.1.2'], 'battle:oder-exit': ['1.1.3', '3.1.3', '3.2.4'], 'battle:posen': ['1.1.4', '3.1.2', '3.2.3'],
  'battle:seelow': ['1.2.2', '3.1.1'], 'battle:neisse': ['1.2.2', '3.2.4'], 'battle:lower-oder': ['1.2.2', '3.2.4'], 'battle:ring': ['1.2.3', '3.1.2'],
  'battle:torgau': ['1.2.3'], 'battle:halbe': ['1.2.4', '3.1.2'], 'battle:bautzen': ['1.2.5', '3.1.4'], 'battle:berlin-storm': ['1.2.6', '3.2.3'], 'battle:reichstag': ['1.2.6', '3.2.3'],
};
const OP_RUBRICS: Record<string, string[]> = { 'op:berlin': ['1.2', '1.2.1', '1.2.7'], 'op:vistula-oder': ['1.1', '1.1.5'] };
for (const e of entries.values()) {
  e.rubrics = e.rubrics?.length ? e.rubrics : BATTLE_RUBRICS[e.id] ?? OP_RUBRICS[e.id] ?? defaultRubrics(e);
  const bad = e.rubrics.filter((c) => !RUBRIC_CODES.includes(c));
  if (bad.length) throw new Error(`${e.id}: нет таких рубрик ${bad.join(', ')}`);
}

const list = [...entries.values()].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title, 'ru'));
const out = join(ROOT, 'packages/knowledge/data/seed.json');
writeFileSync(out, JSON.stringify({ built: new Date().toISOString().slice(0, 10), note: 'собрано packages/knowledge/tools/build_seed.ts из docs/sources, профилей сторон, docs/system.md и data/curated', entries: list }));
const by = new Map<string, number>();
for (const e of list) by.set(e.category, (by.get(e.category) ?? 0) + 1);
const claimStats = new Map<string, number>();
for (const e of list) for (const f of e.facts ?? []) if (f.claim) claimStats.set(f.claim.kind, (claimStats.get(f.claim.kind) ?? 0) + 1);
console.log(`формальных частей: ${[...claimStats].map(([k, v]) => `${k} ${v}`).join(', ')}; пропущено: ${[...claimSkipped].map(([k, v]) => `${k} — ${v}`).join('; ')}`);
console.log(`записей: ${list.length}; ${[...by].map(([k, v]) => `${k} ${v}`).join(', ')}; ${(JSON.stringify(list).length / 1e6).toFixed(1)} МБ`);
