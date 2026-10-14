/**
 * Документ → предложения изменить базу. Текст режется на части; модель по каждой части выписывает
 * сведения по каркасу категорий — только прямо сказанное в тексте, каждый факт с дословной цитатой.
 * Затем проверка: факт, чьей цитаты нет в тексте части, отбрасывается (защита от выдумок); запись
 * сопоставляется с существующей (по названию и синонимам) — тогда это дополнение, иначе новая запись.
 * В базу попадает только то, что примет человек.
 */
import type { Candidate } from './candidate';
import { CATEGORIES, type CategoryId, type Claim, type Entry, type Fact, type InfraItem, type InfraProposal, type KbDocument, type BoundaryItem, type BoundaryProposal, type PositionItem, type PositionProposal, type Proposal, type Relation, type RelationType, type Reliability } from './schema';
import { foreignTo } from './operations';
import { stems } from './search';
import { defaultRubrics, RUBRIC_CODES, rubricPath } from './rubrics';

/** Разбить текст на части по абзацам (около size знаков, с перекрытием). */
export function chunkText(text: string, size = 3000, overlap = 300): string[] {
  const paras = text.replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > size) { out.push(cur); cur = cur.slice(-overlap); }
    if (p.length > size * 1.5) { for (let i = 0; i < p.length; i += size - overlap) out.push(p.slice(i, i + size)); continue; }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

const RELS: RelationType[] = ['part_of', 'participant', 'commanded_by', 'commands', 'located', 'opponent', 'related'];
const s = { type: 'string' };
const EXTRACT_ITEMS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['category', 'rubrics', 'title', 'aliases', 'summary', 'facts', 'relations', 'dateFrom', 'dateTo'],
        properties: {
          category: { type: 'string', enum: CATEGORIES.map((c) => c.id) },
          rubrics: { type: 'array', items: { type: 'string', enum: RUBRIC_CODES } },
          title: s, aliases: { type: 'array', items: s }, summary: s,
          facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'value', 'quote'], properties: { key: s, value: s, quote: s } } },
          relations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'target'], properties: { type: { type: 'string', enum: RELS }, target: s } } },
          dateFrom: { type: ['string', 'null'] }, dateTo: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

/** Прочая инфраструктура — только дороги, железные дороги и рубежи; переправы и мосты — факты claims вида crossing. */
const INFRA_ITEM = {
  type: 'object', additionalProperties: false, required: ['kind', 'state', 'title', 'place', 'river', 'date', 'dateTo', 'side', 'note', 'quote'],
  properties: {
    kind: { type: 'string', enum: ['road', 'rail', 'line', 'other'] },
    state: { type: 'string', enum: ['destroyed', 'damaged', 'intact', 'built', 'repaired', 'blocked', 'mined', 'impassable', 'fortified'] },
    title: s, place: { type: ['string', 'null'] }, river: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] }, dateTo: { type: ['string', 'null'] }, side: { type: ['string', 'null'] }, note: { type: ['string', 'null'] }, quote: s,
  },
} as const;

/** Виды формальных фактов (часть 1). */
export const CLAIM_KINDS = ['strength', 'reinforce', 'parent', 'enter', 'position', 'boundary', 'crossing', 'event', 'losses'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
const nul = (type: string) => ({ type: [type, 'null'] });
const CLAIM_PROPS = {
  kind: { type: 'string', enum: [...CLAIM_KINDS] },
  subject: nul('string'), parent: nul('string'), place: nul('string'),
  between: { type: ['array', 'null'], items: s, minItems: 2, maxItems: 2 },
  points: { type: ['array', 'null'], items: s }, inclusive: nul('string'), title: nul('string'),
  date: nul('string'), dateTo: nul('string'),
  personnel: nul('number'), tanks: nul('number'), guns: nul('number'), killed: nul('number'), wounded: nul('number'), missing: nul('number'), total: nul('number'),
  state: { type: ['string', 'null'], enum: ['open', 'destroyed', 'built', null] },
  lat: nul('number'), lon: nul('number'), approxKm: nul('number'),
  quote: s,
} as const;
const CLAIM_REQUIRED = Object.keys(CLAIM_PROPS);
const CLAIM_ITEM = { type: 'object', additionalProperties: false, required: CLAIM_REQUIRED, properties: CLAIM_PROPS } as const;
/** Фактическая часть ответа: формальные факты всех видов. */
const CLAIMS = { type: 'array', items: CLAIM_ITEM } as const;
/** То же для скана: к каждому факту — место на странице (доли 0–1: левый, верхний, правый, нижний край). */
const SCAN_CLAIM_ITEM = {
  ...CLAIM_ITEM, required: [...CLAIM_REQUIRED, 'box'],
  properties: { ...CLAIM_PROPS, box: { type: ['array', 'null'], items: { type: 'number' }, minItems: 4, maxItems: 4 } },
} as const;
export const SCAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['transcript', 'claims'],
  properties: { transcript: s, claims: { type: 'array', items: SCAN_CLAIM_ITEM } },
} as const;

