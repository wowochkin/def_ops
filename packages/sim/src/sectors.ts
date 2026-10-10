/**
 * Полосы фронтов (армий) и разграничительные линии.
 *
 * Полоса стороны делится между её объединениями двумя способами:
 *  - расчётно — каждая клетка принадлежит объединению, чьи войска к ней ближе (в пределах reachKm);
 *  - по директиве — где действует историческая разграничительная линия (Scenario.boundaries) между двумя
 *    объединениями, клетки этих двух объединений делятся по сторонам линии. За концами линии (линия
 *    «оборвана», как у Люббен 15.04) и где линий нет — полосы остаются расчётными.
 *
 * Полосы нужны движку (выбор пути: войска идут своей полосой, в соседнюю по директиве — неохотно),
 * отчёту (выходы в чужую полосу), карте (разграничительные линии от переднего края в глубину) и штабу
 * (кто сосед справа и слева).
 */
import type { LngLat } from '@def-ops/core';
import type { XY } from './geo';
import type { Theatre } from './theatre';
import type { Boundary, Echelon, Scenario } from './types';

export type SectorLevel = 'front' | 'army';

/** Объединение уровня level для каждого формирования сценария: фронт (группа армий) или армия; нет такого предка — верхний предок. */
export function groupOf(scenario: Scenario, level: SectorLevel = 'front'): Map<string, string> {
  const defs = new Map(scenario.formations.map((f) => [f.id, f]));
  const want: Echelon = level;
  const out = new Map<string, string>();
  for (const f of scenario.formations) {
    let cur = f, hit = f.echelon === want ? f : null;
    const seen = new Set([f.id]);
    while (cur.parent && defs.has(cur.parent) && !seen.has(cur.parent)) {
      cur = defs.get(cur.parent)!;
      seen.add(cur.id);
      if (cur.echelon === want && (level === 'front' || !hit)) hit = cur;
    }
    out.set(f.id, (hit ?? cur).id);
  }
  // соединение без объединения нужного уровня (дивизия СС без подчинения в сценарии) — к единственному объединению
  // этого уровня своей стороны, если оно одно; армия без фронта (12 А при ОКВ) остаётся отдельной полосой
  const ECH: Echelon[] = ['front', 'army', 'corps', 'division', 'brigade', 'regiment'];
  for (const f of scenario.formations) {
    const g = defs.get(out.get(f.id)!)!;
    if (g.echelon === want || ECH.indexOf(g.echelon) <= ECH.indexOf(want) + (level === 'front' ? 1 : 0)) continue;
    const only = [...new Set(scenario.formations.filter((x) => x.side === f.side && defs.get(out.get(x.id)!)!.echelon === want).map((x) => out.get(x.id)!))];
    if (only.length === 1) out.set(f.id, only[0]);
  }
  return out;
}

/** Разграничительные линии, действующие в момент time (наземные; авиационные — только для карты). */
export function activeBoundaries(scenario: Scenario, time: string, side?: string): Boundary[] {
  return (scenario.boundaries ?? []).filter((b) => b.kind !== 'air' && (!side || b.side === side) && b.from <= time && (!b.until || time < b.until));
}

export interface SectorUnit { id: string; side: string; at: LngLat; destroyed?: boolean }

export interface SectorMap {
  side: string;
  level: SectorLevel;
  /** Объединения стороны (индекс — значение label). */
  groups: string[];
  /** Сетка полос: шаг stepKm, клетки сетки театра, сгруппированные по step × step. */
  step: number;
  stepKm: number;
  cols: number;
  rows: number;
  /** Объединение клетки (индекс в groups), −1 — дальше reachKm от войск стороны. */
  label: Int16Array;
  /** 1 — клетка поделена по исторической линии (директиве). */
  hist: Uint8Array;
  /** Расстояние до ближайших своих и чужих войск, км (для линий на карте: только своя сторона от переднего края). */
  ownKm: Float32Array;
  enemyKm: Float32Array;
  /** Действующие линии этой стороны. */
  boundaries: Boundary[];
}

