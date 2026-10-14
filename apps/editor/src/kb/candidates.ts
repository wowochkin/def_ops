/**
 * Кандидаты-факты в базе: приём в записи (автоматически по итогам проверок или человеком), очередь «На проверку»
 * (хранилище candidates), откат документа, исправление встроенных фактов. Проверки кандидат уже прошёл
 * (verdict задан потоком разбора); здесь — только маршрут и запись. Каждое изменение — событие «база изменилась»:
 * сборщик пересобирает операции (факты в модель идут только через compileOperation).
 */
import {
  applyProposal, dateOf, fingerprint, subjectOf, sameClaim, formationEntries, formationEntry, matchEntry, matchFormation, pinKey, scenarioIdOf,
  type Candidate, type Claim, type Entry, type Fact, type FactRef, type InfraProposal, type Pins, type Proposal, type Reliability,
} from '@def-ops/knowledge';
import { claimText } from '../modeling/basis';
import * as kb from './kb';
import * as store from './store';

/** Кандидат из прежней очереди записей (proposals): без формальной части, принимается как прежде (applyProposal). */
export type TextCandidate = Omit<Candidate, 'claim'> & { claim?: undefined; proposal: Proposal };
/**
 * Текстовый кандидат из предложения записи (новая запись или дополнение — принимается applyProposal). key и value —
 * для карточки очереди (по умолчанию — «новая запись» / «дополнение записи» и название записи).
 */
export function textCandidateOf(p: Proposal, o: { id: string; state: Candidate['state']; key?: string; value?: string }): TextCandidate {
  return {
    id: o.id, names: { subject: p.entry.title }, key: o.key ?? (p.kind === 'new' ? 'новая запись' : 'дополнение записи'), value: o.value ?? p.entry.title,
    source: `doc:${p.doc}`, pages: `часть ${p.chunk + 1}`, ...(p.facts[0]?.reliability ? { reliability: p.facts[0].reliability } : {}), origin: 'text',
    evidence: { kind: 'quote', doc: p.doc, chunk: p.chunk, quote: p.facts.find((f) => f.quote)?.quote ?? '' }, ...(p.operation ? { op: p.operation } : {}),
    checks: [], verdict: 'review', state: o.state, proposal: p,
  };
}

const ddmm = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

/**
 * Дорога, рубеж и прочая инфраструктура (не переправа) из документа операции → текстовый кандидат: принятие пишет
 * тот же факт, что прежде addInfraFact (запись «Состояние инфраструктуры» операции, ключ features, с цитатой и
 * источником). id — как у прежнего сведения: повторный разбор или перенос не задваивает. stateRu — состояния по-русски.
 */
export function infraTextCandidate(x: Pick<InfraProposal, 'id' | 'doc' | 'chunk' | 'item' | 'reliability' | 'status'>, op: { id: string; title: string }, stateRu: Record<string, string>): TextCandidate {
  const it = x.item;
  const id = `u:${op.id}:infrastructure`;
  const entry: Entry = {
    id, category: 'terrain', group: 'rivers', title: `Состояние инфраструктуры: ${op.title.split(':')[0]}`, operations: [op.id], rubrics: ['5.3', '5.2'],
    summary: 'Мосты, переправы, дороги и железные дороги операции — по документам и сведениям, принятым в разделе «Операции».', facts: [], status: 'extracted', origin: 'document',
  };
  const value = `${it.title}: ${stateRu[it.state] ?? it.state}${it.date ? ` с ${ddmm(it.date)}` : ''}${it.dateTo ? ` до ${ddmm(it.dateTo)}` : ''}${it.note ? ` (${it.note})` : ''}`;
  const p: Proposal = {
    id: x.id, doc: x.doc, chunk: x.chunk, kind: 'update', target: id, entry, relations: [], operation: op.id, status: x.status,
    facts: [{ key: 'features', value, quote: it.quote, source: `doc:${x.doc}`, reliability: x.reliability }],
  };
  return textCandidateOf(p, { id: x.id, state: x.status, key: 'инфраструктура', value });
}

/** Кандидат в хранилище: с формальной частью или текстовый; принятый — с адресом факта. */
export type StoredCandidate = (Candidate | TextCandidate) & { accepted?: { entry: string; index: number } };

/** Для приёма: формирования сценария операции (для новой записи), театр (координаты пункта положения). */
export interface AcceptCtx {
  formations: { id: string; name: string; side?: string; echelon?: string }[];
  theatre?: { locate(name: string): { at: [number, number] } | null };
}

