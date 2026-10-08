/**
 * Документ → предложения изменить базу. Текст режется на части; модель по каждой части выписывает
 * сведения по каркасу категорий — только прямо сказанное в тексте, каждый факт с дословной цитатой.
 * Затем проверка: факт, чьей цитаты нет в тексте части, отбрасывается (защита от выдумок); запись
 * сопоставляется с существующей (по названию и синонимам) — тогда это дополнение, иначе новая запись.
 * В базу попадает только то, что примет человек.
 */
import { CATEGORIES, type CategoryId, type Entry, type Fact, type KbDocument, type Proposal, type Relation, type RelationType, type Reliability } from './schema';
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

export interface ExtractedItem {
  category: CategoryId; rubrics?: string[]; title: string; aliases: string[]; summary: string;
  facts: { key: string; value: string; quote: string }[];
  relations: { type: RelationType; target: string }[];
  dateFrom: string | null; dateTo: string | null;
}

export function extractMessages(chunk: string, docName: string): { role: 'system' | 'user'; content: string }[] {
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

Ответ — один JSON-объект по схеме.` },
    { role: 'user', content: `Документ: «${docName}». Фрагмент:\n\n${chunk}` },
  ];
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
export function toProposals(items: ExtractedItem[], chunk: string, entries: Entry[], doc: Pick<KbDocument, 'id' | 'name' | 'reliability'>, chunkIndex: number): { proposals: Proposal[]; dropped: number } {
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
      out.push({ id: `${doc.id}:${chunkIndex}:${out.length}`, doc: doc.id, chunk: chunkIndex, kind: 'update', target: existing.id, entry: existing, facts: fresh, relations: freshRel, ...(freshRub.length ? { rubrics: freshRub } : {}), status: 'pending' });
    } else {
      if (!facts.length) continue; // новая запись — только с подтверждёнными фактами
      const entry: Entry = {
        id: `u:${it.category}:${slug(it.title)}`, category: it.category, rubrics: rubrics.length ? rubrics : undefined, title: it.title.trim(), aliases: it.aliases ?? [], summary: it.summary?.trim() ?? '',
        facts, relations: [...relations, { type: 'source', target: srcId }], status: 'extracted', origin: 'document',
        ...(it.dateFrom || it.dateTo ? { period: { from: it.dateFrom ?? undefined, to: it.dateTo ?? undefined } } : {}),
      };
      out.push({ id: `${doc.id}:${chunkIndex}:${out.length}`, doc: doc.id, chunk: chunkIndex, kind: 'new', entry, facts, relations, status: 'pending' });
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
    ...(p.rubrics?.length ? { rubrics: [...new Set([...(base.rubrics ?? defaultRubrics(base)), ...p.rubrics])] } : {}),
    facts: [...(base.facts ?? []), ...p.facts], relations: [...(base.relations ?? []), ...p.relations.filter((r) => !(base.relations ?? []).some((g) => g.target === r.target && g.type === r.type))],
    updatedAt: new Date().toISOString(),
  };
}