/** Разбор текста: записи базы и формальные факты всех видов. */
export const EXTRACT_SCHEMA = {
  ...EXTRACT_ITEMS_SCHEMA, required: ['items', 'claims'],
  properties: { ...EXTRACT_ITEMS_SCHEMA.properties, claims: CLAIMS },
} as const;
/** Разбор документа операции: то же и сведения о дорогах и рубежах (положения, линии, переправы — в claims). */
export const OPERATION_EXTRACT_SCHEMA = {
  ...EXTRACT_ITEMS_SCHEMA, required: ['items', 'claims', 'infrastructure'],
  properties: { ...EXTRACT_ITEMS_SCHEMA.properties, claims: CLAIMS, infrastructure: { type: 'array', items: INFRA_ITEM } },
} as const;

/** Формальный факт из ответа модели (названия — как в тексте). */
export interface ExtractedClaim {
  kind: ClaimKind;
  subject: string | null; parent: string | null; place: string | null;
  between: string[] | null; points: string[] | null; inclusive: string | null; title: string | null;
  /** ГГГГ-ММ-ДД (начало периода или момент). */
  date: string | null; dateTo: string | null;
  personnel: number | null; tanks: number | null; guns: number | null;
  killed: number | null; wounded: number | null; missing: number | null; total: number | null;
  state: 'open' | 'destroyed' | 'built' | null;
  lat: number | null; lon: number | null; approxKm: number | null;
  quote: string;
  /** Место на странице скана (доли). */
  box?: [number, number, number, number] | null;
}

/** Операция, к которой относится документ: для подсказки модели (сроки, стороны). */
export interface OperationHint { id: string; title: string; start: string; end: string; sides: { id: string; name: string }[] }

export interface ExtractedItem {
  category: CategoryId; rubrics?: string[]; title: string; aliases: string[]; summary: string;
  facts: { key: string; value: string; quote: string }[];
  relations: { type: RelationType; target: string }[];
  dateFrom: string | null; dateTo: string | null;
}

export function extractMessages(chunk: string, docName: string, op?: OperationHint): { role: 'system' | 'user'; content: string }[] {
  const rubs = RUBRIC_CODES.filter((c) => c.split('.').length > 1).map((c) => `- ${c} ${rubricPath(c).map((x) => x.title).join(' › ')}`).join('\n');
  const cats = CATEGORIES.map((c) => `- ${c.id} — ${c.title}: ${c.description} Ключи фактов: ${c.fields.map((f) => `${f.key} (${f.title})`).join(', ')}.`).join('\n');
  return [
    { role: 'system', content: `Вы — составитель военно-исторической базы знаний (операции 1945 года: Висло-Одерская, Берлинская). Из фрагмента документа выпишите сведения по каркасу категорий.

Строгие правила:
1. Только то, что прямо сказано во фрагменте. Никаких своих знаний, догадок и обобщений.
2. Каждый факт — с дословной цитатой из фрагмента (quote, до 200 знаков), на которой он основан. Нет цитаты — нет факта.
3. Ключи фактов — из списка для категории; значение — коротко, по-русски, с числами и единицами как в тексте.
4. Названия — как принято по-русски, оригинал (немецкий, польский) — в aliases.
5. Связи (relations): target — название другой записи (операции, сражения, формирования, лица), упомянутой во фрагменте.
6. Даты — ГГГГ-ММ-ДД, если указаны; иначе null.
7. Рубрики (rubrics) — 1–3 кода из рубрикатора ниже, самая точная первой: о чём запись (операция и этап, тема военного искусства, род войск и т. п.).
8. Если во фрагменте нет таких сведений (оглавление, библиография, посторонний текст) — items пустой.
9. Цифры потерь, численности и положения — не в items, а в claims (ниже).

Категории (что это за запись):
${cats}

Рубрикатор (о чём запись):
${rubs}

${claimRules(op)}${op ? infraRules(op) : ''}Ответ — один JSON-объект по схеме.` },
    { role: 'user', content: `Документ: «${docName}»${op ? ` (материал операции «${op.title}»)` : ''}. Фрагмент:\n\n${chunk}` },
  ];
}

