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
import type { Entry, Fact, Reliability, Relation } from '../src/schema';
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
const dedupeFacts = (l: Fact[]) => l.filter((f, i) => l.findIndex((g) => g.key === f.key && g.value === f.value && g.source === f.source) === i);
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
for (const { f, file } of allF) {
  const facts: Fact[] = [];
  const src = srcId(f.source as string) ?? undefined;
  if (f.side) facts.push({ key: 'side', value: SIDE[f.side] ?? f.side, source: src });
  if (f.echelon) facts.push({ key: 'echelon', value: ECH[f.echelon] ?? f.echelon, source: src });
  if (f.parent) facts.push({ key: 'parent', value: fname.get(f.parent) ?? f.parent, source: src });
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
  for (const b of d.boundaries as { id: string; kind: string; right: string; left: string; title: string; from: string; until: string | null; points: { place: string }[]; inclusiveNote?: string; beyondEnd?: string; quote: string; source: { doc: string; archive?: string; reliability: string } }[]) {
    const src = b.source.reliability === 'A' ? 'src:RA_15' : 'src:ROK_SD';
    const pair = b.kind === 'air' ? 'советские ВВС / ВВС союзников' : `${nm(b.right)} / ${nm(b.left)}`;
    const value = `${pair} с ${b.from.slice(8, 10)}.${b.from.slice(5, 7)}${b.until ? ` до ${b.until.slice(8, 10)}.${b.until.slice(5, 7)}` : ''}: ${b.points.map((x) => x.place).join(' — ')}${b.inclusiveNote ? ` (${b.inclusiveNote})` : ''} — ${b.source.doc}`;
    const fact = { key: 'boundary', value, source: src, pages: b.source.archive, reliability: rel(b.source.reliability), quote: b.quote };
    const targets = b.kind === 'air' ? ['op:berlin'] : [`f:${b.right}`, `f:${b.left}`, 'op:berlin'];
    for (const t of targets) { const e = entries.get(t); if (e) e.facts = dedupeFacts([...(e.facts ?? []), fact]); }
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
  type Pos = { army: string; unit: string; date: string | null; time?: string | null; kind: string; place: string; source: string; url?: string; lat?: number | null };
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
    if (f) { addLine(f, 'Положения по дням (документы ЦАМО)', line); link(f, d?.id); }
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

// связи «включает» для родительских формирований и операций
for (const e of entries.values()) for (const r of e.relations ?? []) {
  if (r.type !== 'part_of') continue;
  const p = entries.get(r.target);
  if (p && !(p.relations ?? []).some((x) => x.type === 'includes' && x.target === e.id)) p.relations = [...(p.relations ?? []), { type: 'includes', target: e.id }];
}
// висячие ссылки — убрать
for (const e of entries.values()) e.relations = (e.relations ?? []).filter((r) => entries.has(r.target));

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
console.log(`записей: ${list.length}; ${[...by].map(([k, v]) => `${k} ${v}`).join(', ')}; ${(JSON.stringify(list).length / 1e6).toFixed(1)} МБ`);
