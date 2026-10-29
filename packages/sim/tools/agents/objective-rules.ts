/**
 * Опыт «цели по правилу»: может ли доктринальное правило, не зная решений Берлинской операции, выбрать ту же
 * ближайшую задачу армии, что и исторические боевые распоряжения фронтов армиям (`frontDirectives`, form =
 * instruction), с точностью около 5 км. Положение армий на момент распоряжения берётся из прогона режима «фронты»
 * (`agents-run --command fronts`, trace.json): центр живых дивизий армии и её смещение за прошлые 24 ч. Ось — от армии
 * к задаче фронта по последней директиве Ставки. Местность — только театр (`areas`, `bridges`, `rivers`, `roads`),
 * глубина — доктринальный суточный темп из agents-v0.json. Ничего из хода операции, кроме положения своих войск.
 *
 * Правила: R0 — точка оси на глубине D; R1 — R0 с привязкой к ближайшему пункту или мосту в пределах S км;
 * R2 — первый рубеж на оси (мост через большую реку, затем крупный пункт) на глубине D/2…1,5·D за передним краем;
 * R3 — по главной дороге, ближе всего идущей по оси, на D км, привязка к пункту на этой дороге. R* — расстояние от
 * исторической цели до ближайшего пункта или моста вообще (предел точности привязки). Диагностика: R1 с осью по
 * движению армии, R1 с осью на историческую цель (ошибка только глубины), R1 с исторической глубиной (только оси).
 *
 *   npx tsx packages/sim/tools/agents/objective-rules.ts [--trace evals-out/exp/obj/run/trace.json] \
 *     [--report evals-out/reports/objective-rules.md] [--snap 10]
 * Без готового trace.json инструмент сам запускает target/release/agents-run (seed 1, режим fronts, сторона su).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const SCEN = 'packages/sim/data/scenarios/agents/berlin-1945.json';
const THEATRE = 'packages/sim/data/theatres/oder-berlin-1945.json';
const RULES = 'packages/sim/data/rules/agents-v0.json';
const tracePath = resolve(ROOT, opt('trace', 'evals-out/exp/obj/run/trace.json')!);
const reportPath = resolve(ROOT, opt('report', 'evals-out/reports/objective-rules.md')!);
const S = Number(opt('snap', '10'));

type LngLat = [number, number];
type XY = [number, number];
const readJson = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

if (!existsSync(tracePath)) {
  const out = dirname(tracePath);
  mkdirSync(out, { recursive: true });
  const r = spawnSync(resolve(ROOT, 'target/release/agents-run'),
    ['--scenario', SCEN, '--seed', '1', '--runs', '1', '--command', 'fronts', '--side', 'su', '--out', out],
    { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('agents-run не отработал');
}

interface Dir { id: string; at: string; from: string; to: string[]; form: string; task: string; note?: string;
  axis?: LngLat[]; immediate?: { line?: LngLat[] } | null; subsequent?: { line?: LngLat[] } | null }
const scen = readJson(SCEN) as { start: string; frontDirectives: Dir[]; directives: Dir[];
  cityRings: { name: string; level: number; ring: LngLat[] }[] };
const th = readJson(THEATRE) as {
  areas: { id: string; name: string; ring: LngLat[] }[];
  bridges: { id: string; at: LngLat; name: string; river?: string; kind: string }[];
  rivers: { name: string; line: LngLat[]; major: boolean }[];
  roads: { kind: string; line: LngLat[]; name?: string }[];
};
const rules = readJson(RULES);
const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as {
  start: string; fields: string[];
  divisions: { id: string; hq: string; side: string }[];
  hqs: { id: string; name: string; echelon?: string; parent?: string }[];
  frames: (number | string)[][][];
};

// ── Геометрия: местная прямоугольная проекция, км ──
const LAT0 = 52.5, LNG0 = 13.4;
const KX = 111.32 * Math.cos((LAT0 * Math.PI) / 180), KY = 110.57;
const xy = ([lng, lat]: LngLat): XY => [(lng - LNG0) * KX, (lat - LAT0) * KY];
const ll = ([x, y]: XY): LngLat => [x / KX + LNG0, y / KY + LAT0];
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const add = (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]];
const mul = (a: XY, k: number): XY => [a[0] * k, a[1] * k];
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1];
const len = (a: XY) => Math.hypot(a[0], a[1]);
const dist = (a: XY, b: XY) => len(sub(a, b));
const unit = (a: XY): XY => { const l = len(a); return l > 1e-9 ? [a[0] / l, a[1] / l] : [1, 0]; };
const angleDeg = (a: XY, b: XY) => (Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b))))) * 180) / Math.PI;
function nearestOnSeg(p: XY, a: XY, b: XY): XY {
  const ab = sub(b, a), l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return add(a, mul(ab, t));
}
function nearestOnLine(p: XY, line: XY[]): { pt: XY; d: number; seg: number } {
  if (line.length === 1) return { pt: line[0], d: dist(p, line[0]), seg: 0 };
  let best = { pt: line[0], d: Infinity, seg: 0 };
  for (let i = 0; i + 1 < line.length; i++) {
    const q = nearestOnSeg(p, line[i], line[i + 1]), d = dist(p, q);
    if (d < best.d) best = { pt: q, d, seg: i };
  }
  return best;
}
function ringCentroidArea(ring: XY[]): { c: XY; area: number } {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length], f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return { c: mul(ring.reduce(add, [0, 0] as XY), 1 / ring.length), area: 0 };
  return { c: [cx / (6 * a), cy / (6 * a)], area: Math.abs(a) };
}
function pointInRing(p: XY, ring: XY[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ── Местность ──
/** Не населённые пункты: местности и водоём; Берлин остаётся (центр — Митте). */
const NOT_SETTLEMENT = new Set(['Зееловские высоты', 'Кюстринский плацдарм', 'Одербрух', 'Шпревальд', 'леса у Хальбе', 'Mueggelsee']);
interface Place { name: string; kind: 'пункт' | 'мост'; p: XY; area: number; major: boolean; ring?: XY[] }
const settlements: Place[] = th.areas.filter((a) => !NOT_SETTLEMENT.has(a.name)).map((a) => {
  const ring = a.ring.map(xy), { c, area } = ringCentroidArea(ring);
  return { name: a.name, kind: 'пункт', p: c, area, major: false, ring };
});
const majorRiverNames = new Set(th.rivers.filter((r) => r.major).flatMap((r) => r.name.split(/\s*[/;]\s*/)));
const bridges: Place[] = th.bridges.map((b) => ({
  name: b.name, kind: 'мост', p: xy(b.at), area: 0,
  major: b.kind === 'crossing' || (b.river ? b.river.split(/\s*[/;]\s*/).some((n) => majorRiverNames.has(n)) : false),
}));
const places = [...settlements, ...bridges];
const roadsMain = th.roads.filter((r) => r.kind !== 'rail').map((r) => ({ ...r, xy: r.line.map(xy) }));
const roadsRail = th.roads.filter((r) => r.kind === 'rail').map((r) => ({ ...r, xy: r.line.map(xy) }));
const berlinOuter = scen.cityRings.filter((r) => r.level === 1).map((r) => r.ring.map(xy))[0];

