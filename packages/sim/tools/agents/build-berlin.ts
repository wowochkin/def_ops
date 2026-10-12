/**
 * Сценарий агентной модели «Берлинская операция, 16.04–2.05.1945» — все три фронта и вся немецкая сторона
 * (docs/plans/agents.md, этап 6) — и история для сверки.
 *
 *   npm run agents:berlin-data      (сначала перепись с выгрузкой: npm run sim:census -- --json evals-out/census/census.json)
 *
 * Тот же порядок, что у Зееловских высот (build-seelow.ts), на весь реестр дивизий (docs/sources/berlin-1945-divisions.json):
 * - **Состав.** Все советские и немецкие соединения реестра, кроме артиллерийских дивизий и корпусов (огонь в модели —
 *   артподготовкой, а не агентом). Немецкий корпус сценария нынешней модели без дивизий в реестре — один агент
 *   «корпусная группа» с численностью корпуса.
 * - **Подчинение** — на 16.04; приказ армии или корпуса получают соединения, подчинённые ему на дату приказа.
 *   Советские фронтовые корпуса и дивизии без армии подчинены фронту.
 * - **Численность.** Перепись (evals-out/census/census.json); советские — как у Зееловских высот (медиана армии,
 *   танки и орудия армии поровну); немецкие без числа — остаток численности корпуса из сценария нынешней модели
 *   поровну (C), иначе типовое значение по виду (допущение).
 * - **Исходные положения.** Корпуса 1 БФ утром 16.04 (berlin-1945-seelow-divisions.json); собственное положение из
 *   переписи строго до начала (10–15.04, утро 16.04) не дальше 30 км от штаба; немецкие дивизии сценария нынешней
 *   модели; иначе — вдоль линии фронта 16.04 двумя эшелонами, подвижные — в глубине (placeSlots, C).
 * - **Немецкие силы вне дивизий** (german-forces.ts): крепость Франкфурт по источникам, по агенту «части усиления»
 *   на корпус 9 А (25,7 тыс. боевых вне дивизий по Lakowski), гитлерюгенд-истребители танков.
 * - **Резервы фронтов** без задач раз в сутки выдвигаются за своим фронтом (допущение).
 * - **Приказы** — исторические задачи сценария нынешней модели (berlin-1945-tasks), цели дивизий сдвинуты на их
 *   смещение от центра объединения (не больше 8 км).
 * - **Артподготовка** 16.04: 1 БФ — как у Зееловских высот (плотности по армиям); 1 УФ — 150 мин на Нейсе
 *   (HistoryNet, C), плотность не найдена — норматив правил. Отвод с первой позиции — только 9 А (как у Зееловских высот).
 * - **Ввод в операцию** — как в сценарии нынешней модели (enterAt: 28 А с 20.04, её 3 гв. ск с 26.04, III тк СС, XX и
 *   XXXXI ак 12 А, «Нордланд» и «Недерланд» с 17.04); до ввода соединения нет на карте, приказы ждут его ввода.
 *
 * Выход: packages/sim/data/scenarios/agents/berlin-1945.json и berlin-1945.history.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixFrankfurt, reinforcements } from './german-forces';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const rd = <T>(p: string): T => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as T;
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };

type LngLat = [number, number];
interface Sub { date: string; front?: string | null; army?: string | null; corps?: string | null; corps_name?: string | null }
interface Div { id: string; side: 'su' | 'de'; type: string; guards?: boolean; name_ru: string; abbr: string[]; subordination: Sub[] }
interface CensusPos { date: string; time: string | null; lng: number; lat: number; approxKm: number | null; set: string; reliability: string | null; own: boolean }
interface CensusVal { value: number; reliability: string; source: string; date: string | null }
interface CensusRow { id: string; personnel: CensusVal | null; tanks: CensusVal | null; guns: CensusVal | null; positions: CensusPos[] }
interface TsFormation { id: string; name: string; side: string; echelon: string; parent: string | null; type?: string; position?: LngLat; personnel?: number; tanks?: number; guns?: number; ammo?: number; fuel?: number; enterAt?: string }
interface TsOrder { id: string; formation: string; task: string; target: string | LngLat | { formation: string } | null; issuedAt: string; note?: string }

const START = '1945-04-16T05:00';
const END = '1945-05-02T05:00';
const HOURS = 16 * 24;
const BRIGADE_PERSONNEL = 1200;
const CORPS_PERSONNEL = 8000;
/** Типовые значения там, где в источниках чисел нет (C, допущения). */
const DEFAULTS: Record<string, { personnel: number; tanks: number; guns: number }> = {
  tk: { personnel: CORPS_PERSONNEL, tanks: 150, guns: 60 },
  mk: { personnel: CORPS_PERSONNEL, tanks: 150, guns: 60 },
  kd: { personnel: 4500, tanks: 0, guns: 30 },
  ur: { personnel: 3000, tanks: 0, guns: 60 },
  de_div: { personnel: 4000, tanks: 10, guns: 60 },
  de_garrison: { personnel: 3000, tanks: 0, guns: 40 },
  de_kg: { personnel: 1500, tanks: 5, guns: 10 },
  de_stug: { personnel: 400, tanks: 25, guns: 0 },
};