/** Правила формальных фактов (claims): общие для текста и скана. */
export function claimRules(op?: OperationHint): string {
  const year = op ? op.start.slice(0, 4) : '1945';
  return `Кроме записей (items), выпишите в claims формальные факты — то, что можно занести в модель. Вид (kind):
- strength — численность соединения на дату: subject, date, personnel / tanks / guns (что названо);
- reinforce — пополнение, прибывшее в соединение: subject, date, personnel / tanks / guns;
- parent — подчинённость: subject (кто), parent (кому подчинён), date — с какого дня;
- enter — ввод соединения в бой: subject, date;
- position — где находилось соединение в день: subject, date, place (населённый пункт, район или рубеж в именительном падеже, оригинал — в скобках) и, только если координаты прямо названы в тексте, lat / lon (WGS84) и approxKm (радиус неопределённости);
- boundary — разграничительная линия между объединениями: between (два объединения; если документ адресован одному из них — «с 1-м Белорусским фронтом», — второй адресат документа), date / dateTo — с какого и до какого дня, points — пункты линии по порядку в именительном падеже («прежняя», «по железной дороге» — не пункты), inclusive — чьи пункты включительно или null;
- crossing — переправа или мост: subject (название «мост через Шпрее у Фюрстенвальде»), place, date — с какого дня, state: open — проходима, destroyed — разрушена, built — наведена;
- event — событие (сражение, взятие города, удар): title, date, place;
- losses — потери соединения за период: subject, date (начало), dateTo (конец, включительно), killed / wounded / missing / total (total — если разбивки нет), tanks.
Правила claims:
1. Названия соединений (subject, parent, between) и мест — как в тексте, не расшифровывайте и не исправляйте («8 гв. А» так и остаётся).
2. Даты — ГГГГ-ММ-ДД; если в тексте нет года, он ${year}. «С 16 по 19 апреля» — date 16-е, dateTo 19-е. Нет даты — null.
3. Числа — как в тексте, целыми, без своих пересчётов; «4 910» — 4910. Названо «до 1 200», «около» — берите названное число. Не называйте то, чего нет, — null.
4. quote — дословная цитата (до 200 знаков), в которой есть все названные числа факта. Нет такой цитаты — нет факта.
5. Только факты о фактическом положении дел; планы, приказы «наступать», потери противника, не относящиеся к названному соединению, — не выписывайте. Нет таких сведений — claims пустой.

`;
}

function infraRules(op: OperationHint): string {
  return `Документ — материал операции «${op.title}» (${op.start.slice(0, 10)} — ${op.end.slice(0, 10)}). В infrastructure выпишите сведения о дорогах, железных дорогах и рубежах, влияющих на движение войск (мосты и переправы — не здесь, а в claims, вид crossing):
- kind: road — дорога, шоссе, улица; rail — железная дорога, станция; line — рубеж, заграждения, противотанковый ров; other — прочее (аэродром, плотина).
- state: destroyed — разрушен; damaged — повреждён, но проходим; intact — уцелел; built — построен; repaired — восстановлен; blocked — завал, баррикада, затор; mined — заминирован; impassable — непроходим (распутица, затоплен); fortified — укреплён.
- title — коротко, что это; place — ближайший населённый пункт или район в именительном падеже, оригинал — в скобках; river — река или канал, если есть.
- date / dateTo — ГГГГ-ММ-ДД, с какого и до какого дня это так (если сказано); side — id стороны, чьими силами (${op.sides.map((x) => `${x.id} — ${x.name}`).join(', ')}), иначе null; note — подробности или null; quote — дословная цитата.
Только прямо сказанное во фрагменте. Нет таких сведений — infrastructure пустой.

`;
}

const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„'’`]/g, '').replace(/[\s ]+/g, ' ').replace(/\s*-\s*/g, '-').trim();
/** Есть ли цитата во фрагменте (с точностью до пробелов, кавычек и регистра; допускается сокращение многоточием). */
export function quoteFound(quote: string, text: string): boolean {
  const t = norm(text);
  return norm(quote).split(/\s*(?:\.\.\.|…)\s*/).filter((p) => p.length >= 8).every((p) => t.includes(p)) && norm(quote).replace(/\.\.\.|…/g, '').length >= 8;
}

