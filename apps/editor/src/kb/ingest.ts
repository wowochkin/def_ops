/**
 * Единый поток разбора загруженного документа: текст, скан, таблица, пакет внешнего агента → кандидаты-факты →
 * проверки 1–7 (код) → перекрёстное прочтение цитаты второй моделью (текст и скан; выключается) → итог → база,
 * очередь «На проверку» или отброшенные (saveCandidates). Разбор идёт по частям (части текста, затем страницы-сканы;
 * таблица и пакет — одна часть) и продолжается с места остановки: разобранные части помнятся в документе.
 *
 * Ошибки: сервер моделей недоступен или таймаут — разбор останавливается, сделанное сохранено; зацикливание или
 * ответ не по схеме — повтор без схемы на сервере (как у штаба противника), вторая неудача — часть в failedParts.
 * Скан, а модель чтения сканов не видит изображений, — документ «ждёт распознавания».
 */
import {
  boxOnPage, CROSS_SCHEMA, crossCompare, crossMessages, EXTRACT_SCHEMA, extractMessages, isTemplate, MAPPING_SCHEMA, mappingMessages, matchFormation,
  normalizeMapping, OPERATION_EXTRACT_SCHEMA, parseFactsJson, rowsToCandidates, runChecks, SCAN_SCHEMA, scanMessages, stripes, templateMapping,
  toCandidates, toInfraProposals, toProposals, verdictOf,
  type Candidate, type CheckCtx, type CheckResult, type CrossAnswer, type Entry, type ExtractedClaim, type ExtractedItem, type Fact, type InfraItem,
  type KbDocument, type OperationHint, type Proposal, type RowError, type TableMapping,
} from '@def-ops/knowledge';
import type { ChatMessage, LlmClient } from '@def-ops/staff-service/llm';
import type { LlmSettings } from '../sim/game-protocol';
import { saveCandidates, textCandidateOf, type StoredCandidate, type TextCandidate } from './candidates';
import { crossLlm, kbLlm, llmClient, scanLlm } from './kb';
import * as store from './store';
import { cropImage, renderPdfPage, type PageImage } from './text';

export interface IngestProgress { done: number; total: number; auto: number; review: number; drop: number; stage: string }

export interface IngestResult {
  auto: number; review: number; drop: number; duplicate: number;
  /** Части (номера по порядку частей документа), которые модель так и не разобрала. */
  failedParts: number[];
  /** Таблица не по шаблону: нужно сопоставление столбцов (предложение модели); разбор не начинался. */
  needsMapping?: { header: string[]; sample: string[][]; proposed: TableMapping };
  /** Скан, а модель чтения сканов не видит изображений: документ ждёт распознавания. */
  waitingVision?: true;
  /** Разбор остановлен (человеком или ошибкой сервера моделей) — почему; сделанное сохранено. */
  stopped?: string;
}

export interface IngestOptions {
  hint?: OperationHint;
  /** Диапазон страниц PDF (включительно); части текста — по странице, с которой начинаются. */
  pages?: [number, number];
  /** Подтверждённое сопоставление столбцов таблицы. */
  mapping?: TableMapping;
  onProgress(p: IngestProgress): void;
  signal?: AbortSignal;
}

/** Данные операции документа для проверок: подсказка модели, сроки, формирования сценария, театр. */
export interface OpContext {
  hint?: OperationHint;
  op?: { start: string; end: string };
  formations: { id: string; name: string; side?: string; echelon?: string; personnel?: number }[];
  theatre?: { locate(name: string): { at: [number, number] } | null };
}

type Chat = Pick<LlmClient, 'chat'>;

/** Сценарий и театр операции документа (нет операции или не прочиталась — пусто). */
export async function opContext(doc: KbDocument, hint?: OperationHint): Promise<OpContext> {
  if (!doc.operation) return { formations: [] };
  try {
    const { syncInput } = await import('../modeling/sync');
    const input = await syncInput(doc.operation);
    const { getData } = await import('../sim/userdata');
    const { Theatre, locatePlace } = await import('@def-ops/sim');
    const td = await getData('theatres', `${input.scenario.theatre}.json`).catch(() => null);
    const T = td ? new Theatre(td as ConstructorParameters<typeof Theatre>[0]) : null;
    const o = input.operation;
    return {
      hint: hint ?? { id: o.id, title: o.title, start: o.start, end: o.end, sides: input.scenario.sides.map((x) => ({ id: x.id, name: x.name })) },
      op: { start: o.start, end: o.end },
      formations: input.formations.map((f) => ({ id: f.id, name: f.name, side: f.side, echelon: f.echelon, personnel: f.personnel })),
      ...(T ? { theatre: { locate: (n: string) => { const p = locatePlace(T, n); return p ? { at: p.at as [number, number] } : null; } } } : {}),
    };
  } catch {
    // сценарий не прочитался — подсказка операции (сроки, стороны) как в прежнем разборе
    const h = hint ?? await deps.hint(doc.operation);
    return { formations: [], ...(h ? { hint: h, op: { start: h.start, end: h.end } } : {}) };
  }
}

