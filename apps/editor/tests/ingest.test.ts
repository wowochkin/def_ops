import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { stripes, type KbDocument } from '@def-ops/knowledge';
import type { ChatRequest, ChatResult } from '@def-ops/staff-service/llm';
import * as store from '../src/kb/store';
import * as kb from '../src/kb/kb';
import { deps, ingest, opContext, type IngestProgress } from '../src/kb/ingest';
import { decideCandidates, type StoredCandidate } from '../src/kb/candidates';
import type { ReadDoc } from '../src/kb/text';
import type { LlmSettings } from '../src/sim/game-protocol';

/** Записанные ответы модели (packages/knowledge/tests/fixtures/llm). */
const fx = (n: string) => JSON.parse(readFileSync(new URL(`../../../packages/knowledge/tests/fixtures/llm/${n}.json`, import.meta.url), 'utf8')) as unknown;

const OP = 'test-op';
const LLM: LlmSettings = { url: 'http://llm', model: 'm', thinking: 'off' };

// Вымышленная выписка: два абзаца по ~2000 знаков — две части текста.
const FILL = 'Части вели бой на прежних рубежах, подтягивая тылы и пополняя боеприпасы. ';
const PARA_A = `С 16 по 19.04 8 гв. А потеряла убитыми 1 200, ранеными 3 400 человек. ${FILL.repeat(26)}`;
const PARA_B = `Сводка за 20 апреля: к 20.04 в 8 гв. А насчитывалось 52 000 человек. ${FILL.repeat(26)}`;
const TEXT = `${PARA_A}\n\n${PARA_B}`;

type Answer = Partial<ChatResult> | Error;
/** Подменённый клиент: ответ по имени схемы и содержимому запроса; журнал запросов. */
function fakeClient(answer: (req: ChatRequest, text: string) => Answer) {
  const log: { schema: string; text: string; loose?: boolean }[] = [];
  deps.client = () => ({
    async chat(req: ChatRequest): Promise<ChatResult> {
      const text = req.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join(''))).join('\n');
      log.push({ schema: req.schema?.name ?? '', text, ...(req.schemaLoose ? { loose: true } : {}) });
      const a = answer(req, text);
      if (a instanceof Error) throw a;
      return { model: 'm', content: '', reasoning: '', timings: { firstTokenMs: 0, totalMs: 0 }, ...a };
    },
  });
  return log;
}

/** Обычные ответы: разбор части по её тексту, перекрёстное прочтение по цитате. */
const normal = (req: ChatRequest, text: string): Answer => {
  const s = req.schema?.name ?? '';
  if (s.startsWith('kb_') && s.endsWith('extract')) return { json: fx(text.includes('потеряла') ? 'extract-losses' : 'extract-strength') };
  if (s === 'kb_cross') return { json: fx(text.includes('потеряла') ? 'cross-match' : 'cross-strength') };
  if (s === 'kb_table_mapping') return { json: fx('mapping-losses') };
  if (s === 'kb_scan') return { json: fx('scan-page') };
  return new Error(`неожиданный запрос ${s}`);
};

const FORMATIONS = [{ id: 'su_8gva', name: '8 гв. А', side: 'su', echelon: 'army', personnel: 60000 }];

beforeEach(async () => {
  await store.resetForTests();
  globalThis.indexedDB = new IDBFactory();
  deps.context = async () => ({
    formations: FORMATIONS, op: { start: '1945-04-16', end: '1945-05-08' },
    hint: { id: OP, title: 'Тестовая операция', start: '1945-04-16', end: '1945-05-08', sides: [{ id: 'su', name: 'СССР' }, { id: 'de', name: 'Германия' }] },
  });
  deps.crop = async (url, s) => `${url}#${s.y}`;
  deps.hint = async () => undefined;
});

/** Загрузить документ через addFile с подменённым чтением файла. */
async function upload(r: ReadDoc, name = 'выписка.txt'): Promise<KbDocument> {
  kb.reader.read = async () => r;
  return kb.addFile(new File(['x'], name), 'B', '', OP);
}
const doc = async (id: string) => (await store.one<KbDocument>('documents', id))!;
const queue = () => store.all<StoredCandidate>('candidates');
const extracts = <T extends { schema: string; loose?: boolean }>(log: T[]) => log.filter((x) => x.schema.endsWith('extract') && !x.loose);