const reg = rd<{ divisions: Div[] }>('docs/sources/berlin-1945-divisions.json');
const census = new Map(rd<CensusRow[]>(opt('census', 'evals-out/census/census.json')).map((r) => [r.id, r]));
const ts = rd<{ formations: TsFormation[]; orders: TsOrder[] }>('packages/sim/data/scenarios/berlin-1945-tasks.json');
const tsHist = rd<{ positions: { formation: string; time: string; at: LngLat; approxKm: number; reliability: string; source?: string }[]; frontline: { time: string; sector: string; line: LngLat[] }[]; events: { id: string; title: string; date: string; kind: string; side?: string; place?: string; radiusKm?: number; formations?: string[]; source?: string }[] }>('packages/sim/data/scenarios/berlin-1945-tasks.history.json');
const theatre = rd<{ areas: { id: string; name: string; ring: LngLat[] }[] }>('packages/sim/data/theatres/oder-berlin-1945.json');
const seelow = rd<{ positions: { formation: string; date: string; time?: string; lng: number; lat: number }[] }>('docs/sources/berlin-1945-seelow-divisions.json');
const wehrmacht = rd<{ unitTypes: Record<string, { quality?: number }> }>('packages/sim/data/profiles/wehrmacht-1945.json');
const rkka = rd<{ unitTypes: Record<string, { quality?: number }> }>('packages/sim/data/profiles/rkka-1945.json');

const tsF = new Map(ts.formations.map((f) => [f.id, f]));
const areaC = new Map(theatre.areas.map((a) => [a.id, a.ring.reduce<LngLat>((s, p) => [s[0] + p[0] / a.ring.length, s[1] + p[1] / a.ring.length], [0, 0])]));
const KX = 111.32 * Math.cos((52.5 * Math.PI) / 180), KY = 110.57;
const km = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * KX, (a[1] - b[1]) * KY);
const r4 = (p: LngLat): LngLat => [+p[0].toFixed(4), +p[1].toFixed(4)];
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const center = (ps: LngLat[]): LngLat => ps.reduce<LngLat>((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length], [0, 0]);
const subAt = (d: Div, day: string) => [...d.subordination].filter((s) => s.date <= day).pop() ?? d.subordination[0];
const targetOf = (t: TsOrder['target']): LngLat | null => {
  if (!t) return null;
  if (Array.isArray(t)) return t as LngLat;
  if (typeof t === 'string') return areaC.get(t) ?? null;
  return tsF.get(t.formation)?.position ?? null;
};

/** Штаб соединения на дату: советские — армия, иначе фронт; немецкие — корпус, иначе армия. */
const hqOf = (d: Div, day: string): string | null => {
  const s = subAt(d, day);
  return d.side === 'su' ? s.army ?? s.front ?? null : s.corps ?? s.army ?? null;
};
const units = reg.divisions.filter((d) => d.type !== 'art' && hqOf(d, '1945-04-16'));

// ---------- штабы: фронты, армии, корпуса (сценарий нынешней модели и реестр) ----------
interface Hq { id: string; name: string; side: 'su' | 'de'; echelon: 'front' | 'army' | 'corps'; parent: string | null; pos: LngLat | null }
const hqs = new Map<string, Hq>();
for (const f of ts.formations) {
  if (f.echelon === 'division') continue;
  const echelon = f.echelon === 'front' ? 'front' : f.echelon === 'army' ? 'army' : 'corps';
  hqs.set(f.id, { id: f.id, name: f.name, side: f.side as 'su' | 'de', echelon, parent: f.parent, pos: f.position ?? null });
}
// штабы из реестра, которых нет в сценарии нынешней модели
for (const d of units) for (const s of d.subordination) {
  if (d.side === 'su' && s.army && !hqs.has(s.army)) hqs.set(s.army, { id: s.army, name: s.army.replace(/^su_/, '').toUpperCase(), side: 'su', echelon: 'army', parent: s.front ?? null, pos: null });
  if (d.side === 'de' && s.corps && !hqs.has(s.corps)) hqs.set(s.corps, { id: s.corps, name: `${s.corps_name ?? s.corps.replace(/^de_/, '').toUpperCase()} корпус`, side: 'de', echelon: 'corps', parent: s.army ?? null, pos: null });
}