/** Картинка страницы PDF: из байтов документа (хранилище pages). */
async function renderPage(docId: string, page: number): Promise<PageImage> {
  const src = await store.one<{ pdf: ArrayBuffer }>('pages', `${docId}:pdf`);
  if (!src) throw new Error('исходный PDF не сохранён — загрузите документ заново');
  return renderPdfPage(src.pdf, page);
}

/** Зависимости потока (подменяются в тестах): клиент модели, данные операции, картинки страниц и полосы. */
export const deps = {
  client: (llm: LlmSettings): Chat => llmClient(llm, 'off'),
  context: opContext,
  /** Подсказка операции из сценария (сроки, стороны) — запасной путь, если сценарий для проверок не прочитался. */
  hint: async (op: string): Promise<OperationHint | undefined> => (await import('../sim/userdata')).operationHint(op),
  render: renderPage,
  crop: cropImage,
};

/** Часть документа: часть текста, страница-скан, вся таблица (пакет). */
type Part = { kind: 'chunk'; i: number; page?: number } | { kind: 'scan'; page: number } | { kind: 'table' };

function partsOf(doc: KbDocument): Part[] {
  if (doc.kind === 'table' || doc.kind === 'facts') return [{ kind: 'table' }];
  return [...doc.chunks.map((c): Part => ({ kind: 'chunk', i: c.i, ...(c.page ? { page: c.page } : {}) })), ...(doc.scans ?? []).map((s): Part => ({ kind: 'scan', page: s.page }))];
}
const inRange = (p: Part, r?: [number, number]) =>
  !r || p.kind === 'table' || (p.kind === 'chunk' ? p.page == null || (p.page >= r[0] && p.page <= r[1]) : p.page >= r[0] && p.page <= r[1]);

const JSON_HINT = '\n\nОтветь одним JSON-объектом с полями из описания формата, без текста до и после него.';
/** Последнее сообщение с просьбой ответить одним JSON-объектом (повтор без схемы на сервере). */
function withJsonHint(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1];
  const content = typeof last.content === 'string' ? last.content + JSON_HINT : [...last.content, { type: 'text' as const, text: JSON_HINT.trim() }];
  return [...messages.slice(0, -1), { ...last, content }];
}

/**
 * Запрос со схемой; зацикливание или ответ не по схеме — повтор без схемы на сервере (разбор по схеме у нас).
 * null — и повтор не дал JSON. Недоступность сервера и остановка — исключение.
 */
async function ask<T>(client: Chat, messages: ChatMessage[], schema: { name: string; schema: object }, signal?: AbortSignal): Promise<T | null> {
  const stopped = () => { if (signal?.aborted) throw new Error('остановлено'); };
  let r = await client.chat({ messages, schema, signal });
  // остановка во время ответа (зациклившегося или оборванного) — не неудача части, а остановка разбора
  stopped();
  if (r.degenerate || r.json == null || typeof r.json !== 'object') {
    r = await client.chat({ messages: withJsonHint(messages), schema, schemaLoose: true, signal });
    stopped();
  }
  return r.json != null && typeof r.json === 'object' ? (r.json as T) : null;
}

/** Ошибка сервера: модель не принимает изображения. */
const NO_VISION = /image|vision|multimodal|modalit/i;
const WAITING = 'ждёт распознавания: модель чтения сканов не видит изображений — выберите модель со зрением (роль «Чтение сканов»)';
const CROSS_OFF = 'перекрёстная проверка выключена';

/** Последняя известная численность соединения на дату — по фактам базы. */
function strengthFrom(facts: Fact[]) {
  return (subject: string, at: string): number | null => {
    let best: { at: string; n: number } | null = null;
    for (const f of facts) {
      const c = f.claim;
      if (c?.kind !== 'strength' || c.subject !== subject || c.personnel == null || c.at > at) continue;
      if (!best || c.at > best.at) best = { at: c.at, n: c.personnel };
    }
    return best?.n ?? null;
  };
}