// ── Доктрина: суточная глубина ──
const ET = rules.march.enemyTerritoryKmDay;
const D_MARCH = { rifle: ET.foot.value as number, tank: ET.tracked.value as number };
const hasty = rules.combat.advance.hasty.value as [number, number][];
const RATIO = 3.01; // соотношение сил прорыва — допущение опыта (Дюпюи: 3:1 — «решающее превосходство»)
const hastyAt = hasty.filter(([r]) => r <= RATIO).at(-1)![1];
const D_COMBAT = { rifle: hastyAt, tank: hastyAt * rules.combat.armorFactor.value };

// ── Положение армий по ходу прогона ──
const F = Object.fromEntries(trace.fields.map((f, i) => [f, i]));
const hqById = new Map(trace.hqs.map((h) => [h.id, h]));
function armyOf(hq: string): string | null {
  let h = hqById.get(hq);
  for (let i = 0; h && i < 10; i++) { if (h.echelon === 'army') return h.id; h = h.parent ? hqById.get(h.parent) : undefined; }
  return null;
}
const divArmy = trace.divisions.map((d) => armyOf(d.hq));
const DEAD = new Set(['небоеспособна', 'сведена в другую дивизию', 'не введена в операцию']);
const startMs = Date.parse(`${trace.start}:00Z`);
const tickOf = (at: string) => Math.max(0, Math.min(trace.frames.length - 1, Math.round((Date.parse(`${at}:00Z`) - startMs) / 3_600_000)));
function armyDivs(army: string, tick: number): XY[] {
  const fr = trace.frames[tick], pts: XY[] = [];
  trace.divisions.forEach((_, i) => {
    if (divArmy[i] !== army) return;
    const row = fr[i];
    if (DEAD.has(String(row[F.state])) || Number(row[F.personnel]) <= 0) return;
    pts.push(xy([Number(row[F.lng]), Number(row[F.lat])]));
  });
  return pts;
}
const centroid = (pts: XY[]): XY => mul(pts.reduce(add, [0, 0] as XY), 1 / pts.length);
const isTank = (army: string) => /танков/.test(hqById.get(army)?.name ?? '') || /gta$/.test(army);

