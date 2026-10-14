import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { claimFacts, fingerprint, pinKey, resolve, type Candidate, type Claim, type Entry, type FactRef } from '@def-ops/knowledge';
import * as store from '../src/kb/store';
import { correctBuiltin, decideCandidates, deleteFact, editFact, rollbackDocument, saveCandidates, staleCorrections, type StoredCandidate } from '../src/kb/candidates';

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

describe('положение по названию места', () => {
  const located = { ...ctx, theatre: { locate: (n: string) => (n === 'Зелов' ? { at: [14.37, 52.59] as [number, number] } : null) } };
  it('повторная загрузка — повтор, хотя записанный факт получил координаты', async () => {
    const c = () => cand('p', { kind: 'position', subject: 'su_99a', at: '1945-04-17', place: 'Зелов' }, 'auto');
    expect(await saveCandidates([c()], located)).toMatchObject({ auto: 1 });
    const f = (await userEntry(ENTRY))!.facts!.find((x) => x.claim?.kind === 'position');
    expect(f?.claim).toMatchObject({ lngLat: [14.37, 52.59] });
    expect(await saveCandidates([c()], located)).toEqual({ auto: 0, review: 0, drop: 0, duplicate: 1 });
    expect((await userEntry(ENTRY))!.facts!.filter((x) => x.claim?.kind === 'position')).toHaveLength(1);
  });
  it('приём не меняет кандидата вызывающего (subject заполняется в копии)', async () => {
    const c = cand('s', { kind: 'enter', subject: '', at: '1945-04-17' }, 'auto');
    await saveCandidates([c], ctx);
    expect((c.claim as { subject: string }).subject).toBe('');
    expect((await userEntry(ENTRY))!.facts!.find((x) => x.claim?.kind === 'enter')?.claim).toMatchObject({ subject: 'su_99a' });
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

describe('editFact и deleteFact: правка своих фактов и исправлений', () => {
  async function corrected() {
    const seed = await store.seed();
    const e = seed.find((x) => x.id === 'f:su_1bf')!;
    const index = e.facts!.findIndex((f) => f.claim?.kind === 'strength' && f.claim.at === '1945-04-16');
    const ref: FactRef = { entry: e.id, index, fact: e.facts![index], updated: '' };
    const old = ref.fact.claim as Extract<Claim, { kind: 'strength' }>;
    await correctBuiltin(ref, { ...old, personnel: old.personnel! + 1000 }, { source: 'src:test', starts: ['1945-04-16T05:00'] });
    const ent = (await store.entries()).find((x) => x.id === ref.entry)!;
    return { ref, old, fix: ent.facts!.findIndex((f) => f.corrects) };
  }

  it('изменённое исправление закреплено заново (не «закреплённый факт удалён»), встроенный не выигрывает', async () => {
    const { ref, old, fix } = await corrected();
    const f0 = (await store.entries()).find((x) => x.id === ref.entry)!.facts![fix];
    const nextClaim: Claim = { ...old, personnel: old.personnel! + 2000 };
    await editFact(ref.entry, fix, { ...f0, claim: nextClaim, value: 'исправлено ещё раз' }, { starts: ['1945-04-16T05:00'] });
    const entries = await store.entries();
    const f = entries.find((x) => x.id === ref.entry)!.facts![fix];
    expect(f.corrects).toBe(f0.corrects);
    expect(f.check?.by).toBe('human');
    const pins = await store.pins();
    expect(pins[pinKey('strength', 'su_1bf', '1945-04-16T05:00')]).toEqual({ entry: ref.entry, index: fix, fp: fingerprint(f) });
    const r = resolve(claimFacts(entries), 'strength', 'su_1bf', '1945-04-16T05:00', pins, { window: 2 });
    expect(r.pin).toBe('fact');
    expect(r.chosen?.fact.value).toBe('исправлено ещё раз');
  });

  it('удалённое исправление снимает закрепления — встроенный снова выбирается', async () => {
    const { ref, fix } = await corrected();
    await deleteFact(ref.entry, fix, { starts: ['1945-04-16T05:00'] });
    const entries = await store.entries();
    expect(entries.find((x) => x.id === ref.entry)!.facts!.some((f) => f.corrects)).toBe(false);
    const pins = await store.pins();
    expect(pins[pinKey('strength', 'su_1bf', '1945-04-16T05:00')]).toBeUndefined();
    expect(pins[pinKey('strength', 'su_1bf', '1945-04-16')]).toBeUndefined();
    const r = resolve(claimFacts(entries), 'strength', 'su_1bf', '1945-04-16T05:00', pins, { window: 2 });
    expect(r.chosen).toMatchObject({ entry: ref.entry, index: ref.index });
  });

  it('удаление сдвигает закрепления следующих фактов записи и адреса принятых кандидатов', async () => {
    await saveCandidates([
      cand('a', { kind: 'strength', subject: 'su_99a', at: '1945-04-16', personnel: 50000 }, 'auto'),
      cand('b', { kind: 'strength', subject: 'su_99a', at: '1945-04-20', personnel: 48000 }, 'auto'),
    ], ctx);
    const e = (await userEntry(ENTRY))!;
    const i1 = e.facts!.findIndex((f) => f.value === 'b');
    const i0 = e.facts!.findIndex((f) => f.value === 'a');
    expect(i1).toBeGreaterThan(i0);
    await store.putPins({ k: { entry: ENTRY, index: i1, fp: fingerprint(e.facts![i1]) }, k0: { entry: ENTRY, index: i0, fp: fingerprint(e.facts![i0]) } });
    await store.put('candidates', { ...cand('b', e.facts![i1].claim!, 'auto'), state: 'accepted', accepted: { entry: ENTRY, index: i1 } });
    await deleteFact(ENTRY, i0);
    const pins = await store.pins();
    expect(pins.k).toEqual({ entry: ENTRY, index: i1 - 1, fp: fingerprint(e.facts![i1]) });
    expect(pins.k0).toBeUndefined();
    expect((await queue()).find((c) => c.id === 'b')?.accepted).toEqual({ entry: ENTRY, index: i1 - 1 });
  });
});

describe('откат закреплений исправления (запись correctionPins)', () => {
  const S = '1945-04-16T05:00';
  async function builtinRef(): Promise<FactRef> {
    const e = (await store.seed()).find((x) => x.id === 'f:su_1bf')!;
    const index = e.facts!.findIndex((f) => f.claim?.kind === 'strength' && f.claim.at === '1945-04-16');
    return { entry: e.id, index, fact: e.facts![index], updated: '' };
  }
  const fixIndex = async (entry: string) => (await store.entries()).find((x) => x.id === entry)!.facts!.findIndex((f) => f.corrects);

  it('исправление о другом соединении: удаление со starts [] снимает «не брать» и на начале операции', async () => {
    const ref = await builtinRef();
    const old = ref.fact.claim as Extract<Claim, { kind: 'strength' }>;
    await correctBuiltin(ref, { ...old, subject: 'su_1uf' }, { source: 'src:test', starts: [S] });
    const i = await fixIndex(ref.entry);
    const f = (await store.entries()).find((x) => x.id === ref.entry)!.facts![i];
    expect(f.correctionPins?.map((r) => r.key).sort()).toEqual([pinKey('strength', 'su_1bf', '1945-04-16'), pinKey('strength', 'su_1bf', S)].sort());
    await deleteFact(ref.entry, i, { starts: [] });
    const pins = await store.pins();
    expect(pins[pinKey('strength', 'su_1bf', S)]).toBeUndefined();
    expect(pins[pinKey('strength', 'su_1bf', '1945-04-16')]).toBeUndefined();
  });

  it('прежнее закрепление человека по ключу возвращается при удалении исправления', async () => {
    const ref = await builtinRef();
    const old = ref.fact.claim as Extract<Claim, { kind: 'strength' }>;
    await store.putPins({ [pinKey('strength', 'su_1bf', S)]: 'none' });
    await correctBuiltin(ref, { ...old, personnel: old.personnel! + 1000 }, { source: 'src:test', starts: [S] });
    expect((await store.pins())[pinKey('strength', 'su_1bf', S)]).not.toBe('none');
    await deleteFact(ref.entry, await fixIndex(ref.entry), { starts: [] });
    expect((await store.pins())[pinKey('strength', 'su_1bf', S)]).toBe('none');
  });

  it('правка исправления: прежние значения записи — до первого исправления, а не его собственные закрепления', async () => {
    const ref = await builtinRef();
    const old = ref.fact.claim as Extract<Claim, { kind: 'strength' }>;
    await correctBuiltin(ref, { ...old, subject: 'su_1uf' }, { source: 'src:test', starts: [S] });
    const i = await fixIndex(ref.entry);
    const f0 = (await store.entries()).find((x) => x.id === ref.entry)!.facts![i];
    await editFact(ref.entry, i, { ...f0, claim: { ...old, personnel: old.personnel! + 500 }, value: 'то же соединение' }, { starts: [S] });
    const f1 = (await store.entries()).find((x) => x.id === ref.entry)!.facts![i];
    expect(f1.correctionPins?.every((r) => r.prev === null)).toBe(true);
    expect((await store.pins())[pinKey('strength', 'su_1bf', S)]).toEqual({ entry: ref.entry, index: i, fp: fingerprint(f1) });
    await deleteFact(ref.entry, i);
    expect((await store.pins())[pinKey('strength', 'su_1bf', S)]).toBeUndefined();
  });

  it('прежнее исправление без записи: удаление снимает «не брать» по началам операций каталога не раньше даты встроенного', async () => {
    const ref = await builtinRef();
    const old = ref.fact.claim as Extract<Claim, { kind: 'strength' }>;
    await correctBuiltin(ref, { ...old, subject: 'su_1uf' }, { source: 'src:test', starts: [S] });
    const e = (await store.all<Entry>('entries')).find((x) => x.id === ref.entry)!;
    const i = e.facts!.findIndex((f) => f.corrects);
    const { correctionPins: _r, ...legacy } = e.facts![i];
    await store.put('entries', { ...e, facts: e.facts!.map((f, j) => (j === i ? legacy : f)) });
    await store.putPins({ [pinKey('strength', 'su_1bf', '1945-01-12T05:00')]: 'none' });
    await deleteFact(ref.entry, i, { starts: [], allStarts: ['1945-01-12T05:00', S] });
    const pins = await store.pins();
    expect(pins[pinKey('strength', 'su_1bf', S)]).toBeUndefined();
    // начало операции раньше даты встроенного — не его ключ, не трогается
    expect(pins[pinKey('strength', 'su_1bf', '1945-01-12T05:00')]).toBe('none');
  });

  it('встроенный факт не правится и не удаляется', async () => {
    const ref = await builtinRef();
    await correctBuiltin(ref, { ...(ref.fact.claim as Claim) }, { source: 'src:test', starts: [S] }); // запись пользователя — копия сида
    await expect(deleteFact(ref.entry, ref.index)).rejects.toThrow(/исправить/);
    await expect(editFact(ref.entry, ref.index, { ...ref.fact, value: 'x' })).rejects.toThrow(/исправить/);
  });
});

describe('addManual: переправа, введённая вручную', () => {
  it('принята человеком в запись инфраструктуры операции, кандидат — принятым с адресом', async () => {
    const { addManual } = await import('../src/kb/candidates');
    const c: Candidate = {
      id: 'm1', claim: { kind: 'crossing', subject: 'мост у Кюстрина', from: '1945-04-16', state: 'destroyed' }, names: { subject: 'мост у Кюстрина' },
      key: 'переправа', value: 'мост у Кюстрина', source: 'вручную', origin: 'manual', evidence: { kind: 'manual' }, op: OP, checks: [], verdict: 'review', state: 'pending',
    };
    const r = await addManual(c, ctx);
    expect(r).toEqual({ entry: `u:${OP}:infrastructure`, index: 0 });
    const f = (await userEntry(`u:${OP}:infrastructure`))?.facts?.[0];
    expect(f?.check?.by).toBe('human');
    expect(f?.claim).toMatchObject({ kind: 'crossing', state: 'destroyed' });
    expect((await queue())[0]).toMatchObject({ id: 'm1', verdict: 'review', state: 'accepted', accepted: { entry: `u:${OP}:infrastructure`, index: 0 } });
  });
});
