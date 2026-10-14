/**
 * Перенос базы знаний версии 6 в версию 7: прежние очереди документов операций (положения, разграничительные линии,
 * сведения об инфраструктуре, предложения записей) → факты с формальной частью и кандидаты.
 *
 * Принятые положения, линии, переправы и мосты — факты с claim и check.by = 'human' (прежний текстовый факт
 * дополняется формальной частью; нет его — факт добавляется). Где claim не собрать (формирование, место или дата не
 * найдены) — текстовый факт остаётся как был. Ждущие и отклонённые — кандидатами с прежним состоянием; предложения
 * записей — текстовыми кандидатами (без claim). Прочая инфраструктура (дороги, рубежи) остаётся как была.
 * Повторный запуск ничего не задваивает: метка migrated:v7 в хранилище pins, а сам перенос узнаёт сделанное.
 */
import type { BoundaryProposal, Claim, Entry, Fact, InfraItem, InfraProposal, PositionProposal, Proposal, SyncInput } from '@def-ops/knowledge';
import { Theatre, type Scenario, type TheatreData } from '@def-ops/sim';
import { boundaryClaim, boundaryTargets, boundaryText, positionClaim, positionFact, positionTarget, resolveBoundary, resolvePosition, syncInput, type BoundaryResolution, type PositionResolution } from '../modeling/sync';
import { work, type StoredCandidate, type TextCandidate } from './candidates';
import * as store from './store';

/** Данные операции для переноса: сценарий (формирования) и театр; null — операции нет. */
export interface MigrateCtx {
  operation(op: string): Promise<{ input: SyncInput & { scenario: Scenario }; theatre: TheatreData | null } | null>;
}

const defaultCtx: MigrateCtx = {
  async operation(op) {
    try {
      const input = await syncInput(op);
      const { getData } = await import('../sim/userdata');
      const theatre = (await getData('theatres', `${input.scenario.theatre}.json`).catch(() => null)) as TheatreData | null;
      return { input, theatre };
    } catch { return null; }
  },
};

export const MIGRATED_V7 = 'migrated:v7';

/** Прежние очереди (из хранилищ версии 6 или из выгрузки версии 1). */
export interface Legacy { proposals?: Proposal[]; infra?: InfraProposal[]; positions?: PositionProposal[]; boundaries?: BoundaryProposal[] }

/** Перенос при открытии базы версии 7 — один раз (метка в pins); одновременные вызовы ждут один перенос. */
let running: Promise<{ facts: number; candidates: number }> | null = null;
export function migrateV7(ctx: MigrateCtx = defaultCtx): Promise<{ facts: number; candidates: number }> {
  running ??= runV7(ctx).finally(() => { running = null; });
  return running;
}
async function runV7(ctx: MigrateCtx): Promise<{ facts: number; candidates: number }> {
  if (await store.one('pins', MIGRATED_V7)) return { facts: 0, candidates: 0 };
  const [proposals, infra, positions, boundaries] = await Promise.all([
    store.all<Proposal>('proposals'), store.all<InfraProposal>('infra'), store.all<PositionProposal>('positions'), store.all<BoundaryProposal>('boundaries'),
  ]);
  const r = await migrateLegacy({ proposals, infra, positions, boundaries }, ctx);
  await store.put('pins', { id: MIGRATED_V7, at: new Date().toISOString(), ...r });
  return r;
}

const CROSSING_STATE: Partial<Record<InfraItem['state'], Extract<Claim, { kind: 'crossing' }>['state']>> = {
  intact: 'open', built: 'built', repaired: 'built', destroyed: 'destroyed', impassable: 'destroyed',
};
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isCrossing = (p: InfraProposal) => p.item.kind === 'bridge' || p.item.kind === 'crossing';
/** Переправа или мост → формальная часть: нужны дата и состояние, которое читается как проходима / разрушена / наведена. */
function crossingClaim(it: InfraItem): Extract<Claim, { kind: 'crossing' }> | null {
  const state = CROSSING_STATE[it.state];
  return state && ISO_DAY.test(it.date ?? '') ? { kind: 'crossing', subject: it.title, from: it.date!, state } : null;
}

