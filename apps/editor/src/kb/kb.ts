/**
 * База знаний в браузере: записи (начальные + слой пользователя), поиск, документы и их обработка
 * моделью (LM Studio), предложения изменений, вопросы и рассказы по материалам. Обработка идёт вне
 * компонентов — переключение разделов её не прерывает; подписчики получают изменения.
 */
import {
  applyProposal, chunkText, EXTRACT_SCHEMA, extractMessages, gameReference, gather, Index, qaMessages, toProposals,
  type Entry, type ExtractedItem, type KbDocument, type Proposal, type Reliability, type Source,
} from '@def-ops/knowledge';
import { LlmClient } from '@def-ops/staff-service/llm';
import type { LlmSettings } from '../sim/game-protocol';
import * as store from './store';
import { fileText } from './text';

export interface KbState {
  ready: boolean;
  entries: Entry[];
  byId: Map<string, Entry>;
  index: Index | null;
  documents: KbDocument[];
  proposals: Proposal[];
  /** Обработка документа: id, часть, всего, сообщение. */
  job: { doc: string; at: number; total: number; text: string } | null;
}

let state: KbState = { ready: false, entries: [], byId: new Map(), index: null, documents: [], proposals: [], job: null };
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
  const [entries, documents, proposals] = await Promise.all([store.entries(), store.all<KbDocument>('documents'), store.all<Proposal>('proposals')]);
  state.entries = entries;
  state.byId = new Map(entries.map((e) => [e.id, e]));
  state.documents = documents.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  state.proposals = proposals;
  state.index = new Index(entries, documents);
  state.ready = true;
  emit();
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

export async function addFile(file: File, reliability: Reliability, note: string): Promise<KbDocument> {
  const text = (await fileText(file)).trim();
  if (text.length < 50) throw new Error('в файле не найден текст (скан без текстового слоя? — нужен распознанный PDF)');
  const id = `d${Date.now().toString(36)}`;
  const chunks = chunkText(text).map((t, i) => ({ i, text: t }));
  const doc: KbDocument = { id, name: file.name, mime: file.type, size: file.size, addedAt: new Date().toISOString(), reliability, note: note || undefined, chunks, status: 'new', processed: 0 };
  // запись-источник: документ виден в каркасе (категория «Источники → Загруженные документы»)
  const src: Entry = { id: `doc:${id}`, category: 'sources', group: 'uploaded', title: file.name, summary: note || `Загруженный документ: ${chunks.length} частей, ${Math.round(text.length / 1000)} тыс. знаков.`, status: 'checked', origin: 'user',
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
  await reload();
}

let abort: AbortController | null = null;
export const stop = () => abort?.abort();

/** Обработать документ моделью: по частям, с места остановки; предложения — в очередь на проверку. */
export async function process(id: string, llm: LlmSettings) {
  if (state.job) throw new Error('уже идёт обработка другого документа');
  const doc = state.documents.find((d) => d.id === id);
  if (!doc) return;
  abort = new AbortController();
  const c = client(llm, 'off');
  doc.status = 'processing';
  let dropped = 0, made = 0;
  try {
    for (let i = doc.processed ?? 0; i < doc.chunks.length; i++) {
      if (abort.signal.aborted) break;
      state.job = { doc: id, at: i, total: doc.chunks.length, text: `часть ${i + 1} из ${doc.chunks.length}…` };
      emit();
      const r = await c.chat({ messages: extractMessages(doc.chunks[i].text, doc.name), schema: { name: 'kb_extract', schema: EXTRACT_SCHEMA }, signal: abort.signal });
      const items = ((r.json as { items?: ExtractedItem[] } | undefined)?.items) ?? [];
      const res = toProposals(items, doc.chunks[i].text, state.entries, doc, i);
      dropped += res.dropped; made += res.proposals.length;
      if (res.proposals.length) await store.put('proposals', ...res.proposals);
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

/* ───────────── обмен ───────────── */

export async function exportUser(): Promise<string> {
  const [entries, documents, proposals] = await Promise.all([store.all('entries'), store.all('documents'), store.all('proposals')]);
  return JSON.stringify({ format: 'def-ops-knowledge', version: 1, exported: new Date().toISOString(), entries, documents, proposals });
}
export async function importUser(json: string) {
  const d = JSON.parse(json) as { format?: string; entries?: Entry[]; documents?: KbDocument[]; proposals?: Proposal[] };
  if (d.format !== 'def-ops-knowledge') throw new Error('это не выгрузка базы знаний');
  if (d.entries?.length) await store.put('entries', ...d.entries);
  if (d.documents?.length) await store.put('documents', ...d.documents);
  if (d.proposals?.length) await store.put('proposals', ...d.proposals);
  await reload();
}

/* ───────────── вопросы и рассказы ───────────── */

export async function ask(mode: 'ask' | 'lecture', question: string, llm: LlmSettings, history: { q: string; a: string }[], onDelta: (t: string) => void, signal?: AbortSignal): Promise<{ text: string; sources: Source[] }> {
  await load();
  const sources = gather(state.index!, state.byId, question, { limit: mode === 'lecture' ? 10 : 7 });
  const r = await client(llm).chat({ messages: qaMessages(mode, question, sources, history), signal, onDelta: (k, t) => { if (k === 'content') onDelta(t); } });
  return { text: r.content, sources };
}

/** Справка из базы для советника в игре: доктрина, техника, местность, источники; ход боёв — только в вопросах истории. */
export async function reference(query: string, historyAllowed: boolean): Promise<string> {
  try { await load(); } catch { return ''; }
  return state.index ? gameReference(state.index, state.byId, query, historyAllowed) : '';
}