/**
 * Основы слов рода и вида войск (корпус, дивизия, армия, батальон…): совпадение только по ним не говорит, что это
 * то же соединение («Неизвестный корпус» — не «Батальон … (резерв корпуса)»).
 */
const GENERIC = /^(корп|дивиз|арми|армей|батал|бат|полк|бриг|груп|фронт|отряд|гарни|крепо|резер|част|соеди|объед|войск|гвард|гв|удар|танк|стрел|пехот|кавал|механ|мех|мотор|артил|штаб|кп|сапер|инжен|морск|ополч|народ|division|div|corps|korps|armee|army|brig|regim|panze|infan|grena|volks|festu|kampf|gruppe|batai|abtei|ss)/i;
/** Основа слова отличительная: число или имя собственное (не род и вид войск). */
export const distinctiveStem = (w: string) => /\d/.test(w) || !GENERIC.test(w);

/**
 * Сходство названий по основам слов (без повторов): совпало не меньше двух основ, среди них хотя бы одна
 * отличительная (число или имя собственное), и все основы названия есть в записи или почти все совпали.
 */
export function stemSimilarity(name: string, title: string): number {
  const st = new Set(stems(name));
  const es = [...new Set(stems(title))];
  const common = es.filter((w) => st.has(w));
  if (common.length < 2 || !common.some(distinctiveStem)) return 0;
  const score = common.length / Math.max(es.length, st.size);
  return common.length === st.size || score > 0.75 ? score : 0;
}

/**
 * Найти существующую запись той же категории по названию и синонимам. exact — совпало название или синоним;
 * иначе найдено по сходству основ слов (stemSimilarity) — такое сопоставление требует проверки человеком.
 */
export function matchEntryHow(entries: Entry[], cat: string, title: string, aliases: string[]): { entry: Entry; exact: boolean } | null {
  const names = [title, ...aliases].map(norm);
  const exact = entries.find((e) => e.category === cat && [e.title, ...(e.aliases ?? [])].some((x) => names.includes(norm(x))));
  if (exact) return { entry: exact, exact: true };
  let best: Entry | null = null, bs = 0;
  for (const e of entries) {
    if (e.category !== cat) continue;
    const st = new Set(stems(title));
    const es = [...new Set(stems(e.title))];
    const common = es.filter((w) => st.has(w));
    const score = common.length / Math.max(es.length, st.size);
    if (common.length >= 2 && common.some(distinctiveStem) && score > 0.75 && score > bs) { bs = score; best = e; }
  }
  return best ? { entry: best, exact: false } : null;
}

/** Найти существующую запись той же категории по названию и синонимам (точно или по сходству основ). */
export function matchEntry(entries: Entry[], cat: string, title: string, aliases: string[]): Entry | null {
  return matchEntryHow(entries, cat, title, aliases)?.entry ?? null;
}

const slug = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50);