const SUBJECT_MISSING = 'соединение не найдено: указать вручную или создать запись';

/** Отпечаток формальной части (как у проверки повтора). */
const claimFp = (c: Claim) => fingerprint({ key: '', value: '', claim: c });
/** Тот же факт: та же формальная часть (координаты, добавленные при приёме, не мешают) и тот же источник. */
const sameFact = (f: Fact, claim: Claim, source: string) => !!f.claim && f.source === source && sameClaim(claim, f.claim);
/** Ключ кандидата в очереди (повторная загрузка того же — не новый кандидат). */
const queueKey = (c: StoredCandidate) => JSON.stringify([c.claim ? claimFp(c.claim) : null, c.names, c.key, c.value, c.source]);
/** Кандидат отброшен как повтор (проверка duplicate). */
const isDuplicate = (c: Candidate) => c.checks.some((r) => r.check === 'duplicate' && r.level === 'fail');
const quoteOf = (c: Candidate) => ('quote' in c.evidence ? c.evidence.quote : undefined);

/** Рабочий набор записей: записи базы и изменённые (пишутся разом). */
export class Work {
  touched = new Map<string, Entry>();
  constructor(public entries: Entry[]) {}
  get(id: string): Entry | undefined { return this.touched.get(id) ?? this.entries.find((e) => e.id === id); }
  set(e: Entry) {
    const x: Entry = { ...e, origin: e.origin === 'seed' ? 'user' : e.origin ?? 'user', updatedAt: new Date().toISOString() };
    this.touched.set(e.id, x);
    if (!this.entries.some((y) => y.id === e.id)) this.entries = [...this.entries, x];
    else this.entries = this.entries.map((y) => (y.id === e.id ? x : y));
  }
  async save() { if (this.touched.size) await store.put('entries', ...this.touched.values()); }
}
export const work = async () => new Work(await store.entries());

/**
 * Запись для формирования по id сценария или по названию из источника. Прежний кандидат с id записи (f:su_1bf) —
 * та же запись (соединение в факте — её id сценария, см. subjectId).
 */
function formationTarget(id: string, name: string | undefined, op: string | undefined, w: Work, ctx: AcceptCtx): Entry | null {
  if (id) {
    const own = w.get(id);
    if (own) return own;
    const f = ctx.formations.find((x) => x.id === id);
    if (f) return formationEntries(w.entries, f)[0] ?? formationEntry({ id: op ?? 'general' }, { id: f.id, name: f.name, side: f.side ?? '', echelon: f.echelon ?? '' });
    const byAlias = w.entries.find((e) => e.category === 'formations' && (e.aliases ?? []).includes(id));
    if (byAlias) return byAlias;
  }
  return name ? matchEntry(w.entries, 'formations', name, []) : null;
}

/**
 * Запись операции по шаблону (переправы — «Состояние инфраструктуры», события — «Хронология»). Документ без
 * операции — общие записи (u:general:…): событие и переправа не о соединении, ждать «соединения» им незачем.
 */
function opEntry(op: string | undefined, kind: 'crossing' | 'event', w: Work): Entry {
  const o = op ?? 'general';
  const id = kind === 'crossing' ? `u:${o}:infrastructure` : `u:${o}:chronology`;
  const ops = op ? { operations: [op] } : {};
  return w.get(id) ?? (kind === 'crossing'
    ? { id, category: 'terrain', group: 'rivers', title: op ? `Состояние инфраструктуры: ${op}` : 'Состояние инфраструктуры (без операции)', ...ops, rubrics: ['5.3', '5.2'], summary: 'Мосты, переправы, дороги и железные дороги — по документам.', facts: [], status: 'extracted', origin: 'document' }
    : { id, category: 'chronology', group: 'other', title: op ? `События: ${op}` : 'События (без операции)', ...ops, summary: 'События по документам.', facts: [], status: 'extracted', origin: 'document' });
}

/** Соединение в факте — id сценария: прежний id записи (f:su_1bf) — её синоним-id сценария (нет — пусто). */
function subjectId(id: string, w: Work): string {
  if (!id) return id;
  const e = w.get(id);
  return e && e.category === 'formations' ? scenarioIdOf(e) : id;
}

/**
 * Куда ляжет факт кандидата; null — некуда (соединение не найдено). Пустой subject заполняется по названию; id записи
 * вместо id сценария (прежние кандидаты) — заменяется. Переправа — с названием из источника (subject — название).
 */
