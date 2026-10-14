import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { claimFacts, fingerprint, pinKey, resolve, type Candidate, type Claim, type Entry, type FactRef } from '@def-ops/knowledge';
import * as store from '../src/kb/store';
import { correctBuiltin, decideCandidates, rollbackDocument, saveCandidates, staleCorrections, type StoredCandidate } from '../src/kb/candidates';

beforeEach(async () => {
  await store.resetForTests();
  globalThis.indexedDB = new IDBFactory();
});

const OP = 'test-op';
const ctx = { formations: [{ id: 'su_99a', name: '99-я армия', side: 'su', echelon: 'army' }] };
const ENTRY = `u:${OP}:formations:su_99a`;

/** Кандидат из вымышленной выписки документа d1. */
function cand(id: string, claim: Claim, verdict: Candidate['verdict'], checks: Candidate['checks'] = [], names: Candidate['names'] = { subject: '99-я армия' }): Candidate {
  return {
    id, claim, names, key: 'численность', value: id, source: 'doc:d1', pages: 'часть 1', reliability: 'B', origin: 'text',
    evidence: { kind: 'quote', doc: 'd1', chunk: 0, quote: `выписка ${id}` }, op: OP, checks, verdict, state: 'pending',
  };
}
const list = (): Candidate[] => [
  cand('a', { kind: 'strength', subject: 'su_99a', at: '1945-04-16', personnel: 50000 }, 'auto', [{ check: 'quote', level: 'ok' }]),
  cand('r', { kind: 'strength', subject: 'su_99a', at: '1945-04-20', personnel: 48000 }, 'review', [{ check: 'plausible', level: 'doubt', why: 'за пределами' }]),
  cand('d', { kind: 'losses', subject: 'su_99a', from: '1945-04-16', to: '1945-04-18', total: 5000 }, 'drop', [{ check: 'numbers', level: 'fail', why: 'в цитате нет числа: 5000' }]),
];
const userEntry = async (id: string) => (await store.all<Entry>('entries')).find((e) => e.id === id);
const queue = () => store.all<StoredCandidate>('candidates');

describe('saveCandidates: маршрут по итогу проверок', () => {
  it('auto — факт в записи, review — в очереди, drop — отклонён с причиной', async () => {
    expect(await saveCandidates(list(), ctx)).toEqual({ auto: 1, review: 1, drop: 1, duplicate: 0 });
    const e = await userEntry(ENTRY);
    const f = e?.facts?.find((x) => x.claim?.kind === 'strength');
    expect(f?.check?.by).toBe('auto');
    expect(f?.evidence).toEqual({ kind: 'quote', doc: 'd1', chunk: 0, quote: 'выписка a' });
    expect(f?.quote).toBe('выписка a');
    expect(f?.source).toBe('doc:d1');
    const q = await queue();
    expect(q.find((c) => c.id === 'r')?.state).toBe('pending');
    const d = q.find((c) => c.id === 'd');
    expect(d?.state).toBe('rejected');
    expect(d?.checks[0].why).toContain('5000');
  });

  it('повторная загрузка того же списка — все повторы, новых фактов нет', async () => {
    await saveCandidates(list(), ctx);
    const before = (await userEntry(ENTRY))!.facts!.length;
    expect(await saveCandidates(list(), ctx)).toEqual({ auto: 0, review: 0, drop: 0, duplicate: 3 });
    expect((await userEntry(ENTRY))!.facts!.length).toBe(before);
    expect((await queue()).length).toBe(2);
  });

  it('отброшенный проверкой повтора — только в счётчике', async () => {
    const c = cand('x', { kind: 'enter', subject: 'su_99a', at: '1945-04-17' }, 'drop', [{ check: 'duplicate', level: 'fail', why: 'уже в базе' }]);
    expect(await saveCandidates([c], ctx)).toEqual({ auto: 0, review: 0, drop: 0, duplicate: 1 });
    expect(await queue()).toEqual([]);
  });

  it('auto без записи соединения — в очередь с сомнением «соединение не найдено»', async () => {
    const c = cand('n', { kind: 'enter', subject: '', at: '1945-04-17' }, 'auto', [], { subject: 'Сводная группа Неизвестного' });
    expect(await saveCandidates([c], ctx)).toEqual({ auto: 0, review: 1, drop: 0, duplicate: 0 });
    const q = (await queue())[0];
    expect(q.state).toBe('pending');
    expect(q.checks.find((r) => r.check === 'subject')?.why).toContain('соединение не найдено');
  });
});