/** Извлечённое моделью → предложения (с проверкой цитат). */
export function toProposals(items: ExtractedItem[], chunk: string, entries: Entry[], doc: Pick<KbDocument, 'id' | 'name' | 'reliability' | 'operation'>, chunkIndex: number): { proposals: Proposal[]; dropped: number } {
  const op = doc.operation;
  // документ операции не дополняет записи из документов других операций — там своя запись
  if (op) entries = entries.filter((e) => !foreignTo(e, op));
  const out: Proposal[] = [];
  let dropped = 0;
  const srcId = `doc:${doc.id}`;
  for (const it of items ?? []) {
    if (!CATEGORIES.some((c) => c.id === it.category) || !it.title?.trim()) continue;
    const facts: Fact[] = [];
    for (const f of it.facts ?? []) {
      if (!f.value?.trim() || !quoteFound(f.quote ?? '', chunk)) { dropped++; continue; }
      facts.push({ key: f.key, value: f.value.trim(), quote: f.quote.trim(), source: srcId, pages: `часть ${chunkIndex + 1}`, reliability: doc.reliability as Reliability });
    }
    const relations: Relation[] = [];
    for (const r of it.relations ?? []) {
      const t = entries.find((e) => [e.title, ...(e.aliases ?? [])].some((x) => norm(x) === norm(r.target))) ?? null;
      if (t && RELS.includes(r.type)) relations.push({ type: r.type, target: t.id });
    }
    const rubrics = [...new Set((it.rubrics ?? []).filter((c) => RUBRIC_CODES.includes(c)))].slice(0, 3);
    const existing = matchEntry(entries, it.category, it.title, it.aliases ?? []);
    if (existing) {
      const fresh = facts.filter((f) => !(existing.facts ?? []).some((g) => g.key === f.key && norm(g.value) === norm(f.value)));
      const freshRel = relations.filter((r) => !(existing.relations ?? []).some((g) => g.type === r.type && g.target === r.target));
      if (!fresh.length && !freshRel.length) continue;
      const freshRub = rubrics.filter((c) => !(existing.rubrics ?? defaultRubrics(existing)).includes(c));
      out.push({ id: `${doc.id}:${chunkIndex}:${out.length}`, doc: doc.id, chunk: chunkIndex, kind: 'update', target: existing.id, entry: existing, facts: fresh, relations: freshRel, ...(freshRub.length ? { rubrics: freshRub } : {}), ...(op ? { operation: op } : {}), status: 'pending' });
    } else {
      if (!facts.length) continue; // новая запись — только с подтверждёнными фактами
      const entry: Entry = {
        id: `u:${op ? `${op}:` : ''}${it.category}:${slug(it.title)}`, ...(op ? { operations: [op] } : {}), category: it.category, rubrics: rubrics.length ? rubrics : undefined, title: it.title.trim(), aliases: it.aliases ?? [], summary: it.summary?.trim() ?? '',
        facts, relations: [...relations, { type: 'source', target: srcId }], status: 'extracted', origin: 'document',
        ...(it.dateFrom || it.dateTo ? { period: { from: it.dateFrom ?? undefined, to: it.dateTo ?? undefined } } : {}),
      };
      out.push({ id: `${doc.id}:${chunkIndex}:${out.length}`, doc: doc.id, chunk: chunkIndex, kind: 'new', entry, facts, relations, ...(op ? { operation: op } : {}), status: 'pending' });
    }
  }
  return { proposals: out, dropped };
}

/** Принять предложение: новая запись или дополненная (возвращает запись для слоя пользователя). */
export function applyProposal(p: Proposal, current: Entry | undefined): Entry {
  if (p.kind === 'new') return { ...p.entry, updatedAt: new Date().toISOString() };
  const base = current ?? p.entry;
  return {
    ...base, origin: base.origin === 'seed' ? 'user' : base.origin,
    ...(p.operation ? { operations: [...new Set([...(base.operations ?? []), p.operation])] } : {}),
    ...(p.rubrics?.length ? { rubrics: [...new Set([...(base.rubrics ?? defaultRubrics(base)), ...p.rubrics])] } : {}),
    facts: [...(base.facts ?? []), ...p.facts], relations: [...(base.relations ?? []), ...p.relations.filter((r) => !(base.relations ?? []).some((g) => g.target === r.target && g.type === r.type))],
    updatedAt: new Date().toISOString(),
  };
}

/** Сведения об инфраструктуре → предложения (с проверкой цитат). */
export function toInfraProposals(items: InfraItem[] | undefined, chunk: string, doc: Pick<KbDocument, 'id' | 'name' | 'reliability'> & { operation: string }, chunkIndex: number): { proposals: InfraProposal[]; dropped: number } {
  const out: InfraProposal[] = [];
  let dropped = 0;
  const date = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);
  for (const it of items ?? []) {
    if (!it?.title?.trim() || !quoteFound(it.quote ?? '', chunk)) { dropped++; continue; }
    out.push({
      id: `${doc.id}:i${chunkIndex}:${out.length}`, doc: doc.id, docName: doc.name, chunk: chunkIndex, operation: doc.operation, reliability: doc.reliability,
      item: { ...it, title: it.title.trim(), date: date(it.date), dateTo: date(it.dateTo), quote: it.quote.trim() }, status: 'pending',
    });
  }
  return { proposals: out, dropped };
}