const ddmm = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

/**
 * Дороги, рубежи и прочая инфраструктура (не переправы — они в claims) → текстовые кандидаты: принятие пишет тот же
 * факт, что прежде addInfraFact (запись «Состояние инфраструктуры» операции, ключ features, с цитатой и источником).
 * id — как у прежнего сведения (документ, часть, номер): повторный разбор части не задваивает и не сбрасывает принятое.
 */
async function infraCandidates(items: InfraItem[], text: string, doc: KbDocument, chunk: number, op: { id: string; title: string }): Promise<TextCandidate[]> {
  const { INFRA_STATE_RU } = await import('@def-ops/sim');
  const inf = toInfraProposals(items.filter((x) => x.kind !== 'bridge' && x.kind !== 'crossing'), text, { ...doc, operation: op.id }, chunk);
  const id = `u:${op.id}:infrastructure`;
  const entry: Entry = {
    id, category: 'terrain', group: 'rivers', title: `Состояние инфраструктуры: ${op.title.split(':')[0]}`, operations: [op.id], rubrics: ['5.3', '5.2'],
    summary: 'Мосты, переправы, дороги и железные дороги операции — по документам и сведениям, принятым в разделе «Операции».', facts: [], status: 'extracted', origin: 'document',
  };
  return inf.proposals.map((x) => {
    const it = x.item;
    const value = `${it.title}: ${INFRA_STATE_RU[it.state]}${it.date ? ` с ${ddmm(it.date)}` : ''}${it.dateTo ? ` до ${ddmm(it.dateTo)}` : ''}${it.note ? ` (${it.note})` : ''}`;
    const p: Proposal = {
      id: x.id, doc: doc.id, chunk, kind: 'update', target: id, entry, relations: [], operation: op.id, status: 'pending',
      facts: [{ key: 'features', value, quote: it.quote, source: `doc:${doc.id}`, reliability: doc.reliability }],
    };
    return textCandidateOf(p, { id: x.id, state: 'pending', key: 'инфраструктура', value });
  });
}

type Counts = { auto: number; review: number; drop: number; duplicate: number };

/**
 * Разобрать документ: по частям или страницам (диапазон pages), с места остановки. Таблица не по шаблону без
 * сопоставления — needsMapping (с предложением модели), разбор не начинается.
 */
