/**
 * База знаний в браузере: записи (начальные + слой пользователя), поиск, документы и их обработка
 * моделью (LM Studio), предложения изменений, вопросы и рассказы по материалам. Обработка идёт вне
 * компонентов — переключение разделов её не прерывает; подписчики получают изменения.
 */
import { stripMeta } from '../markdown';
import {
  chunkText, doctrineFor, gather, hybridHits, Index, type Hit, qaMessages, roleReference,
  type DoctrineClaim, type DoctrineRule, type DoctrineTrigger, type RoleRef, type RoleScope,
  type Entry, type Fact, type BoundaryProposal, type InfraProposal, type KbDocument, type OperationHint, type Pins, type PositionProposal, type Proposal, type Reliability, type Source, type TableMapping,
} from '@def-ops/knowledge';
import { LlmClient } from '@def-ops/staff-service/llm';
import type { LlmSettings } from '../sim/game-protocol';
import * as store from './store';
import normsFile from '../../../../packages/sim/data/rules/norms.json';
import { readDocument } from './text';
import { ingest, type IngestProgress, type IngestResult } from './ingest';
import { Vectors, type VecState } from './vectors';
import type { StoredCandidate } from './candidates';

export interface KbState {
  ready: boolean;
  entries: Entry[];
  byId: Map<string, Entry>;
  index: Index | null;
  documents: KbDocument[];
  proposals: Proposal[];
  /** Сведения об инфраструктуре из документов операций. */
  infra: InfraProposal[];
  /** Положения формирований по дням из документов операций. */
  positions: PositionProposal[];
  boundaries: BoundaryProposal[];
  /** Кандидаты-факты: очередь «На проверку» (pending), принятые и отклонённые (итоги документа). */
  candidates: StoredCandidate[];
  /** Обработка документа: id, часть, всего, сообщение. */
  job: { doc: string; at: number; total: number; text: string } | null;
  /** Смысловой поиск (эмбеддинги). */
  vec: VecState;
}

const vectors = new Vectors(() => { state.vec = vectors.state; emit(); });
let state: KbState = { ready: false, entries: [], byId: new Map(), index: null, documents: [], proposals: [], infra: [], positions: [], boundaries: [], candidates: [], job: null, vec: vectors.state };
const subs = new Set<(s: KbState) => void>();
const emit = () => { state = { ...state }; subs.forEach((f) => f(state)); };
export const subscribe = (f: (s: KbState) => void) => { subs.add(f); f(state); return () => { subs.delete(f); }; };
export const current = () => state;

/**
 * База изменилась (запись, факты, решение по предложениям, загрузка, закрепление): событие в окне — поправки
 * операций пересобираются (sim/kb-recompile.ts). В фоновом потоке окна нет — не нужно.
 */
export const KB_CHANGED = 'def_ops.kb-changed';
function kbChanged() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(KB_CHANGED)); }

let loading: Promise<void> | null = null;
export function load(): Promise<void> {
  loading ??= migrate().then(reload);
  return loading;
}
/**
 * Перенос прежних очередей (версия 6) в кандидаты и факты — один раз, в окне (нужны сценарии и театры операций);
 * в фоновом потоке не выполняется. Ошибка переноса не мешает открыть базу.
 */
async function migrate() {
  if (typeof window === 'undefined') return;
  try { await (await import('./migrate')).migrateV7(); } catch (e) { console.warn('перенос базы знаний (версия 7):', e); }
}
/** Перечитать базу и известить сборщик операций (после записи в хранилище в обход функций этого модуля). */
export async function refresh() {
  await reload();
  kbChanged();
}
async function reload() {
  const [entries, documents, proposals, infra, positions, boundaries, candidates] = await Promise.all([store.entries(), store.all<KbDocument>('documents'), store.all<Proposal>('proposals'), store.all<InfraProposal>('infra'), store.all<PositionProposal>('positions'), store.all<BoundaryProposal>('boundaries'), store.all<StoredCandidate>('candidates')]);
  state.candidates = candidates;
  state.infra = infra;
  state.positions = positions;
  state.boundaries = boundaries;
  state.entries = entries;
  state.byId = new Map(entries.map((e) => [e.id, e]));
  state.documents = documents.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  state.proposals = proposals;
  state.index = new Index(entries, documents);
  state.ready = true;
  emit();
  void vectors.index(state.index, state.byId);
}