// ---------- исходные положения ----------
const seelowCorpsStart = new Map<string, LngLat>();
for (const p of seelow.positions) if (p.date === '1945-04-16' && p.time === 'start') seelowCorpsStart.set(p.formation, [p.lng, p.lat]);
const ownStart = (id: string, near: LngLat | null): LngLat | null => {
  // до начала операции: 10–15.04 или утро 16.04 («start»); положение за 16.04 без отметки — вечернее, уже после начала
  const ps = (census.get(id)?.positions ?? []).filter((p) => p.own && p.date >= '1945-04-10' && (p.date < '1945-04-16' || (p.date === '1945-04-16' && p.time === 'start')))
    .filter((p) => !near || km(near, [p.lng, p.lat]) <= 30)
    .sort((a, b) => a.date.localeCompare(b.date));
  return ps.length ? [ps[ps.length - 1].lng, ps[ps.length - 1].lat] : null;
};
/** Положение штаба: своё, иначе центр подчинённых с положениями, иначе положение старшего. */
const hqPos = (id: string, seen = new Set<string>()): LngLat | null => {
  const h = hqs.get(id);
  if (!h || seen.has(id)) return null;
  seen.add(id);
  if (h.pos) return h.pos;
  const kids = [...hqs.values()].filter((x) => x.parent === id).map((x) => hqPos(x.id, seen)).filter((p): p is LngLat => !!p);
  if (kids.length) return center(kids);
  return h.parent ? hqPos(h.parent, seen) : null;
};

// ---------- расстановка без своего положения: вдоль линии фронта 16.04 ----------
// Линия фронта на вечер 16.04 из истории сценария нынешней модели (2 БФ — Одер, 1 БФ — Одер и Кюстринский плацдарм,
// 1 УФ — Нейсе), с севера на юг. Стрелковые соединения без своего положения — двумя эшелонами вдоль неё на своей
// стороне (первый — две трети, через 3 км по фронту, второй — на 6 км глубже через 4 км; центр — на удалении штаба от
// линии), подвижные — группой у своего штаба; если штаб дальше 40 км от линии (гарнизоны, 12 А на Эльбе), — компактно
// вокруг штаба через 3 км (C).
const FRONT: LngLat[] = tsHist.frontline.filter((f) => f.time === '1945-04-16T20:00')
  .sort((a, b) => Math.max(...b.line.map((p) => p[1])) - Math.max(...a.line.map((p) => p[1])))
  .flatMap((f) => f.line);
