/**
 * Сценарий агентной модели «Зееловские высоты, 16–20.04.1945» (docs/plans/agents.md, этап 3) и история для сверки.
 *
 *   npm run agents:seelow-data      (сначала перепись с выгрузкой: npm run sim:census -- --json evals-out/census/census.json)
 *
 * Состав — реестр дивизий (docs/sources/berlin-1945-divisions.json): советские армии центра 1 БФ (47, 3 уд., 5 уд.,
 * 8 гв., 69 А, 1 и 2 гв. ТА) — все их дивизии и корпуса; немецкие дивизии 9 А на участке (CI ак, LVI тк, XI тк СС) —
 * как в сценарии нынешней модели (berlin-1945-tasks: численность с приданными бригадами, положения, приказы).
 *
 * Численность советских дивизий — лучшая из переписи (evals-out/census/census.json); где нет — медиана известных
 * дивизий той же армии (или всех стрелковых дивизий), пометка C. Танки и орудия армии (из сценария нынешней модели)
 * делятся поровну между её дивизиями (C); у танковых армий численность, танки и орудия — поровну между корпусами (C).
 * Исходные положения: немецкие — из сценария нынешней модели; советские — положение корпуса утром 16.04
 * (berlin-1945-seelow-divisions.json) с разносом дивизий корпуса по 2 км вдоль фронта, иначе — положение армии (C).
 * Приказы — исторические задачи сценария нынешней модели: приказ армии получают все её дивизии, цель каждой
 * сдвинута на её смещение от центра армии (армия наступает полосой, а не сходится в точку).
 *
 * Время — московское, как в сценарии нынешней модели (начало 16.04 05:00). Положение «за день» сверяется в 20:00.
 *
 * Выход: packages/sim/data/scenarios/agents/seelow-1945.json (сценарий ядра) и seelow-1945.history.json.
 */
import { HIGH_COMMAND } from './hierarchy';
import { frontDirectives, scenarioDirectives } from './directives';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFENSE_ZONES, markDeployed, repeatedFires } from './soviet-fires';
import { reinforcementOrders, reinforcements } from './german-forces';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const rd = <T>(p: string): T => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as T;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

type LngLat = [number, number];
interface Sub { date: string; front?: string; army?: string; corps?: string; corps_name?: string; source?: string }
interface Div { id: string; side: 'su' | 'de'; type: string; kind?: string; guards?: boolean; name_ru: string; abbr: string[]; subordination: Sub[] }
interface CensusPos { date: string; time: string | null; lng: number; lat: number; approxKm: number | null; set: string; reliability: string | null; own: boolean }
interface CensusVal { value: number; reliability: string; source: string; date: string | null; note?: string }
interface CensusRow { id: string; personnel: CensusVal | null; tanks: CensusVal | null; guns: CensusVal | null; positions: CensusPos[] }
interface TsFormation { id: string; name: string; side: string; echelon: string; parent: string | null; type?: string; position?: LngLat; personnel?: number; tanks?: number; guns?: number; ammo?: number; fuel?: number }
interface TsOrder { id: string; formation: string; task: string; target: string | LngLat | { formation: string } | null; issuedAt: string; note?: string }

const START = '1945-04-16T05:00';
const END_DAY = '1945-04-20';
const HOURS = 4 * 24;
const SU_ARMIES = ['su_47a', 'su_3ua', 'su_5ua', 'su_8gva', 'su_69a', 'su_1gta', 'su_2gta'];
const TANK_ARMIES = new Set(['su_1gta', 'su_2gta']);
const DE_CORPS = ['de_ci', 'de_lvi', 'de_xi_ss'];
/** Численность отдельной танковой (самоходной) бригады и танкового корпуса в общевойсковой армии — допущения (C):
 * в источниках переписи цифр нет. */
const BRIGADE_PERSONNEL = 1200;
const CORPS_PERSONNEL = 8000;