// ── Задача фронта по последней директиве Ставки ──
const stavka = scen.directives.filter((d) => d.from === 'su_stavka' && ((d.immediate?.line?.length ?? 0) > 0 || (d.axis?.length ?? 0) > 0))
  .sort((a, b) => a.at.localeCompare(b.at));
function frontObjective(front: string, at: string, pos: XY, D: number): { pt: XY; src: string } {
  const ds = stavka.filter((d) => d.to.includes(front) && d.at <= at);
  for (let k = ds.length - 1; k >= 0; k--) {
    const d = ds[k];
    const lines: [string, LngLat[] | undefined][] = [['ближайшая', d.immediate?.line], ['последующая', d.subsequent?.line], ['ось', d.axis?.length ? [d.axis.at(-1)!] : undefined]];
    for (const [what, line] of lines) {
      if (!line?.length) continue;
      const n = nearestOnLine(pos, line.map(xy));
      if (n.d >= D / 2) return { pt: n.pt, src: `${d.id} (${what})` };
    }
  }
  return { pt: add(pos, [0, -1]), src: 'нет' };
}

// ── Правила ──
const snap = (p: XY, pool: Place[], r: number) => {
  let best: Place | null = null, bd = r;
  for (const q of pool) { const d = dist(p, q.p); if (d <= bd) { bd = d; best = q; } }
  return best;
};
interface Pred { p: XY; label: string }
function R1(pos: XY, ax: XY, D: number): Pred {
  const raw = add(pos, mul(ax, D)), s = snap(raw, places, S);
  return s ? { p: s.p, label: s.name } : { p: raw, label: 'точка оси' };
}
function R2(pos: XY, ax: XY, D: number, divs: XY[]): Pred {
  const front = Math.max(0, ...divs.map((d) => dot(sub(d, pos), ax)));
  const lat: XY = [-ax[1], ax[0]];
  const cand = places.map((q) => ({ q, a: dot(sub(q.p, pos), ax), l: Math.abs(dot(sub(q.p, pos), lat)) }))
    .filter((c) => c.a > front && c.a >= D / 2 && c.a <= 1.5 * D && c.l <= S);
  const majorBr = cand.filter((c) => c.q.kind === 'мост' && c.q.major).sort((x, y) => x.a - y.a);
  if (majorBr.length) return { p: majorBr[0].q.p, label: `${majorBr[0].q.name} (мост)` };
  const towns = cand.filter((c) => c.q.kind === 'пункт').sort((x, y) => y.q.area - x.q.area || x.a - y.a);
  if (towns.length) return { p: towns[0].q.p, label: towns[0].q.name };
  const br = cand.filter((c) => c.q.kind === 'мост').sort((x, y) => x.a - y.a);
  if (br.length) return { p: br[0].q.p, label: `${br[0].q.name} (мост)` };
  return { p: add(pos, mul(ax, D)), label: 'точка оси' };
}
/** Точка в `km` км по ломаной от точки `start` на отрезке `seg` в направлении `dir` (+1 / −1); путь — вершины. */
function walk(line: XY[], start: XY, seg: number, dir: 1 | -1, km: number): { end: XY; path: XY[]; left: number; atEnd: boolean } {
  const path: XY[] = [start];
  let cur = start, left = km, i = dir > 0 ? seg + 1 : seg;
  while (left > 0 && i >= 0 && i < line.length) {
    const nxt = line[i], d = dist(cur, nxt);
    if (d >= left) { cur = add(cur, mul(unit(sub(nxt, cur)), left)); path.push(cur); return { end: cur, path, left: 0, atEnd: false }; }
    left -= d; cur = nxt; path.push(cur); i += dir;
  }
  return { end: cur, path, left, atEnd: true };
}
type Road = { xy: XY[] };
function bestRoadStep(p: XY, ax: XY, pool: Road[], radius: number, km: number, exclude?: Road) {
  let best: { road: Road; w: ReturnType<typeof walk>; cos: number } | null = null;
  for (const road of pool) {
    if (road === exclude || road.xy.length < 2) continue;
    const n = nearestOnLine(p, road.xy);
    if (n.d > radius) continue;
    for (const dir of [1, -1] as const) {
      const probe = walk(road.xy, n.pt, n.seg, dir, Math.min(5, km));
      const v = sub(probe.end, n.pt);
      if (len(v) < 0.5) continue;
      const cos = dot(unit(v), ax);
      if (!best || cos > best.cos) best = { road, w: walk(road.xy, n.pt, n.seg, dir, km), cos };
    }
  }
  return best;
}
function R3(pos: XY, ax: XY, D: number): Pred & { road: string } {
  for (const [pool, kind] of [[roadsMain, 'шоссе'], [roadsRail, 'ж. д.']] as const) {
    let step = bestRoadStep(pos, ax, pool, 10, D);
    if (!step || step.cos < 0.3) continue;
    const path: XY[] = [...step.w.path];
    let left = step.w.left, cur = step.road;
    for (let k = 0; k < 6 && left > 0.5 && step; k++) { // на конце ломаной — продолжение по смежной дороге
      const nxt = bestRoadStep(path.at(-1)!, ax, pool, 2, left, cur);
      if (!nxt || nxt.cos < 0.3) break;
      path.push(...nxt.w.path); left = nxt.w.left; cur = nxt.road;
    }
    const end = path.at(-1)!;
    const onRoad = settlements.filter((q) => nearestOnLine(q.p, path).d <= 4);
    const s = snap(end, onRoad, S);
    return s ? { p: s.p, label: s.name, road: kind } : { p: end, label: 'конец пути', road: kind };
  }
  return { ...R1(pos, ax, D), road: 'нет дороги' };
}