/** Положения формирований из документа → предложения (с проверкой цитат; без даты или места — отбрасываются). */
export function toPositionProposals(items: PositionItem[] | undefined, chunk: string, doc: Pick<KbDocument, 'id' | 'name' | 'reliability'> & { operation: string }, chunkIndex: number): { proposals: PositionProposal[]; dropped: number } {
  const out: PositionProposal[] = [];
  let dropped = 0;
  for (const it of items ?? []) {
    const date = /^\d{4}-\d{2}-\d{2}/.test(it?.date ?? '') ? it.date.slice(0, 10) : null;
    if (!it?.formation?.trim() || !it.place?.trim() || !date || !quoteFound(it.quote ?? '', chunk)) { dropped++; continue; }
    out.push({
      id: `${doc.id}:p${chunkIndex}:${out.length}`, doc: doc.id, docName: doc.name, chunk: chunkIndex, operation: doc.operation, reliability: doc.reliability,
      item: { formation: it.formation.trim(), date, place: it.place.trim(), note: it.note?.trim() || null, quote: it.quote.trim() }, status: 'pending',
    });
  }
  return { proposals: out, dropped };
}

/** Разграничительные линии из документа → предложения (с проверкой цитат; меньше двух объединений или двух пунктов — отбрасываются). */
export function toBoundaryProposals(items: BoundaryItem[] | undefined, chunk: string, doc: Pick<KbDocument, 'id' | 'name' | 'reliability'> & { operation: string }, chunkIndex: number): { proposals: BoundaryProposal[]; dropped: number } {
  const out: BoundaryProposal[] = [];
  let dropped = 0;
  const date = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null);
  for (const it of items ?? []) {
    const between = (it?.between ?? []).map((x) => x.trim()).filter(Boolean);
    const points = (it?.points ?? []).map((x) => x.trim()).filter(Boolean);
    if (between.length < 2 || points.length < 2 || !quoteFound(it.quote ?? '', chunk)) { dropped++; continue; }
    out.push({
      id: `${doc.id}:b${chunkIndex}:${out.length}`, doc: doc.id, docName: doc.name, chunk: chunkIndex, operation: doc.operation, reliability: doc.reliability,
      item: { between: between.slice(0, 2), date: date(it.date), dateTo: date(it.dateTo), points, inclusive: it.inclusive?.trim() || null, note: it.note?.trim() || null, quote: it.quote.trim() }, status: 'pending',
    });
  }
  return { proposals: out, dropped };
}

export const KIND_RU: Record<ClaimKind, string> = {
  strength: 'численность', reinforce: 'пополнение', parent: 'подчинённость', enter: 'ввод в бой', position: 'положение',
  boundary: 'разграничительная линия', crossing: 'переправа', event: 'событие', losses: 'потери',
};
const STATE_RU = { open: 'проходима', destroyed: 'разрушена', built: 'наведена' } as const;
const NUM_RU: [string, string][] = [['personnel', 'людей'], ['tanks', 'танков'], ['guns', 'орудий'], ['killed', 'убито'], ['wounded', 'ранено'], ['missing', 'пропало'], ['total', 'всего']];
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
/** ISO-дата (день, возможно с временем) → ГГГГ-ММ-ДД; всё прочее — '' (проверка даты отбросит такой факт). */
const iso = (v: unknown): string => { const d = str(v); return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(d) ? d.slice(0, 10) : ''; };