/* ───────────── смысловой поиск ───────────── */

/** Настройки модели (из оболочки): при появлении модели эмбеддингов база индексируется. */
export function configure(llm: LlmSettings, embedModels: string[] | null) {
  if (vectors.configure(llm, embedModels) && state.ready) void vectors.index(state.index!, state.byId);
}
export const rebuildVectors = () => (state.ready ? vectors.rebuild(state.index!, state.byId) : Promise.resolve());

/** Поиск: BM25, при готовых векторах — гибрид BM25 + смысловая близость (RRF). */
export async function search(query: string, pool = 30): Promise<Hit[]> {
  await load();
  const bm = state.index!.search(query, { limit: pool });
  if (!vectors.ready) return bm;
  try { return hybridHits(bm, await vectors.near(query, pool), (id) => state.index!.doc(id), pool); } catch { return bm; }
}

export const llmClient = (llm: LlmSettings, thinking?: LlmSettings['thinking']) => new LlmClient({
  url: /^https?:/.test(llm.url) ? llm.url : new URL(llm.url, location.origin).href.replace(/\/+$/, ''),
  model: llm.model, thinking: thinking ?? llm.thinking, timeoutMs: 10 * 60_000, maxTokens: 12000,
}, fetch.bind(globalThis));

/* ───────────── записи ───────────── */

export async function saveEntry(e: Entry) {
  const x: Entry = { ...e, origin: e.origin === 'seed' ? 'user' : e.origin ?? 'user', updatedAt: new Date().toISOString() };
  await store.put('entries', x);
  await reload();
  kbChanged();
}

/* ───────────── закрепления ───────────── */

/** Закрепления выбора факта: ключ pinKey → факт или 'none' (не брать ничего). */
export const getPins = () => store.pins();
/** Закрепить факт за ключом (null — снять закрепление). */
export const setPin = (key: string, pin: Pins[string] | null) => setPins({ [key]: pin });
/** Несколько закреплений разом (одно событие «база изменилась»). */
export async function setPins(list: Record<string, Pins[string] | null>) {
  if (!Object.keys(list).length) return;
  await store.putPins(list);
  kbChanged();
}

/* ───────────── документы ───────────── */

/** Чтение файла (подменяется в тестах): тип входа определяется сам. */
export const reader = { read: readDocument };

const normWs = (t: string) => t.replace(/\s+/g, ' ').trim();
/** Страница PDF, с которой начинается часть (по первым словам части); не найдено — как у предыдущей. */
function chunkPages(chunks: string[], pages: string[]): (number | undefined)[] {
  const norm = pages.map(normWs);
  let last: number | undefined;
  return chunks.map((c) => {
    const head = normWs(c).slice(0, 60);
    const i = head ? norm.findIndex((p, k) => (last == null || k + 1 >= last) && p.includes(head)) : -1;
    if (i >= 0) last = i + 1;
    return last;
  });
}

const size = (n: number) => (n < 2000 ? `${n} знаков` : `${Math.round(n / 1000)} тыс. знаков`);

/**
 * Загрузить документ любого типа: текст (PDF с текстовым слоем, docx, txt, md, html), скан (PDF без текста —
 * меньше 50 знаков на страницу, JPG, PNG), таблица (CSV, XLSX), пакет фактов (JSON def-ops-facts). Картинки
 * сканов и байты PDF — в хранилище pages (картинки страниц PDF рисуются при разборе). operation — документ
 * операции: кандидаты относятся к ней, проверки идут по её сценарию и театру.
 */