// ── Расчёт по распоряжениям ──
const all = scen.frontDirectives.filter((d) => d.form === 'instruction' && !d.id.endsWith(':journal'));
const withObj = all.filter((d) => (d.immediate?.line?.length ?? 0) > 0);
const RULE_NAMES = ['R0', 'R1', 'R2', 'R3', 'R1·бой', 'R1·движение', 'R1·ось-история', 'R1·глубина-история'] as const;
type RuleName = (typeof RULE_NAMES)[number];
interface Row {
  d: Dir; army: string; tank: boolean; pos: XY; hist: XY; histLine: XY[]; D: number; axisSrc: string;
  ax: XY; move: number; dh: number; theta: number; preds: Record<RuleName, Pred>; err: Record<RuleName, number>;
  rStar: number; rStarName: string; inRing: boolean; inBerlin: boolean;
}
const rows: Row[] = [];
const skipped: string[] = [];
for (const d of withObj) {
  const army = d.to[0], tick = tickOf(d.at), divs = armyDivs(army, tick);
  if (!divs.length) { skipped.push(`${d.id}: нет живых дивизий`); continue; }
  const pos = centroid(divs), prevDivs = armyDivs(army, Math.max(0, tick - 24));
  const moveV = prevDivs.length ? sub(pos, centroid(prevDivs)) : ([0, 0] as XY);
  const tank = isTank(army), D = tank ? D_MARCH.tank : D_MARCH.rifle, Dc = tank ? D_COMBAT.tank : D_COMBAT.rifle;
  const obj = frontObjective(d.from, d.at, pos, D);
  const ax = unit(sub(obj.pt, pos));
  const histLine = d.immediate!.line!.map(xy);
  const hist = histLine.length === 1 ? histLine[0] : nearestOnLine(pos, histLine).pt;
  const errOf = (p: XY) => nearestOnLine(p, histLine).d;
  const hv = sub(hist, pos), dh = len(hv);
  const preds = {
    R0: { p: add(pos, mul(ax, D)), label: 'точка оси' },
    R1: R1(pos, ax, D),
    R2: R2(pos, ax, D, divs),
    R3: R3(pos, ax, D),
    'R1·бой': R1(pos, ax, Dc),
    'R1·движение': R1(pos, len(moveV) >= 3 ? unit(moveV) : ax, D),
    'R1·ось-история': R1(pos, unit(hv), D),
    'R1·глубина-история': R1(pos, ax, dh),
  } as Record<RuleName, Pred>;
  const err = Object.fromEntries(RULE_NAMES.map((r) => [r, errOf(preds[r].p)])) as Record<RuleName, number>;
  let rStar = Infinity, rStarName = '';
  for (const q of places) { const e = errOf(q.p); if (e < rStar) { rStar = e; rStarName = q.name; } }
  const inRing = settlements.some((q) => q.ring && pointInRing(hist, q.ring));
  rows.push({ d, army, tank, pos, hist, histLine, D, axisSrc: obj.src, ax, move: len(moveV), dh, theta: angleDeg(ax, hv),
    preds, err, rStar, rStarName, inRing, inBerlin: berlinOuter ? pointInRing(hist, berlinOuter) : false });
}