const reg = rd<{ divisions: Div[] }>('docs/sources/berlin-1945-divisions.json');
const census = new Map(rd<CensusRow[]>(opt('census', 'evals-out/census/census.json')).map((r) => [r.id, r]));
const ts = rd<{ formations: TsFormation[]; orders: TsOrder[] }>('packages/sim/data/scenarios/berlin-1945-tasks.json');
const tsHist = rd<{ positions: { formation: string; time: string; at: LngLat; approxKm: number; reliability: string; source?: string }[] }>('packages/sim/data/scenarios/berlin-1945-tasks.history.json');
const theatre = rd<{ areas: { id: string; name: string; ring: LngLat[] }[] }>('packages/sim/data/theatres/oder-berlin-1945.json');
const seelow = rd<{ formations: { id: string; parent?: string }[]; positions: { formation: string; date: string; time?: string; lng: number; lat: number }[] }>('docs/sources/berlin-1945-seelow-divisions.json');
const wehrmacht = rd<{ unitTypes: Record<string, { quality?: number }> }>('packages/sim/data/profiles/wehrmacht-1945.json');
const rkka = rd<{ unitTypes: Record<string, { quality?: number }> }>('packages/sim/data/profiles/rkka-1945.json');

const tsF = new Map(ts.formations.map((f) => [f.id, f]));
const areaC = new Map(theatre.areas.map((a) => [a.id, a.ring.reduce<LngLat>((s, p) => [s[0] + p[0] / a.ring.length, s[1] + p[1] / a.ring.length], [0, 0])]));
const KX = 111.32 * Math.cos((52.5 * Math.PI) / 180), KY = 110.57;
const km = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);
const r4 = (p: LngLat): LngLat => [+p[0].toFixed(4), +p[1].toFixed(4)];
const center = (ps: LngLat[]): LngLat => ps.reduce<LngLat>((a, p) => [a[0] + p[0] / ps.length, a[1] + p[1] / ps.length], [0, 0]);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const subAt = (d: Div, day: string) => [...d.subordination].filter((s) => s.date <= day).pop() ?? d.subordination[0];