function targetOf(c: Candidate, w: Work, ctx: AcceptCtx): Entry | null {
  const cl = c.claim;
  if (cl.kind === 'event') return opEntry(c.op, 'event', w);
  // нормативы модели (значение правила, итог прогона): записи пока нет — приём в части 3, задача 3
  if (cl.kind === 'param' || cl.kind === 'outcome') return null;
  if (cl.kind === 'crossing') {
    if (!cl.subject.trim() && c.names.subject?.trim()) cl.subject = c.names.subject.trim();
    if (!cl.subject.trim()) return null;
    return c.op ? opEntry(c.op, 'crossing', w) : matchEntry(w.entries, 'terrain', cl.subject, []) ?? opEntry(undefined, 'crossing', w);
  }
  if (cl.kind === 'boundary') {
    let hit: Entry | null = null;
    for (const i of [0, 1]) {
      const e = formationTarget(cl.between[i], c.names.between?.[i], c.op, w, ctx);
      cl.between[i] = subjectId(cl.between[i], w);
      hit ??= e;
    }
    return hit;
  }
  if (!cl.subject && c.names.subject) {
    const id = matchFormation(c.names.subject, ctx.formations, w.entries);
    if (id) cl.subject = id;
  }
  const target = formationTarget(cl.subject, c.names.subject, c.op, w, ctx);
  cl.subject = subjectId(cl.subject, w);
  if (cl.kind === 'parent') cl.parent = subjectId(cl.parent, w);
  return target;
}

/** Факт из кандидата: текст, формальная часть, проверка (кто, когда, итоги), доказательство, исправляемый встроенный. */
function factOf(c: Candidate, by: 'auto' | 'human', ctx: AcceptCtx): Fact {
  let claim = c.claim;
  if (claim.kind === 'position' && !claim.lngLat && claim.place && ctx.theatre) {
    const at = ctx.theatre.locate(claim.place)?.at;
    if (at) claim = { ...claim, lngLat: at };
  }
  const quote = quoteOf(c);
  // переправа: в тексте факта — её название (прежние кандидаты писали только состояние и дату)
  const value = claim.kind === 'crossing' && claim.subject && !c.value.includes(claim.subject) ? `${claim.subject}: ${c.value}` : c.value;
  return {
    key: c.key, value, claim, source: c.source,
    ...(c.pages ? { pages: c.pages } : {}), ...(c.reliability ? { reliability: c.reliability } : {}), ...(quote ? { quote } : {}),
    check: { by, at: new Date().toISOString(), results: c.checks }, evidence: c.evidence,
    ...(c.corrects ? { corrects: c.corrects } : {}),
  };
}

type Placed = { entry: string; index: number; duplicate: boolean } | { pending: 'no-entry' };

/** Записать факт кандидата в рабочий набор: тот же факт уже в записи — его адрес (повтор). Кандидат не меняется. */
function place(c0: Candidate, by: 'auto' | 'human', ctx: AcceptCtx, w: Work, into?: string): Placed {
  // targetOf заполняет subject по названию — в копии формальной части
  const c: Candidate = { ...c0, claim: (c0.claim.kind === 'boundary' ? { ...c0.claim, between: [...c0.claim.between] } : { ...c0.claim }) as Claim };
  const found = targetOf(c, w, ctx);
  // into — запись, в которую человек добавляет факт («+ Факт» в карточке записи)
  const target = into ? w.get(into) ?? null : found;
  if (!target) return { pending: 'no-entry' };
  const facts = target.facts ?? [];
  const have = facts.findIndex((f) => sameFact(f, c.claim, c.source));
  if (have >= 0) return { entry: target.id, index: have, duplicate: true };
  const isNew = !w.get(target.id);
  w.set({ ...target, ...(c.op && !isNew ? { operations: [...new Set([...(target.operations ?? []), c.op])] } : {}), facts: [...facts, factOf(c, by, ctx)] });
  return { entry: target.id, index: facts.length, duplicate: false };
}

/** Перечитать базу (подписчики) и известить сборщик операций. */
const changed = () => kb.refresh();

/**
 * Принять кандидата: факт — в запись соединения (найденную по сопоставлению; нет записи, но соединение в сценарии —
 * создаётся). Соединение не найдено нигде — { pending: 'no-entry' } (кандидат ждёт в очереди).
 */