export interface SectorOptions {
  level?: SectorLevel;
  /** Дальше этого от своих войск полосы не продолжаются, км (по умолчанию 80, но не меньше 6 клеток театра). */
  reachKm?: number;
  /** Шаг сетки полос, км (по умолчанию — две клетки театра, но не мельче 1 км на оперативном театре). */
  stepKm?: number;
  groups?: Map<string, string>;
}

/** Полосы стороны side в момент time по положению войск units. */
export function sectorMap(T: Theatre, scenario: Scenario, units: SectorUnit[], side: string, time: string, o: SectorOptions = {}): SectorMap {
  const level = o.level ?? 'front';
  const gOf = o.groups ?? groupOf(scenario, level);
  const step = Math.max(1, Math.round((o.stepKm ?? T.cellKm * 2) / T.cellKm));
  const stepKm = step * T.cellKm;
  const cols = Math.ceil(T.cols / step), rows = Math.ceil(T.rows / step);
  const reach = Math.max(o.reachKm ?? 80, T.cellKm * 6);
  const live = units.filter((u) => !u.destroyed);
  const own = live.filter((u) => u.side === side), enemy = live.filter((u) => u.side !== side);
  const groups = [...new Set(own.map((u) => gOf.get(u.id) ?? u.id))].sort();
  const gi = new Map(groups.map((g, i) => [g, i]));
  const ownXY = own.map((u) => ({ p: T.proj.toXY(u.at), g: gi.get(gOf.get(u.id) ?? u.id)! }));
  const enXY = enemy.map((u) => T.proj.toXY(u.at));
  const N = cols * rows;
  const label = new Int16Array(N).fill(-1), hist = new Uint8Array(N);
  const ownKm = new Float32Array(N), enemyKm = new Float32Array(N);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = r * cols + c, p = centerOf(T, step, c, r);
    // квадраты расстояний (без корня в цикле — сетка большого театра считается каждый ход)
    let best = Infinity, bg = -1;
    for (const u of ownXY) { const dx = u.p[0] - p[0], dy = u.p[1] - p[1], d = dx * dx + dy * dy; if (d < best) { best = d; bg = u.g; } }
    let be = Infinity;
    for (const q of enXY) { const dx = q[0] - p[0], dy = q[1] - p[1], d = dx * dx + dy * dy; if (d < be) be = d; }
    best = Math.sqrt(best); be = Math.sqrt(be);
    ownKm[k] = best; enemyKm[k] = be;
    if (best <= reach) label[k] = bg;
  }
  // исторические линии: клетки двух объединений пары — по сторонам линии (кроме зон за концами линии)
  const bs = activeBoundaries(scenario, time, side);
  for (const b of bs) {
    const R = gi.get(b.right), L = gi.get(b.left);
    if (R == null || L == null) continue;
    const line = b.line.map((x) => T.proj.toXY(x));
    for (let k = 0; k < N; k++) {
      if (label[k] !== R && label[k] !== L) continue;
      const s = sideOf(line, centerOf(T, step, k % cols, Math.floor(k / cols)));
      if (s === 0) continue;
      label[k] = s > 0 ? R : L;
      hist[k] = 1;
    }
  }
  return { side, level, groups, step, stepKm, cols, rows, label, hist, ownKm, enemyKm, boundaries: bs };
}

/** Центр клетки сетки полос (км). */
function centerOf(T: Theatre, step: number, c: number, r: number): XY {
  const o = T.cellCenter(0, 0), s = step * T.cellKm;
  return [o[0] - T.cellKm / 2 + (c + 0.5) * s, o[1] - T.cellKm / 2 + (r + 0.5) * s];
}

/**
 * С какой стороны линии точка: 1 — справа (по ходу линии), −1 — слева, 0 — за концами линии
 * (ближайшая точка линии — её конец, а сама точка лежит дальше конца). open — линия продолжается
 * за концы (для «кто по какую сторону» — без зон за концами).
 */
export function sideOf(line: XY[], p: XY, open = false): -1 | 0 | 1 {
  let best = Infinity, cross = 0, beyond = false;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1;
    const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    const tc = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a[0] + dx * tc - p[0], a[1] + dy * tc - p[1]);
    if (d < best - 1e-9) {
      best = d;
      // у внутренней вершины сторона — по биссектрисе: берём отрезок, к которому точка ближе по проекции
      cross = dx * (p[1] - a[1]) - dy * (p[0] - a[0]);
      beyond = (i === 1 && t < 0) || (i === line.length - 1 && t > 1);
    }
  }
  if (beyond && !open) return 0;
  return cross < 0 ? 1 : -1;
}

