/**
 * Полнота материалов операции: из данных операции (сценарий, история, театр) — что должно быть в базе знаний
 * (формирования, ключевые пункты, рубежи, реки, события), оценка по каркасу — по записям базы.
 */
import { assessCoverage, type Coverage, type CoverageInput } from '@def-ops/knowledge';
import { areaOriginal, areaTitle, type History, type LiveSetup, type Scenario, type TheatreData } from '@def-ops/sim';
import { fullCatalog, getData, getInfra, liveOf, sectorsOf } from '../sim/userdata';
import normsFile from '../../../../packages/sim/data/rules/norms.json';
import * as kb from './kb';

const SECTORS = import.meta.glob('../../../../packages/sim/data/scenarios/*.sectors.json', { import: 'default' });
type LL = [number, number];
const center = (ring: LL[]): LL => [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
const LIVE = import.meta.glob('../../../../services/staff/live/*.json', { import: 'default' });
const variants = (title: string) => [title, ...title.split(/[()]/).map((x) => x.trim()).filter(Boolean)].filter((v, i, a) => a.indexOf(v) === i);

export async function coverageInput(opId: string): Promise<CoverageInput> {
  const sc = (await getData('scenarios', `${opId}.json`)) as Scenario;
  const hist = (await getData('scenarios', `${opId}.history.json`)) as History;
  const T = (await getData('theatres', `${sc.theatre}.json`)) as TheatreData;
  const title = (await fullCatalog(true)).find((c) => c.id === opId)?.title ?? sc.name;
  const live = (await liveOf(opId)) ?? ((await LIVE[`../../../../services/staff/live/${opId}.json`]?.()) as LiveSetup | undefined);
  const areas = new Map(T.areas.map((a) => [a.id, a]));
  const places = new Map<string, { id: string; names: string[]; why: string; at?: LL }>();
  const addPlace = (id: string | undefined, why: string) => {
    const a = id ? areas.get(id) : undefined;
    if (!a) return;
    const cur = places.get(a.id);
    if (cur) { if (!cur.why.includes(why)) cur.why += `, ${why}`; return; }
    places.set(a.id, { id: a.id, names: [...variants(areaTitle(a.name)), areaOriginal(a.name)], why, at: center(a.ring as LL[]) });
  };
  const placeOf = (e: unknown) => (e as { place?: string }).place;
  for (const e of hist.events ?? []) addPlace(placeOf(e), 'место события');
  if (live?.anchor) addPlace(live.anchor, 'опорный пункт');
  // цели приказов — главные: на которые нацелено больше всего приказов (не каждый ориентир)
  const freq = new Map<string, number>();
  for (const o of sc.orders) if (typeof o.target === 'string' && areas.has(o.target)) freq.set(o.target, (freq.get(o.target) ?? 0) + 1);
  for (const [id] of [...freq].sort((a, b) => b[1] - a[1]).slice(0, 15)) addPlace(id, `цель приказов (${freq.get(id)})`);
  // район действий: охват положений формирований
  const pos = sc.formations.filter((f) => f.position).map((f) => f.position!);
  const [w, s, e, n] = pos.length ? [Math.min(...pos.map((p) => p[0])), Math.min(...pos.map((p) => p[1])), Math.max(...pos.map((p) => p[0])), Math.max(...pos.map((p) => p[1]))] : T.bbox;
  const inArea = (l: [number, number][]) => l.some((p) => p[0] >= w - 0.2 && p[0] <= e + 0.2 && p[1] >= s - 0.1 && p[1] <= n + 0.1);
  const rivers = [...new Set(T.rivers.filter((r) => r.major && r.name && inArea(r.line)).map((r) => r.name))];
  const RU: Record<string, string> = { Oder: 'Одер', Spree: 'Шпрее', Havel: 'Хафель', Elbe: 'Эльба', 'Neiße': 'Нейсе', Neisse: 'Нейсе', 'Wisła': 'Висла', Warthe: 'Варта', Pilica: 'Пилица', Narew: 'Нарев', Bzura: 'Бзура', Dahme: 'Даме', Landwehrkanal: 'Ландвер-канал', Teltowkanal: 'Тельтов-канал' };
  // участки (сражения и бои): встроенные — из сборки, свои — из пакета операции
  const sectors = ((await SECTORS[`../../../../packages/sim/data/scenarios/${opId}.sectors.json`]?.()) as { sectors: { id: string; title: string; bbox: [number, number, number, number] }[] } | undefined)?.sectors ?? (await sectorsOf(opId));
  // мосты на больших реках района: состояние известно — дата разрушения или наводки в театре, или сведение операции
  const infra = await getInfra(opId);
  const majors = new Set(T.rivers.filter((r) => r.major && inArea(r.line)).map((r) => r.name));
  const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  const bridges = T.bridges.filter((b) => { const r = (b as { river?: string }).river; return (!r || majors.has(r)) && inArea([b.at as LL]); }).map((b) => {
    const rec = infra.find((x) => x.bridge === b.id);
    const how = b.destroyedAt ? `разрушен ${ddmm(b.destroyedAt)}` : b.openFrom ? `наведён ${ddmm(b.openFrom)}` : rec ? `сведение: ${rec.title}` : undefined;
    return { id: b.id, name: b.name ?? b.id, river: (b as { river?: string }).river, known: !!how, how, at: b.at as LL };
  });
  // положения по дням в истории
  const total = Math.max(1, Math.round((Date.parse(`${sc.end}Z`) - Date.parse(`${sc.start}Z`)) / 864e5));
  const daysBy = new Map<string, Set<string>>();
  for (const p of hist.positions ?? []) { const l = daysBy.get(p.formation) ?? new Set<string>(); l.add(p.time.slice(0, 10)); daysBy.set(p.formation, l); }
  const norms = ((normsFile as unknown as { norms: { id: string; title: string; kb?: string; source?: string; reliability?: string; measure?: { scenario?: string } }[] }).norms ?? []).filter((x) => x.measure?.scenario === opId);
  await kb.load();
  const documents = kb.current().documents.filter((d) => d.operation === opId).map((d) => ({ id: d.id, name: d.name, reliability: d.reliability }));
  return {
    operation: { id: opId, title, start: sc.start, end: sc.end },
    sides: sc.sides.map((x) => ({ id: x.id, name: ({ su: 'СССР', de: 'Германия' } as Record<string, string>)[x.id] ?? x.name })),
    formations: sc.formations.map((f) => ({ id: f.id, name: f.name, side: f.side, echelon: f.echelon, at: f.position as LL | undefined })),
    places: [...places.values()],
    lines: (T.lines ?? []).filter((l) => inArea(l.line)).map((l) => ({ id: l.id, names: variants(l.name), line: l.line as LL[] })),
    rivers: rivers.map((r) => ({ names: [RU[r] ?? r, r], lines: T.rivers.filter((x) => x.name === r && inArea(x.line)).map((x) => x.line as LL[]) })),
    events: (hist.events ?? []).map((ev) => { const a = areas.get(placeOf(ev) ?? ''); return { id: ev.id, title: ev.title, date: ev.date, place: a ? variants(areaTitle(a.name)) : undefined, at: a ? center(a.ring as LL[]) : undefined }; }),
    sectors: sectors.map((x) => ({ id: x.id, title: x.title, bbox: x.bbox })),
    bridges,
    positions: sc.formations.filter((f) => f.echelon !== 'front').map((f) => ({ id: f.id, name: f.name, side: f.side, days: daysBy.get(f.id)?.size ?? 0, total })),
    norms: norms.map((x) => ({ id: x.id, title: x.title, kb: x.kb, source: x.source, reliability: x.reliability })),
    documents,
  };
}

export async function coverageOf(opId: string): Promise<Coverage> {
  await kb.load();
  return assessCoverage(await coverageInput(opId), kb.current().entries);
}
