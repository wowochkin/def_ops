/**
 * Связь базы знаний с данными операции: сверка со сценарием (в обе стороны) и положения из документов (в боевой
 * путь формирования в базе и в историю для сравнения расчёта). База знаний — общее место сведений: всё, что
 * принято в сценарий или историю, остаётся в ней с источником и цитатой; всё, чем уже пользуется расчёт, — тоже.
 */
import { ECHELON_KM, formationEntries, formationEntry, matchEntry, matchFormation, reconcile, type BoundaryProposal, type Claim, type Entry, type Fact, type PositionProposal, type SyncInput, type SyncItem } from '@def-ops/knowledge';
import { locatePlace, Theatre, type Boundary, type History, type Scenario } from '@def-ops/sim';
import * as kb from '../kb/kb';
import { fullCatalog, getData, getEdits, updateEdits } from '../sim/userdata';
import { resetPool } from './data';
import { locatePoints, orientBoundary } from '../sim/kb-compile';

const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Данные операции для сверки: действующие формирования (с правками), положения по дням из истории. */
export async function syncInput(opId: string): Promise<SyncInput & { scenario: Scenario; history: History }> {
  const sc = (await getData('scenarios', `${opId}.json`)) as Scenario;
  const hist = (await getData('scenarios', `${opId}.history.json`)) as History;
  const title = (await fullCatalog(true)).find((c) => c.id === opId)?.title ?? sc.name;
  const byId = new Map(sc.formations.map((f) => [f.id, f]));
  return {
    scenario: sc, history: hist,
    operation: { id: opId, title, start: sc.start, end: sc.end },
    formations: sc.formations.filter((f) => f.type).map((f) => ({
      id: f.id, name: f.name, side: f.side, echelon: f.echelon, parent: f.parent ?? null, parentName: f.parent ? byId.get(f.parent)?.name : undefined,
      personnel: f.personnel, tanks: f.tanks, guns: f.guns, note: f.note,
      positions: (hist.positions ?? []).filter((p) => p.formation === f.id).map((p) => ({ time: p.time, place: p.place, source: p.source, reliability: p.reliability })),
    })),
  };
}

/** Предложения сверки (без отклонённых). */
export async function syncItems(opId: string): Promise<{ items: SyncItem[]; input: SyncInput }> {
  await kb.load();
  const [input, edits] = await Promise.all([syncInput(opId), getEdits(opId)]);
  const off = new Set(edits.dismissed);
  return { items: reconcile(input, kb.current().entries).filter((i) => !off.has(i.id)), input };
}

/**
 * Принять «в сценарий»: цифры формирования из базы — в правки операции (прежнее значение помнится). Факты с формальной
 * частью сверка не предлагает — они идут в модель через сборку (sim/kb-recompile.ts), там выбор закрепляется.
 */
export async function acceptToScenario(opId: string, items: SyncItem[]) {
  const list = items.filter((i) => i.dir === 'toScenario' && i.value != null && (i.key === 'personnel' || i.key === 'tanks' || i.key === 'guns'));
  if (!list.length) return;
  const at = new Date().toISOString();
  await updateEdits(opId, (e) => {
    for (const i of list) {
      const k = i.key as 'personnel' | 'tanks' | 'guns';
      const was = e.formations[i.formation]?.[k]?.was ?? (i.scenario as number);
      e.formations[i.formation] = { ...e.formations[i.formation], [k]: { value: i.value!, was, source: `${i.how}; ${i.fact?.value ?? ''}`.slice(0, 300), at } };
      e.log.push({ at, kind: 'scenario', text: `${i.name}: ${KEY_RU[k]} ${fmt(i.scenario as number)} → ${fmt(i.value!)} (из базы)` });
    }
  });
  resetPool();
}

/** Вернуть цифру сценария к исходной. */
export async function revertScenario(opId: string, formation: string, key: 'personnel' | 'tanks' | 'guns', name: string) {
  await updateEdits(opId, (e) => {
    const p = e.formations[formation];
    if (!p?.[key]) return;
    e.log.push({ at: new Date().toISOString(), kind: 'scenario', text: `${name}: ${KEY_RU[key]} — возврат к ${fmt(p[key]!.was)}` });
    delete p[key];
    if (!Object.keys(p).length) delete e.formations[formation];
  });
  resetPool();
}

/** Принять «в базу»: сведения сценария — фактами записей формирований (нет записи — создаётся). */
export async function acceptToKb(opId: string, items: SyncItem[], input: SyncInput) {
  const list = items.filter((i) => i.dir === 'toKb' && i.facts?.length);
  if (!list.length) return 0;
  const fs = new Map(input.formations.map((f) => [f.id, f]));
  const n = await kb.addFacts(list.map((i) => ({ entry: i.entry, create: i.entry ? undefined : formationEntry(input.operation, fs.get(i.formation)!), facts: i.facts!, operation: opId })));
  await updateEdits(opId, (e) => { e.log.push({ at: new Date().toISOString(), kind: 'kb', text: `в базу из сценария: ${list.length} сведений (${n} записей)` }); });
  return n;
}