const human = (at: string) => ({ by: 'human' as const, at, results: [] });
const quoteEv = (doc: string, chunk: number, quote: string) => ({ kind: 'quote' as const, doc, chunk, quote });

/** Перенести очереди: принятое — фактами, ждущее и отклонённое — кандидатами. Идемпотентно. */
export async function migrateLegacy(data: Legacy, ctx: MigrateCtx = defaultCtx): Promise<{ facts: number; candidates: number }> {
  const at = new Date().toISOString();
  const w = await work();
  const have = new Set((await store.all<StoredCandidate>('candidates')).map((c) => c.id));
  const cands: StoredCandidate[] = [];
  let facts = 0;
  const addCand = (c: StoredCandidate) => { if (!have.has(c.id)) { have.add(c.id); cands.push(c); } };

  const ops = new Map<string, Promise<{ od: Awaited<ReturnType<MigrateCtx['operation']>>; T: Theatre | null }>>();
  const opData = (op: string) => {
    if (!ops.has(op)) ops.set(op, ctx.operation(op).catch(() => null).then((od) => ({ od, T: od?.theatre ? new Theatre(od.theatre) : null })));
    return ops.get(op)!;
  };

  /** Факты прежнего приёма (тот же документ и цитата) в записях. */
  const find = (pred: (f: Fact) => boolean) => {
    const out: { e: Entry; i: number; f: Fact }[] = [];
    for (const e of w.entries) (e.facts ?? []).forEach((f, i) => { if (pred(f)) out.push({ e, i, f }); });
    return out;
  };
  /** Дополнить прежний текстовый факт формальной частью; нет его — добавить в запись (если такого факта ещё нет). */
  const upgrade = (hits: { e: Entry; i: number; f: Fact }[], add: Fact, target: () => Entry | null) => {
    if (hits.some((h) => h.f.claim)) return;
    if (hits.length) {
      const { e, i, f } = hits[0];
      const fs = [...(e.facts ?? [])];
      fs[i] = { ...f, claim: add.claim, check: add.check, evidence: add.evidence };
      w.set({ ...e, facts: fs });
      facts++;
      return;
    }
    const e = target();
    if (!e) return;
    const cur = w.get(e.id) ?? e;
    if ((cur.facts ?? []).some((f) => f.claim && f.source === add.source && JSON.stringify(f.claim) === JSON.stringify(add.claim))) return;
    w.set({ ...cur, facts: [...(cur.facts ?? []), add] });
    facts++;
  };
  const base = (p: { id: string; doc: string; chunk: number; reliability: Fact['reliability']; operation: string; status: StoredCandidate['state'] }, quote: string) => ({
    source: `doc:${p.doc}`, pages: `часть ${p.chunk + 1}`, ...(p.reliability ? { reliability: p.reliability } : {}), origin: 'text' as const,
    evidence: quoteEv(p.doc, p.chunk, quote), op: p.operation, checks: [], verdict: 'review' as const, state: p.status,
  });

  for (const p of data.positions ?? []) {
    const { od, T } = await opData(p.operation);
    const r: PositionResolution = od ? resolvePosition(p, od.input, T, w.entries) : {};
    const claim = positionClaim(p, r);
    if (p.status === 'accepted') {
      if (!claim || !od) continue;
      const hits = find((f) => f.key === 'path' && f.source === `doc:${p.doc}` && f.quote === p.item.quote);
      const t = positionTarget(p, r, od.input);
      upgrade(hits, positionFact(p, r, at),
        () => (t.entry ? w.get(t.entry) ?? null : t.create ?? null));
      continue;
    }
    addCand({
      id: `v6:pos:${p.id}`, ...base(p, p.item.quote),
      claim: claim ?? { kind: 'position', subject: r.formation?.id ?? '', at: ISO_DAY.test(p.item.date ?? '') ? p.item.date : '', ...(p.item.place ? { place: p.item.place } : {}) },
      names: { subject: p.item.formation, ...(p.item.place ? { place: p.item.place } : {}) },
      key: 'положение', value: `${p.item.place} на ${p.item.date}`,
    });
  }

  for (const p of data.boundaries ?? []) {
    const { od, T } = await opData(p.operation);
    const r: BoundaryResolution = od ? resolveBoundary(p, od.input, T, w.entries) : { points: [], missing: [], entries: [] };
    const claim = boundaryClaim(p, r);
    const it = p.item;
    if (p.status === 'accepted') {
      if (!claim || !od) continue;
      const hits = find((f) => f.key === 'boundary' && f.source === `doc:${p.doc}` && f.quote === it.quote);
      const t = boundaryTargets(p, r, od.input, w.entries)[0];
      upgrade(hits, { key: 'boundary', value: boundaryText(it), quote: it.quote, source: `doc:${p.doc}`, pages: `часть ${p.chunk + 1}`, reliability: p.reliability, claim, check: human(at), evidence: quoteEv(p.doc, p.chunk, it.quote) },
        () => (t.entry ? w.get(t.entry) ?? null : t.create ?? null));
      continue;
    }
    addCand({
      id: `v6:bnd:${p.id}`, ...base(p, it.quote),
      claim: claim ?? { kind: 'boundary', between: [r.a?.id ?? '', r.b?.id ?? ''], from: ISO_DAY.test(it.date ?? '') ? it.date! : '', points: it.points, ...(it.inclusive ? { inclusive: it.inclusive } : {}) },
      names: it.between.length === 2 ? { between: [it.between[0], it.between[1]] } : {},
      key: 'линия', value: `${it.points.join(' — ')}${it.date ? `, с ${it.date}` : ''}`,
    });
  }

  for (const p of (data.infra ?? []).filter(isCrossing)) {
    const claim = crossingClaim(p.item);
    if (p.status === 'accepted') {
      if (!claim) continue;
      const id = `u:${p.operation}:infrastructure`;
      const hits = find((f) => f.source === `doc:${p.doc}` && f.quote === p.item.quote);
      const { od } = await opData(p.operation);
      upgrade(hits, { key: 'crossings', value: `${p.item.title}: ${claim.state === 'open' ? 'проходима' : claim.state === 'built' ? 'наведена' : 'разрушена'} с ${claim.from}`, quote: p.item.quote, source: `doc:${p.doc}`, reliability: p.reliability, claim, check: human(at), evidence: quoteEv(p.doc, p.chunk, p.item.quote) },
        () => w.get(id) ?? { id, category: 'terrain', group: 'rivers', title: `Состояние инфраструктуры: ${(od?.input.operation.title ?? p.operation).split(':')[0]}`, operations: [p.operation], rubrics: ['5.3', '5.2'], summary: 'Мосты, переправы, дороги и железные дороги операции — по документам и сведениям, принятым в разделе «Операции».', facts: [], status: 'extracted', origin: 'document' });
      continue;
    }
    // состояние, которое не читается как проходима / разрушена / наведена, — остаётся в прежней очереди
    if (!CROSSING_STATE[p.item.state]) continue;
    addCand({
      id: `v6:inf:${p.id}`, ...base(p, p.item.quote),
      claim: { kind: 'crossing', subject: p.item.title, from: ISO_DAY.test(p.item.date ?? '') ? p.item.date! : '', state: CROSSING_STATE[p.item.state]! },
      names: { subject: p.item.title, ...(p.item.place ? { place: p.item.place } : {}) },
      key: 'переправа', value: `${p.item.title}${p.item.date ? `, с ${p.item.date}` : ''}`,
    });
  }

  for (const p of data.proposals ?? []) {
    if (p.status === 'accepted') continue; // принятые уже в записях
    const c: TextCandidate = {
      id: `v6:prop:${p.id}`, names: { subject: p.entry.title }, key: p.kind === 'new' ? 'новая запись' : 'дополнение записи', value: p.entry.title,
      source: `doc:${p.doc}`, pages: `часть ${p.chunk + 1}`, ...(p.facts[0]?.reliability ? { reliability: p.facts[0].reliability } : {}), origin: 'text',
      evidence: quoteEv(p.doc, p.chunk, p.facts.find((f) => f.quote)?.quote ?? ''), ...(p.operation ? { op: p.operation } : {}),
      checks: [], verdict: 'review', state: p.status, proposal: p,
    };
    addCand(c);
  }

  await w.save();
  if (cands.length) await store.put('candidates', ...cands);
  return { facts, candidates: cands.length };
}

