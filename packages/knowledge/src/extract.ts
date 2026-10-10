/**
 * Документ → предложения изменить базу. Текст режется на части; модель по каждой части выписывает
 * сведения по каркасу категорий — только прямо сказанное в тексте, каждый факт с дословной цитатой.
 * Затем проверка: факт, чьей цитаты нет в тексте части, отбрасывается (защита от выдумок); запись
 * сопоставляется с существующей (по названию и синонимам) — тогда это дополнение, иначе новая запись.
 * В базу попадает только то, что примет человек.
 */
import { CATEGORIES, type CategoryId, type Entry, type Fact, type InfraItem, type InfraProposal, type KbDocument, type BoundaryItem, type BoundaryProposal, type PositionItem, type PositionProposal, type Proposal, type Relation, type RelationType, type Reliability } from './schema';
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
export const EXTRACT_SCHEMA = {
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

const INFRA_ITEM = {
  type: 'object', additionalProperties: false, required: ['kind', 'state', 'title', 'place', 'river', 'date', 'dateTo', 'side', 'note', 'quote'],
  properties: {
    kind: { type: 'string', enum: ['bridge', 'crossing', 'road', 'rail', 'line', 'other'] },
    state: { type: 'string', enum: ['destroyed', 'damaged', 'intact', 'built', 'repaired', 'blocked', 'mined', 'impassable', 'fortified'] },
    title: s, place: { type: ['string', 'null'] }, river: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] }, dateTo: { type: ['string', 'null'] }, side: { type: ['string', 'null'] }, note: { type: ['string', 'null'] }, quote: s,
  },
} as const;
const POSITION_ITEM = {
  type: 'object', additionalProperties: false, required: ['formation', 'date', 'place', 'note', 'quote'],
  properties: { formation: s, date: s, place: s, note: { type: ['string', 'null'] }, quote: s },
} as const;
const BOUNDARY_ITEM = {
  type: 'object', additionalProperties: false, required: ['between', 'date', 'dateTo', 'points', 'inclusive', 'note', 'quote'],
  properties: { between: { type: 'array', items: s }, date: { type: ['string', 'null'] }, dateTo: { type: ['string', 'null'] }, points: { type: 'array', items: s }, inclusive: { type: ['string', 'null'] }, note: { type: ['string', 'null'] }, quote: s },
} as const;
/** Разбор документа операции: записи базы, сведения об инфраструктуре, положения формирований по дням, разграничительные линии. */
export const OPERATION_EXTRACT_SCHEMA = {
  ...EXTRACT_SCHEMA, required: ['items', 'infrastructure', 'positions', 'boundaries'],
  properties: { ...EXTRACT_SCHEMA.properties, infrastructure: { type: 'array', items: INFRA_ITEM }, positions: { type: 'array', items: POSITION_ITEM }, boundaries: { type: 'array', items: BOUNDARY_ITEM } },
} as const;

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

Категории (что это за запись):
${cats}

Рубрикатор (о чём запись):
${rubs}

${op ? infraRules(op) : ''}Ответ — один JSON-объект по схеме.` },
    { role: 'user', content: `Документ: «${docName}»${op ? ` (материал операции «${op.title}»)` : ''}. Фрагмент:\n\n${chunk}` },
  ];
}

function infraRules(op: OperationHint): string {
  return `Документ — материал операции «${op.title}» (${op.start.slice(0, 10)} — ${op.end.slice(0, 10)}). Кроме записей (items), выпишите в infrastructure сведения о состоянии инфраструктуры — то, что влияет на движение войск:
- kind: bridge — мост; crossing — переправа (понтонная, паромная, вброд, по льду); road — дорога, шоссе, улица; rail — железная дорога, станция; line — рубеж, заграждения, противотанковый ров; other — прочее (аэродром, плотина).
- state: destroyed — взорван, разрушен; damaged — повреждён, но проходим; intact — захвачен целым, уцелел; built — наведён, построен; repaired — восстановлен; blocked — завал, баррикада, затор; mined — заминирован; impassable — непроходим (распутица, затоплен); fortified — укреплён.
- title — коротко, что это: «мост через Шпрее у Фюрстенвальде»; place — ближайший населённый пункт или район в именительном падеже, немецкое или польское название — в скобках, если известно: «Фюрстенвальде (Fürstenwalde)»; river — река или канал, если есть.
- date / dateTo — ГГГГ-ММ-ДД, с какого и до какого дня это так (если сказано); side — id стороны, чьими силами (${op.sides.map((x) => `${x.id} — ${x.name}`).join(', ')}), иначе null; note — подробности (грузоподъёмность, длина, кто подорвал) или null; quote — дословная цитата.
Только прямо сказанное во фрагменте. Нет таких сведений — infrastructure пустой.

И в positions — где находилось формирование (фронт, армия, корпус, дивизия) в определённый день операции: «к исходу 22 апреля 8-я гвардейская армия вышла к Эркнеру».
- formation — название формирования, как принято по-русски («8-я гвардейская армия», «LVI танковый корпус»);
- date — ГГГГ-ММ-ДД (день, к которому относится положение; год — ${op.start.slice(0, 4)}, если не указан);
- place — населённый пункт, район или рубеж в именительном падеже, оригинал — в скобках: «Эркнер (Erkner)»;
- note — подробности (какими силами, передовые части или главные силы) или null; quote — дословная цитата.
Только положения с датой и местом, прямо сказанные во фрагменте; направление удара без места — не положение. Нет — positions пустой.

И в boundaries — разграничительные линии между объединениями (фронтами, армиями, группами армий): «Установить с 15.4.45 г. следующую разграничительную линию с 1-м Белорусским фронтом: до Унруштадт прежняя и далее оз. Енсдорфер-Зее, Гросс-Гастрозе, Люббен».
- between — два объединения, между которыми линия, как принято по-русски («1-й Белорусский фронт», «1-й Украинский фронт»); если документ адресован одному из них («с 1-м Белорусским фронтом»), второй — адресат документа;
- date / dateTo — ГГГГ-ММ-ДД, с какого и до какого дня действует (если сказано), иначе null;
- points — пункты линии по порядку, как в тексте, в именительном падеже («Люббен», «оз. Енсдорфер-Зее»); «прежняя», «по железной дороге» — не пункты (в note);
- inclusive — чьи пункты включительно (название объединения) или null; note — оговорки («все пункты, кроме Люббен», «до Люббен прежняя») или null; quote — дословная цитата.
Только прямо сказанные линии. Нет — boundaries пустой.

`;
}

const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„'’`]/g, '').replace(/[\s ]+/g, ' ').replace(/\s*-\s*/g, '-').trim();
/** Есть ли цитата во фрагменте (с точностью до пробелов, кавычек и регистра; допускается сокращение многоточием). */
export function quoteFound(quote: string, text: string): boolean {
  const t = norm(text);
  return norm(quote).split(/\s*(?:\.\.\.|…)\s*/).filter((p) => p.length >= 8).every((p) => t.includes(p)) && norm(quote).replace(/\.\.\.|…/g, '').length >= 8;
}

/** Найти существующую запись той же категории по названию и синонимам. */
export function matchEntry(entries: Entry[], cat: string, title: string, aliases: string[]): Entry | null {
  const names = [title, ...aliases].map(norm);
  const exact = entries.find((e) => e.category === cat && [e.title, ...(e.aliases ?? [])].some((x) => names.includes(norm(x))));
  if (exact) return exact;
  const st = new Set(stems(title));
  let best: Entry | null = null, bs = 0;
  for (const e of entries) {
    if (e.category !== cat) continue;
    const es = stems(e.title);
    const common = es.filter((w) => st.has(w)).length;
    const score = common / Math.max(es.length, st.size);
    if (common >= 2 && score > 0.75 && score > bs) { bs = score; best = e; }
  }
  return best;
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
