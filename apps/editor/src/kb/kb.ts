/**
 * База знаний в браузере: записи (начальные + слой пользователя), поиск, документы и их обработка
 * моделью (LM Studio), предложения изменений, вопросы и рассказы по материалам. Обработка идёт вне
 * компонентов — переключение разделов её не прерывает; подписчики получают изменения.
 */
import { stripMeta } from '../markdown';
import {
  applyProposal, chunkText, EXTRACT_SCHEMA, extractMessages, gameReference, gather, hybridHits, Index, type Hit, OPERATION_EXTRACT_SCHEMA, qaMessages, toInfraProposals, toPositionProposals, toProposals,
  type Entry, type ExtractedItem, type Fact, type InfraItem, type InfraProposal, type KbDocument, type OperationHint, type PositionItem, type PositionProposal, type Proposal, type Reliability, type Source,
} from '@def-ops/knowledge';
import { LlmClient } from '@def-ops/staff-service/llm';
import type { LlmSettings } from '../sim/game-protocol';
import * as store from './store';
import { fileText } from './text';
import { Vectors, type VecState } from './vectors';

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
  /** Обработка документа: id, часть, всего, сообщение. */
  job: { doc: string; at: number; total: number; text: string } | null;
  /** Смысловой поиск (эмбеддинги). */
  vec: VecState;
}

const vectors = new Vectors(() => { state.vec = vectors.state; emit(); });
let state: KbState = { ready: false, entries: [], byId: new Map(), index: null, documents: [], proposals: [], infra: [], positions: [], job: null, vec: vectors.state };
const subs = new Set<(s: KbState) => void>();
const emit = () => { state = { ...state }; subs.forEach((f) => f(state)); };
export const subscribe = (f: (s: KbState) => void) => { subs.add(f); f(state); return () => { subs.delete(f); }; };
export const current = () => state;