/** Формальный факт из ответа модели → формальная часть и текстовая (ключ, значение). null — собрать нельзя. */
export function buildClaim(x: ExtractedClaim): { claim: Claim; key: string; value: string } | null {
  const nums = Object.fromEntries(['personnel', 'tanks', 'guns', 'killed', 'wounded', 'missing', 'total'].map((k) => [k, num((x as unknown as Record<string, unknown>)[k])]).filter(([, v]) => v != null)) as Record<string, number>;
  const numText = NUM_RU.filter(([k]) => nums[k] != null).map(([k, ru]) => `${ru} ${nums[k]}`).join(', ');
  const date = iso(x.date), dateTo = iso(x.dateTo) || date;
  const subject = ''; // сопоставляется проверкой (names.subject)
  const place = str(x.place) || undefined;
  let claim: Claim, value: string;
  switch (x.kind) {
    case 'strength': claim = { kind: 'strength', subject, at: date, ...pickNums(nums, ['personnel', 'tanks', 'guns']) }; value = `${numText} на ${date}`; break;
    case 'reinforce': claim = { kind: 'reinforce', subject, at: date, ...pickNums(nums, ['personnel', 'tanks', 'guns']) }; value = `${numText} к ${date}`; break;
    case 'parent': claim = { kind: 'parent', subject, from: date, parent: '' }; value = `подчинён: ${str(x.parent)}, с ${date}`; break;
    case 'enter': claim = { kind: 'enter', subject, at: date }; value = `введён в бой ${date}`; break;
    case 'position': {
      const lngLat: [number, number] | undefined = num(x.lon) != null && num(x.lat) != null ? [num(x.lon)!, num(x.lat)!] : undefined;
      claim = { kind: 'position', subject, at: date, ...(place ? { place } : {}), ...(lngLat ? { lngLat } : {}), ...(lngLat && num(x.approxKm) != null ? { uncertaintyKm: num(x.approxKm) } : {}) };
      value = `${place ?? (lngLat ? `${lngLat[1]}, ${lngLat[0]}` : 'место не названо')} на ${date}`; break;
    }
    case 'boundary': {
      const points = (x.points ?? []).map(str).filter(Boolean);
      claim = { kind: 'boundary', between: ['', ''], from: date, ...(dateTo && dateTo !== date ? { to: dateTo } : {}), points, ...(str(x.inclusive) ? { inclusive: str(x.inclusive) } : {}) };
      value = `${points.join(' — ')}${date ? `, с ${date}` : ''}`; break;
    }
    case 'crossing':
      if (!x.state || !(x.state in STATE_RU)) return null;
      claim = { kind: 'crossing', subject, from: date, state: x.state }; value = `${STATE_RU[x.state]} с ${date}`; break;
    case 'event': claim = { kind: 'event', id: '', at: date, title: str(x.title) || str(x.quote).slice(0, 80), ...(place ? { place } : {}) }; value = `${(claim as { title: string }).title}, ${date}`; break;
    case 'losses': claim = { kind: 'losses', subject, from: date, to: dateTo, ...pickNums(nums, ['killed', 'wounded', 'missing', 'total', 'tanks']) }; value = `${numText}, ${date} — ${dateTo}`; break;
    default: return null;
  }
  return { claim, key: KIND_RU[x.kind], value: value.trim() };
}
const pickNums = (n: Record<string, number>, keys: string[]) => Object.fromEntries(keys.filter((k) => n[k] != null).map((k) => [k, n[k]]));

/**
 * Формальные факты из ответа модели → кандидаты (без проверок: их делает поток разбора, verdict пока 'review').
 * Названия остаются в names, claim.subject и прочие id пусты — их заполняет проверка соединения.
 * Факт, из которого claim не собрать (неизвестный вид, переправа без состояния), пропускается.
 */
export function toCandidates(
  claims: ExtractedClaim[] | undefined,
  doc: Pick<KbDocument, 'id' | 'name' | 'reliability' | 'operation'>,
  where: { chunk: number } | { page: number; stripe?: number; box?: [number, number, number, number] },
  origin: 'text' | 'scan',
): Candidate[] {
  const out: Candidate[] = [];
  const tag = 'chunk' in where ? `c${where.chunk}` : `s${where.page}${where.stripe != null ? `.${where.stripe}` : ''}`;
  for (const x of claims ?? []) {
    const b = x ? buildClaim(x) : null;
    if (!b || !x.quote?.trim()) continue;
    const quote = x.quote.trim();
    const between = (x.between ?? []).map(str);
    const names: Candidate['names'] = {
      ...(str(x.subject) ? { subject: str(x.subject) } : {}), ...(str(x.parent) ? { parent: str(x.parent) } : {}), ...(str(x.place) ? { place: str(x.place) } : {}),
      ...(between.length === 2 ? { between: [between[0], between[1]] as [string, string] } : {}),
    };
    const box = 'page' in where ? (x.box ?? where.box ?? undefined) : undefined;
    const id = `${doc.id}:${tag}:${out.length}`;
    if (b.claim.kind === 'event') b.claim.id = id;
    out.push({
      id, claim: b.claim, names, key: b.key, value: b.value, source: `doc:${doc.id}`,
      pages: 'chunk' in where ? `часть ${where.chunk + 1}` : `стр. ${where.page}`,
      reliability: doc.reliability, origin,
      evidence: 'chunk' in where ? { kind: 'quote', doc: doc.id, chunk: where.chunk, quote } : { kind: 'scan', doc: doc.id, page: where.page, quote, ...(box ? { box } : {}) },
      ...(doc.operation ? { op: doc.operation } : {}),
      checks: [], verdict: 'review', state: 'pending',
    });
  }
  return out;
}
