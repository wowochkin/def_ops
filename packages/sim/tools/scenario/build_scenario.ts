/**
 * Сборщик сценария из «рецепта» и набора исторических данных (положения по
 * дням). Универсален: рецепт задаёт стороны, состав, распределение сил фронта
 * по армиям и правила исторических приказов; положения и названия берутся из
 * набора данных (формат docs/sources/*-positions.json).
 *
 *   npx tsx tools/scenario/build_scenario.ts data/scenarios/src/berlin-1945.recipe.json
 *
 * Пишет data/scenarios/<id>.json (Scenario) и рядом <id>.history.json —
 * исторические положения и линии фронта для сравнения с прогоном.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { LngLat } from '@def-ops/core';
import { addHours } from '../../src/step';
import { localProjection, dist } from '../../src/geo';
import type { Echelon, FormationDef, Order, Posture, Scenario, Task } from '../../src/types';

interface RecipeFormation {
  id: string; type?: string; divisions?: number; personnel?: number; tanks?: number; guns?: number;
  posture?: Posture; ammo?: number; fuel?: number; enterAt?: string; outsidePool?: boolean; note?: string;
  /** Вес орудий на дивизию относительно средней (артиллерия прорыва на главных направлениях). */
  gunsWeight?: number;
  /** Положение на начало вместо взятого из набора данных (поправка составителя). */
  position?: LngLat; positionNote?: string;
}
interface Recipe {
  id: string; name: string; timeNote?: string; start: string; end: string; turnHours: number; theatre: string; rules: string;
  dataset: string; sides: Scenario['sides']; events?: unknown[]; supply?: Record<string, { sources: string[] } | string>;
  defaults: Record<string, { ammo: number; fuel: number; posture: Posture }>;
  allocation: { fronts: Record<string, { personnel: number; tanks: number; guns: number; combatShare: number; note?: string }> };
  formations: RecipeFormation[];
  orders: {
    mode?: 'positions' | 'tasks';
    auto: { issueHour: number; su: Task; de: { stay: Task; move: Task; stayKm: number } } & Record<string, unknown>;
    manual: { formation: string; task: Task; issuedAt: string; until?: string; target?: string | LngLat; note?: string }[];
    /** Исторические задачи: [формирование, «ММ-ДД» или «ММ-ДДTЧЧ», задача, цель (место, «@формирование» или null), примечание]. */
    tasks?: [string, string, Task, string | null, string][];
  };
}
interface DsFormation { id: string; name_ru: string; side: string; echelon: string; parent: string | null; strength_16_04?: Record<string, { value: number } | null> }
interface DsPosition { formation: string; date: string; time?: string; lng: number; lat: number; approx_km: number; place: string; reliability: string; source: string; sector_note?: string }
interface Dataset { formations: DsFormation[]; positions: DsPosition[]; frontline: { date: string; sector: string; points: { place: string; lng: number; lat: number }[] }[]; events: unknown[] }

const recipePath = resolve(process.argv[2] ?? '');
const R: Recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
const ds: Dataset = JSON.parse(readFileSync(resolve(dirname(recipePath), R.dataset), 'utf8'));
const outDir = resolve(dirname(recipePath), '..');

const dsF = new Map(ds.formations.map((f) => [f.id, f]));
const ECHELON: Record<string, Echelon> = { front: 'front', army_group: 'front', army: 'army', corps: 'corps', division: 'division' };

/* ------------------------------ положения по дням ------------------------------ */

/** Положение за день — к вечеру; для 16.04 есть «start» (утро) и «end» (вечер). */
const posTime = (p: DsPosition) => (p.time === 'start' ? `${p.date}T00:00` : `${p.date}T20:00`);
const track = new Map<string, DsPosition[]>();
for (const p of ds.positions) {
  const l = track.get(p.formation) ?? [];
  l.push(p);
  track.set(p.formation, l);
}
for (const l of track.values()) l.sort((a, b) => posTime(a).localeCompare(posTime(b)));

/* ------------------------------ состав и силы ------------------------------ */

const sideOf = (id: string) => dsF.get(id)?.side ?? id.slice(0, 2);
const parentOf = (id: string) => dsF.get(id)?.parent ?? null;
const formations: FormationDef[] = [];
const notes: string[] = [];