export async function acceptCandidate(c: Candidate, by: 'auto' | 'human', ctx: AcceptCtx, into?: string): Promise<{ entry: string; index: number } | { pending: 'no-entry' }> {
  const w = await work();
  const r = place(c, by, ctx, w, into);
  await w.save();
  if ('pending' in r) return r;
  if (!r.duplicate) await changed();
  return { entry: r.entry, index: r.index };
}

/** Кандидат в очередь с сомнением «соединение не найдено». */
const toQueue = (c: Candidate): StoredCandidate => ({
  ...c, verdict: 'review', state: 'pending',
  checks: c.checks.some((r) => r.check === 'subject' && r.level !== 'ok') ? c.checks : [...c.checks.filter((r) => r.check !== 'subject'), { check: 'subject', level: 'doubt', why: SUBJECT_MISSING }],
});

/**
 * Сохранить проверенных кандидатов: auto — в базу, review — в очередь, drop — в хранилище отклонёнными (итоги
 * документа с причинами). Повтор (тот же факт уже в базе или тот же кандидат уже в очереди, проверка duplicate) —
 * только в счётчике: повторная загрузка того же документа ничего не добавляет. Принятый автоматически, но без
 * записи соединения — в очередь (считается в review).
 */
export async function saveCandidates(list: Candidate[], ctx: AcceptCtx = { formations: [] }): Promise<{ auto: number; review: number; drop: number; duplicate: number }> {
  const n = { auto: 0, review: 0, drop: 0, duplicate: 0 };
  const w = await work();
  const queued = new Set((await store.all<StoredCandidate>('candidates')).map(queueKey));
  const put: StoredCandidate[] = [];
  const enqueue = (c: StoredCandidate, k: 'review' | 'drop') => {
    const key = queueKey(c);
    if (queued.has(key)) { n.duplicate++; return; }
    queued.add(key);
    put.push(c);
    n[k]++;
  };
  for (const c of list) {
    if (c.verdict === 'drop' && isDuplicate(c)) { n.duplicate++; continue; }
    if (c.verdict === 'auto') {
      const r = place(c, 'auto', ctx, w);
      if ('pending' in r) enqueue(toQueue(c), 'review');
      else if (r.duplicate) n.duplicate++;
      else n.auto++;
    } else enqueue({ ...c, state: c.verdict === 'review' ? 'pending' : 'rejected' }, c.verdict);
  }
  await w.save();
  if (put.length) await store.put('candidates', ...put);
  if (w.touched.size || put.length) await changed();
  return n;
}

/**
 * Решение человека по кандидатам очереди: принять (check.by = 'human', с правками из карточки) или отклонить.
 * Принятый без записи соединения остаётся в очереди (pending — его id). Текстовый кандидат (прежнее предложение
 * записи) принимается как прежде.
 */
export async function decideCandidates(ids: string[], accept: boolean, edits: Record<string, Partial<Candidate>> = {}, ctx: AcceptCtx = { formations: [] }): Promise<{ accepted: number; pending: string[] }> {
  const all = await store.all<StoredCandidate>('candidates');
  const list = all.filter((c) => ids.includes(c.id) && c.state === 'pending');
  const w = await work();
  const out: StoredCandidate[] = [];
  const pending: string[] = [];
  let accepted = 0;
  for (const c0 of list) {
    const e = edits[c0.id];
    const c = (e ? { ...c0, ...e, names: { ...c0.names, ...e.names } } : c0) as StoredCandidate;
    if (!accept) { out.push({ ...c, state: 'rejected' }); continue; }
    if ('proposal' in c && c.proposal) {
      const p = c.proposal;
      const key = p.kind === 'new' ? p.entry.id : p.target!;
      const cur = w.get(key);
      // факт с тем же ключом и значением уже в записи (принят прежде или вручную) — не задваивается
      const fresh = p.kind === 'update' ? { ...p, facts: p.facts.filter((f) => !(cur?.facts ?? []).some((g) => g.key === f.key && g.value === f.value)) } : p;
      w.set(applyProposal(fresh, cur));
      out.push({ ...c, state: 'accepted', proposal: { ...p, status: 'accepted' } });
      accepted++;
      continue;
    }
    const r = place(c as Candidate, 'human', ctx, w);
    if ('pending' in r) { pending.push(c.id); out.push(c); continue; }
    out.push({ ...c, state: 'accepted', accepted: { entry: r.entry, index: r.index } });
    accepted++;
  }
  await w.save();
  if (out.length) await store.put('candidates', ...out);
  if (out.length || w.touched.size) await changed();
  return { accepted, pending };
}