describe('ingest: текст', () => {
  it('две части — прогресс дважды, итог совпадает с суммой', async () => {
    const d = await upload({ kind: 'text', text: TEXT });
    expect(d.chunks).toHaveLength(2);
    fakeClient(normal);
    const prog: IngestProgress[] = [];
    const r = await ingest(d.id, LLM, { onProgress: (p) => prog.push(p) });
    expect(prog.map((p) => [p.done, p.total])).toEqual([[1, 2], [2, 2]]);
    expect(prog.map((p) => p.stage)).toEqual(['часть 1 из 2', 'часть 2 из 2']);
    // потери прошли все проверки и перекрёстное прочтение; численность: модель не уверена в стороне — совпадает
    expect(r).toMatchObject({ auto: 2, review: 0, drop: 0, duplicate: 0, failedParts: [] });
    const last = prog[prog.length - 1];
    expect([last.auto, last.review, last.drop]).toEqual([r.auto, r.review, r.drop]);
    const after = await doc(d.id);
    expect(after).toMatchObject({ status: 'processed', processed: 2, done: [0, 1], counts: { auto: 2, review: 0, drop: 0, duplicate: 0 } });
    const facts = (await store.all<{ id: string; facts?: { check?: { by: string; results: { check: string }[] } }[] }>('entries')).flatMap((e) => e.facts ?? []).filter((f) => f.check);
    expect(facts).toHaveLength(2);
    expect(facts.every((f) => f.check!.by === 'auto' && f.check!.results.some((x) => x.check === 'cross'))).toBe(true);
  });

  it('остановка после первой части; повторный вызов разбирает только вторую', async () => {
    const d = await upload({ kind: 'text', text: TEXT });
    const log = fakeClient(normal);
    const ac = new AbortController();
    const r1 = await ingest(d.id, LLM, { signal: ac.signal, onProgress: () => ac.abort() });
    expect(r1.stopped).toBe('остановлено');
    expect(r1.auto).toBe(1);
    expect(await doc(d.id)).toMatchObject({ status: 'new', processed: 1, done: [0], error: 'остановлено' });
    expect(extracts(log)).toHaveLength(1);

    const prog: IngestProgress[] = [];
    const r2 = await ingest(d.id, LLM, { onProgress: (p) => prog.push(p) });
    const ex = extracts(log);
    expect(ex).toHaveLength(2);
    expect(ex[1].text).toContain('52 000');
    expect(ex[1].text).not.toContain('потеряла');
    expect(prog).toHaveLength(1);
    expect(prog[0]).toMatchObject({ done: 2, total: 2, stage: 'часть 2 из 2' });
    expect(r2.auto).toBe(1);
    expect((await doc(d.id)).status).toBe('processed');
  });

  it('перекрёстная проверка выключена — все кандидаты из текста в очереди', async () => {
    const d = await upload({ kind: 'text', text: TEXT });
    const log = fakeClient(normal);
    const r = await ingest(d.id, { ...LLM, crossCheck: false }, { onProgress: () => {} });
    expect(r).toMatchObject({ auto: 0, review: 2, drop: 0 });
    expect(log.some((x) => x.schema === 'kb_cross')).toBe(false);
    const q = await queue();
    expect(q).toHaveLength(2);
    for (const c of q) {
      expect(c.state).toBe('pending');
      expect(c.checks.find((x) => x.check === 'cross')).toEqual({ check: 'cross', level: 'doubt', why: 'перекрёстная проверка выключена' });
    }
  });

  it('зацикливание — повтор без схемы; вторая неудача — часть в failedParts', async () => {
    const d = await upload({ kind: 'text', text: TEXT });
    let n = 0;
    const log = fakeClient((req, text) => {
      const s = req.schema?.name ?? '';
      if (s.endsWith('extract') && text.includes('потеряла')) return { degenerate: 'пробелы' };
      if (s.endsWith('extract') && !req.schemaLoose && n++ === 0) return { degenerate: 'пробелы' };
      return normal(req, text);
    });
    const r = await ingest(d.id, LLM, { onProgress: () => {} });
    expect(r.failedParts).toEqual([0]);
    expect(r.auto).toBe(1);
    const loose = log.filter((x) => x.loose);
    expect(loose).toHaveLength(2);
    expect(loose[0].text).toContain('Ответь одним JSON-объектом');
    expect(await doc(d.id)).toMatchObject({ failedParts: [0], processed: 2, status: 'processed' });
  });

  it('сервер моделей недоступен — остановка, сделанное сохранено', async () => {
    const d = await upload({ kind: 'text', text: TEXT });
    fakeClient((req, text) => (text.includes('52 000') && req.schema?.name.endsWith('extract') ? new Error('сервер модели не отвечает: fetch failed') : normal(req, text)));
    const r = await ingest(d.id, LLM, { onProgress: () => {} });
    expect(r.stopped).toContain('не отвечает');
    expect(r.auto).toBe(1);
    expect(await doc(d.id)).toMatchObject({ status: 'error', processed: 1, done: [0] });
  });
});