/** Объединение, в чьей полосе точка (id), или null. */
export function sectorAt(T: Theatre, m: SectorMap, at: LngLat): { group: string; historical: boolean } | null {
  const [c, r] = T.cellOfXY(T.proj.toXY(at));
  const cc = Math.floor(c / m.step), rr = Math.floor(r / m.step);
  if (cc < 0 || rr < 0 || cc >= m.cols || rr >= m.rows) return null;
  const k = rr * m.cols + cc;
  return m.label[k] < 0 ? null : { group: m.groups[m.label[k]], historical: !!m.hist[k] };
}

/**
 * Множитель «выгодности» клетки театра для выбора пути объединением group: в полосе соседа по директиве —
 * 1 + foreign (время движения не меняется — только выбор пути, как и разброс путей).
 */
export function sectorPrefer(T: Theatre, m: SectorMap, group: string, foreign: number): ((i: number) => number) | null {
  const g = m.groups.indexOf(group);
  if (g < 0 || foreign <= 0 || !m.boundaries.length) return null;
  return (i: number) => {
    const k = Math.floor(Math.floor(i / T.cols) / m.step) * m.cols + Math.floor((i % T.cols) / m.step);
    return m.hist[k] && m.label[k] >= 0 && m.label[k] !== g ? 1 + foreign : 1;
  };
}

export interface SectorLine {
  /** Пара объединений (по алфавиту). */
  pair: [string, string];
  points: LngLat[];
  /** Доля длины по исторической линии. */
  historical: number;
}

/**
 * Разграничительные линии на карте: границы полос между объединениями на своей стороне фронта — от переднего
 * края в глубину не дальше depthKm (по умолчанию 40 км). Сглажены; короче minKm — отбрасываются.
 */