/**
 * Факт, введённый человеком вручную (переправа в «Материалах», «+ Факт» в записи): тем же путём, что кандидат из
 * очереди — принят человеком (check.by = 'human', итоги проверок 3–7 — в c.checks), в хранилище кандидатов с адресом
 * факта; записи соединения нет — ждёт в очереди. into — запись, в которую добавляется факт (иначе — по сопоставлению).
 */
export async function addManual(c: Candidate, ctx: AcceptCtx, into?: string): Promise<{ entry: string; index: number } | { pending: 'no-entry' }> {
  const r = await acceptCandidate(c, 'human', ctx, into);
  // ручной ввод — решение человека, а не итог проверок: verdict 'review' (как принятый из очереди), state 'accepted'
  await store.put('candidates', 'pending' in r ? toQueue(c) : { ...c, verdict: 'review', state: 'accepted', accepted: r } satisfies StoredCandidate);
  await changed();
  return r;
}

/** Документ факта: из доказательства, иначе из источника doc:… */
const docOf = (f: Fact): string | undefined =>
  (f.evidence && 'doc' in f.evidence ? f.evidence.doc : undefined) ?? (f.source?.startsWith('doc:') ? f.source.slice(4) : undefined);

/**
 * Откатить документ: принятые из него автоматически факты снимаются, принятые человеком остаются с пометкой
 * «документ откачен» (check.docRolledBack). Номера следующих фактов записи меняются — закрепления на них, прежние
 * значения в записях исправлений и адреса принятых кандидатов сдвигаются (как при удалении факта).
 */
export async function rollbackDocument(docId: string): Promise<{ removed: number; kept: number }> {
  let removed = 0, kept = 0;
  const w = await work();
  const cuts = new Map<string, { before: Fact[]; removed: Set<number> }>();
  for (const e of [...w.entries]) {
    let hit = false;
    const gone = new Set<number>();
    const facts: Fact[] = [];
    (e.facts ?? []).forEach((f, i) => {
      if (!f.check || docOf(f) !== docId) { facts.push(f); return; }
      hit = true;
      if (f.check.by === 'auto') { removed++; gone.add(i); return; }
      kept++;
      facts.push({ ...f, check: { ...f.check, docRolledBack: true } });
    });
    if (!hit) continue;
    w.set({ ...e, facts });
    if (gone.size) cuts.set(e.id, { before: e.facts ?? [], removed: gone });
  }
  if (!w.touched.size) return { removed, kept };
  const pins = await shiftAddresses(w, cuts, await store.pins());
  await w.save();
  if (Object.keys(pins).length) await store.putPins(pins);
  await shiftCandidates(cuts);
  await changed();
  return { removed, kept };
}

type Cuts = Map<string, { before: Fact[]; removed: Set<number> }>;
/** Новый номер факта записи после снятия (null — снят; запись не менялась или номера нет — тот же). */
function newIndex(cuts: Cuts, entry: string, index: number): number | null {
  const c = cuts.get(entry);
  if (!c || index >= c.before.length) return index;
  if (c.removed.has(index)) return null;
  let n = 0;
  for (const r of c.removed) if (r < index) n++;
  return index - n;
}
/** Закрепление после снятия фактов: на снятый — null, на следующий — с новым номером; на изменённый (отпечаток другой) — как было. */
function shiftPin(cuts: Cuts, p: PinVal | null): PinVal | null {
  if (!p || p === 'none' || !cuts.has(p.entry)) return p;
  const was = cuts.get(p.entry)!.before[p.index];
  if (p.fp != null && was && p.fp !== fingerprint(was)) return p;
  const ni = newIndex(cuts, p.entry, p.index);
  return ni === null ? null : ni === p.index ? p : { ...p, index: ni };
}

/**
 * Сдвиг после снятия фактов (cuts — запись → факты до снятия и снятые номера): закрепления из all (изменённые — в
 * ответе для putPins; over — уже вычисленные значения по ключам, их тоже сдвинуть) и прежние значения в записях
 * исправлений (correctionPins) — в рабочем наборе w.
 */