// ── Сводка ──
const fmt = (x: number, n = 1) => x.toFixed(n).replace('.', ',');
const pct = (x: number) => `${Math.round(100 * x)} %`;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stat = (xs: number[]) => ({ n: xs.length, med: median(xs), mean: mean(xs), w5: xs.filter((x) => x <= 5).length / xs.length, w10: xs.filter((x) => x <= 10).length / xs.length });
const statRow = (name: string, xs: number[]) => { const s = stat(xs); return `| ${name} | ${s.n} | ${fmt(s.med)} | ${fmt(s.mean)} | ${pct(s.w5)} | ${pct(s.w10)} |`; };
const HEAD = '| правило | n | медиана, км | среднее, км | ≤ 5 км | ≤ 10 км |\n|---|---|---|---|---|---|';
const groups: [string, (r: Row) => boolean][] = [
  ['стрелковые', (r) => !r.tank], ['танковые', (r) => r.tank],
  ...[...new Set(rows.map((r) => r.d.task))].map((t) => [`задача ${t}`, (r: Row) => r.d.task === t] as [string, (r: Row) => boolean]),
  ['цель в Берлине (внешний обвод)', (r) => r.inBerlin], ['цель вне Берлина', (r) => !r.inBerlin],
];
const RULE_TITLE: Record<RuleName, string> = {
  R0: 'R0 точка оси на глубине D', R1: `R1 «темп по оси», привязка ≤ ${S} км`, R2: 'R2 «ближайший рубеж»', R3: 'R3 «по дороге»',
  'R1·бой': 'R1 с боевым темпом (Дюпюи, 3:1)', 'R1·движение': 'R1, ось по движению армии за 24 ч',
  'R1·ось-история': 'R1, ось на историческую цель (ошибка глубины)', 'R1·глубина-история': 'R1, глубина по истории (ошибка оси)',
};

function why(r: Row, rule: RuleName): string {
  const parts: string[] = [];
  if (r.theta > 60) parts.push(`поворот: цель в ${Math.round(r.theta)}° от оси Ставки`);
  else if (r.theta > 30) parts.push(`цель в ${Math.round(r.theta)}° от оси`);
  if (r.dh < r.D / 3) parts.push(`цель ближе суточного темпа (${fmt(r.dh, 0)} км из ${r.D})`);
  else if (r.dh > 2 * r.D) parts.push(`цель глубже суточного темпа (${fmt(r.dh, 0)} км)`);
  if (r.inBerlin) parts.push('район Берлина');
  if (r.rStar > 5) parts.push(`цель не у пункта (R* ${fmt(r.rStar)} км)`);
  if (!parts.length) parts.push(`ошибка привязки: ${r.preds[rule].label} вместо ${r.rStarName}`);
  return parts.join('; ');
}