export async function dismiss(opId: string, ids: string[]) {
  await updateEdits(opId, (e) => { e.dismissed = [...new Set([...e.dismissed, ...ids])]; });
}

/* ───────────── положения из документов ───────────── */

export interface PositionResolution {
  /** Формирование сценария (нет — только в базу). */
  formation?: { id: string; name: string; echelon: string };
  /** Пункт театра (нет — только в базу). */
  place?: { title: string; at: [number, number]; radiusKm: number };
  /** Запись базы, куда ляжет боевой путь. */
  entry?: string;
}

/** Куда ляжет положение: формирование сценария, пункт театра, запись базы (entries — записи базы; нет — нынешние). */
export function resolvePosition(p: PositionProposal, input: SyncInput, T: Theatre | null, entries: Entry[] = kb.current().entries): PositionResolution {
  const fid = matchFormation(p.item.formation, input.formations, entries);
  const f = fid ? input.formations.find((x) => x.id === fid) : undefined;
  const pl = T ? locatePlace(T, p.item.place) : null;
  const entry = f ? formationEntries(entries, f)[0]?.id : matchEntry(entries, 'formations', p.item.formation, [])?.id;
  return { ...(f ? { formation: { id: f.id, name: f.name, echelon: f.echelon } } : {}), ...(pl ? { place: { title: pl.title, at: pl.at as [number, number], radiusKm: pl.radiusKm } } : {}), ...(entry ? { entry } : {}) };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Положение из документа → формальная часть: нужны формирование сценария, пункт театра и дата; иначе null (останется текстом). */
export function positionClaim(p: PositionProposal, r: PositionResolution): Extract<Claim, { kind: 'position' }> | null {
  if (!r.formation || !r.place || !ISO_DAY.test(p.item.date ?? '')) return null;
  return { kind: 'position', subject: r.formation.id, at: p.item.date, place: r.place.title, lngLat: r.place.at, uncertaintyKm: Math.max(r.place.radiusKm, ECHELON_KM[r.formation.echelon] ?? 5) };
}

/** Факт положения из документа: текст (как прежде) и, если собирается, формальная часть с проверкой человеком. */
export function positionFact(p: PositionProposal, r: PositionResolution, at = new Date().toISOString()): Fact {
  const claim = positionClaim(p, r);
  return {
    key: 'path', value: `${ddmm(p.item.date)} — ${p.item.place}${p.item.note ? ` (${p.item.note})` : ''}`, quote: p.item.quote, source: `doc:${p.doc}`, pages: `часть ${p.chunk + 1}`, reliability: p.reliability,
    ...(claim ? { claim, check: { by: 'human' as const, at, results: [] }, evidence: { kind: 'quote' as const, doc: p.doc, chunk: p.chunk, quote: p.item.quote } } : {}),
  };
}

/** Запись для положения: найденная, иначе новая (формирования сценария или по названию из документа). */
export function positionTarget(p: PositionProposal, r: PositionResolution, input: SyncInput): { entry?: string; create?: Entry } {
  const f = r.formation ? input.formations.find((x) => x.id === r.formation!.id) : undefined;
  return {
    entry: r.entry,
    create: r.entry ? undefined : f ? formationEntry(input.operation, f) : { ...formationEntry(input.operation, { id: `doc-${p.item.formation.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-')}`, name: p.item.formation, side: '', echelon: '' }), aliases: [], facts: [] },
  };
}

/** Убрать положение из истории (в базе знаний факт остаётся). */
export async function removePosition(opId: string, id: string) {
  await updateEdits(opId, (e) => {
    const p = e.positions.find((x) => x.id === id);
    e.positions = e.positions.filter((x) => x.id !== id);
    if (p) e.log.push({ at: new Date().toISOString(), kind: 'history', text: `положение убрано из истории: ${p.formation} ${ddmm(p.time)} ${p.place}` });
  });
  resetPool();
}

/* ───────────── разграничительные линии из документов ───────────── */

export interface BoundaryResolution {
  /** Объединения сценария (нет — только в базу). */
  a?: { id: string; name: string }; b?: { id: string; name: string };
  /** Пункты, найденные на театре (по порядку), и не найденные. */
  points: { name: string; title: string; at: [number, number] }[];
  missing: string[];
  /** Линия для сценария: кто справа и слева по ходу линии (по положению войск объединений в начале операции). */
  boundary?: Boundary;
  /** Записи базы объединений. */
  entries: string[];
}

/** Куда ляжет линия: объединения сценария, пункты театра, стороны линии. */
export function resolveBoundary(p: BoundaryProposal, input: SyncInput & { scenario: Scenario }, T: Theatre | null, entries: Entry[] = kb.current().entries): BoundaryResolution {
  // объединения — все формирования сценария, включая фронты (у них нет типа и положения)
  const fs = input.scenario.formations.map((x) => ({ id: x.id, name: x.name, side: x.side, echelon: x.echelon }));
  const ids = p.item.between.map((n) => matchFormation(n, fs, entries));
  const f = ids.map((id) => (id ? fs.find((x) => x.id === id) : undefined));
  const { points, missing } = locatePoints(T, p.item.points);
  const ents = f.flatMap((x, i) => (x ? formationEntries(entries, x).slice(0, 1).map((e) => e.id) : [matchEntry(entries, 'formations', p.item.between[i], [])?.id].filter(Boolean) as string[]));
  const out: BoundaryResolution = { points, missing, entries: ents, ...(f[0] ? { a: { id: f[0].id, name: f[0].name } } : {}), ...(f[1] ? { b: { id: f[1].id, name: f[1].name } } : {}) };
  if (!T || !f[0] || !f[1] || f[0].id === f[1].id || points.length < 2) return out;
  const o = orientBoundary(input.scenario, T, f[0].id, f[1].id, points.map((x) => x.at));
  if (!o) return out;
  const right = o.right === f[0].id ? f[0] : f[1], left = o.right === f[0].id ? f[1] : f[0];
  const incl = p.item.inclusive ? matchFormation(p.item.inclusive, fs, entries) : null;
  out.boundary = {
    id: `doc-${p.id.replace(/[^a-z0-9]/gi, '-')}`, kind: input.scenario.formations.find((x) => x.id === right.id)?.echelon === 'army' ? 'army' : 'front', side: input.scenario.formations.find((x) => x.id === right.id)?.side ?? '',
    right: right.id, left: left.id, title: `${right.name} / ${left.name}${p.item.date ? ` с ${ddmm(p.item.date)}` : ''}`,
    from: p.item.date ? `${p.item.date}T00:00` : input.scenario.start, until: p.item.dateTo ? `${p.item.dateTo}T00:00` : null,
    line: points.map((x) => x.at), places: points.map((x) => x.title), inclusive: incl,
    note: [p.item.note, missing.length ? `не найдены на театре: ${missing.join(', ')}` : ''].filter(Boolean).join('; '),
    source: `${p.docName}, часть ${p.chunk + 1}`, reliability: p.reliability,
  };
  return out;
}

/** Линия из документа → формальная часть: нужны оба объединения сценария, дата и хотя бы два пункта на театре; иначе null. */
export function boundaryClaim(p: BoundaryProposal, r: BoundaryResolution): Extract<Claim, { kind: 'boundary' }> | null {
  const it = p.item;
  if (!r.a || !r.b || r.a.id === r.b.id || !ISO_DAY.test(it.date ?? '') || r.points.length < 2) return null;
  return { kind: 'boundary', between: [r.a.id, r.b.id], from: it.date!, ...(it.dateTo && ISO_DAY.test(it.dateTo) ? { to: it.dateTo } : {}), points: it.points, ...(it.inclusive ? { inclusive: it.inclusive } : {}) };
}

/** Текст факта линии (как прежде). */
export const boundaryText = (it: BoundaryProposal['item']) =>
  `${it.between.join(' / ')}${it.date ? ` с ${ddmm(it.date)}` : ''}${it.dateTo ? ` до ${ddmm(it.dateTo)}` : ''}: ${it.points.join(' — ')}${it.inclusive ? ` (пункты включительно — для: ${it.inclusive})` : ''}${it.note ? `; ${it.note}` : ''}`;

/** Записи обоих объединений линии: найденная или новая. */
export function boundaryTargets(p: BoundaryProposal, r: BoundaryResolution, input: SyncInput & { scenario: Scenario }, entries: Entry[] = kb.current().entries): { entry?: string; create?: Entry }[] {
  const it = p.item;
  return [r.a, r.b].map((g, k) => {
    const d = g ? input.scenario.formations.find((x) => x.id === g.id) : undefined;
    const fm = d ? { id: d.id, name: d.name, side: d.side, echelon: d.echelon } : undefined;
    const entry = fm ? formationEntries(entries, fm)[0]?.id : matchEntry(entries, 'formations', it.between[k], [])?.id;
    return { entry, create: entry ? undefined : fm ? formationEntry(input.operation, fm) : { ...formationEntry(input.operation, { id: `doc-${it.between[k].toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-')}`, name: it.between[k], side: '', echelon: '' }), aliases: [], facts: [] } };
  });
}

/** Убрать линию из сценария операции (в базе знаний факт остаётся). */
export async function removeBoundary(opId: string, id: string) {
  await updateEdits(opId, (e) => {
    const b = (e.boundaries ?? []).find((x) => x.id === id);
    e.boundaries = (e.boundaries ?? []).filter((x) => x.id !== id);
    if (b) e.log.push({ at: new Date().toISOString(), kind: 'scenario', text: `разграничительная линия убрана: ${b.title}` });
  });
  resetPool();
}

export const KEY_RU: Record<'personnel' | 'tanks' | 'guns', string> = { personnel: 'численность', tanks: 'танки и САУ', guns: 'орудия' };
export const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