for (const [front, a] of Object.entries(R.allocation.fronts)) {
  const kids = R.formations.filter((f) => f.type && parentOf(f.id) === front);
  const explicit = (k: 'personnel' | 'tanks' | 'guns') => kids.reduce((s, f) => s + (f[k] != null && inPool(f) ? (f[k] as number) : 0), 0);
  const pool = { personnel: a.personnel * a.combatShare - explicit('personnel'), tanks: a.tanks - explicit('tanks'), guns: a.guns - explicit('guns') };
  const keys = ['personnel', 'tanks', 'guns'] as const;
  const share = (f: RecipeFormation, k: string) => f.divisions! * (k === 'guns' ? f.gunsWeight ?? 1 : 1);
  const div = Object.fromEntries(keys.map((k) => [k, kids.filter((f) => f[k] == null && f.divisions).reduce((s, f) => s + share(f, k), 0)]));
  for (const f of kids) {
    for (const k of keys) {
      if (f[k] == null && f.divisions) f[k] = Math.round((Math.max(0, pool[k]) * share(f, k)) / Math.max(1, div[k]));
    }
  }
  notes.push(`${front}: делится ${Math.round(pool.personnel)} чел., ${Math.round(pool.tanks)} танков, ${Math.round(pool.guns)} орудий${a.note ? ` — ${a.note}` : ''}`);
}
/** Введённые позже и учтённые отдельно (outsidePool) из численности фронта не вычитаются. */
function inPool(f: RecipeFormation) { return !f.enterAt && !f.outsidePool; }

for (const rf of R.formations) {
  const d = dsF.get(rf.id);
  if (!d) throw new Error(`нет формирования ${rf.id} в наборе данных`);
  const side = d.side;
  const first = track.get(rf.id)?.find((p) => p.time === 'start' || p.date >= R.start.slice(0, 10)) ?? null;
  const enter = rf.enterAt ?? null;
  const at = enter ? track.get(rf.id)?.find((p) => posTime(p) >= addHours(enter, -24)) ?? first : first;
  const def: FormationDef = {
    id: rf.id, name: d.name_ru, side, echelon: ECHELON[d.echelon] ?? 'corps', parent: d.parent,
    ...(rf.type ? {
      type: rf.type,
      position: rf.position ?? (at ? [at.lng, at.lat] as LngLat : undefined),
      personnel: rf.personnel ?? 0, tanks: rf.tanks ?? 0, guns: rf.guns ?? 0,
      ammo: rf.ammo ?? R.defaults[side].ammo, fuel: rf.fuel ?? R.defaults[side].fuel, posture: rf.posture ?? R.defaults[side].posture,
      ...(enter ? { enterAt: enter } : {}),
    } : {}),
    ...(rf.note || rf.positionNote ? { note: [rf.note, rf.positionNote].filter(Boolean).join('; ') } : {}),
  };
  if (rf.type && !at) notes.push(`${rf.id}: нет исторического положения в охвате — на карту не ставится`);
  formations.push(def);
}

/* ------------------------------ исторические приказы ------------------------------ */

const center: LngLat = [13.6, 52.5];
const proj = localProjection(center);
const km = (a: LngLat, b: LngLat) => dist(proj.toXY(a), proj.toXY(b));
const orders: Order[] = [];
const A = R.orders.auto;
const hh = String(A?.issueHour ?? 18).padStart(2, '0');

