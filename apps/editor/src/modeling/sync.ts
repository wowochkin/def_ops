/**
 * Связь базы знаний с данными операции: сверка со сценарием (в обе стороны) и положения из документов (в боевой
 * путь формирования в базе и в историю для сравнения расчёта). База знаний — общее место сведений: всё, что
 * принято в сценарий или историю, остаётся в ней с источником и цитатой; всё, чем уже пользуется расчёт, — тоже.
 */
import { ECHELON_KM, formationEntries, formationEntry, matchEntry, matchFormation, reconcile, type Fact, type PositionProposal, type SyncInput, type SyncItem } from '@def-ops/knowledge';
import { locatePlace, Theatre, type History, type Scenario, type TheatreData } from '@def-ops/sim';
import * as kb from '../kb/kb';
import { fullCatalog, getData, getEdits, updateEdits, type HistPosition } from '../sim/userdata';
import { resetPool } from './data';

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

/** Принять «в сценарий»: цифры формирования из базы — в правки операции (прежнее значение помнится). */
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

/** Куда ляжет положение: формирование сценария, пункт театра, запись базы. */
export function resolvePosition(p: PositionProposal, input: SyncInput, T: Theatre | null): PositionResolution {
  const entries = kb.current().entries;
  const fid = matchFormation(p.item.formation, input.formations, entries);
  const f = fid ? input.formations.find((x) => x.id === fid) : undefined;
  const pl = T ? locatePlace(T, p.item.place) : null;
  const entry = f ? formationEntries(entries, f)[0]?.id : matchEntry(entries, 'formations', p.item.formation, [])?.id;
  return { ...(f ? { formation: { id: f.id, name: f.name, echelon: f.echelon } } : {}), ...(pl ? { place: { title: pl.title, at: pl.at as [number, number], radiusKm: pl.radiusKm } } : {}), ...(entry ? { entry } : {}) };
}

/**
 * Принять положения: в базу — факт «боевой путь» записи формирования (с цитатой и документом); в историю
 * операции — положение для сравнения расчёта, если формирование и пункт нашлись.
 */
export async function acceptPositions(opId: string, ps: PositionProposal[], input: SyncInput, theatre: TheatreData | null) {
  const T = theatre ? new Theatre(theatre) : null;
  const add: { entry?: string; create?: ReturnType<typeof formationEntry>; facts: Fact[]; operation: string }[] = [];
  const hist: HistPosition[] = [];
  for (const p of ps) {
    const r = resolvePosition(p, input, T);
    const fact: Fact = { key: 'path', value: `${ddmm(p.item.date)} — ${p.item.place}${p.item.note ? ` (${p.item.note})` : ''}`, quote: p.item.quote, source: `doc:${p.doc}`, pages: `часть ${p.chunk + 1}`, reliability: p.reliability };
    const f = r.formation ? input.formations.find((x) => x.id === r.formation!.id) : undefined;
    add.push({
      entry: r.entry,
      create: r.entry ? undefined : f ? formationEntry(input.operation, f) : { ...formationEntry(input.operation, { id: `doc-${p.item.formation.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-')}`, name: p.item.formation, side: '', echelon: '' }), aliases: [], facts: [] },
      facts: [fact], operation: opId,
    });
    if (r.formation && r.place) {
      hist.push({ id: p.id, formation: r.formation.id, time: `${p.item.date}T12:00`, at: r.place.at, approxKm: Math.max(r.place.radiusKm, ECHELON_KM[r.formation.echelon] ?? 5), place: r.place.title, reliability: p.reliability, source: `${p.docName}, часть ${p.chunk + 1}`, quote: p.item.quote, doc: p.doc });
    }
  }
  await kb.addFacts(add);
  const at = new Date().toISOString();
  await updateEdits(opId, (e) => {
    e.positions = [...e.positions.filter((x) => !hist.some((h) => h.id === x.id)), ...hist];
    if (hist.length) e.log.push({ at, kind: 'history', text: `положений из документов: +${hist.length} (${[...new Set(hist.map((h) => input.formations.find((f) => f.id === h.formation)?.name ?? h.formation))].slice(0, 4).join(', ')})` });
    if (ps.length > hist.length) e.log.push({ at, kind: 'kb', text: `положений только в базу (формирование или пункт не найдены): ${ps.length - hist.length}` });
  });
  await kb.decidePositions(ps.map((p) => p.id), true);
  if (hist.length) resetPool();
  return { history: hist.length, kb: ps.length };
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

export const KEY_RU: Record<'personnel' | 'tanks' | 'guns', string> = { personnel: 'численность', tanks: 'танки и САУ', guns: 'орудия' };
export const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