describe('ingest: таблица', () => {
  const ROWS = [['Соединение', 'С', 'По', 'Убито'], ['8 гв. А', '16.04.1945', '19.04.1945', '1200'], ['8 гв. А', '20.04.1945', '20.04.1945', 'много']];
  it('не по шаблону без сопоставления — needsMapping с предложением модели, разбор не начинается', async () => {
    const d = await upload({ kind: 'table', rows: ROWS }, 'потери.csv');
    fakeClient(normal);
    const r = await ingest(d.id, LLM, { onProgress: () => { throw new Error('прогресса быть не должно'); } });
    expect(r.needsMapping).toEqual({ header: ROWS[0], sample: ROWS.slice(1), proposed: { kind: 'losses', columns: ['subject', 'date', 'date_to', 'killed'] } });
    expect(r).toMatchObject({ auto: 0, review: 0, drop: 0 });
    expect(await queue()).toEqual([]);
    expect(await doc(d.id)).toMatchObject({ status: 'new', processed: 0 });
  });

  it('с сопоставлением — строки разобраны кодом, строка с ошибкой отброшена с номером', async () => {
    const d = await upload({ kind: 'table', rows: ROWS }, 'потери.csv');
    const log = fakeClient(normal);
    const r = await ingest(d.id, LLM, { mapping: { kind: 'losses', columns: ['subject', 'date', 'date_to', 'killed'] }, onProgress: () => {} });
    expect(log).toEqual([]);
    expect(r).toMatchObject({ auto: 1, drop: 1 });
    const after = await doc(d.id);
    expect(after.mapping?.kind).toBe('losses');
    expect(after.rowErrors?.[0].row).toBe(3);
    expect(after.status).toBe('processed');
  });
});

describe('ingest: скан', () => {
  const IMG = { url: 'data:image/png;base64,AAAA', width: 1000, height: 1400 };
  it('модель чтения сканов не видит картинок — waitingVision, документ ждёт распознавания', async () => {
    const d = await upload({ kind: 'image', image: IMG }, 'донесение.png');
    expect(d).toMatchObject({ kind: 'scan', scans: [{ page: 1, width: 1000, height: 1400 }] });
    fakeClient((req) => (req.schema?.name === 'kb_scan' ? new Error('сервер модели ответил 400: Model does not support image input') : new Error('не то')));
    const r = await ingest(d.id, { ...LLM, scanModel: 'text-only' }, { onProgress: () => {} });
    expect(r.waitingVision).toBe(true);
    const after = await doc(d.id);
    expect(after.status).toBe('waiting');
    expect(after.error).toContain('ждёт распознавания');
    expect(after.processed ?? 0).toBe(0);
  });

  it('высокая страница — по полосам; расшифровка сохранена, место — в долях страницы', async () => {
    const d = await upload({ kind: 'image', image: { ...IMG, height: 3000 } }, 'таблица.png');
    const log = fakeClient(normal);
    await ingest(d.id, LLM, { onProgress: () => {} });
    const scans = log.filter((x) => x.schema === 'kb_scan');
    expect(scans.length).toBeGreaterThan(1);
    const t = await store.one<{ text: string; stripes: string[] }>('transcripts', `${d.id}:1`);
    expect(t?.stripes).toHaveLength(scans.length);
    // цитата «2 300» против «2 3?0» в расшифровке — отброшена (с остальных полос — тот же факт, повтор);
    // кандидат помнит полосу, место пересчитано из долей полосы в доли страницы
    const q = await queue();
    expect(q).toHaveLength(1);
    const c = q[0];
    expect(c.id).toContain(':s1.0:');
    expect(c.verdict).toBe('drop');
    const h = stripes(1000, 3000)[0].h;
    expect((c.evidence as { box: number[] }).box[1]).toBeCloseTo((0.12 * h) / 3000, 5);
  });
});