export async function addFile(file: File, reliability: Reliability, note: string, operation?: string): Promise<KbDocument> {
  const r = await reader.read(file);
  const id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const base = { id, name: file.name, mime: file.type, size: file.size, addedAt: new Date().toISOString(), reliability, note: note || undefined, status: 'new' as const, processed: 0, ...(operation ? { operation } : {}) };
  let doc: KbDocument, about: string;
  const pages: unknown[] = [];
  if (r.kind === 'text') {
    const text = r.text.trim();
    const scans = r.scanPages ?? [];
    if (text.length < 50 && !scans.length) throw new Error('в файле не найден текст');
    const parts = text.length >= 50 ? chunkText(text) : [];
    const at = r.pages ? chunkPages(parts, r.pages) : [];
    doc = { ...base, kind: scans.length && !parts.length ? 'scan' : 'text', chunks: parts.map((t, i) => ({ i, text: t, ...(at[i] ? { page: at[i] } : {}) })),
      ...(r.pages ? { pageCount: r.pages.length } : {}), ...(scans.length ? { scans: scans.map((page) => ({ page })) } : {}) };
    if (scans.length && r.pdf) pages.push({ id: `${id}:pdf`, doc: id, pdf: r.pdf });
    about = [parts.length ? `${parts.length} частей, ${size(text.length)}` : '', scans.length ? `страниц-сканов: ${scans.length}` : ''].filter(Boolean).join('; ');
  } else if (r.kind === 'image') {
    doc = { ...base, kind: 'scan', chunks: [], pageCount: 1, scans: [{ page: 1, width: r.image.width, height: r.image.height }] };
    pages.push({ id: `${id}:1`, doc: id, page: 1, ...r.image });
    about = 'скан (картинка)';
  } else if (r.kind === 'table') {
    if (r.rows.length < 2) throw new Error('в таблице нет строк');
    doc = { ...base, kind: 'table', chunks: [], table: r.rows };
    about = `таблица: ${r.rows.length - 1} строк, ${r.rows[0].length} столбцов`;
  } else {
    const j = r.json as { format?: unknown; facts?: unknown[] } | null;
    if (j?.format !== 'def-ops-facts') throw new Error(j && (j as { format?: unknown }).format === 'def-ops-knowledge' ? 'это выгрузка базы знаний — её загружают кнопкой «Загрузить выгрузку»' : 'это не пакет фактов (формат def-ops-facts)');
    doc = { ...base, kind: 'facts', chunks: [], facts: r.json };
    about = `пакет фактов: ${Array.isArray(j.facts) ? j.facts.length : 0}`;
  }
  // запись-источник: документ виден в каркасе (категория «Источники → Загруженные документы»)
  const src: Entry = { id: `doc:${id}`, category: 'sources', group: 'uploaded', title: file.name, ...(operation ? { operations: [operation] } : {}), summary: note || `Загруженный документ: ${about}.`, status: 'checked', origin: 'document',
    facts: [{ key: 'ref', value: file.name }, { key: 'reliability', value: reliability }, ...(note ? [{ key: 'covers', value: note }] : [])] };
  if (pages.length) await store.put('pages', ...pages);
  await store.put('documents', doc);
  await store.put('entries', src);
  await reload();
  kbChanged();
  return doc;
}

export async function removeDocument(id: string) {
  await store.del('documents', id);
  await store.del('entries', `doc:${id}`);
  const ps = state.proposals.filter((p) => p.doc === id && p.status === 'pending').map((p) => p.id);
  if (ps.length) await store.del('proposals', ...ps);
  const ip = state.infra.filter((p) => p.doc === id && p.status === 'pending').map((p) => p.id);
  if (ip.length) await store.del('infra', ...ip);
  const pp = state.positions.filter((p) => p.doc === id && p.status === 'pending').map((p) => p.id);
  if (pp.length) await store.del('positions', ...pp);
  const bp = state.boundaries.filter((p) => p.doc === id && p.status === 'pending').map((p) => p.id);
  if (bp.length) await store.del('boundaries', ...bp);
  // кандидаты документа, ждущие решения, картинки страниц и расшифровки
  const cp = state.candidates.filter((c) => c.source === `doc:${id}` && c.state === 'pending').map((c) => c.id);
  if (cp.length) await store.del('candidates', ...cp);
  for (const s of ['pages', 'transcripts'] as const) {
    const ids = (await store.all<{ id: string; doc?: string }>(s)).filter((x) => x.doc === id).map((x) => x.id);
    if (ids.length) await store.del(s, ...ids);
  }
  await reload();
  kbChanged();
}

let abort: AbortController | null = null;
export const stop = () => abort?.abort();

/** Ход разбора для человека: «часть / страница N из M; принято автоматически X, на проверку Y, отброшено Z». */
export const progressText = (p: IngestProgress) => `${p.stage}; принято автоматически ${p.auto}, на проверку ${p.review}, отброшено ${p.drop}`;

/**
 * Разобрать документ (поток ingest.ts): по частям или страницам, с места остановки; кандидаты проходят проверки и
 * ложатся в базу, в очередь «На проверку» или в отброшенные. Ход — в state.job; стоп — stop().
 */