const toKm = (p: LngLat): LngLat => [p[0] * KX, p[1] * KY];
const toLL = (q: LngLat): LngLat => [q[0] / KX, q[1] / KY];
const project = (p: LngLat) => {
  const P = toKm(p);
  let best = { q: P, t: [0, 1] as LngLat, d: Infinity };
  for (let i = 0; i + 1 < FRONT.length; i++) {
    const A = toKm(FRONT[i]), B = toKm(FRONT[i + 1]);
    const v: LngLat = [B[0] - A[0], B[1] - A[1]];
    const l2 = v[0] * v[0] + v[1] * v[1] || 1;
    const u = Math.max(0, Math.min(1, ((P[0] - A[0]) * v[0] + (P[1] - A[1]) * v[1]) / l2));
    const q: LngLat = [A[0] + v[0] * u, A[1] + v[1] * u];
    const d = Math.hypot(P[0] - q[0], P[1] - q[1]);
    if (d < best.d) { const l = Math.sqrt(l2); best = { q, t: [v[0] / l, v[1] / l], d }; }
  }
  return best;
};
const grid = (c: LngLat, n: number, step: number): LngLat[] => {
  const cols = Math.ceil(Math.sqrt(n));
  return Array.from({ length: n }, (_, i) => toLL([c[0] + ((i % cols) - (cols - 1) / 2) * step, c[1] - (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * step]));
};
const MOBILE = new Set(['tk', 'mk', 'brigade', 'stug', 'kd']);
function placeSlots(hp: LngLat, side: 'su' | 'de', needs: Div[]): Map<string, { pos: LngLat; note: string }> {
  const out = new Map<string, { pos: LngLat; note: string }>();
  if (!needs.length) return out;
  const pr = project(hp);
  const H = toKm(hp);
  if (pr.d > 40) {
    grid(H, needs.length, 3).forEach((p, i) => out.set(needs[i].id, { pos: p, note: 'положение: вокруг штаба через 3 км, штаб далеко от фронта (C)' }));
    return out;
  }
  // своя сторона: от линии к штабу; если штаб на линии — советские к востоку, немецкие к западу
  let N: LngLat = pr.d > 0.5 ? [(H[0] - pr.q[0]) / pr.d, (H[1] - pr.q[1]) / pr.d] : [-pr.t[1], pr.t[0]];
  if (pr.d <= 0.5 && (side === 'su' ? N[0] < 0 : N[0] > 0)) N = [-N[0], -N[1]];
  const at = (along: number, back: number) => toLL([pr.q[0] + pr.t[0] * along + N[0] * back, pr.q[1] + pr.t[1] * along + N[1] * back]);
  const mobile = needs.filter((d) => MOBILE.has(d.type));
  const rifle = needs.filter((d) => !MOBILE.has(d.type));
  const n1 = Math.ceil((rifle.length * 2) / 3);
  // глубина эшелонов: второй — на 6 км за первым; первый — так, чтобы центр соединений пришёлся на удаление штаба от
  // линии (положение армии в источниках — её центр), но не ближе 1 км к линии
  const back1 = Math.max(1, pr.d - (6 * (rifle.length - n1)) / Math.max(1, rifle.length));
  rifle.forEach((d, i) => {
    const first = i < n1;
    const j = first ? i : i - n1, n = first ? n1 : rifle.length - n1;
    out.set(d.id, { pos: at((j - (n - 1) / 2) * (first ? 3 : 4), first ? back1 : back1 + 6), note: `положение: ${first ? 'первый' : 'второй'} эшелон вдоль линии фронта 16.04 (C)` });
  });
  grid(H, mobile.length, 3).forEach((p, i) => out.set(mobile[i].id, { pos: p, note: 'положение: подвижные — группой у своего штаба (C)' }));
  return out;
}

// ---------- соединения ----------
interface Out { id: string; name: string; side: 'su' | 'de'; hq: string; kind: string; mobility: 'foot' | 'motor' | 'tracked'; size: 'rifle' | 'tank' | 'other'; quality: number; personnel: number; tanks: number; guns: number; ammo: number; fuel: number; pos: LngLat; enterAt?: string; notes: string[] }
/** Ввод в операцию по сценарию нынешней модели (enterAt): своё, корпуса армии (su_28a_3gsk), штаба или старшего. */
const enterOf = (d: Div, hqId: string): string | undefined => {
  const own = tsF.get(d.id)?.enterAt as string | undefined;
  if (own) return own;
  const s = subAt(d, '1945-04-16');
  const corps = s.army && s.corps ? tsF.get(`${s.army}_${s.corps.replace(/^su_/, '')}`)?.enterAt as string | undefined : undefined;
  if (corps) return corps;
  for (let x: string | null = hqId, n = 0; x && n < 6; x = hqs.get(x)?.parent ?? null, n++) { const e = tsF.get(x)?.enterAt as string | undefined; if (e) return e; }
  return undefined;
};
const out: Out[] = [];
const byHq = new Map<string, Div[]>();
for (const d of units) { const h = hqOf(d, '1945-04-16')!; byHq.set(h, [...(byHq.get(h) ?? []), d]); }
const knownSd = units.filter((d) => d.side === 'su' && d.type === 'sd' && census.get(d.id)?.personnel).map((d) => census.get(d.id)!.personnel!.value);
const TANKISH = new Set(['tk', 'mk', 'brigade', 'stug']);

for (const [hqId, divs] of byHq) {
  const hq = hqs.get(hqId)!;
  const f = tsF.get(hqId);
  const hp = hqPos(hqId);
  // советские: численность, танки и орудия армии — как у Зееловских высот
  const armyKnown = divs.filter((d) => census.get(d.id)?.personnel && d.type === 'sd').map((d) => census.get(d.id)!.personnel!.value);
  const fill = median(armyKnown.length >= 2 ? armyKnown : knownSd);
  const tankArmy = /tank_army/.test(f?.type ?? '') || /gta$/.test(hqId);
  const w = (x: Div) => (x.type === 'tk' || x.type === 'mk' ? 3 : x.type === 'brigade' || x.type === 'stug' ? 1 : 0);
  const tankW = divs.reduce((s, x) => s + w(x), 0);
  const gunN = divs.filter((x) => x.type !== 'brigade').length;
  // немецкие: остаток численности корпуса из сценария нынешней модели — поровну тем, у кого чисел нет
  const tsDiv = (d: Div) => (tsF.get(d.id)?.echelon === 'division' ? tsF.get(d.id) : undefined);
  const deKnown = divs.filter((d) => census.get(d.id)?.personnel || tsDiv(d)?.personnel);
  const deRest = f?.personnel ? Math.max(0, f.personnel - deKnown.reduce((s, d) => s + (census.get(d.id)?.personnel?.value ?? tsDiv(d)?.personnel ?? 0), 0)) : 0;
  const deUnknown = divs.length - deKnown.length;
  // у кого нет своего положения — расстановка вдоль фронта
  const cposOf = (d: Div) => { const c = subAt(d, '1945-04-16').corps; return d.side === 'su' && c ? seelowCorpsStart.get(`${hqId}_${c.replace(/^su_/, '')}`) : undefined; };
  const slots = hp ? placeSlots(hp, hq.side, divs.filter((d) => !cposOf(d) && !tsDiv(d)?.position && !ownStart(d.id, hp))) : new Map();
  for (const d of divs) {
    // исходные числа переписи — только на дату не позже начала операции (иначе это остаток после боёв)
    const raw = census.get(d.id);
    const ini = (v: CensusVal | null | undefined) => (v && (!v.date || v.date <= '1945-04-16') ? v : null);
    const c = raw ? { personnel: ini(raw.personnel), tanks: ini(raw.tanks), guns: ini(raw.guns) } : undefined;
    const notes: string[] = [];
    // положение
    let pos: LngLat | null = null;
    const sCorps = subAt(d, '1945-04-16').corps;
    const cpos = d.side === 'su' && sCorps ? seelowCorpsStart.get(`${hqId}_${sCorps.replace(/^su_/, '')}`) : undefined;
    if (cpos) {
      const same = divs.filter((x) => subAt(x, '1945-04-16').corps === sCorps);
      const j = same.indexOf(d);
      pos = [cpos[0], cpos[1] + ((j - (same.length - 1) / 2) * 2) / KY];
      notes.push('положение: корпус утром 16.04 (seelow), разнос 2 км (C)');
    }
    if (!pos && tsDiv(d)?.position) { pos = tsDiv(d)!.position!; notes.push('положение: сценарий нынешней модели'); }
    if (!pos) { const p = ownStart(d.id, hp); if (p) { pos = p; notes.push('положение: перепись, 10–16.04'); } }
    if (!pos && slots.has(d.id)) { const sl = slots.get(d.id)!; pos = sl.pos; notes.push(sl.note); }
    if (!pos) { console.warn(`нет положения: ${d.id}`); continue; }
    // численность, танки, орудия
    let personnel: number, tanks: number, guns: number;
    const def = DEFAULTS[d.side === 'su' ? d.type : `de_${d.type}`];
    if (d.side === 'su') {
      const a = f;
      if (c?.personnel) { personnel = c.personnel.value; notes.push(`численность: ${c.personnel.source} (${c.personnel.reliability})`); }
      else if (d.type === 'brigade') { personnel = BRIGADE_PERSONNEL; notes.push(`численность: бригада ${BRIGADE_PERSONNEL} (допущение)`); }
      else if (tankArmy && a?.personnel) { personnel = Math.round(a.personnel / Math.max(1, gunN)); notes.push('численность: армия поровну между корпусами (C)'); }
      else if (def) { personnel = def.personnel; notes.push(`численность: типовая для вида ${d.type} (допущение)`); }
      else { personnel = Math.round(fill); notes.push('численность: медиана известных дивизий (C)'); }
      tanks = c?.tanks?.value ?? (a?.tanks && tankW ? Math.round((a.tanks * w(d)) / tankW) : def?.tanks ?? 0);
      guns = c?.guns?.value ?? (a?.guns && d.type !== 'brigade' ? Math.round(a.guns / Math.max(1, gunN)) : def?.guns ?? (d.type === 'brigade' ? 0 : 60));
    } else {
      const t = tsDiv(d);
      if (c?.personnel) { personnel = c.personnel.value; notes.push(`численность: ${c.personnel.source} (${c.personnel.reliability})`); }
      else if (t?.personnel) { personnel = t.personnel; notes.push('численность: сценарий нынешней модели'); }
      else if (deRest > 0 && deUnknown > 0) { personnel = Math.round(deRest / deUnknown); notes.push('численность: остаток корпуса из сценария нынешней модели поровну (C)'); }
      else { personnel = def?.personnel ?? 3000; notes.push(`численность: типовая для вида ${d.type} (допущение)`); }
      tanks = c?.tanks?.value ?? t?.tanks ?? (f?.tanks ? Math.round(f.tanks / divs.length) : def?.tanks ?? 0);
      guns = c?.guns?.value ?? t?.guns ?? (f?.guns ? Math.round(f.guns / divs.length) : def?.guns ?? 40);
    }
    // вид и подвижность
    const name = d.name_ru;
    const deMob = /танков|панцер|гренадер|моторизов/i.test(name) || d.type === 'stug' ? 'tracked' : 'foot';
    const mobility = d.side === 'su' ? (TANKISH.has(d.type) ? 'tracked' : d.type === 'kd' ? 'motor' : 'foot') : deMob;
    const size = mobility === 'tracked' ? (d.type === 'brigade' || d.type === 'stug' ? 'other' : 'tank') : ['sd', 'vdd', 'pd', 'div'].includes(d.type) ? 'rifle' : 'other';
    const deType = /СС/.test(name) && mobility === 'tracked' ? 'ss_pzgr_div' : /парашют/i.test(name) ? 'fj_div' : /танковая/i.test(name) ? 'pz_div' : mobility === 'tracked' ? 'pzgr_div' : d.type === 'garrison' ? 'fortress' : 'inf_div';
    const quality = d.side === 'su' ? (d.guards ? Math.max(rkka.unitTypes[f?.type ?? '']?.quality ?? 1, 1.1) : rkka.unitTypes[f?.type ?? '']?.quality ?? 1) : wehrmacht.unitTypes[tsDiv(d)?.type ?? deType]?.quality ?? 1;
    out.push({
      id: d.id, name, side: d.side, hq: hqId, kind: d.type, mobility, size, quality, personnel, tanks, guns,
      ammo: f?.ammo ?? tsDiv(d)?.ammo ?? 1, fuel: f?.fuel ?? tsDiv(d)?.fuel ?? 1, pos: r4(pos), enterAt: enterOf(d, hqId), notes,
    });
  }
}
// немецкие корпуса сценария нынешней модели без дивизий в реестре — корпусная группа одним агентом
for (const f of ts.formations.filter((x) => x.side === 'de' && x.echelon === 'corps' && x.position && x.personnel && !byHq.has(x.id) && !out.some((o) => o.id === x.id))) {
  const mob = /panzer/.test(f.type ?? '') ? 'tracked' : 'foot';
  out.push({
    id: f.id, name: `${f.name} (корпусная группа)`, side: 'de', hq: f.parent ?? f.id, kind: 'corps', mobility: mob, size: mob === 'tracked' ? 'tank' : 'rifle',
    quality: wehrmacht.unitTypes[f.type ?? '']?.quality ?? 1, personnel: f.personnel!, tanks: f.tanks ?? 0, guns: f.guns ?? 0,
    ammo: f.ammo ?? 1, fuel: f.fuel ?? 1, pos: r4(f.position!), enterAt: f.enterAt, notes: ['корпус без разбивки по дивизиям в реестре — один агент; численность и положение — сценарий нынешней модели'],
  });
}
// немецкие силы вне дивизий (german-forces.ts): крепость Франкфурт по источникам, части усиления корпусов 9 А
fixFrankfurt(out);
out.push(...reinforcements(out, (id) => hqs.get(id)?.name ?? id));
const agentIds = new Set(out.map((o) => o.id));

// ---------- приказы ----------
const KIND: Record<string, string> = { attack: 'attack', counterattack: 'attack', breakout: 'attack', defend: 'defend', hold: 'hold', withdraw: 'withdraw', regroup: 'move', reserve: 'move' };
const clampKm = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));
const posOf = new Map(out.map((o) => [o.id, o.pos]));
/** Кому адресован приказ штаба на дату: агенты, подчинённые ему (или его корпусам) на эту дату. */
const recipients = (formation: string, day: string): string[] => {
  if (agentIds.has(formation)) return [formation];
  // «su_28a_3gsk» — корпус армии
  const m = formation.match(/^(su_\w+?a)_(\w+)$/);
  if (m) return units.filter((d) => subAt(d, day).army === m[1] && subAt(d, day).corps === `su_${m[2]}` && agentIds.has(d.id)).map((d) => d.id);
  const under = (h: string | null | undefined): boolean => { for (let x = h, n = 0; x && n < 6; x = hqs.get(x)?.parent ?? null, n++) if (x === formation) return true; return false; };
  return out.filter((o) => {
    const d = units.find((u) => u.id === o.id);
    const h = d ? hqOf(d, day) : o.hq;
    return under(h);
  }).map((o) => o.id);
};
const orders: unknown[] = [];
let skipped = 0, empty = 0;
for (const o of ts.orders) {
  if (o.issuedAt >= END) continue;
  const kind = KIND[o.task];
  if (!kind) { skipped++; continue; }
  const day = o.issuedAt.slice(0, 10) < '1945-04-16' ? '1945-04-16' : o.issuedAt.slice(0, 10);
  const to = recipients(o.formation, day);
  if (!to.length) { empty++; continue; }
  const tgt = targetOf(o.target);
  const at = o.issuedAt < START ? 0 : o.issuedAt;
  const hq = agentIds.has(o.formation) ? out.find((x) => x.id === o.formation)!.hq : hqs.has(o.formation) ? o.formation : out.find((x) => x.id === to[0])!.hq;
  const c = center(to.map((id) => posOf.get(id)!));
  // цель-соединение («вместе с 3 гв. ТА») — его место в момент приказа (ядро), а не исходное положение
  const follow = o.target && typeof o.target === 'object' && !Array.isArray(o.target) ? o.target.formation : null;
  for (const id of to) {
    const p = posOf.get(id)!;
    const off: LngLat = to.length > 1 ? [+clampKm((p[0] - c[0]) * KX, 8).toFixed(2), +clampKm((p[1] - c[1]) * KY, 8).toFixed(2)] : [0, 0];
    const t = tgt ? r4([tgt[0] + off[0] / KX, tgt[1] + off[1] / KY]) : null;
    orders.push({ at, hq, to: [id], kind, target: t, ...(follow ? { targetFormation: follow, offsetKm: off } : {}), note: `${o.note ?? ''} [${o.id}]`.trim() });
  }
}