function shiftAddresses(w: Work, cuts: Cuts, all: Pins, over: Record<string, PinVal | null> = {}): Record<string, PinVal | null> {
  const out: Record<string, PinVal | null> = {};
  for (const [key, p] of Object.entries(over)) out[key] = shiftPin(cuts, p);
  for (const [key, p] of Object.entries(all)) {
    if (key in out) continue;
    const q = shiftPin(cuts, p);
    if (q !== p) out[key] = q;
  }
  for (const e of [...w.entries]) {
    let hit = false;
    const facts = (e.facts ?? []).map((f) => {
      if (!f.correctionPins?.some((r) => r.prev && r.prev !== 'none' && cuts.has(r.prev.entry))) return f;
      hit = true;
      return { ...f, correctionPins: f.correctionPins.map((r) => ({ ...r, prev: shiftPin(cuts, r.prev) })) };
    });
    if (hit) w.set({ ...e, facts });
  }
  return out;
}

/** Адреса принятых кандидатов после снятия фактов: снятый — без адреса, следующие — с новым номером. */
async function shiftCandidates(cuts: Cuts) {
  const cands = (await store.all<StoredCandidate>('candidates')).filter((c) => c.accepted && cuts.has(c.accepted.entry));
  const out: StoredCandidate[] = [];
  for (const c of cands) {
    const ni = newIndex(cuts, c.accepted!.entry, c.accepted!.index);
    if (ni === c.accepted!.index) continue;
    if (ni === null) { const { accepted: _a, ...rest } = c; out.push(rest); } else out.push({ ...c, accepted: { entry: c.accepted!.entry, index: ni } });
  }
  if (out.length) await store.put('candidates', ...out);
}

/** О ком факт (как в pinKey): subject, id события или пара объединений линии. */
/** Дата факта (как в resolve): у потерь — конец периода, иначе at или from. */

/** Ключ исправления: запись#номер встроенного факта и его отпечаток. */
export const correctsKey = (ref: Pick<FactRef, 'entry' | 'index' | 'fact'>) => `${ref.entry}#${ref.index}|${fingerprint(ref.fact)}`;
export const parseCorrects = (s: string): { entry: string; index: number; fp: string } | null => {
  const m = /^(.+?)#(\d+)\|([\s\S]*)$/.exec(s);
  return m ? { entry: m[1], index: Number(m[2]), fp: m[3] } : null;
};

/**
 * Закрепления исправления встроенного факта old по моментам, где встроенный выбирался, — его собственная дата и начала
 * операций (starts). Исправление того же вида и о том же — на само исправление (self; resolve при закреплении «не брать»
 * не берёт ничего, и исправление тоже не попало бы в модель); иначе, и на собственной дате встроенного, если у
 * исправления другая дата (там исправления нет среди кандидатов), — 'none'.
 */
function correctionPins(old: Claim, next: Claim, self: Pins[string], starts: string[] = []): Record<string, Pins[string]> {
  const same = next.kind === old.kind && subjectOf(next) === subjectOf(old);
  const pins: Record<string, Pins[string]> = {};
  pins[pinKey(old.kind, subjectOf(old), dateOf(old))] = same && dateOf(next) === dateOf(old) ? self : 'none';
  for (const s of starts) pins[pinKey(old.kind, subjectOf(old), s)] = same ? self : 'none';
  return pins;
}

type PinVal = Pins[string];
type PinRecord = NonNullable<Fact['correctionPins']>;

/** Записать закрепления исправления: прежние значения по ключам (cur — нынешние закрепления) — в запись для отката. */
function recordPins(write: Record<string, PinVal>, cur: Record<string, PinVal | null | undefined>): PinRecord {
  return Object.keys(write).map((key) => ({ key, prev: cur[key] ?? null }));
}

/**
 * Откат закреплений исправления: записанные ключи — к прежним значениям, но только где закрепление всё ещё то, что
 * записало исправление ('none' или само исправление — self); выбор человека, сделанный позже, остаётся. kept — ключи,
 * где остался выбор человека.
 */
function restorePins(rec: PinRecord, cur: Pins, self: { entry: string; index: number; fp: string }): { pins: Record<string, PinVal | null>; kept: Set<string> } {
  const pins: Record<string, PinVal | null> = {};
  const kept = new Set<string>();
  for (const r of rec) {
    const p = cur[r.key];
    if (p === 'none' || (p && pinAt(p, self.entry, self.index) && (p.fp == null || p.fp === self.fp))) pins[r.key] = r.prev;
    else kept.add(r.key);
  }
  return { pins, kept };
}

/**
 * Прежнее исправление без записи закреплений: ключи встроенного — его дата, переданные starts и все начала операций
 * каталога (allStarts) не раньше его даты; снимаются 'none' и закрепления на само исправление.
 */