// ---------- советская сторона ----------
interface Out { id: string; name: string; side: 'su' | 'de'; hq: string; kind: string; mobility: 'foot' | 'motor' | 'tracked'; size: 'rifle' | 'tank' | 'other'; quality: number; personnel: number; tanks: number; guns: number; ammo: number; fuel: number; pos: LngLat; notes: string[] }
const out: Out[] = [];
const TANKISH = new Set(['tk', 'mk', 'brigade', 'stug']);
const suDivs = reg.divisions.filter((d) => d.side === 'su' && SU_ARMIES.includes(subAt(d, '1945-04-16').army ?? ''));
const byArmy = new Map<string, Div[]>();
for (const d of suDivs) { const a = subAt(d, '1945-04-16').army!; byArmy.set(a, [...(byArmy.get(a) ?? []), d]); }
const knownSd = suDivs.filter((d) => d.type === 'sd' && census.get(d.id)?.personnel).map((d) => census.get(d.id)!.personnel!.value);
const seelowCorpsStart = new Map<string, LngLat>();
for (const p of seelow.positions) if (p.date === '1945-04-16' && p.time === 'start') seelowCorpsStart.set(p.formation, [p.lng, p.lat]);
for (const [army, divs] of byArmy) {
  const a = tsF.get(army)!;
  const apos = a.position!;
  const tank = TANK_ARMIES.has(army);
  const quality = rkka.unitTypes[a.type ?? '']?.quality ?? 1;
  const armyKnown = divs.filter((d) => census.get(d.id)?.personnel).map((d) => census.get(d.id)!.personnel!.value);
  const fill = median(armyKnown.length >= 2 ? armyKnown : knownSd);
  // корпус → дивизии (для разноса вдоль фронта)
  const byCorps = new Map<string, Div[]>();
  for (const d of divs) { const c = subAt(d, '1945-04-16').corps ?? `${army}:${d.id}`; byCorps.set(c, [...(byCorps.get(c) ?? []), d]); }
  let k = 0;
  for (const [corps, cd] of byCorps) {
    const cpos = seelowCorpsStart.get(`${army}_${corps.replace(/^su_/, '')}`);
    cd.forEach((d, j) => {
      const c = census.get(d.id);
      const notes: string[] = [];
      let pos: LngLat;
      if (cpos) { pos = [cpos[0], cpos[1] + ((j - (cd.length - 1) / 2) * 2) / KY]; notes.push('положение: корпус утром 16.04 (seelow), разнос 2 км (C)'); }
      else { pos = [apos[0], apos[1] + ((k - (divs.length - 1) / 2) * 2.5) / KY]; notes.push('положение: армия (C)'); }
      k++;
      // доли армии: танки — танковым соединениям (корпус — 3 доли, бригада — 1), орудия — всем, кроме бригад;
      // численность танковой армии — корпусам поровну, бригадам — допущение
      const w = (x: Div) => (x.type === 'tk' || x.type === 'mk' ? 3 : x.type === 'brigade' || x.type === 'stug' ? 1 : 0);
      const tankW = divs.reduce((s2, x) => s2 + w(x), 0);
      const gunN = divs.filter((x) => x.type !== 'brigade').length;
      let personnel: number;
      if (d.type === 'brigade') { personnel = BRIGADE_PERSONNEL; notes.push(`численность: бригада ${BRIGADE_PERSONNEL} (допущение)`); }
      else if (tank) { personnel = Math.round((a.personnel ?? 0) / Math.max(1, divs.filter((x) => x.type !== 'brigade').length)); notes.push('численность: армия поровну между корпусами (C)'); }
      else if (d.type === 'tk' || d.type === 'mk') { personnel = CORPS_PERSONNEL; notes.push(`численность: корпус ${CORPS_PERSONNEL} (допущение)`); }
      else if (c?.personnel) { personnel = c.personnel.value; notes.push(`численность: ${c.personnel.source} (${c.personnel.reliability})`); }
      else { personnel = Math.round(fill); notes.push('численность: медиана известных дивизий (C)'); }
      const isTank = TANKISH.has(d.type);
      out.push({
        id: d.id, name: d.name_ru, side: 'su', hq: army, kind: d.type,
        mobility: isTank ? 'tracked' : 'foot', size: isTank ? (d.type === 'brigade' ? 'other' : 'tank') : d.type === 'sd' || d.type === 'vdd' ? 'rifle' : 'other',
        quality: d.guards ? Math.max(quality, 1.1) : quality,
        personnel,
        tanks: tankW ? Math.round(((a.tanks ?? 0) * w(d)) / tankW) : 0,
        guns: d.type === 'brigade' ? 0 : Math.round((a.guns ?? 0) / Math.max(1, gunN)),
        ammo: a.ammo ?? 1, fuel: a.fuel ?? 1, pos: r4(pos), notes,
      });
      void corps;
    });
  }
}

// ---------- немецкая сторона: как в сценарии нынешней модели ----------
const deDivs = ts.formations.filter((f) => f.side === 'de' && f.echelon === 'division' && DE_CORPS.includes(f.parent ?? ''));
for (const f of deDivs) {
  const mob = /pz|pzgr|tk/.test(f.type ?? '') ? 'tracked' : 'foot';
  out.push({
    id: f.id, name: f.name, side: 'de', hq: f.parent!, kind: f.type ?? 'div', mobility: mob, size: mob === 'tracked' ? 'tank' : 'rifle',
    quality: wehrmacht.unitTypes[f.type ?? '']?.quality ?? 1, personnel: f.personnel ?? 0, tanks: f.tanks ?? 0, guns: f.guns ?? 0,
    ammo: f.ammo ?? 1, fuel: f.fuel ?? 1, pos: r4(f.position!), notes: ['как в сценарии нынешней модели (berlin-1945-tasks)'],
  });
}

// немецкие силы вне дивизий (german-forces.ts): части усиления корпусов 9 А, гитлерюгенд-истребители танков
out.push(...reinforcements(out, (id) => tsF.get(id)?.name ?? id));