export function sectorLines(T: Theatre, m: SectorMap, o: { depthKm?: number; minKm?: number } = {}): SectorLine[] {
  const depth = o.depthKm ?? 40, minKm = o.minKm ?? m.stepKm * 3;
  const ok = (k: number) => m.label[k] >= 0 && m.ownKm[k] <= m.enemyKm[k] && m.enemyKm[k] <= depth;
  // рёбра между клетками с разными объединениями: вершины сетки (c, r) — углы клеток
  type Edge = { a: number; b: number; pair: string; hist: boolean };
  const edges: Edge[] = [];
  const V = (c: number, r: number) => r * (m.cols + 1) + c;
  for (let r = 0; r < m.rows; r++) for (let c = 0; c < m.cols; c++) {
    const k = r * m.cols + c;
    if (!ok(k)) continue;
    for (const [dc, dr] of [[1, 0], [0, 1]] as const) {
      const c2 = c + dc, r2 = r + dr;
      if (c2 >= m.cols || r2 >= m.rows) continue;
      const k2 = r2 * m.cols + c2;
      if (!ok(k2) || m.label[k2] === m.label[k]) continue;
      const g = [m.groups[m.label[k]], m.groups[m.label[k2]]].sort().join('|');
      const hist = !!(m.hist[k] && m.hist[k2]);
      // общая сторона клеток: для соседа справа — вертикальная, снизу — горизонтальная
      if (dc) edges.push({ a: V(c + 1, r), b: V(c + 1, r + 1), pair: g, hist });
      else edges.push({ a: V(c, r + 1), b: V(c + 1, r + 1), pair: g, hist });
    }
  }
  const out: SectorLine[] = [];
  const byPair = new Map<string, Edge[]>();
  for (const e of edges) { const l = byPair.get(e.pair); if (l) l.push(e); else byPair.set(e.pair, [e]); }
  const c0 = T.cellCenter(0, 0);
  const vxy = (v: number): XY => [c0[0] - T.cellKm / 2 + (v % (m.cols + 1)) * m.stepKm, c0[1] - T.cellKm / 2 + Math.floor(v / (m.cols + 1)) * m.stepKm];
  for (const [pair, es] of byPair) {
    const adj = new Map<number, number[]>();
    const link = (v: number, i: number) => { const l = adj.get(v); if (l) l.push(i); else adj.set(v, [i]); };
    es.forEach((e, i) => { link(e.a, i); link(e.b, i); });
    const used = new Uint8Array(es.length);
    const chains: { vs: number[]; hist: number }[] = [];
    for (let s = 0; s < es.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      const vs = [es[s].a, es[s].b];
      let h = es[s].hist ? 1 : 0;
      // в обе стороны, пока есть неиспользованное ребро из конца цепочки
      for (const dir of [1, -1]) {
        for (;;) {
          const end = dir > 0 ? vs[vs.length - 1] : vs[0];
          const next = (adj.get(end) ?? []).find((i) => !used[i]);
          if (next == null) break;
          used[next] = 1;
          if (es[next].hist) h++;
          const v = es[next].a === end ? es[next].b : es[next].a;
          if (dir > 0) vs.push(v); else vs.unshift(v);
        }
      }
      chains.push({ vs, hist: h / (vs.length - 1) });
    }
    const [ga, gb] = pair.split('|');
    const bl = m.boundaries.find((b) => (b.right === ga && b.left === gb) || (b.right === gb && b.left === ga));
    const blXY = bl?.line.map((x) => T.proj.toXY(x));
    for (const ch of chains) {
      const raw = ch.vs.map(vxy);
      // по директиве — сама линия директивы на протяжении цепочки; иначе — ступеньки сетки, спрямлённые и сглаженные
      const xy = blXY && ch.hist >= 0.5 ? subLine(blXY, raw[0], raw[raw.length - 1]) : smooth(simplifyXY(raw, m.stepKm * 0.75), 2);
      let len = 0;
      for (let i = 1; i < xy.length; i++) len += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
      if (len < minKm) continue;
      out.push({ pair: [ga, gb], points: simplifyXY(xy, m.stepKm * 0.1).map((p) => { const ll = T.proj.toLL(p); return [+ll[0].toFixed(4), +ll[1].toFixed(4)] as LngLat; }), historical: +ch.hist.toFixed(2) });
    }
  }
  return out;
}

/** Часть ломаной между проекциями точек a и b на неё. */
function subLine(line: XY[], a: XY, b: XY): XY[] {
  const at = (p: XY) => {
    let best = Infinity, pos = 0, acc = 0, pt: XY = line[0];
    for (let i = 1; i < line.length; i++) {
      const u = line[i - 1], v = line[i], dx = v[0] - u[0], dy = v[1] - u[1], L = Math.hypot(dx, dy) || 1e-9;
      const t = Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / (L * L)));
      const q: XY = [u[0] + dx * t, u[1] + dy * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < best) { best = d; pos = acc + t * L; pt = q; }
      acc += L;
    }
    return { pos, pt };
  };
  let s = at(a), e = at(b);
  if (s.pos > e.pos) [s, e] = [e, s];
  const out: XY[] = [s.pt];
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    acc += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    if (acc > s.pos && acc < e.pos) out.push(line[i]);
  }
  out.push(e.pt);
  return out;
}