// ---------- резервы фронтов без задач ----------
// Фронтовые корпуса и дивизии, которым в сценарии нынешней модели задач нет, раз в сутки выдвигаются за своим
// фронтом — к центру его соединений со сдвигом на своё исходное удаление от него (не больше 15 км). Допущение до
// правил советской доктрины (docs/soviet-doctrine-agent-task.md, вопрос 3: ввод вторых эшелонов и подвижных групп).
const ordered = new Set((orders as { to: string[] }[]).flatMap((o) => o.to));
let reserveOrders = 0;
for (const front of [...hqs.values()].filter((h) => h.side === 'su' && h.echelon === 'front' && !args.includes('--no-reserve'))) {
  const idle = out.filter((o) => o.hq === front.id && !ordered.has(o.id));
  if (!idle.length) continue;
  const all = out.filter((o) => { for (let x: string | null = o.hq, n = 0; x && n < 6; x = hqs.get(x)?.parent ?? null, n++) if (x === front.id) return true; return false; });
  const c = center(all.map((o) => o.pos));
  for (let day = 1; day < HOURS / 24; day++) {
    const at = new Date(Date.parse(`${START}:00Z`) + day * 86400000).toISOString().slice(0, 16);
    for (const o of idle) {
      const off: LngLat = [+clampKm((o.pos[0] - c[0]) * KX, 15).toFixed(2), +clampKm((o.pos[1] - c[1]) * KY, 15).toFixed(2)];
      orders.push({ at, hq: front.id, to: [o.id], kind: 'move', target: null, targetFormation: front.id, offsetKm: off, note: 'резерв фронта следует за фронтом (допущение)' });
      reserveOrders++;
    }
  }
}