function legacyCleanup(builtin: Claim, starts: string[], allStarts: string[], all: Pins, entry: string, index: number): Record<string, PinVal | null> {
  const from = dateOf(builtin);
  const keys = Object.keys(correctionPins(builtin, builtin, 'none', [...starts, ...allStarts.filter((s) => s >= from)]));
  const out: Record<string, PinVal | null> = {};
  for (const key of keys) { const p = all[key]; if (p === 'none' || (p && pinAt(p, entry, index))) out[key] = null; }
  return out;
}

/**
 * Исправить встроенный факт: факт пользователя в той же записи (с источником и пометкой corrects) и закрепления
 * встроенного по моментам, где он выбирался (correctionPins; meta.starts — начала операций, на которые факт влияет).
 * Записанные ключи и прежние значения по ним — в факте (correctionPins): удаление и правка исправления откатывают ровно их.
 */
export async function correctBuiltin(ref: FactRef, next: Claim, meta: { source: string; pages?: string; reliability?: Reliability; note?: string; starts?: string[] }): Promise<void> {
  const old = ref.fact.claim;
  const w = await work();
  const e = w.get(ref.entry);
  if (!e || !old) throw new Error('встроенный факт не найден');
  const index = (e.facts ?? []).length;
  const fact: Fact = {
    key: ref.fact.key, value: claimText(next), claim: next, source: meta.source,
    ...(meta.pages ? { pages: meta.pages } : {}), ...(meta.reliability ? { reliability: meta.reliability } : {}),
    check: { by: 'human', at: new Date().toISOString(), results: [] }, evidence: { kind: 'manual', ...(meta.note ? { note: meta.note } : {}) },
    corrects: correctsKey(ref),
  };
  const write = correctionPins(old, next, { entry: ref.entry, index, fp: fingerprint(fact) }, meta.starts);
  fact.correctionPins = recordPins(write, await store.pins());
  w.set({ ...e, facts: [...(e.facts ?? []), fact] });
  await w.save();
  await store.putPins(write);
  await changed();
}

/** Встроенный факт, который исправляет факт с corrects (по сиду; нет — null). */
async function correctedBuiltin(corrects: string): Promise<Fact | null> {
  const k = parseCorrects(corrects);
  if (!k) return null;
  return (await store.seed()).find((e) => e.id === k.entry)?.facts?.[k.index] ?? null;
}

const pinAt = (p: PinVal, entry: string, index: number): p is { entry: string; index: number; fp?: string } => p !== 'none' && p.entry === entry && p.index === index;

/** Встроенный факт (тот же на том же месте записи сида, без отметки проверки) не правится и не удаляется — только «исправить». */
async function refuseBuiltin(entryId: string, index: number, f: Fact) {
  const b = (await store.seed()).find((e) => e.id === entryId)?.facts?.[index];
  if (b && !f.check && fingerprint(b) === fingerprint(f)) throw new Error('встроенный факт не правится и не удаляется — используйте «исправить»');
}

/** Для правки и удаления исправления: starts — моменты встроенного; allStarts — начала всех операций каталога (прежние исправления без записи). */
export interface FactEditOpts { starts?: string[]; allStarts?: string[] }

/**
 * Изменить свой факт (запись, номер): факт заменяется (проверено человеком), закрепления на него переводятся на
 * новый отпечаток — если вид и соединение ключа не изменились; иначе снимаются. Исправление встроенного: сначала
 * откат его закреплений (по записи correctionPins; прежнее без записи — legacyCleanup), затем закрепление заново, как
 * при «исправить» (correctionPins с теми же starts) — иначе закрепление стало бы «закреплённый факт удалён», и
 * встроенный снова мог бы выиграть.
 */
