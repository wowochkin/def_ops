/**
 * Сквозные проверки «документ → база → модель» по видам, где сборка рвалась: переправа (по названию из документа),
 * разграничительная линия (таблица), потери «дни в столбцах» (убито и ранено за день). Цепочка: извлечение / строки
 * таблицы → runChecks → saveCandidates / decideCandidates → compileOperation → apply*. Документы — вымышленные.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  compileOperation, parseCsv, rowsToCandidates, runChecks, toCandidates, verdictOf,
  type Candidate, type CheckCtx, type ExtractedClaim, type TableMapping,
} from '@def-ops/knowledge';
import { locatePlace, Theatre, type History, type Scenario, type TheatreData } from '@def-ops/sim';
import scenarioFile from '../../../packages/sim/data/scenarios/berlin-1945.json';
import theatreFile from '../../../packages/sim/data/theatres/oder-berlin-1945.json';
import * as store from '../src/kb/store';
import { decideCandidates, saveCandidates } from '../src/kb/candidates';
import { applyCompiledBoundaries, applyCompiledCrossings, applyCompiledHistory } from '../src/sim/kb-compile';

beforeEach(async () => {
  await store.resetForTests();
  globalThis.indexedDB = new IDBFactory();
});

const sc = scenarioFile as unknown as Scenario;
const T = new Theatre(theatreFile as unknown as TheatreData);
const OP = 'berlin-1945';
const formations = sc.formations.map((f) => ({ id: f.id, name: f.name, side: f.side, echelon: f.echelon, personnel: f.personnel }));
const accept = { formations, theatre: { locate: (n: string) => { const p = locatePlace(T, n); return p ? { at: p.at as [number, number] } : null; } } };
const doc = { id: 'dx', name: 'Вымышленная выписка', reliability: 'B' as const, operation: OP };

/** Проверки 1–7, как в потоке разбора (перекрёстная выключена — извлечённое моделью идёт в очередь). */
async function checked(cands: Candidate[], extra: Partial<CheckCtx>, crossOff = false): Promise<Candidate[]> {
  const entries = await store.entries();
  const existing = entries.flatMap((e) => e.facts ?? []);
  const ctx: CheckCtx = { formations, entries, theatre: accept.theatre, op: { start: sc.start, end: sc.end }, strengthOf: () => null, existing, ...extra };
  return cands.map((c) => {
    const checks = runChecks(c, ctx);
    if (crossOff && verdictOf(checks) === 'auto') checks.push({ check: 'cross', level: 'doubt', why: 'перекрёстная проверка выключена' });
    return { ...c, checks, verdict: verdictOf(checks) };
  });
}
const compiled = async () => compileOperation(await store.entries(), { id: OP, start: sc.start, end: sc.end, formations: sc.formations }, await store.pins()).edits;

const claim = (x: Partial<ExtractedClaim>): ExtractedClaim => ({
  kind: 'strength', subject: null, parent: null, place: null, between: null, points: null, inclusive: null, title: null, date: null, dateTo: null,
  personnel: null, tanks: null, guns: null, killed: null, wounded: null, missing: null, total: null, state: null, lat: null, lon: null, approxKm: null, quote: '', ...x,
});