const year = R.start.slice(0, 4);
if (R.orders.mode === 'tasks') {
  for (const [fid, when, task, to, note] of R.orders.tasks ?? []) {
    const f = formations.find((x) => x.id === fid);
    if (!f?.type) throw new Error(`задача для неизвестного формирования ${fid}`);
    const [md, hh2] = when.split('T');
    const issued = `${year}-${md}T${(hh2 ?? hh).padStart(2, '0')}:00`;
    const target = to == null ? null : to.startsWith('@') ? { formation: to.slice(1) } : to;
    orders.push({ id: `${fid}@${issued}:${task}`, formation: fid, task, target, issuedAt: issued < R.start ? addHours(R.start, -12) : issued, source: 'script', ...(note ? { note } : {}) });
  }
}
for (const f of R.orders.mode === 'tasks' ? [] : formations) {
  if (!f.type || !f.position) continue;
  const pts = (track.get(f.id) ?? []).filter((p) => posTime(p) > (f.enterAt ?? R.start) && posTime(p) <= addHours(R.end, 24));
  const manual = (R.orders.manual ?? []).filter((m) => m.formation === f.id);
  let prev: LngLat = f.position;
  let prevDate = addHours(f.enterAt ?? R.start, -12).slice(0, 10);
  for (const p of pts) {
    const to: LngLat = [p.lng, p.lat];
    // длинный промежуток между известными положениями — промежуточные цели по дням (равномерно),
    // иначе формирование уйдёт к далёкой цели раньше срока
    const days = Math.max(1, Math.round((Date.parse(p.date) - Date.parse(prevDate)) / 86400000));
    for (let k = 1; k <= days; k++) {
      const u = k / days;
      const tgt: LngLat = k === days ? to : [+(prev[0] + (to[0] - prev[0]) * u).toFixed(4), +(prev[1] + (to[1] - prev[1]) * u).toFixed(4)];
      const day = new Date(Date.parse(prevDate) + (k - 1) * 86400000).toISOString().slice(0, 10);
      const issued = p.time === 'end' ? addHours(R.start, -12) : `${day}T${hh}:00`;
      let task: Task;
      if (f.side === 'su') task = A.su;
      else task = km(prev, to) <= A.de.stayKm ? A.de.stay : A.de.move;
      // под действием ручного приказа «держаться до…» автоматические не отдаются; после — продолжаются сами
      const held = manual.find((m) => m.issuedAt <= issued && (!m.until || issued < m.until));
      if (!held) orders.push({ id: `${f.id}@${issued}`, formation: f.id, task, target: tgt, issuedAt: issued < R.start ? addHours(R.start, -12) : issued, source: 'script', note: k === days ? `ист.: ${p.place}, ${p.date} (${p.reliability}, ±${p.approx_km} км)` : `промежуточная цель к ${p.place} (${p.date}), день ${k} из ${days}` });
      if (p.time === 'end') break;
    }
    prev = to;
    prevDate = p.date;
  }
  for (const m of manual) {
    orders.push({ id: `${f.id}@${m.issuedAt}:${m.task}`, formation: f.id, task: m.task, target: m.target ?? f.position, issuedAt: m.issuedAt, source: 'script', note: m.note });
  }
}
orders.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt) || a.formation.localeCompare(b.formation));

const scenario: Scenario & { notes: string[]; timeNote?: string } = {
  id: R.id, name: R.name, start: R.start, end: R.end, turnHours: R.turnHours, theatre: R.theatre, rules: R.rules,
  sides: R.sides, formations, orders, timeNote: R.timeNote, notes,
  ...(R.supply ? { supply: Object.fromEntries(Object.entries(R.supply).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, v as { sources: string[] }])) } : {}),
};
writeFileSync(join(outDir, `${R.id}.json`), JSON.stringify(scenario, null, 1));

/* ------------------------------ история для сравнения ------------------------------ */

const history = {
  scenario: R.id,
  note: 'исторические положения и линии фронта для сравнения с прогоном; время положения — вечер дня (20:00), для 16.04 start — утро',
  positions: ds.positions.filter((p) => formations.some((f) => f.id === p.formation)).map((p) => ({
    formation: p.formation, time: posTime(p), at: [p.lng, p.lat], approxKm: p.approx_km, place: p.place, reliability: p.reliability, source: p.source,
  })),
  events: R.events ?? [],
  frontline: ds.frontline.map((l) => ({ time: `${l.date}T20:00`, sector: l.sector, line: l.points.map((p) => [p.lng, p.lat]) })),
};
writeFileSync(join(outDir, `${R.id}.history.json`), JSON.stringify(history));
console.log(`сценарий ${R.id}: формирований ${formations.length} (действующих ${formations.filter((f) => f.type && f.position).length}), приказов ${orders.length}`);
for (const n of notes) console.log('  ' + n);
