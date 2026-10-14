import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { formationEntries, type BoundaryProposal, type Entry, type Fact, type InfraProposal, type PositionProposal, type Proposal } from '@def-ops/knowledge';
import type { Scenario, TheatreData } from '@def-ops/sim';
import scenarioFile from '../../../packages/sim/data/scenarios/berlin-1945.json';
import theatreFile from '../../../packages/sim/data/theatres/oder-berlin-1945.json';
import * as store from '../src/kb/store';
import { importUser } from '../src/kb/kb';
import { migrateLegacy, migrateV7, MIGRATED_V7, MIGRATED_V7_INFRA, type MigrateCtx } from '../src/kb/migrate';
import { decideCandidates } from '../src/kb/candidates';
import type { StoredCandidate } from '../src/kb/candidates';

const OP = 'berlin-1945';
const sc = scenarioFile as unknown as Scenario;
const input = {
  scenario: sc, operation: { id: OP, title: 'Берлинская операция', start: sc.start, end: sc.end },
  formations: sc.formations.filter((f) => f.type).map((f) => ({ id: f.id, name: f.name, side: f.side, echelon: f.echelon, parent: f.parent ?? null, positions: [] })),
};
const ctx: MigrateCtx = { operation: async (op) => (op === OP ? { input, theatre: theatreFile as unknown as TheatreData } : null) };

beforeEach(async () => {
  await store.resetForTests();
  globalThis.indexedDB = new IDBFactory();
});

/** Вымышленные выписки: положение армии и линия между фронтами — принятые прежним разделом «Операции». */
const pos = (id: string, status: PositionProposal['status'], place = 'Seelow'): PositionProposal => ({
  id, doc: 'd1', docName: 'выписка.txt', chunk: 0, operation: OP, reliability: 'B', status,
  item: { formation: '8-я гвардейская армия', date: '1945-04-17', place, note: null, quote: `Армия к вечеру вышла к пункту ${place} (${id})` },
});
const bnd = (id: string, status: BoundaryProposal['status']): BoundaryProposal => ({
  id, doc: 'd1', docName: 'выписка.txt', chunk: 1, operation: OP, reliability: 'B', status,
  item: { between: ['1-й Белорусский фронт', '1-й Украинский фронт'], date: '1945-04-16', dateTo: null, points: ['Beeskow', 'Cottbus'], inclusive: null, note: null, quote: `Линия разграничения по пунктам (${id})` },
});
const prop: Proposal = {
  id: 'p1', doc: 'd1', chunk: 2, kind: 'new', entry: { id: 'u:x', category: 'battles', title: 'Бой у высот', summary: 'Пересказ.', status: 'extracted', origin: 'document' },
  facts: [{ key: 'place', value: 'высоты', quote: 'бой у высот', reliability: 'B' }], relations: [], status: 'pending',
};

/** Записи, как их оставил прежний приём: копии записей сида с текстовыми фактами положения и линии. */
async function legacyEntries(): Promise<Entry[]> {
  const seed = await store.seed();
  const of = (id: string, name: string) => formationEntries(seed, { id, name })[0];
  const text = (key: string, quote: string, value: string): Fact => ({ key, value, quote, source: 'doc:d1', pages: 'часть 1', reliability: 'B' });
  const a = of('su_8gva', '8-я гвардейская армия'), b = of('su_1bf', '1-й Белорусский фронт'), c = of('su_1uf', '1-й Украинский фронт');
  const bq = bnd('b1', 'accepted').item.quote;
  return [
    { ...a, origin: 'user', facts: [...(a.facts ?? []), text('path', pos('p-acc', 'accepted').item.quote, '17.04 — Seelow')] },
    { ...b, origin: 'user', facts: [...(b.facts ?? []), text('boundary', bq, 'линия')] },
    { ...c, origin: 'user', facts: [...(c.facts ?? []), text('boundary', bq, 'линия')] },
  ];
}
const legacy = () => ({
  positions: [pos('p-acc', 'accepted'), pos('p-wait', 'pending', 'Dolgelin')],
  boundaries: [bnd('b1', 'accepted'), bnd('b2', 'rejected')],
  proposals: [prop],
});