describe('переправа из документа доходит до моста театра', () => {
  const text = 'Утром 18 апреля мост через Одер у Франкфурта взорван отходящим противником. 20 апреля у Фюрстенберга сапёры навели наплавной мост через Одер.';
  const extracted = [
    claim({ kind: 'crossing', subject: 'мост через Одер у Франкфурта', date: '1945-04-18', state: 'destroyed', quote: 'мост через Одер у Франкфурта взорван отходящим противником' }),
    claim({ kind: 'crossing', subject: 'наплавной мост через Одер у Фюрстенберга', date: '1945-04-20', state: 'built', quote: 'у Фюрстенберга сапёры навели наплавной мост через Одер' }),
  ];

  it('авто: название — в claim.subject и тексте факта, сборка — мост br56 разрушен с 18.04', async () => {
    const cands = await checked(toCandidates(extracted, doc, { chunk: 0 }, 'text'), { text });
    expect(cands.map((c) => c.claim.kind === 'crossing' && c.claim.subject)).toEqual(['мост через Одер у Франкфурта', 'наплавной мост через Одер у Фюрстенберга']);
    expect(cands.every((c) => !c.checks.some((r) => r.check === 'subject' && r.level !== 'ok'))).toBe(true);
    expect(cands.map((c) => c.verdict)).toEqual(['auto', 'auto']);
    expect(await saveCandidates(cands, accept)).toMatchObject({ auto: 2, review: 0 });
    const fact = (await store.entries()).find((e) => e.id === `u:${OP}:infrastructure`)!.facts!.find((f) => f.claim?.kind === 'crossing' && f.claim.state === 'destroyed')!;
    expect(fact.value).toContain('мост через Одер у Франкфурта');
    const c = await compiled();
    const mine = (c.crossings as { subject: string }[]).filter((x) => x.subject.includes('Одер'));
    expect(mine).toHaveLength(2);   // две переправы — два входа, а не одна безымянная группа
    const recs = applyCompiledCrossings([], c, T);
    expect(recs.find((r) => r.title === 'мост через Одер у Франкфурта')).toMatchObject({ bridge: 'br56', state: 'destroyed', from: '1945-04-18' });
  });

  it('из очереди: прежний кандидат без названия в claim принимается человеком с названием из источника', async () => {
    const [c0] = toCandidates(extracted.slice(0, 1), doc, { chunk: 0 }, 'text');
    const legacy: Candidate = { ...c0, claim: { kind: 'crossing', subject: '', from: '1945-04-18', state: 'destroyed' }, value: 'разрушена с 1945-04-18' };
    const [cand] = await checked([legacy], { text }, true);
    expect(cand.verdict).toBe('review');
    await saveCandidates([{ ...cand, claim: { ...legacy.claim } }], accept);   // в хранилище — как прежде, без названия
    expect(await decideCandidates([cand.id], true, {}, accept)).toEqual({ accepted: 1, pending: [] });
    const f = (await store.entries()).find((e) => e.id === `u:${OP}:infrastructure`)!.facts![0];
    expect(f.claim).toMatchObject({ subject: 'мост через Одер у Франкфурта' });
    expect(f.value).toBe('мост через Одер у Франкфурта: разрушена с 1945-04-18');
    expect(applyCompiledCrossings([], await compiled(), T).find((r) => r.title === 'мост через Одер у Франкфурта')?.bridge).toBe('br56');
  });

  it('переправа без названия — сомнение «не названа переправа», в модель не идёт', async () => {
    const [c] = await checked(toCandidates([claim({ kind: 'crossing', date: '1945-04-18', state: 'destroyed', quote: 'мост через Одер у Франкфурта взорван' })], doc, { chunk: 0 }, 'text'), { text });
    expect(c.checks.find((r) => r.check === 'subject')).toMatchObject({ level: 'doubt', why: 'не названа переправа' });
    await saveCandidates([c], accept);
    expect(await decideCandidates([c.id], true, {}, accept)).toEqual({ accepted: 0, pending: [c.id] });
  });
});

describe('разграничительная линия из таблицы доходит до сценария', () => {
  it('строка шаблона: стороны — id сценария, пункты — на театре, линия в сценарии', async () => {
    const rows = parseCsv('kind;subject;date;place;quote\nboundary;1-й Белорусский фронт / 1-й Украинский фронт;17.04.1945;Beeskow | Cottbus;разгранлиния Бесков — Котбус\n');
    const r = rowsToCandidates(rows, { kind: 'boundary', columns: ['kind', 'subject', 'date', 'place', 'quote'] }, doc);
    expect(r.errors).toEqual([]);
    const cands = await checked(r.candidates, { rowExists: true });
    expect(cands[0].claim).toMatchObject({ kind: 'boundary', between: ['su_1bf', 'su_1uf'] });
    expect(cands[0].verdict).toBe('auto');
    expect(await saveCandidates(cands, accept)).toMatchObject({ auto: 1 });
    const out = applyCompiledBoundaries(sc, await compiled(), T);
    const kb = out.boundaries!.filter((b) => b.source === 'база знаний' && b.from === '1945-04-17T00:00');
    expect(kb).toHaveLength(1);
    expect([kb[0].right, kb[0].left].sort()).toEqual(['su_1bf', 'su_1uf']);
    expect(kb[0].line).toHaveLength(2);
  });
});

describe('потери «дни в столбцах»: убито и ранено за день — один факт, в модели сумма', () => {
  it('строки → кандидаты → база → контрольная точка потерь 310 + 640', async () => {
    const rows = parseCsv('Соединение;16.04.1945;16.04.1945;17.04.1945\n8-я гвардейская армия;310;640;120\n');
    const mapping: TableMapping = { kind: 'losses', columns: ['subject', { day: '1945-04-16', field: 'killed' }, { day: '1945-04-16', field: 'wounded' }, { day: '1945-04-17', field: 'killed' }] };
    const r = rowsToCandidates(rows, mapping, doc);
    expect(r.errors).toEqual([]);
    expect(r.candidates).toHaveLength(2);
    const cands = await checked(r.candidates, { rowExists: true });
    expect(cands.map((c) => c.verdict)).toEqual(['auto', 'auto']);
    expect(cands[0].claim).toMatchObject({ subject: 'su_8gva', killed: 310, wounded: 640 });
    expect(await saveCandidates(cands, accept)).toMatchObject({ auto: 2 });
    const c = await compiled();
    const h = applyCompiledHistory({ positions: [] } as unknown as History, c);
    const day16 = (h.checkpoints ?? []).filter((x) => x.formation === 'su_8gva' && x.kind === 'losses' && x.at.startsWith('1945-04-16'));
    expect(day16).toHaveLength(1);
    expect(day16[0]).toMatchObject({ personnel: 950 });
  });
});