let loading: Promise<void> | null = null;
export function load(): Promise<void> {
  loading ??= reload();
  return loading;
}
async function reload() {
  const [entries, documents, proposals, infra, positions] = await Promise.all([store.entries(), store.all<KbDocument>('documents'), store.all<Proposal>('proposals'), store.all<InfraProposal>('infra'), store.all<PositionProposal>('positions')]);
  state.infra = infra;
  state.positions = positions;
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

const client = (llm: LlmSettings, thinking?: LlmSettings['thinking']) => new LlmClient({
  url: /^https?:/.test(llm.url) ? llm.url : new URL(llm.url, location.origin).href.replace(/\/+$/, ''),
  model: llm.model, thinking: thinking ?? llm.thinking, timeoutMs: 10 * 60_000, maxTokens: 12000,
}, fetch.bind(globalThis));

/* ───────────── записи ───────────── */

export async function saveEntry(e: Entry) {
  const x: Entry = { ...e, origin: e.origin === 'seed' ? 'user' : e.origin ?? 'user', updatedAt: new Date().toISOString() };
  await store.put('entries', x);
  await reload();
}

/* ───────────── документы ───────────── */

/** operation — документ операции (раздел «Моделирование» → «Операции»): записи относятся к ней, разбор ищет и инфраструктуру. */
export async function addFile(file: File, reliability: Reliability, note: string, operation?: string): Promise<KbDocument> {
  const text = (await fileText(file)).trim();
  if (text.length < 50) throw new Error('в файле не найден текст (скан без текстового слоя? — нужен распознанный PDF)');
  const id = `d${Date.now().toString(36)}`;
  const chunks = chunkText(text).map((t, i) => ({ i, text: t }));
  const doc: KbDocument = { id, name: file.name, mime: file.type, size: file.size, addedAt: new Date().toISOString(), reliability, note: note || undefined, chunks, status: 'new', processed: 0, ...(operation ? { operation } : {}) };
  // запись-источник: документ виден в каркасе (категория «Источники → Загруженные документы»)
  const src: Entry = { id: `doc:${id}`, category: 'sources', group: 'uploaded', title: file.name, ...(operation ? { operations: [operation] } : {}), summary: note || `Загруженный документ: ${chunks.length} частей, ${text.length < 2000 ? `${text.length} знаков` : `${Math.round(text.length / 1000)} тыс. знаков`}.`, status: 'checked', origin: 'document',
    facts: [{ key: 'ref', value: file.name }, { key: 'reliability', value: reliability }, ...(note ? [{ key: 'covers', value: note }] : [])] };
  await store.put('documents', doc);
  await store.put('entries', src);
  await reload();
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
  await reload();
}

let abort: AbortController | null = null;
export const stop = () => abort?.abort();

/**
 * Обработать документ моделью: по частям, с места остановки; предложения — в очередь на проверку. Документ
 * операции (hint — её сроки и стороны) — ещё и сведения об инфраструктуре.
 */
export async function process(id: string, llm: LlmSettings, hint?: OperationHint) {
  llm = kbLlm(llm);
  if (state.job) throw new Error('уже идёт обработка другого документа');
  const doc = state.documents.find((d) => d.id === id);
  if (!doc) return;
  abort = new AbortController();
  const c = client(llm, 'off');
  doc.status = 'processing';
  let dropped = 0, made = 0;
  if (doc.operation && !hint) hint = await (await import('../sim/userdata')).operationHint(doc.operation);
  const op = doc.operation && hint ? hint : undefined;
  const sum = doc.extracted ?? { entries: 0, updates: 0, infra: 0, dropped: 0 };
  try {
    for (let i = doc.processed ?? 0; i < doc.chunks.length; i++) {
      if (abort.signal.aborted) break;
      state.job = { doc: id, at: i, total: doc.chunks.length, text: `часть ${i + 1} из ${doc.chunks.length}…` };
      emit();
      const r = await c.chat({ messages: extractMessages(doc.chunks[i].text, doc.name, op), schema: op ? { name: 'kb_operation_extract', schema: OPERATION_EXTRACT_SCHEMA } : { name: 'kb_extract', schema: EXTRACT_SCHEMA }, signal: abort.signal });
      const j = r.json as { items?: ExtractedItem[]; infrastructure?: InfraItem[]; positions?: PositionItem[] } | undefined;
      const res = toProposals(j?.items ?? [], doc.chunks[i].text, state.entries, doc, i);
      dropped += res.dropped; made += res.proposals.length;
      if (res.proposals.length) await store.put('proposals', ...res.proposals);
      sum.entries += res.proposals.filter((p) => p.kind === 'new').length; sum.updates += res.proposals.filter((p) => p.kind === 'update').length; sum.dropped += res.dropped;
      if (op && doc.operation) {
        const inf = toInfraProposals(j?.infrastructure, doc.chunks[i].text, { ...doc, operation: doc.operation }, i);
        if (inf.proposals.length) await store.put('infra', ...inf.proposals);
        state.infra = [...state.infra, ...inf.proposals];
        sum.infra += inf.proposals.length; sum.dropped += inf.dropped; dropped += inf.dropped; made += inf.proposals.length;
        const pos = toPositionProposals(j?.positions, doc.chunks[i].text, { ...doc, operation: doc.operation }, i);
        if (pos.proposals.length) await store.put('positions', ...pos.proposals);
        state.positions = [...state.positions, ...pos.proposals];
        sum.positions = (sum.positions ?? 0) + pos.proposals.length; sum.dropped += pos.dropped; dropped += pos.dropped; made += pos.proposals.length;
      }
      doc.extracted = { ...sum };
      doc.processed = i + 1;
      await store.put('documents', { ...doc });
      state.proposals = [...state.proposals, ...res.proposals];
    }
    doc.status = (doc.processed ?? 0) >= doc.chunks.length ? 'processed' : 'new';
    doc.error = undefined;
  } catch (e) {
    doc.status = 'error';
    doc.error = abort.signal.aborted ? 'остановлено' : (e as Error).message;
  } finally {
    await store.put('documents', { ...doc });
    state.job = null;
    abort = null;
    await reload();
  }
  return { made, dropped };
}

/* ───────────── предложения ───────────── */

export async function decide(ids: string[], accept: boolean) {
  const ps = state.proposals.filter((p) => ids.includes(p.id) && p.status === 'pending');
  const touched = new Map<string, Entry>();
  for (const p of ps) {
    p.status = accept ? 'accepted' : 'rejected';
    if (!accept) continue;
    const key = p.kind === 'new' ? p.entry.id : p.target!;
    const cur = touched.get(key) ?? state.byId.get(key);
    touched.set(key, applyProposal(p, cur));
  }
  if (touched.size) await store.put('entries', ...touched.values());
  await store.put('proposals', ...ps);
  await reload();
}

/** Сведения об инфраструктуре: отметить принятыми или отклонёнными (в операцию их записывает раздел «Операции»). */
export async function decideInfra(ids: string[], accept: boolean) {
  const ps = state.infra.filter((p) => ids.includes(p.id) && p.status === 'pending');
  for (const p of ps) p.status = accept ? 'accepted' : 'rejected';
  if (ps.length) await store.put('infra', ...ps);
  await reload();
}

/** Положения из документов: отметить принятыми или отклонёнными (в историю и в базу их пишет раздел «Операции»). */
export async function decidePositions(ids: string[], accept: boolean) {
  const ps = state.positions.filter((p) => ids.includes(p.id) && p.status === 'pending');
  for (const p of ps) p.status = accept ? 'accepted' : 'rejected';
  if (ps.length) await store.put('positions', ...ps);
  await reload();
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
}

/* ───────────── обмен ───────────── */

export async function exportUser(): Promise<string> {
  const [entries, documents, proposals, infra, positions] = await Promise.all([store.all('entries'), store.all('documents'), store.all('proposals'), store.all('infra'), store.all('positions')]);
  return JSON.stringify({ format: 'def-ops-knowledge', version: 1, exported: new Date().toISOString(), entries, documents, proposals, infra, positions });
}
export async function importUser(json: string) {
  const d = JSON.parse(json) as { format?: string; entries?: Entry[]; documents?: KbDocument[]; proposals?: Proposal[]; infra?: InfraProposal[]; positions?: PositionProposal[] };
  if (d.format !== 'def-ops-knowledge') throw new Error('это не выгрузка базы знаний');
  if (d.entries?.length) await store.put('entries', ...d.entries);
  if (d.documents?.length) await store.put('documents', ...d.documents);
  if (d.proposals?.length) await store.put('proposals', ...d.proposals);
  if (d.infra?.length) await store.put('infra', ...d.infra);
  if (d.positions?.length) await store.put('positions', ...d.positions);
  await reload();
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
  const r = await client(llm).chat({ messages: qaMessages(mode, question, sources, history), signal, onDelta: (k, t) => { if (k === 'content') content += t; else reasoning += t; push(); } });
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

/** Справка из базы для советника в игре: доктрина, техника, местность, источники; ход боёв — только в вопросах истории. */
export async function reference(query: string, historyAllowed: boolean, operation?: string): Promise<string> {
  try { await load(); } catch { return ''; }
  if (!state.index) return '';
  // справка отбирается фильтром (доктрина, техника) — нужна широкая выдача
  return gameReference(state.index, state.byId, query, historyAllowed, 5, await search(query, 300).catch(() => undefined), operation);
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
}