/** Сглаживание ступенек сетки: Чайкин, концы на месте. */
function smooth(p: XY[], n: number): XY[] {
  let q = p;
  for (let k = 0; k < n && q.length > 2; k++) {
    const r: XY[] = [q[0]];
    for (let i = 0; i < q.length - 1; i++) {
      const a = q[i], b = q[i + 1];
      r.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    r.push(q[q.length - 1]);
    q = r;
  }
  return q;
}

/** Дуглас — Пекер с допуском tol, км. */
function simplifyXY(p: XY[], tol: number): XY[] {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const st: [number, number][] = [[0, p.length - 1]];
  while (st.length) {
    const [i, j] = st.pop()!;
    const a = p[i], b = p[j], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    let md = 0, mk = -1;
    for (let k = i + 1; k < j; k++) { const d = Math.abs(dy * (p[k][0] - a[0]) - dx * (p[k][1] - a[1])) / L; if (d > md) { md = d; mk = k; } }
    if (md > tol && mk > 0) { keep[mk] = 1; st.push([i, mk], [mk, j]); }
  }
  return p.filter((_, i) => keep[i]);
}

/** Где подписать полосу объединения: средняя точка его клеток у переднего края (в 3–25 км от противника). */
export function sectorLabels(T: Theatre, m: SectorMap): { group: string; at: LngLat; cells: number }[] {
  const acc = m.groups.map(() => ({ x: 0, y: 0, n: 0 }));
  for (let k = 0; k < m.label.length; k++) {
    const g = m.label[k];
    if (g < 0 || m.ownKm[k] > m.enemyKm[k] || m.enemyKm[k] < 3 || m.enemyKm[k] > 25) continue;
    const p = centerOf(T, m.step, k % m.cols, Math.floor(k / m.cols));
    acc[g].x += p[0]; acc[g].y += p[1]; acc[g].n++;
  }
  return acc.flatMap((a, i) => (a.n ? [{ group: m.groups[i], at: T.proj.toLL([a.x / a.n, a.y / a.n]), cells: a.n }] : []));
}

export interface SectorViolation {
  formation: string;
  group: string;
  /** В чьей полосе (по директиве) оказалось. */
  in: string;
  time: string;
  boundary: string;
}

/** Выходы формирований в полосу соседа по действующей директиве (по снимку положений). */
export function sectorViolations(T: Theatre, scenario: Scenario, units: SectorUnit[], time: string, groups?: Map<string, string>): SectorViolation[] {
  const gOf = groups ?? groupOf(scenario, 'front');
  const out: SectorViolation[] = [];
  for (const side of new Set(units.map((u) => u.side))) {
    const bs = activeBoundaries(scenario, time, side);
    if (!bs.length) continue;
    for (const u of units) {
      if (u.side !== side || u.destroyed) continue;
      const g = gOf.get(u.id) ?? u.id;
      for (const b of bs) {
        if (b.right !== g && b.left !== g) continue;
        const s = sideOf(b.line.map((x) => T.proj.toXY(x)), T.proj.toXY(u.at));
        const inG = s > 0 ? b.right : s < 0 ? b.left : g;
        if (inG !== g) out.push({ formation: u.id, group: g, in: inG, time, boundary: b.id });
      }
    }
  }
  return out;
}

/**
 * Полосы стороны словами (для штаба модели, советника и игрока): у каждого объединения — соседи и линия с ними
 * (по директиве: пункты и срок; иначе — «по расположению войск»), и кто из своих стоит в полосе соседа.
 */
export function sectorText(T: Theatre, scenario: Scenario, units: SectorUnit[], side: string, time: string, short: (id: string) => string = (id) => id): string[] {
  const groups = groupOf(scenario, 'front');
  const m = sectorMap(T, scenario, units, side, time, { groups });
  if (m.groups.length < 2) return m.groups.length ? [`Сторона действует одним объединением (${short(m.groups[0])}): разграничительных линий нет.`] : [];
  const pairs = new Set(sectorLines(T, m, { depthKm: 1e6, minKm: 0 }).map((l) => l.pair.join('|')));
  for (const b of m.boundaries) if (m.groups.includes(b.right) && m.groups.includes(b.left)) pairs.add([b.right, b.left].sort().join('|'));
  const out: string[] = [];
  for (const key of pairs) {
    const [a, b] = key.split('|');
    const d = m.boundaries.find((x) => (x.right === a && x.left === b) || (x.right === b && x.left === a));
    out.push(d
      ? `${short(a)} / ${short(b)} — по директиве (${d.title}): ${(d.places ?? []).join(' — ')}${d.inclusive ? `; пункты включительно — для ${short(d.inclusive)}` : ''}; справа по линии — ${short(d.right)}. За концами линии — по расположению войск.`
      : `${short(a)} / ${short(b)} — линия директивой не установлена: полосы по расположению войск.`);
  }
  const out2 = sectorViolations(T, scenario, units, time, groups).filter((v) => units.find((u) => u.id === v.formation)?.side === side);
  if (out2.length) out.push(`В полосе соседа: ${out2.map((v) => `${short(v.formation)} (в полосе ${short(v.in)})`).join(', ')}.`);
  return out;
}