// ---------- штабы ----------
const hqs = [
  { id: 'su_1bf', name: tsF.get('su_1bf')!.name, side: 'su', echelon: 'front', parent: null, pos: [14.6, 52.6] as LngLat },
  ...SU_ARMIES.map((a) => ({ id: a, name: tsF.get(a)!.name, side: 'su', echelon: 'army', parent: 'su_1bf', pos: tsF.get(a)!.position! })),
  { id: 'de_9a', name: tsF.get('de_9a')!.name, side: 'de', echelon: 'army', parent: null, pos: [14.1, 52.45] as LngLat },
  ...DE_CORPS.map((c) => {
    const ds = deDivs.filter((f) => f.parent === c);
    const p = ds.reduce<LngLat>((s, f) => [s[0] + f.position![0] / ds.length, s[1] + f.position![1] / ds.length], [0, 0]);
    return { id: c, name: tsF.get(c)!.name, side: 'de', echelon: 'corps', parent: 'de_9a', pos: r4(p) };
  }),
];

// ---------- приказы ----------
const KIND: Record<string, string> = { attack: 'attack', counterattack: 'attack', breakout: 'attack', defend: 'defend', hold: 'hold', withdraw: 'withdraw', regroup: 'move', reserve: 'move' };
const targetOf = (t: TsOrder['target']): LngLat | null => {
  if (!t) return null;
  if (Array.isArray(t)) return t as LngLat;
  if (typeof t === 'string') return areaC.get(t) ?? null;
  return tsF.get(t.formation)?.position ?? null;
};
const endHour = `${END_DAY}T05:00`;
const orders: unknown[] = [];
const armyCenter = new Map<string, LngLat>();
for (const a of SU_ARMIES) {
  const ds = out.filter((o) => o.hq === a);
  armyCenter.set(a, ds.reduce<LngLat>((s, o) => [s[0] + o.pos[0] / ds.length, s[1] + o.pos[1] / ds.length], [0, 0]));
}
const clampKm = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
let skipped = 0;
for (const o of ts.orders) {
  if (o.issuedAt >= endHour) continue;
  const kind = KIND[o.task];
  if (!kind) { skipped++; continue; }
  const tgt = targetOf(o.target);
  const at = o.issuedAt < START ? 0 : o.issuedAt;
  if (SU_ARMIES.includes(o.formation)) {
    const c = armyCenter.get(o.formation)!;
    for (const d of out.filter((x) => x.hq === o.formation)) {
      // цель дивизии — цель армии со смещением дивизии от центра армии (не больше 8 км)
      const t = tgt ? r4([tgt[0] + clampKm((d.pos[0] - c[0]) * KX, 8) / KX, tgt[1] + clampKm((d.pos[1] - c[1]) * KY, 8) / KY]) : null;
      orders.push({ at, hq: o.formation, to: [d.id], kind, target: t, note: `${o.note ?? ''} [${o.id}]`.trim() });
    }
  } else if (out.some((x) => x.id === o.formation && x.side === 'de')) {
    const d = out.find((x) => x.id === o.formation)!;
    orders.push({ at, hq: d.hq, to: [d.id], kind, target: tgt ? r4(tgt) : null, note: `${o.note ?? ''} [${o.id}]`.trim() });
  }
}

orders.push(...reinforcementOrders(out));