describe('decideCandidates и rollbackDocument', () => {
  it('принятие человеком с правкой; откат снимает auto, оставляет human с пометкой', async () => {
    await saveCandidates(list(), ctx);
    const r = await decideCandidates(['r'], true, { r: { claim: { kind: 'strength', subject: 'su_99a', at: '1945-04-20', personnel: 47000 } } }, ctx);
    expect(r).toEqual({ accepted: 1, pending: [] });
    const facts = (await userEntry(ENTRY))!.facts!;
    const h = facts.find((f) => f.check?.by === 'human');
    expect(h?.claim).toMatchObject({ personnel: 47000 });
    expect((await queue()).find((c) => c.id === 'r')?.state).toBe('accepted');

    expect(await rollbackDocument('d1')).toEqual({ removed: 1, kept: 1 });
    const after = (await userEntry(ENTRY))!.facts!;
    expect(after.some((f) => f.check?.by === 'auto')).toBe(false);
    expect(after.find((f) => f.check?.by === 'human')?.check?.docRolledBack).toBe(true);
  });

  it('отклонение — состояние rejected', async () => {
    await saveCandidates(list(), ctx);
    await decideCandidates(['r'], false);
    expect((await queue()).find((c) => c.id === 'r')?.state).toBe('rejected');
  });
});

describe('correctBuiltin и staleCorrections', () => {
  /** Встроенный факт численности фронта на начало операции. */
  async function builtin(): Promise<FactRef> {
    const seed = await store.seed();
    const e = seed.find((x) => x.id === 'f:su_1bf')!;
    const index = e.facts!.findIndex((f) => f.claim?.kind === 'strength' && f.claim.at === '1945-04-16');
    return { entry: e.id, index, fact: e.facts![index], updated: '' };
  }

  it('исправление: факт с corrects, встроенный исключён — в сборке выбирается исправление', async () => {
    const ref = await builtin();
    const old = ref.fact.claim as Extract<Claim, { kind: 'strength' }>;
    const next: Claim = { ...old, personnel: old.personnel! + 1000 };
    await correctBuiltin(ref, next, { source: 'src:test', reliability: 'A', starts: ['1945-04-16T05:00'] });
    const entries = await store.entries();
    const e = entries.find((x) => x.id === ref.entry)!;
    const fix = e.facts!.findIndex((f) => f.corrects);
    expect(e.facts![fix].corrects).toBe(`${ref.entry}#${ref.index}|${fingerprint(ref.fact)}`);
    expect(e.facts![fix].check?.by).toBe('human');
    const pins = await store.pins();
    // закреплено исправление (не 'none': «не брать» исключило бы и его)
    expect(pins[pinKey('strength', 'su_1bf', '1945-04-16T05:00')]).toEqual({ entry: ref.entry, index: fix, fp: fingerprint(e.facts![fix]) });
    const r = resolve(claimFacts(entries), 'strength', 'su_1bf', '1945-04-16T05:00', pins, { window: 2 });
    expect(r.chosen?.fact.corrects).toBeTruthy();

    // встроенный не менялся — исправление не устарело; изменился в сиде — устарело
    const seed = await store.seed();
    expect(staleCorrections(entries, seed)).toEqual([]);
    const changed = seed.map((x) => (x.id === ref.entry ? { ...x, facts: x.facts!.map((f, i) => (i === ref.index ? { ...f, claim: { ...old, personnel: 900000 } } : f)) } : x));
    expect(staleCorrections(entries, changed)).toEqual([{ entry: ref.entry, index: fix }]);
  });

  it('исправление о другом соединении — встроенный закреплён «не брать»', async () => {
    const ref = await builtin();
    const old = ref.fact.claim as Extract<Claim, { kind: 'strength' }>;
    await correctBuiltin(ref, { ...old, subject: 'su_1uf' }, { source: 'src:test', starts: ['1945-04-16T05:00'] });
    const pins = await store.pins();
    expect(pins[pinKey('strength', 'su_1bf', '1945-04-16T05:00')]).toBe('none');
    expect(pins[pinKey('strength', 'su_1bf', '1945-04-16')]).toBe('none');
  });
});