export async function ingest(docId: string, llm: LlmSettings, o: IngestOptions): Promise<IngestResult> {
  const res: IngestResult = { auto: 0, review: 0, drop: 0, duplicate: 0, failedParts: [] };
  const doc = await store.one<KbDocument>('documents', docId);
  if (!doc) throw new Error('документ не найден');
  const kbChat = deps.client(kbLlm(llm));
  const save = (patch: Partial<KbDocument>) => { Object.assign(doc, patch); return store.put('documents', { ...doc }); };

  // таблица: сопоставление столбцов — до разбора
  let mapping: TableMapping | null = null;
  if (doc.kind === 'table') {
    const rows = doc.table ?? [];
    const header = rows[0] ?? [];
    mapping = o.mapping ?? doc.mapping ?? (isTemplate(header) ? templateMapping(header) : null);
    if (!mapping) {
      let proposed: TableMapping | null = null;
      try { proposed = normalizeMapping(await ask(kbChat, mappingMessages(header, rows.slice(1, 11)), { name: 'kb_table_mapping', schema: MAPPING_SCHEMA }, o.signal), header.length); } catch {
        // остановлено — не предложение «всё пропустить», а остановка; сервер недоступен — сопоставит человек
        if (o.signal?.aborted) return { ...res, stopped: 'остановлено' };
      }
      return { ...res, needsMapping: { header, sample: rows.slice(1, 4), proposed: proposed ?? { kind: 'strength', columns: header.map(() => 'skip') } } };
    }
    if (o.mapping) await save({ mapping: o.mapping });
  }

  const parts = partsOf(doc);
  const done = new Set(doc.done ?? Array.from({ length: Math.min(doc.processed ?? 0, parts.length) }, (_, i) => i));
  const inScope = parts.map((p, i) => ({ p, i })).filter(({ p }) => inRange(p, o.pages));
  const todo = inScope.filter(({ i }) => !done.has(i));
  let doneN = inScope.length - todo.length;
  const cx = await deps.context(doc, o.hint);
  const hint = doc.operation ? (cx.hint ?? o.hint) : undefined;
  const scanChat = deps.client(scanLlm(llm));
  const crossChat = llm.crossCheck !== false ? deps.client(crossLlm(llm)) : null;
  const sideOf = (id: string) => { const s = cx.formations.find((f) => f.id === id)?.side; return s === 'su' || s === 'de' ? s : null; };
  const failed = new Set(doc.failedParts ?? []);
  const counts: Counts = { ...{ auto: 0, review: 0, drop: 0, duplicate: 0 }, ...doc.counts };
  const nChunks = doc.chunks.length, nPages = doc.pageCount ?? doc.scans?.length ?? 0;
  const stageOf = (p: Part) => p.kind === 'chunk' ? `часть ${p.i + 1} из ${nChunks}` : p.kind === 'scan' ? `страница ${p.page} из ${nPages}` : doc.kind === 'facts' ? 'пакет фактов' : 'таблица';

  /** Проверки 1–7, перекрёстное прочтение (текст и скан), итог. */
  const check = async (cands: Candidate[], extra: Partial<CheckCtx>, entries: Entry[]): Promise<Candidate[]> => {
    const existing = entries.flatMap((e) => (e.facts ?? []).filter((f) => f.claim));
    const ctx: CheckCtx = { formations: cx.formations, entries, theatre: cx.theatre, op: cx.op, strengthOf: strengthFrom(existing), existing, ...extra };
    const match = (name: string) => matchFormation(name, cx.formations, entries);
    for (const c of cands) {
      const checks: CheckResult[] = runChecks(c, ctx);
      if (c.origin === 'text' || c.origin === 'scan') {
        if (crossChat) {
          if (verdictOf(checks) !== 'drop') {
            const quote = 'quote' in c.evidence ? c.evidence.quote ?? '' : '';
            const a = await ask<CrossAnswer>(crossChat, crossMessages(quote), { name: 'kb_cross', schema: CROSS_SCHEMA }, o.signal);
            checks.push(a && Array.isArray(a.numbers) ? crossCompare(c, a, match, sideOf) : { check: 'cross', level: 'doubt', why: 'перекрёстное прочтение не удалось: модель не ответила по схеме' });
          }
        } else if (verdictOf(checks) === 'auto') checks.push({ check: 'cross', level: 'doubt', why: CROSS_OFF });
      }
      c.checks = checks;
      c.verdict = verdictOf(checks);
    }
    return cands;
  };

  /** Текстовые кандидаты (прежние предложения записей) — в очередь; уже стоящие там не задваиваются. */
  const queueText = async (list: TextCandidate[]) => {
    if (!list.length) return 0;
    const have = new Set((await store.all<StoredCandidate>('candidates')).map((c) => c.id));
    const fresh = list.filter((c) => !have.has(c.id));
    if (fresh.length) await store.put('candidates', ...fresh);
    return fresh.length;
  };

  /** Разобрать одну часть: кандидаты с итогом и текстовые; failed — модель не разобрала; waiting — нет зрения. */
  const runPart = async (p: Part): Promise<{ cands: Candidate[]; text: TextCandidate[]; failed?: boolean; waiting?: boolean; errors?: RowError[]; skipped?: string[] }> => {
    const entries = await store.entries();
    if (p.kind === 'chunk') {
      const text = doc.chunks.find((c) => c.i === p.i)?.text ?? '';
      const schema = hint ? { name: 'kb_operation_extract', schema: OPERATION_EXTRACT_SCHEMA } : { name: 'kb_extract', schema: EXTRACT_SCHEMA };
      const j = await ask<{ items?: ExtractedItem[]; claims?: ExtractedClaim[]; infrastructure?: InfraItem[] }>(kbChat, extractMessages(text, doc.name, hint), schema, o.signal);
      if (!j) return { cands: [], text: [], failed: true };
      const cands = await check(toCandidates(j.claims, doc, { chunk: p.i }, 'text'), { text }, entries);
      const props = toProposals(j.items ?? [], text, entries, doc, p.i).proposals;
      const textC = props.map((x) => textCandidateOf(x, { id: x.id, state: 'pending' }));
      // дороги, рубежи и прочее (не переправы — они в claims) — текстовые кандидаты записи инфраструктуры операции
      if (hint && doc.operation) textC.push(...await infraCandidates(j.infrastructure ?? [], text, doc, p.i, { id: doc.operation, title: hint.title }));
      return { cands, text: textC };
    }
    if (p.kind === 'scan') {
      let img = await store.one<PageImage>('pages', `${doc.id}:${p.page}`);
      if (!img) {
        img = await deps.render(doc.id, p.page);
        await store.put('pages', { id: `${doc.id}:${p.page}`, doc: doc.id, page: p.page, ...img });
        await save({ scans: (doc.scans ?? []).map((s) => (s.page === p.page ? { ...s, width: img!.width, height: img!.height } : s)) });
      }
      const strips = stripes(img.width, img.height);
      const transcripts: string[] = [];
      const cands: Candidate[] = [];
      let bad = false;
      for (let k = 0; k < strips.length; k++) {
        const url = strips.length > 1 ? await deps.crop(img.url, strips[k], img.width) : img.url;
        let j: { transcript?: string; claims?: ExtractedClaim[] } | null;
        try {
          j = await ask(scanChat, scanMessages(url, doc.name, hint) as ChatMessage[], { name: 'kb_scan', schema: SCAN_SCHEMA }, o.signal);
        } catch (e) {
          if (!o.signal?.aborted && NO_VISION.test((e as Error).message)) return { cands: [], text: [], waiting: true };
          throw e;
        }
        if (!j) { bad = true; transcripts[k] = ''; continue; }
        const transcript = typeof j.transcript === 'string' ? j.transcript : '';
        transcripts[k] = transcript;
        const cs = toCandidates(j.claims, doc, { page: p.page, ...(strips.length > 1 ? { stripe: k } : {}) }, 'scan');
        // место на полосе → место на странице
        if (strips.length > 1) for (const c of cs) if (c.evidence.kind === 'scan' && c.evidence.box) c.evidence.box = boxOnPage(c.evidence.box, strips[k], img.height);
        cands.push(...await check(cs, { transcript }, entries));
      }
      await store.put('transcripts', { id: `${doc.id}:${p.page}`, doc: doc.id, page: p.page, text: transcripts.join('\n'), stripes: transcripts });
      return { cands, text: [], failed: bad };
    }
    if (doc.kind === 'facts') {
      const r = parseFactsJson(doc.facts, doc);
      return { cands: await check(r.candidates, { rowExists: true }, entries), text: [], errors: r.errors };
    }
    const r = rowsToCandidates(doc.table ?? [], mapping!, doc);
    return { cands: await check(r.candidates, { rowExists: true }, entries), text: [], errors: r.errors, skipped: r.skipped };
  };

  await save({ status: 'processing', error: undefined });
  let status: KbDocument['status'] = 'new', error: string | undefined;
  try {
    for (const { p, i } of todo) {
      if (o.signal?.aborted) { res.stopped = 'остановлено'; break; }
      const r = await runPart(p);
      if (r.waiting) { res.waitingVision = true; break; }
      const n = await saveCandidates(r.cands, { formations: cx.formations, theatre: cx.theatre });
      const queued = await queueText(r.text);
      const rowErr = r.errors?.length ?? 0;
      const add: Counts = { auto: n.auto, review: n.review + queued, drop: n.drop + rowErr, duplicate: n.duplicate };
      for (const k of ['auto', 'review', 'drop', 'duplicate'] as const) { res[k] += add[k]; counts[k] += add[k]; }
      if (r.failed) failed.add(i); else failed.delete(i);
      done.add(i);
      doneN++;
      await save({
        done: [...done].sort((a, b) => a - b), processed: done.size, counts: { ...counts }, failedParts: [...failed].sort((a, b) => a - b),
        ...(r.errors ? { rowErrors: r.errors } : {}), ...(r.skipped ? { skippedColumns: r.skipped } : {}),
      });
      o.onProgress({ done: doneN, total: inScope.length, auto: res.auto, review: res.review, drop: res.drop, stage: stageOf(p) });
    }
    if (res.waitingVision) { status = 'waiting'; error = WAITING; }
    else if (done.size >= parts.length) status = 'processed';
    else if (res.stopped) error = res.stopped;
  } catch (e) {
    // сервер моделей недоступен, таймаут, остановка во время запроса — сделанное сохранено, продолжение — с этого места
    const msg = o.signal?.aborted ? 'остановлено' : (e as Error).message;
    res.stopped = msg;
    status = o.signal?.aborted ? 'new' : 'error';
    error = msg;
  } finally {
    await save({ status, error });
  }
  res.failedParts = [...failed].sort((a, b) => a - b);
  return res;
}