describe('ingest: правки первого круга', () => {
  it('сценарий не прочитался — подсказка операции из operationHint (сроки, стороны)', async () => {
    deps.context = opContext;
    deps.hint = async (op) => ({ id: op, title: 'Запасная операция', start: '1945-04-16', end: '1945-05-08', sides: [{ id: 'su', name: 'СССР' }] });
    const d = await upload({ kind: 'text', text: PARA_A });
    const log = fakeClient(normal);
    await ingest(d.id, LLM, { onProgress: () => {} });
    const ex = extracts(log);
    expect(ex[0].schema).toBe('kb_operation_extract');
    expect(ex[0].text).toContain('Запасная операция');
  });

  it('остановка во время зациклившегося ответа — остановка, часть не отмечена ни разобранной, ни неудачной', async () => {
    const d = await upload({ kind: 'text', text: TEXT });
    const ac = new AbortController();
    const log = fakeClient(() => { ac.abort(); return { degenerate: 'пробелы' }; });
    const r = await ingest(d.id, LLM, { signal: ac.signal, onProgress: () => {} });
    expect(r.stopped).toBe('остановлено');
    expect(r.failedParts).toEqual([]);
    expect(log).toHaveLength(1);
    expect(await doc(d.id)).toMatchObject({ status: 'new', processed: 0, error: 'остановлено' });
  });

  it('остановка во время запроса сопоставления — остановка, а не предложение «всё пропустить»', async () => {
    const d = await upload({ kind: 'table', rows: [['Соединение', 'Убито'], ['8 гв. А', '1200']] }, 'потери.csv');
    const ac = new AbortController();
    fakeClient(() => { ac.abort(); return new Error('This operation was aborted'); });
    const r = await ingest(d.id, LLM, { signal: ac.signal, onProgress: () => {} });
    expect(r.stopped).toBe('остановлено');
    expect(r.needsMapping).toBeUndefined();
  });

  it('дороги и рубежи — текстовые кандидаты; принятое остаётся принятым при повторном разборе части', async () => {
    const ROAD = 'Сводка. Дорога Зелов — Мюнхеберг разрушена и непроходима для колёсного транспорта с 18 апреля. ' + FILL.repeat(3);
    const d = await upload({ kind: 'text', text: ROAD });
    const answer = { items: [], claims: [], infrastructure: [{ kind: 'road', state: 'impassable', title: 'Дорога Зелов — Мюнхеберг', place: 'Зелов', river: null, date: '1945-04-18', dateTo: null, side: null, note: null, quote: 'Дорога Зелов — Мюнхеберг разрушена и непроходима для колёсного транспорта' }] };
    fakeClient((req) => (req.schema?.name === 'kb_operation_extract' ? { json: answer } : new Error('не то')));
    const r1 = await ingest(d.id, LLM, { onProgress: () => {} });
    expect(r1.review).toBe(1);
    expect(await store.all('infra')).toEqual([]);
    const [c] = await queue();
    expect(c).toMatchObject({ key: 'инфраструктура', state: 'pending' });
    expect(c.value).toContain('Дорога Зелов — Мюнхеберг: ');
    await decideCandidates([c.id], true);
    const entry = async () => (await store.all<{ id: string; facts?: { key: string; value: string; quote?: string; source?: string }[] }>('entries')).find((e) => e.id === `u:${OP}:infrastructure`);
    expect((await entry())?.facts).toEqual([expect.objectContaining({ key: 'features', value: c.value, quote: answer.infrastructure[0].quote, source: `doc:${d.id}` })]);

    // повторный разбор той же части
    await store.put('documents', { ...(await doc(d.id)), done: [], processed: 0 });
    const r2 = await ingest(d.id, LLM, { onProgress: () => {} });
    expect(r2.review).toBe(0);
    const q = await queue();
    expect(q).toHaveLength(1);
    expect(q[0].state).toBe('accepted');
    expect((await entry())?.facts).toHaveLength(1);
  });
});

describe('проверка «норматив»: единица и нынешнее значение входов правил', () => {
  it('paramInfo — единица каждого входа и значение исходного набора; ставится в проверки', async () => {
    const { paramInfo, PARAM_INFO } = await import('../src/kb/ingest');
    const { runChecks } = await import('@def-ops/knowledge');
    expect(PARAM_INFO['defense.prepared'].unit).toBe('×');
    const info = await paramInfo();
    expect(info['defense.prepared'].unit).toBe('×');
    expect(info['defense.prepared'].value).toBeGreaterThan(1);
    expect(info['advanceMax'].value).toBeGreaterThan(0);
    const c = {
      id: 'c1', claim: { kind: 'param' as const, param: 'defense.prepared', value: 35, unit: '%' }, names: {}, key: 'numbers', value: 'v', source: 'doc:d1',
      origin: 'text' as const, evidence: { kind: 'quote' as const, doc: 'd1', chunk: 0, quote: 'на 35 %' }, checks: [], verdict: 'auto' as const, state: 'pending' as const,
    };
    const r = runChecks(c, { formations: [], entries: [], strengthOf: () => null, existing: [], paramInfo: info, text: 'на 35 %' });
    expect(r.find((x) => x.check === 'param')?.level).toBe('doubt');
  });
});