export async function editFact(entryId: string, index: number, next: Fact, o: FactEditOpts = {}): Promise<void> {
  const w = await work();
  const e = w.get(entryId);
  const old = e?.facts?.[index];
  if (!e || !old) throw new Error('факт не найден');
  await refuseBuiltin(entryId, index, old);
  const { correctionPins: _rec, ...rest } = next;
  const fact: Fact = { ...rest, check: { ...next.check, by: 'human', at: new Date().toISOString(), results: next.check?.results ?? [] }, ...(old.corrects ? { corrects: old.corrects } : {}) };
  const fpOld = fingerprint(old), self = { entry: entryId, index, fp: fingerprint(fact) };
  const all = await store.pins();
  const b = old.corrects ? await correctedBuiltin(old.corrects) : null;
  // 1) откат закреплений исправления (кроме ключей, где человек позже выбрал другое)
  const restored = old.correctionPins ? restorePins(old.correctionPins, all, { entry: entryId, index, fp: fpOld }) : null;
  const pins: Record<string, PinVal | null> = restored ? restored.pins
    : b?.claim ? legacyCleanup(b.claim, o.starts ?? [], o.allStarts ?? [], all, entryId, index) : {};
  // 2) прочие закрепления на изменяемый факт (выбор человека в «Расхождениях»)
  for (const [key, p] of Object.entries(all)) {
    if (key in pins || !pinAt(p, entryId, index) || (p.fp != null && p.fp !== fpOld)) continue;
    const parts = key.split('|');
    const same = !!fact.claim && parts[0] === fact.claim.kind && parts.slice(1, -1).join('|') === subjectOf(fact.claim);
    pins[key] = same ? self : null;
  }
  // 3) исправление — закрепить заново, с записью прежних значений (после отката)
  if (b?.claim && fact.claim) {
    const write = correctionPins(b.claim, fact.claim, self, o.starts);
    for (const key of restored?.kept ?? []) delete write[key];
    const cur: Record<string, PinVal | null | undefined> = { ...all, ...pins };
    fact.correctionPins = recordPins(write, cur);
    Object.assign(pins, write);
  }
  w.set({ ...e, facts: (e.facts ?? []).map((f, i) => (i === index ? fact : f)) });
  await w.save();
  if (Object.keys(pins).length) await store.putPins(pins);
  await changed();
}

/**
 * Удалить свой факт (запись, номер). Закрепления на него снимаются, на следующие факты записи — сдвигаются на номер
 * назад (номера поменялись, отпечатки — нет). Исправление встроенного откатывает свои закрепления: ровно записанные
 * ключи к прежним значениям (сознательное «не брать» части 1 возвращается); прежнее без записи — legacyCleanup
 * (starts и все начала операций каталога не раньше даты встроенного). Адреса принятых кандидатов — сдвигаются.
 */
export async function deleteFact(entryId: string, index: number, o: FactEditOpts = {}): Promise<void> {
  const w = await work();
  const e = w.get(entryId);
  const facts = e?.facts ?? [];
  const old = facts[index];
  if (!e || !old) throw new Error('факт не найден');
  await refuseBuiltin(entryId, index, old);
  const all = await store.pins();
  const b = old.corrects && !old.correctionPins ? await correctedBuiltin(old.corrects) : null;
  // откат закреплений исправления (кроме ключей, где человек позже выбрал другое)
  const restored = old.correctionPins ? restorePins(old.correctionPins, all, { entry: entryId, index, fp: fingerprint(old) }).pins
    : b?.claim ? legacyCleanup(b.claim, o.starts ?? [], o.allStarts ?? [], all, entryId, index) : {};
  w.set({ ...e, facts: facts.filter((_, i) => i !== index) });
  // номера фактов после удаляемого — на один назад: закрепления (и прежние значения, к которым откатываемся), записи исправлений, кандидаты
  const cuts: Cuts = new Map([[entryId, { before: facts, removed: new Set([index]) }]]);
  const pins = shiftAddresses(w, cuts, all, restored);
  await w.save();
  if (Object.keys(pins).length) await store.putPins(pins);
  await shiftCandidates(cuts);
  await changed();
}

/**
 * Исправления, у которых встроенный факт изменился (отпечаток не совпал, факта нет): адрес исправления. builtin —
 * встроенные записи (сид; нет — те же entries).
 */
export function staleCorrections(entries: Entry[], builtin: Entry[] = entries): { entry: string; index: number }[] {
  const byId = new Map(builtin.map((e) => [e.id, e]));
  const out: { entry: string; index: number }[] = [];
  for (const e of entries) (e.facts ?? []).forEach((f, index) => {
    if (!f.corrects) return;
    const k = parseCorrects(f.corrects);
    const b = k ? byId.get(k.entry)?.facts?.[k.index] : undefined;
    if (!k || !b || fingerprint(b) !== k.fp) out.push({ entry: e.id, index });
  });
  return out;
}

/** Устаревшие исправления по нынешней базе: записи пользователя поверх сида против сида. */
export async function staleNow(): Promise<{ entry: string; index: number }[]> {
  const [entries, seed] = await Promise.all([store.entries(), store.seed()]);
  return staleCorrections(entries, seed);
}