const L: string[] = [];
const P = (s = '') => L.push(s);
P('# Опыт «цели по правилу»: выбор ближайшей задачи армии по доктрине');
P();
P('Вопрос: может ли правило без знания решений операции выбрать ту же цель армии, что историческое боевое распоряжение фронта, с точностью около 5 км.');
P();
P(`Распоряжений form = instruction (без «:journal»): ${all.length}; с целью (immediate.line): ${withObj.length} — все точечные; ${all.length - withObj.length} — «оборонять» без рубежа, в расчёт не входят. Пропущено: ${skipped.length}${skipped.length ? ` (${skipped.join('; ')})` : ''}.`);
P(`Положение армии — центр живых дивизий в прогоне режима «фронты» (seed 1, ${tracePath.replace(`${ROOT}/`, '')}) на час распоряжения; ось — от армии к ближайшей точке ближайшей задачи последней директивы Ставки фронту (если до неё меньше D/2 — к последующей задаче, затем к концу оси).`);
P(`Глубина D — темп по территории противника вне боя (march.enemyTerritoryKmDay): стрелковая армия ${D_MARCH.rifle} км, танковая ${D_MARCH.tank} км; вариант «бой» — combat.advance.hasty при 3:1: ${fmt(D_COMBAT.rifle, 0)} / ${fmt(D_COMBAT.tank, 0)} км. Привязка S = ${S} км к ${settlements.length} пунктам (центр кольца; без местностей и водоёма) и ${bridges.length} мостам и переправам (больших рек — ${bridges.filter((b) => b.major).length}). Дороги: шоссе ${roadsMain.length}, железные ${roadsRail.length} — R3 идёт по шоссе, где их нет в 10 км — по железной дороге.`);
P();
P('## Точность правил');
P();
P(HEAD);
for (const r of RULE_NAMES) P(statRow(RULE_TITLE[r], rows.map((x) => x.err[r])));
P(statRow('R* ближайший пункт или мост к исторической цели', rows.map((x) => x.rStar)));
P();
const rs = stat(rows.map((x) => x.rStar));
P(`R*: историческая цель лежит внутри кольца пункта в ${pct(rows.filter((x) => x.inRing).length / rows.length)} случаев; ближайший пункт или мост — в ${pct(rs.w5)} случаев не дальше 5 км, в ${pct(rs.w10)} — не дальше 10 км (медиана ${fmt(rs.med)} км). Это потолок любой привязки к театру: ошибка R1–R3 сверх него — выбор не того пункта.`);
P(`Расстояние армии до исторической цели: медиана ${fmt(median(rows.map((x) => x.dh)))} км (стрелковые ${fmt(median(rows.filter((x) => !x.tank).map((x) => x.dh)))}, танковые ${fmt(median(rows.filter((x) => x.tank).map((x) => x.dh)))}); угол между осью Ставки и направлением на цель: медиана ${Math.round(median(rows.map((x) => x.theta)))}°, больше 45° — ${pct(rows.filter((x) => x.theta > 45).length / rows.length)}.`);
P();
const ratio = rows.map((x) => x.dh / x.D);
P(`Глубина исторической цели в суточных темпах D: медиана ${fmt(median(ratio), 2)}; меньше 0,5·D — ${pct(ratio.filter((x) => x < 0.5).length / rows.length)}, больше 1,5·D — ${pct(ratio.filter((x) => x > 1.5).length / rows.length)}. Распоряжение задаёт цель не на сутки, а на 0–4 суток вперёд.`);
for (const id of [...new Set(rows.map((x) => x.axisSrc.split(' ')[0]))]) {
  const sel = rows.filter((x) => x.axisSrc.startsWith(`${id} `));
  P(`- ось по ${id}: ${sel.length} распоряжений, медиана ошибки R1 ${fmt(median(sel.map((x) => x.err.R1)))} км, угол оси к цели — медиана ${Math.round(median(sel.map((x) => x.theta)))}°`);
}
P();
P('## По видам армий, задачам и месту');
for (const [g, f] of groups) {
  const sel = rows.filter(f);
  if (!sel.length) continue;
  P(); P(`### ${g} (${sel.length})`); P(); P(HEAD);
  for (const r of ['R0', 'R1', 'R2', 'R3', 'R1·ось-история', 'R1·глубина-история'] as RuleName[]) P(statRow(RULE_TITLE[r], sel.map((x) => x.err[r])));
  P(statRow('R*', sel.map((x) => x.rStar)));
}
P();
P('## Десять худших промахов R1');
P();
P('| распоряжение | армия → цель | R1 выбрал | ошибка R1 / R2 / R3, км | почему | примечание источника |');
P('|---|---|---|---|---|---|');
for (const r of [...rows].sort((a, b) => b.err.R1 - a.err.R1).slice(0, 10)) {
  const note = (r.d.note ?? '').replace(/\s*\[[^\]]*\]\s*$/, '').trim() || '—';
  P(`| ${r.d.at} ${r.army} | ${fmt(r.dh, 0)} км, ${Math.round(r.theta)}° от оси (${r.rStarName}) | ${r.preds.R1.label} | ${fmt(r.err.R1)} / ${fmt(r.err.R2)} / ${fmt(r.err.R3)} | ${why(r, 'R1')} | ${note} |`);
}
P();
P('## Все распоряжения');
P();
P('| время | армия | D | ось (директива Ставки) | до цели, км | угол | R0 | R1 | R2 | R3 | R* |');
P('|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) P(`| ${r.d.at} | ${r.army} | ${r.D} | ${r.axisSrc} | ${fmt(r.dh, 0)} | ${Math.round(r.theta)}° | ${fmt(r.err.R0)} | ${fmt(r.err.R1)} | ${fmt(r.err.R2)} | ${fmt(r.err.R3)} | ${fmt(r.rStar)} |`);

const best = [...(['R0', 'R1', 'R2', 'R3'] as RuleName[])].map((r) => ({ r, s: stat(rows.map((x) => x.err[r])) })).sort((a, b) => a.s.med - b.s.med)[0];
const sAx = stat(rows.map((x) => x.err['R1·ось-история'])), sDp = stat(rows.map((x) => x.err['R1·глубина-история']));
P();
P('## Вывод');
P();
P(`Нет: ни одно из правил не приближается к 5 км. Лучшее из R0–R3 (${best.r}) даёт медиану ${fmt(best.s.med)} км и попадает в 5 км в ${pct(best.s.w5)} случаев (в 10 км — ${pct(best.s.w10)}), то есть на уровне сдвига целей на десятки километров — заметно хуже опыта «±5 км», который уже стоил режиму фронтов 0,10 точности. Дело не в зернистости театра: исторические цели почти все стоят в пунктах или у мостов (R*: медиана ${fmt(rs.med)} км, ${pct(rs.w5)} в 5 км), так что ошибка — выбор не того пункта. Привязка к пункту, рубежу или дороге почти ничего не меняет против голой точки оси (R0 ${fmt(stat(rows.map((x) => x.err.R0)).med)} км): решают направление и глубина. Даже зная точное направление на цель, правило с доктринальной глубиной ошибается на ${fmt(sAx.med)} км (в 5 км — ${pct(sAx.w5)}), а зная точную глубину, но держа ось на задачу Ставки, — на ${fmt(sDp.med)} км (${pct(sDp.w5)}): обе составляющие нужно знать. Глубина исторической цели гуляет от 0 до 4 суточных темпов (это цель на этап, а не на сутки), направление в ${pct(rows.filter((x) => x.theta > 45).length / rows.length)} случаев уходит от оси Ставки больше чем на 45° — повороты на Берлин и в обход, к Эльбе, выход к рубежу окружения, развороты 2 БФ на запад и север; последняя директива Ставки (например № 11074 о кольце на востоке) иногда разворачивает ось прочь от задачи армии. Чтобы выйти на 5 км, «командующему-планировщику» нужно знать то, чего правило не видит: замысел фронта по этапам — полосу и разграничительные линии армии с соседями (ось армии, а не фронта), последующую задачу фронта и рубеж, на который армия должна выйти к сроку этапа (глубину на 2–4 суток), положение противника (рубежи обороны, куда отходят и где окружены — откуда берутся повороты), и роль армии в замысле (главный удар, обход, внутренний или внешний фронт окружения, прикрытие фланга). Без этого остаётся опираться на исторические рубежи распоряжений, а правило годится разве что как заполнитель там, где их нет.`);

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${L.join('\n')}\n`);

console.log(`распоряжений с целью: ${rows.length} из ${all.length}`);
console.log('правило                                     медиана  среднее  ≤5км  ≤10км');
for (const r of RULE_NAMES) {
  const s = stat(rows.map((x) => x.err[r]));
  console.log(`${RULE_TITLE[r].padEnd(44)} ${fmt(s.med).padStart(6)}  ${fmt(s.mean).padStart(6)}  ${pct(s.w5).padStart(5)} ${pct(s.w10).padStart(5)}`);
}
console.log(`${'R* ближайший пункт/мост'.padEnd(44)} ${fmt(rs.med).padStart(6)}  ${fmt(rs.mean).padStart(6)}  ${pct(rs.w5).padStart(5)} ${pct(rs.w10).padStart(5)}`);
console.log(`отчёт: ${reportPath}`);