/** База версии 6: прежние хранилища без candidates. */
async function makeV6() {
  const entries = await legacyEntries();
  const l = legacy();
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('def_ops_kb', 6);
    r.onupgradeneeded = () => { for (const s of ['entries', 'documents', 'proposals', 'vectors', 'infra', 'positions', 'boundaries', 'pins']) r.result.createObjectStore(s, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const tx = db.transaction(['entries', 'positions', 'boundaries', 'proposals'], 'readwrite');
  for (const e of entries) tx.objectStore('entries').put(e);
  for (const p of l.positions) tx.objectStore('positions').put(p);
  for (const p of l.boundaries) tx.objectStore('boundaries').put(p);
  for (const p of l.proposals) tx.objectStore('proposals').put(p);
  await new Promise<void>((res) => { tx.oncomplete = () => res(); });
  db.close();
}

/** Что получилось: факты с формальной частью из документа, кандидаты. */
async function result() {
  const facts = (await store.all<Entry>('entries')).flatMap((e) => (e.facts ?? []).filter((f) => f.source === 'doc:d1' && f.claim).map((f) => ({ entry: e.id, f })));
  return { facts, cands: await store.all<StoredCandidate>('candidates') };
}

function expectMigrated(r: Awaited<ReturnType<typeof result>>) {
  const p = r.facts.find((x) => x.f.claim!.kind === 'position')!;
  expect(p.f.claim).toMatchObject({ kind: 'position', subject: 'su_8gva', at: '1945-04-17' });
  expect(p.f.check?.by).toBe('human');
  expect(p.f.evidence).toMatchObject({ kind: 'quote', doc: 'd1' });
  const b = r.facts.filter((x) => x.f.claim!.kind === 'boundary');
  expect(b).toHaveLength(1);
  expect(b[0].f.claim).toMatchObject({ between: ['su_1bf', 'su_1uf'], from: '1945-04-16', points: ['Beeskow', 'Cottbus'] });
  expect(b[0].f.check?.by).toBe('human');
  expect(r.facts).toHaveLength(2);
  const byId = new Map(r.cands.map((c) => [c.id, c]));
  expect(byId.get('v6:pos:p-wait')).toMatchObject({ state: 'pending', claim: { kind: 'position', subject: 'su_8gva' } });
  expect(byId.get('v6:bnd:b2')?.state).toBe('rejected');
  expect(byId.get('v6:prop:p1')).toMatchObject({ state: 'pending', proposal: { id: 'p1' } });
  expect(byId.get('v6:prop:p1')?.claim).toBeUndefined();
  expect(r.cands).toHaveLength(3);
}

describe('перенос базы версии 6', () => {
  it('принятые положение и линия — факты с claim (человек); ждущие и отклонённые — кандидаты; второй запуск — без изменений', async () => {
    await makeV6();
    expect(await migrateV7(ctx)).toEqual({ facts: 2, candidates: 3 });
    const first = await result();
    expectMigrated(first);
    // прежний текстовый факт дополнен, а не задвоен
    const e8 = (await store.all<Entry>('entries')).find((e) => e.id === first.facts[0].entry)!;
    expect(e8.facts!.filter((f) => f.source === 'doc:d1').length).toBe(1);

    expect(await migrateV7(ctx)).toEqual({ facts: 0, candidates: 0 });
    // и сам перенос узнаёт сделанное (без метки)
    expect(await migrateLegacy(legacy(), ctx)).toEqual({ facts: 0, candidates: 0 });
    expect(await result()).toEqual(first);
  });

  it('выгрузка версии 1 загружается с переносом; повторная загрузка ничего не задваивает', async () => {
    const json = JSON.stringify({ format: 'def-ops-knowledge', version: 1, entries: await legacyEntries(), ...legacy(), pins: [] });
    await importUser(json, ctx);
    const first = await result();
    expectMigrated(first);
    await importUser(json, ctx);
    const again = await result();
    expect(again.facts).toHaveLength(2);
    expect(again.cands).toHaveLength(3);
  });

  it('операция не прочиталась — метки переноса нет, следующий запуск переносит без повторов', async () => {
    await makeV6();
    const broken: MigrateCtx = { operation: async () => null };
    expect(await migrateV7(broken)).toEqual({ facts: 0, candidates: 1 });
    expect(await store.one('pins', 'migrated:v7')).toBeUndefined();
    expect(await migrateV7(ctx)).toEqual({ facts: 2, candidates: 2 });
    expect(await store.one('pins', 'migrated:v7')).toBeTruthy();
    expectMigrated(await result());
  });

  it('положение, у которого место не найдено, остаётся текстовым фактом', async () => {
    const p = pos('p-x', 'accepted', 'Нигдебург');
    const r = await migrateLegacy({ positions: [p] }, ctx);
    expect(r).toEqual({ facts: 0, candidates: 0 });
  });

  it('ждущая дорога — текстовым кандидатом и в базе, перенесённой раньше (один раз); принятие — факт инфраструктуры', async () => {
    const road: InfraProposal = {
      id: 'i1', doc: 'd1', docName: 'выписка.txt', chunk: 0, operation: OP, reliability: 'B', status: 'pending',
      item: { kind: 'road', state: 'blocked', title: 'шоссе на Мюнхеберг', place: null, river: null, date: '1945-04-17', dateTo: null, side: null, note: null, quote: 'шоссе было забито (i1)' },
    };
    await store.put('infra', road);
    await store.put('pins', { id: MIGRATED_V7, at: '' });
    expect(await migrateV7(ctx)).toEqual({ facts: 0, candidates: 1 });
    expect(await store.one('pins', MIGRATED_V7_INFRA)).toBeTruthy();
    expect(await migrateV7(ctx)).toEqual({ facts: 0, candidates: 0 });
    const c = (await store.all<StoredCandidate>('candidates'))[0];
    expect(c).toMatchObject({ id: 'v6:inf:i1', state: 'pending', key: 'инфраструктура' });
    expect(c.claim).toBeUndefined();
    expect((await decideCandidates([c.id], true)).accepted).toBe(1);
    const e = (await store.all<Entry>('entries')).find((x) => x.id === `u:${OP}:infrastructure`);
    expect(e?.facts?.[0]).toMatchObject({ key: 'features', quote: 'шоссе было забито (i1)', source: 'doc:d1' });
  });
});