export async function process(id: string, llm: LlmSettings, o: { hint?: OperationHint; pages?: [number, number]; mapping?: TableMapping } = {}): Promise<IngestResult | undefined> {
  if (state.job) throw new Error('уже идёт обработка другого документа');
  if (!state.documents.some((d) => d.id === id)) return undefined;
  abort = new AbortController();
  state.job = { doc: id, at: 0, total: 1, text: 'подготовка…' };
  emit();
  try {
    return await ingest(id, llm, { ...o, signal: abort.signal, onProgress: (p) => { state.job = { doc: id, at: p.done, total: p.total, text: progressText(p) }; emit(); } });
  } finally {
    state.job = null;
    abort = null;
    await reload();
    kbChanged();
  }
}

/**
 * Добавить факты в запись (сверка со сценарием, положения из документов): запись берётся существующая или
 * создаётся по образцу; повторяющиеся факты (тот же ключ и значение) не добавляются. Одна запись — один раз.
 */
export async function addFacts(list: { entry?: string; create?: Entry; facts: Fact[]; operation?: string }[]) {
  await load();
  const touched = new Map<string, Entry>();
  for (const x of list) {
    const id = x.entry ?? x.create?.id;
    if (!id) continue;
    const cur = touched.get(id) ?? state.byId.get(id) ?? x.create;
    if (!cur) continue;
    const fresh = x.facts.filter((f) => !(cur.facts ?? []).some((g) => g.key === f.key && g.value === f.value));
    if (!fresh.length && touched.has(id)) continue;
    touched.set(id, {
      ...cur, origin: cur.origin === 'seed' ? 'user' : cur.origin ?? 'user',
      ...(x.operation ? { operations: [...new Set([...(cur.operations ?? []), x.operation])] } : {}),
      facts: [...(cur.facts ?? []), ...fresh], updatedAt: new Date().toISOString(),
    });
  }
  if (touched.size) await store.put('entries', ...touched.values());
  await reload();
  kbChanged();
  return touched.size;
}

/** Запись о калибровке модели по операции (рубрика «Устройство модели стенда»; советнику в игре не подаётся). */
export async function recordCalibration(op: { id: string; title: string }, at: string, title: string, text: string, facts: Fact[]) {
  await load();
  const id = `u:${op.id}:calibration`;
  const cur = state.byId.get(id);
  const e: Entry = cur ?? {
    id, category: 'organization', group: 'model', title: `Калибровка модели: ${op.title.split(':')[0]}`, operations: [op.id], rubrics: ['9.7'],
    summary: 'Пересчёты модели по этой операции после уточнения данных: что изменилось в данных, мерило до и после, множители правил, контрольная операция.',
    facts: [], sections: [], status: 'checked', origin: 'user',
  };
  await store.put('entries', { ...e, facts: [...(e.facts ?? []), ...facts], sections: [{ title: `${at.slice(8, 10)}.${at.slice(5, 7)}.${at.slice(0, 4)}: ${title}`, text }, ...(e.sections ?? [])], updatedAt: new Date().toISOString() });
  await reload();
  kbChanged();
}

/* ───────────── обмен ───────────── */

/**
 * Выгрузка материалов (версия 2): записи (факты с проверкой и доказательством), документы, кандидаты, прежние
 * очереди, закрепления. Картинки страниц и расшифровки сканов не входят — документ загружается заново.
 */
export async function exportUser(): Promise<string> {
  const [entries, documents, proposals, infra, positions, boundaries, pins, candidates] = await Promise.all([store.all('entries'), store.all('documents'), store.all('proposals'), store.all('infra'), store.all('positions'), store.all('boundaries'), store.all('pins'), store.all('candidates')]);
  return JSON.stringify({ format: 'def-ops-knowledge', version: 2, exported: new Date().toISOString(), entries, documents, proposals, infra, positions, boundaries, pins, candidates });
}
/**
 * Загрузка выгрузки. Версия 1 (до кандидатов) — с переносом: принятые положения, линии, переправы — фактами с
 * формальной частью, ждущие и отклонённые — кандидатами (migrate.ts; повторная загрузка ничего не задваивает).
 */