// ---------- артподготовка и отвод (docs/sources/berlin-1945-artillery-prep.json) ----------
const PREP_1BF: Record<string, number> = { su_5ua: 286, su_47a: 270, su_8gva: 268, su_3ua: 266, su_69a: 253 };
const fires = [
  ...Object.entries(PREP_1BF).map(([hq, density]) => ({ at: START, hq, durationMin: 30, densityPerKm: density, note: '1 БФ, 16.04 05:00 МСК, около 30 мин (Антипенко, B); плотность по армиям (B)' })),
  // 1 УФ: около 2,5 ч перед форсированием Нейсе (HistoryNet, C); плотность не найдена — норматив правил (combat.artillery.normDensityPerKm)
  ...['su_3gva', 'su_13a', 'su_5gva', 'su_52a', 'su_2pa'].map((hq) => ({ at: START, hq, durationMin: 150, densityPerKm: null, note: '1 УФ, 16.04, около 150 мин (HistoryNet, C); плотность — норматив правил (допущение)' })),
];
const ninthArmy = out.filter((o) => o.side === 'de' && ['de_ci', 'de_lvi', 'de_xi_ss'].includes(o.hq) && o.kind !== 'reinf' && o.id !== 'de_hj_pznk').map((o) => o.id);
const first = 0.5;
const withdrawals = [{
  at: START, to: ninthArmy, positions: [+(first / 6).toFixed(4), +(0.3 + (first * 5) / 6).toFixed(4), 0.2],
  note: 'отвод 9 А на Großkampf-HKL в ночь на 16.04, на первой позиции охранение 1/6 (de-wiki по Stich, C)',
}];