// ---------- история для сверки ----------
const ids = new Set(out.map((o) => o.id));
// положение армии по истории нынешней модели (журналы фронтов) на день — для отбраковки ошибок привязки:
// дивизия не бывает дальше REJECT_KM от положения своей армии (одноимённые пункты, ошибки геокодирования)
const REJECT_KM = 30;
const armyDay = new Map<string, { at: LngLat; approxKm: number }>();
for (const p of tsHist.positions) armyDay.set(`${p.formation}|${p.time.slice(0, 10)}`, { at: p.at, approxKm: p.approxKm });
const histDiv: unknown[] = [];
const rejected: unknown[] = [];
for (const o of out) {
  const c = census.get(o.id);
  for (const p of c?.positions ?? []) {
    if (!p.own || p.date < '1945-04-16' || p.date >= END_DAY) continue;
    const time = p.date === '1945-04-16' && p.time === 'start' ? `${p.date}T05:00` : `${p.date}T20:00`;
    const rec = { formation: o.id, time, at: [p.lng, p.lat] as LngLat, approxKm: p.approxKm ?? 5, set: p.set, reliability: p.reliability };
    const a = o.side === 'su' ? armyDay.get(`${o.hq}|${p.date}`) : undefined;
    const far = a ? km(a.at, rec.at) - a.approxKm - rec.approxKm : 0;
    if (far > REJECT_KM) { rejected.push({ ...rec, reason: `дальше ${REJECT_KM} км от положения армии (${far.toFixed(0)} км сверх радиусов)` }); continue; }
    histDiv.push(rec);
  }
}
const histArmy = tsHist.positions.filter((p) => (SU_ARMIES.includes(p.formation) || ids.has(p.formation)) && p.time >= '1945-04-16' && p.time < END_DAY)
  .map((p) => ({ formation: p.formation, time: p.time.replace(/T00:00$/, 'T05:00'), at: p.at, approxKm: p.approxKm, reliability: p.reliability, source: p.source }));

// ---------- артподготовка и отвод с первой позиции (docs/sources/berlin-1945-artillery-prep.json) ----------
// 1 БФ: 16.04 в 05:00 МСК, около 30 мин (план 60 мин сокращён из-за нехватки боеприпасов — Антипенко, B; ГА «Висла»
// доносила о 1,5 ч — расхождение); плотность по армиям — стволов на км (de-wiki по Жукову и Исаеву, B).
const PREP: Record<string, number> = { su_5ua: 286, su_47a: 270, su_8gva: 268, su_3ua: 266, su_69a: 253 };
const fires = Object.entries(PREP).map(([hq, density]) => ({
  at: START, hq, durationMin: 30, densityPerKm: density,
  note: 'артподготовка 16.04: 05:00 МСК, около 30 мин (Антипенко, B); плотность по армиям — berlin-1945-artillery-prep.json',
}));
// повторные артподготовки 17–19.04 (soviet-fires.ts)
fires.push(...repeatedFires(new Set(SU_ARMIES)));
// Отвод 9 А на Großkampf-HKL в ночь на 16.04: на первой позиции — охранение в 1/6 силы (de-wiki по Stich 2018, C;
// атрибуция спорная — сравниваются варианты с отводом и без). Доли по позициям до отвода — правила agents-v0
// (combat.artillery.troopsByPosition: 0,5 / 0,3 / 0,2); после: 1/6 первой позиции остаётся, остальное — на второй.
const first = 0.5;
const withdrawals = [{
  at: START, to: out.filter((o) => o.side === 'de' && o.kind !== 'reinf' && o.id !== 'de_hj_pznk').map((o) => o.id),
  positions: [+(first / 6).toFixed(4), +(0.3 + (first * 5) / 6).toFixed(4), 0.2],
  note: 'отвод на Großkampf-HKL в ночь на 16.04, на первой позиции охранение 1/6 (de-wiki по Stich, C)',
}];