export async function importUser(json: string, ctx?: import('./migrate').MigrateCtx) {
  const d = JSON.parse(json) as { format?: string; version?: number; entries?: Entry[]; documents?: KbDocument[]; proposals?: Proposal[]; infra?: InfraProposal[]; positions?: PositionProposal[]; boundaries?: BoundaryProposal[]; pins?: { id: string; pin: Pins[string] }[]; candidates?: StoredCandidate[] };
  if (d.format !== 'def-ops-knowledge') throw new Error('это не выгрузка базы знаний');
  if (d.candidates?.length) await store.put('candidates', ...d.candidates);
  if (d.entries?.length) await store.put('entries', ...d.entries);
  if (d.documents?.length) await store.put('documents', ...d.documents);
  if (d.proposals?.length) await store.put('proposals', ...d.proposals);
  if (d.infra?.length) await store.put('infra', ...d.infra);
  if (d.positions?.length) await store.put('positions', ...d.positions);
  if (d.boundaries?.length) await store.put('boundaries', ...d.boundaries);
  // метки переноса — свои у этой базы, из файла не берутся
  const pins = d.pins?.filter((p) => !p.id.startsWith('migrated:'));
  if (pins?.length) await store.put('pins', ...pins);
  if ((d.version ?? 1) < 2) await (await import('./migrate')).migrateLegacy({ proposals: d.proposals, infra: d.infra, positions: d.positions, boundaries: d.boundaries }, ctx);
  await reload();
  kbChanged();
}

/* ───────────── вопросы и рассказы ───────────── */

/**
 * Поток ответа как его видит человек: ответ и размышление отдельно. Сервер может присылать размышление в
 * reasoning_content, обёрнутым в <think>…</think> прямо в ответе, а при выключенном размышлении — весь ответ
 * в reasoning_content (тогда он и показывается как ответ).
 */
export function streamView(content: string, reasoning: string, thinkingOff: boolean, final = false): { answer: string; thinking: string } {
  let think = '';
  let answer = content.replace(/<think>([\s\S]*?)<\/think>/g, (_m, t: string) => { think += t; return ''; });
  const open = answer.indexOf('<think>');
  if (open >= 0) { think += answer.slice(open + 7); answer = answer.slice(0, open); }
  const thinking = [reasoning, think].filter(Boolean).join('\n');
  // пока идёт поток, текст размышления — размышление (многие модели думают и при выключенном размышлении: gpt-oss,
  // часть MLX-сборок); ответом он считается, только если к концу ответа так и не было
  if (final && !answer.trim() && thinkingOff) return { answer: thinking, thinking: '' };
  return { answer: answer.replace(/^\s+/, ''), thinking };
}

/** Настройки модели для базы знаний: своя модель и размышление, если заданы, иначе — как в разделе «ИИ». */
export const kbLlm = (llm: LlmSettings): LlmSettings => ({ ...llm, model: llm.kbModel || llm.model, thinking: llm.kbThinking ?? llm.thinking });

/** Модель чтения сканов (со зрением): своя модель и размышление, если заданы, иначе — как в разделе «ИИ». */
export const scanLlm = (llm: LlmSettings): LlmSettings => ({ ...llm, model: llm.scanModel || llm.model, thinking: llm.scanThinking ?? llm.thinking });

/** Модель перекрёстной проверки цитат: своя, если задана, иначе — как в разделе «ИИ». */
export const crossLlm = (llm: LlmSettings): LlmSettings => ({ ...llm, model: llm.crossModel || llm.model, thinking: llm.crossThinking ?? llm.thinking });

/** Убрать из ответа служебные пометки модели о жанре и объёме («Лекция по…», «(Общий объём: около 500 слов)»). */
export function cleanAnswer(t: string): string {
  return stripMeta(t).replace(/^\s+/, '');
}

export async function ask(mode: 'ask' | 'lecture', question: string, llm: LlmSettings, history: { q: string; a: string }[],
  onStream: (v: { answer: string; thinking: string; stage: 'search' | 'model' }) => void, signal?: AbortSignal): Promise<{ text: string; thinking: string; sources: Source[]; model: string; seconds: number; search: string }> {
  llm = kbLlm(llm);
  const t0 = performance.now();
  onStream({ answer: '', thinking: '', stage: 'search' });
  await load();
  const sources = gather(state.index!, state.byId, question, { limit: mode === 'lecture' ? 10 : 7, hits: await search(question, 30) });
  let content = '', reasoning = '', last = 0;
  const off = llm.thinking === 'off';
  const push = (final = false) => { const now = performance.now(); if (final || now - last > 60) { last = now; onStream({ ...streamView(content, reasoning, off, final), stage: 'model' }); } };
  onStream({ answer: '', thinking: '', stage: 'model' });
  const r = await llmClient(llm).chat({ messages: qaMessages(mode, question, sources, history), signal, onDelta: (k, t) => { if (k === 'content') content += t; else reasoning += t; push(); } });
  push(true);
  return { text: r.content, thinking: r.reasoning, sources, model: r.model, seconds: Math.round((performance.now() - t0) / 1000), search: searchMode() };
}