// ---------- история для сверки ----------
const REJECT_KM = 30;
const armyDay = new Map<string, { at: LngLat; approxKm: number }>();
for (const p of tsHist.positions) armyDay.set(`${p.formation}|${p.time.slice(0, 10)}`, { at: p.at, approxKm: p.approxKm });
const histDiv: unknown[] = [];
const rejected: unknown[] = [];
const endDay = END.slice(0, 10);
for (const o of out) {
  const d = units.find((u) => u.id === o.id);
  for (const p of census.get(o.id)?.positions ?? []) {
    if (!p.own || p.date < '1945-04-16' || p.date >= endDay) continue;
    const time = p.date === '1945-04-16' && p.time === 'start' ? `${p.date}T05:00` : `${p.date}T20:00`;
    const rec = { formation: o.id, time, at: [p.lng, p.lat] as LngLat, approxKm: p.approxKm ?? 5, set: p.set, reliability: p.reliability };
    const army = o.side === 'su' && d ? subAt(d, p.date).army : null;
    const a = army ? armyDay.get(`${army}|${p.date}`) : undefined;
    const far = a ? km(a.at, rec.at) - a.approxKm - rec.approxKm : 0;
    if (far > REJECT_KM) { rejected.push({ ...rec, reason: `дальше ${REJECT_KM} км от положения армии (${far.toFixed(0)} км сверх радиусов)` }); continue; }
    histDiv.push(rec);
  }
}
const histArmy = tsHist.positions.filter((p) => (hqs.has(p.formation) || agentIds.has(p.formation)) && p.time >= '1945-04-16' && p.time < endDay)
  .map((p) => ({ formation: p.formation, time: p.time.replace(/T00:00$/, 'T05:00'), at: p.at, approxKm: p.approxKm, reliability: p.reliability, source: p.source }));