// развёрнуты к началу в исходном районе (soviet-fires.ts, markDeployed)
const deployedN = markDeployed(out, orders as { at: unknown; to: string[]; kind: string }[]);
console.log(`развёрнуты к началу: ${deployedN}`);
// ---------- советские стрелковые корпуса и верхние инстанции ----------
// Как в build-berlin.ts: расстановка и приказы посчитаны по армии; дивизия встаёт под свой корпус из реестра на начало
// операции, корпус — под армию; 1 БФ — под Ставкой, 9-я армия — под группой армий «Висла», та — под верховным командованием.
type ScenHqOut = { id: string; name: string; side: string; echelon: string; parent: string | null; pos: LngLat; note?: string };
const hqOut = hqs as ScenHqOut[];
for (const o of out) {
  if (o.side !== 'su') continue;
  const d = suDivs.find((x) => x.id === o.id);
  const s = d && subAt(d, '1945-04-16');
  if (!s?.corps || o.hq !== s.army) continue;
  if (!hqOut.some((h) => h.id === s.corps)) hqOut.push({ id: s.corps, name: s.corps_name ?? s.corps.replace(/^su_/, ''), side: 'su', echelon: 'corps', parent: s.army, pos: [0, 0], note: `состав корпуса — ${s.source ?? 'реестр дивизий'}` });
  o.hq = s.corps;
}
for (const h of hqOut) if (h.echelon === 'corps' && h.side === 'su') h.pos = r4(center(out.filter((o) => o.hq === h.id).map((o) => o.pos)));
const sideCenter = (side: string) => r4(center(out.filter((o) => o.side === side).map((o) => o.pos)));
hqOut.find((h) => h.id === 'su_1bf')!.parent = HIGH_COMMAND.su.id;
hqOut.find((h) => h.id === 'de_9a')!.parent = 'de_hgr_weichsel';
hqOut.push(
  // положения верхних штабов — центр войск стороны (на театре; место ставки на карте не показывается)
  { id: 'de_hgr_weichsel', name: 'Группа армий «Висла»', side: 'de', echelon: 'front', parent: HIGH_COMMAND.de.id, pos: sideCenter('de') },
  { id: HIGH_COMMAND.su.id, name: HIGH_COMMAND.su.name, side: 'su', echelon: 'high_command', parent: null, pos: sideCenter('su') },
  { id: HIGH_COMMAND.de.id, name: HIGH_COMMAND.de.name, side: 'de', echelon: 'high_command', parent: null, pos: sideCenter('de') },
);

const scenario = {
  id: 'agents-seelow-1945',
  name: 'Зееловские высоты, 16–20.04.1945 (агенты-дивизии)',
  theatre: 'packages/sim/data/theatres/oder-berlin-1945.json',
  start: START, hours: HOURS, seed: 1,
  timeNote: 'время московское, как в сценарии нынешней модели; собрано npm run agents:seelow-data',
  hqs, divisions: out.map(({ notes, ...d }) => ({ ...d, note: notes.join('; ') })), orders, directives: scenarioDirectives('docs/sources/berlin-1945-directives.json', new Set(hqOut.map((h) => h.id)), START), frontDirectives: frontDirectives(ts.orders, hqOut, targetOf, START, `${END_DAY}T05:00`), fires, withdrawals, defenseZones: DEFENSE_ZONES,
};
const dir = resolve(ROOT, 'packages/sim/data/scenarios/agents');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'seelow-1945.json'), JSON.stringify(scenario, null, 1) + '\n');
writeFileSync(resolve(dir, 'seelow-1945.history.json'), JSON.stringify({
  scenario: scenario.id,
  note: `положения дивизий — из наборов переписи (только собственные положения, не по координатам армии); отбракованы положения дальше ${REJECT_KM} км от положения армии в тот же день (rejected); армии и немецкие дивизии — история сценария нынешней модели (для сравнения с ней); «за день» — 20:00, утро 16.04 — 05:00 (МСК)`,
  divisions: histDiv, armies: histArmy, rejected,
}, null, 1) + '\n');
const su = out.filter((o) => o.side === 'su'), de = out.filter((o) => o.side === 'de');
console.log(`дивизий: советских ${su.length} (численность из переписи у ${su.filter((o) => o.notes.some((n) => /численность: (?!медиана|армия|бригада|корпус)/.test(n))).length}), немецких ${de.length}; штабов ${hqs.length}; приказов ${orders.length} (пропущено видов ${skipped})`);
console.log(`история: положений дивизий ${histDiv.length} (отбраковано ${rejected.length}), армий и немецких дивизий (нынешняя модель) ${histArmy.length}`);