/** Как искала база: по словам и по смыслу (эмбеддинги) или только по словам — и почему. */
export function searchMode(): string {
  const v = vectors.state;
  if (vectors.ready) return `поиск: слова + смысл (${v.model})`;
  const why = { none: 'модели эмбеддингов на сервере нет', off: 'смысловой поиск выключен', testing: 'идёт самопроверка модели эмбеддингов', indexing: `векторы ещё считаются: ${v.done}/${v.total}`, error: `ошибка эмбеддингов: ${v.error ?? ''}`, ready: 'векторов нет' }[v.status];
  return `поиск: только по словам — ${why}`;
}

/**
 * Справка по роли (советник, посредник, штаб противника, Ставка, разбор): по каждому запросу — гибридная выдача
 * (слова + смысл, широкий пул — справка отбирается фильтром роли), всего не больше limit записей по chars знаков.
 * База недоступна — пустая справка.
 */
export async function roleRef(queries: string[], scope: RoleScope, o: { limit?: number; chars?: number } = {}): Promise<{ refs: RoleRef[]; text: string }> {
  try { await load(); } catch { return { refs: [], text: '' }; }
  if (!state.index) return { refs: [], text: '' };
  const hits = await Promise.all(queries.map((q) => search(q, 300).catch(() => undefined)));
  return roleReference(state.index, state.byId, queries, scope, { limit: o.limit ?? 5, chars: o.chars ?? 700, hits });
}

/** Доктрина стороны к обстановке — по всей базе (сид и слой пользователя) с закреплениями. */
export async function doctrine(side: 'su' | 'de', triggers: DoctrineTrigger[], query: string, levels?: DoctrineClaim['level'][]): Promise<{ rules: DoctrineRule[]; text: string }> {
  await load();
  return doctrineFor(state.entries, await getPins(), side, triggers, query, levels ? { levels } : {});
}

/**
 * Принятое сведение об инфраструктуре — и в базу знаний: запись «Состояние инфраструктуры» операции (театр;
 * рубрики «Переправы и мосты», «Дороги и транспорт»), факт с цитатой и источником.
 */
export async function addInfraFact(op: { id: string; title: string }, f: { text: string; quote?: string; doc?: string; reliability?: Reliability; road?: boolean }) {
  await load();
  const id = `u:${op.id}:infrastructure`;
  const cur = state.byId.get(id);
  const fact = { key: 'features', value: f.text, ...(f.quote ? { quote: f.quote } : {}), ...(f.doc ? { source: `doc:${f.doc}` } : {}), ...(f.reliability ? { reliability: f.reliability } : {}) };
  if (cur?.facts?.some((x) => x.value === fact.value)) return;
  const e: Entry = cur ?? {
    id, category: 'terrain', group: 'rivers', title: `Состояние инфраструктуры: ${op.title.split(':')[0]}`, operations: [op.id], rubrics: ['5.3', '5.2'],
    summary: 'Мосты, переправы, дороги и железные дороги операции — по документам и сведениям, принятым в разделе «Операции».', facts: [], status: 'extracted', origin: 'document',
  };
  await store.put('entries', { ...e, facts: [...(e.facts ?? []), fact], updatedAt: new Date().toISOString() });
  await reload();
  kbChanged();
}

/** Нормативы модели (norms.json) и записи базы, на которые они ссылаются (kb) — для «Полноты» общих знаний. */
export function normsCoverage(byId: Map<string, Entry>): { id: string; title: string; kb?: string; entry: Entry | null }[] {
  const list = (normsFile as unknown as { norms: { id: string; title: string; kb?: string }[] }).norms ?? [];
  return list.map((n) => ({ id: n.id, title: n.title, kb: n.kb, entry: (n.kb && byId.get(n.kb)) || null }));
}