// вехи операции (история сценария нынешней модели): «выход к пункту» и «встреча» — место по театру
const events = tsHist.events.filter((e) => e.date < endDay).map((e) => ({ ...e, at: e.place ? areaC.get(e.place) ?? null : null }));

// ---------- запись ----------
const usedHq = new Set<string>();
const mark = (h: string | null) => { for (let x = h, n = 0; x && n < 6 && !usedHq.has(x); x = hqs.get(x)?.parent ?? null, n++) usedHq.add(x); };
out.forEach((o) => mark(o.hq));
const hqList = [...hqs.values()].filter((h) => usedHq.has(h.id)).map((h) => ({
  id: h.id, name: h.name, side: h.side, echelon: h.echelon, parent: h.parent && usedHq.has(h.parent) ? h.parent : null,
  pos: r4(hqPos(h.id) ?? center(out.filter((o) => o.hq === h.id).map((o) => o.pos))),
}));
const scenario = {
  id: 'agents-berlin-1945',
  name: 'Берлинская операция, 16.04–2.05.1945 (агенты-дивизии)',
  theatre: 'packages/sim/data/theatres/oder-berlin-1945.json',
  start: START, hours: HOURS, seed: 1,
  timeNote: 'время московское, как в сценарии нынешней модели; собрано npm run agents:berlin-data',
  hqs: hqList, divisions: out.map(({ notes, ...d }) => ({ ...d, note: notes.join('; ') })), orders, fires, withdrawals,
};
const dir = resolve(ROOT, 'packages/sim/data/scenarios/agents');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'berlin-1945.json'), JSON.stringify(scenario, null, 1) + '\n');
writeFileSync(resolve(dir, 'berlin-1945.history.json'), JSON.stringify({
  scenario: scenario.id,
  note: `положения дивизий — из наборов переписи (только собственные); отбракованы положения дальше ${REJECT_KM} км от положения армии в тот же день (rejected); армии, корпуса и немецкие дивизии — история сценария нынешней модели (для сравнения с ней); «за день» — 20:00, утро 16.04 — 05:00 (МСК)`,
  divisions: histDiv, armies: histArmy, events, rejected,
}, null, 1) + '\n');
const su = out.filter((o) => o.side === 'su'), de = out.filter((o) => o.side === 'de');
console.log(`соединений: советских ${su.length}, немецких ${de.length}; штабов ${hqList.length}; приказов ${orders.length} (пропущено видов ${skipped}, без получателей ${empty})`);
console.log(`положения: ${[...new Set(out.map((o) => o.notes.find((n) => n.startsWith('положение')) ?? '?'))].map((n) => `${n} — ${out.filter((o) => o.notes.includes(n)).length}`).join('; ')}`);
console.log(`приказов резервам фронтов (допущение): ${reserveOrders}`);
console.log(`ввод позже начала: ${out.filter((o) => o.enterAt && o.enterAt > START).length}`);
console.log(`история: положений дивизий ${histDiv.length} (отбраковано ${rejected.length}), армий и корпусов ${histArmy.length}`);
