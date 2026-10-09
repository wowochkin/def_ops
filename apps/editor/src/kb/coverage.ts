/**
 * Полнота материалов операции: из данных операции (сценарий, история, театр) — что должно быть в базе знаний
 * (формирования, ключевые пункты, рубежи, реки, события), оценка по каркасу — по записям базы.
 */
import { assessCoverage, type Coverage, type CoverageInput } from '@def-ops/knowledge';
import { areaOriginal, areaTitle, type History, type LiveSetup, type Scenario, type TheatreData } from '@def-ops/sim';
import { fullCatalog, getData, liveOf } from '../sim/userdata';
import * as kb from './kb';

const LIVE = import.meta.glob('../../../../services/staff/live/*.json', { import: 'default' });
const variants = (title: string) => [title, ...title.split(/[()]/).map((x) => x.trim()).filter(Boolean)].filter((v, i, a) => a.indexOf(v) === i);

export async function coverageInput(opId: string): Promise<CoverageInput> {
  const sc = (await getData('scenarios', `${opId}.json`)) as Scenario;
  const hist = (await getData('scenarios', `${opId}.history.json`)) as History;
  const T = (await getData('theatres', `${sc.theatre}.json`)) as TheatreData;
  const title = (await fullCatalog(true)).find((c) => c.id === opId)?.title ?? sc.name;
  const live = (await liveOf(opId)) ?? ((await LIVE[`../../../../services/staff/live/${opId}.json`]?.()) as LiveSetup | undefined);
  const areas = new Map(T.areas.map((a) => [a.id, a]));
  const places = new Map<string, { id: string; names: string[]; why: string }>();
  const addPlace = (id: string | undefined, why: string) => {
    const a = id ? areas.get(id) : undefined;
    if (!a) return;
    const cur = places.get(a.id);
    if (cur) { if (!cur.why.includes(why)) cur.why += `, ${why}`; return; }
    places.set(a.id, { id: a.id, names: [...variants(areaTitle(a.name)), areaOriginal(a.name)], why });
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
  return {
    operation: { id: opId, title, start: sc.start, end: sc.end },
    formations: sc.formations.map((f) => ({ id: f.id, name: f.name, side: f.side, echelon: f.echelon })),
    places: [...places.values()],
    lines: (T.lines ?? []).filter((l) => inArea(l.line)).map((l) => ({ id: l.id, names: variants(l.name) })),
    rivers: rivers.map((r) => ({ names: [RU[r] ?? r, r] })),
    events: (hist.events ?? []).map((ev) => { const a = areas.get(placeOf(ev) ?? ''); return { id: ev.id, title: ev.title, date: ev.date, place: a ? variants(areaTitle(a.name)) : undefined }; }),
  };
}

export async function coverageOf(opId: string): Promise<Coverage> {
  await kb.load();
  return assessCoverage(await coverageInput(opId), kb.current().entries);
}
