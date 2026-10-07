/**
 * Театр — местность в виде сетки проходимости (растр) и дорог, рек, мостов и
 * укреплений, перенесённых на ту же сетку. Маршрут — поиск пути A* по сетке
 * со стоимостью «часы движения» для данного вида подвижности: по дороге —
 * быстро, через лес и болото — медленно, через большую реку технике — только
 * по уцелевшему мосту.
 */
import type { LngLat } from '@def-ops/core';
import { localProjection, pointInPolygon, centroid, dist, type LocalProjection, type XY } from './geo';
import { TERRAIN_CLASSES, type Mobility, type Rules, type SideProfile, type TerrainClass, type TheatreData } from './types';

const SQRT2 = Math.SQRT2;

export class Theatre {
  readonly proj: LocalProjection;
  readonly cols: number;
  readonly rows: number;
  readonly cellKm: number;
  private readonly x0: number;
  private readonly y0: number;
  /** Индекс класса местности по клетке. */
  readonly terrain: Uint8Array;
  /** 0 — нет дороги, 1 — дорога, 2 — шоссе. */
  readonly road: Uint8Array;
  /** 0 — нет реки, 1 — малая, 2 — большая. */
  readonly river: Uint8Array;
  /** Укреплённость клетки (уровень рубежа). */
  readonly fort: Uint8Array;
  /** Мосты по клеткам. */
  private readonly bridges = new Map<number, { id: string; destroyedAt?: string | null }[]>();
  private readonly areaRings: { id: string; name: string; ring: XY[]; c: XY }[];

  constructor(readonly data: TheatreData) {
    const [w, s, e, n] = data.bbox;
    this.proj = localProjection([(w + e) / 2, (s + n) / 2]);
    const [x0, y0] = this.proj.toXY([w, s]);
    const [x1, y1] = this.proj.toXY([e, n]);
    this.x0 = x0; this.y0 = y0;
    this.cellKm = data.cellKm;
    this.cols = Math.max(1, Math.ceil((x1 - x0) / data.cellKm));
    this.rows = Math.max(1, Math.ceil((y1 - y0) / data.cellKm));
    const N = this.cols * this.rows;
    this.terrain = new Uint8Array(N).fill(TERRAIN_CLASSES.indexOf(data.defaultTerrain));
    this.road = new Uint8Array(N);
    this.river = new Uint8Array(N);
    this.fort = new Uint8Array(N);

    for (const t of data.terrain) {
      const ring = t.ring.map((p) => this.proj.toXY(p));
      const k = TERRAIN_CLASSES.indexOf(t.class);
      const [c0, r0, c1, r1] = this.ringCells(ring);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        if (pointInPolygon(this.cellCenter(c, r), ring)) this.terrain[r * this.cols + c] = k;
      }
    }
    for (const rd of data.roads) {
      if (rd.kind === 'rail') continue;
      const v = rd.kind === 'highway' ? 2 : 1;
      this.rasterLine(rd.line, (i) => { this.road[i] = Math.max(this.road[i], v); });
    }
    for (const rv of data.rivers) this.rasterLine(rv.line, (i) => { this.river[i] = Math.max(this.river[i], rv.major ? 2 : 1); });
    for (const b of data.bridges) {
      const i = this.indexOf(b.at);
      if (i < 0) continue;
      const list = this.bridges.get(i) ?? [];
      list.push({ id: b.id, destroyedAt: b.destroyedAt });
      this.bridges.set(i, list);
    }
    for (const l of data.lines) {
      if (!l.fortification) continue;
      this.rasterLine(l.line, (i) => { this.fort[i] = Math.max(this.fort[i], l.fortification!); });
    }
    this.areaRings = data.areas.map((a) => { const ring = a.ring.map((p) => this.proj.toXY(p)); return { id: a.id, name: a.name, ring, c: centroid(ring) }; });
  }

  /* ------------------------------- сетка ------------------------------- */

  cellCenter(c: number, r: number): XY {
    return [this.x0 + (c + 0.5) * this.cellKm, this.y0 + (r + 0.5) * this.cellKm];
  }

  cellOfXY(p: XY): [number, number] {
    return [Math.floor((p[0] - this.x0) / this.cellKm), Math.floor((p[1] - this.y0) / this.cellKm)];
  }

  inside(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  /** Индекс клетки точки или −1 вне театра. */
  indexOf(ll: LngLat): number {
    const [c, r] = this.cellOfXY(this.proj.toXY(ll));
    return this.inside(c, r) ? r * this.cols + c : -1;
  }

  private ringCells(ring: XY[]): [number, number, number, number] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const [c0, r0] = this.cellOfXY([minX, minY]);
    const [c1, r1] = this.cellOfXY([maxX, maxY]);
    return [Math.max(0, c0), Math.max(0, r0), Math.min(this.cols - 1, c1), Math.min(this.rows - 1, r1)];
  }

  /** Все клетки, через которые проходит линия (с шагом в треть клетки). */
  private rasterLine(line: LngLat[], set: (i: number) => void) {
    const pts = line.map((p) => this.proj.toXY(p));
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      const n = Math.max(1, Math.ceil(dist(a, b) / (this.cellKm / 3)));
      for (let j = 0; j <= n; j++) {
        const p: XY = [a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n];
        const [c, r] = this.cellOfXY(p);
        if (this.inside(c, r)) set(r * this.cols + c);
      }
    }
  }

  /* ----------------------------- местность ----------------------------- */

  terrainAt(ll: LngLat): TerrainClass {
    const i = this.indexOf(ll);
    return TERRAIN_CLASSES[i < 0 ? TERRAIN_CLASSES.indexOf(this.data.defaultTerrain) : this.terrain[i]];
  }

  fortificationAt(ll: LngLat): number {
    const i = this.indexOf(ll);
    return i < 0 ? 0 : this.fort[i];
  }

  /** Есть ли в клетке уцелевший на момент time мост. */
  bridgeOpen(i: number, time: string): boolean {
    return (this.bridges.get(i) ?? []).some((b) => !b.destroyedAt || time < b.destroyedAt);
  }

  /** Темп в клетке, км/ч; 0 — непроходимо. */
  speedKmh(i: number, mob: Mobility, profile: SideProfile): number {
    const perDay = this.road[i] ? profile.road[mob] * (this.road[i] === 2 ? 1 : 0.85) : profile.offRoad[mob][TERRAIN_CLASSES[this.terrain[i]]];
    return perDay / 24;
  }

  /** Районы: по id или имени; точка — центр района. */
  area(idOrName: string): { id: string; name: string; center: LngLat; ring: LngLat[] } | null {
    const a = this.areaRings.find((x) => x.id === idOrName || x.name === idOrName);
    return a ? { id: a.id, name: a.name, center: this.proj.toLL(a.c), ring: a.ring.map((p) => this.proj.toLL(p)) } : null;
  }

  areaAt(ll: LngLat): string | null {
    const p = this.proj.toXY(ll);
    return this.areaRings.find((a) => pointInPolygon(p, a.ring))?.id ?? null;
  }

  /* ------------------------------ маршрут ------------------------------ */

  /**
   * Путь A* по сетке. Стоимость шага — часы движения (по средней скорости двух
   * клеток) плюс переправа: большая река без моста непроходима для техники,
   * пешим — +riverCrossHours; малая — треть этого.
   */
  route(from: LngLat, to: LngLat, mob: Mobility, profile: SideProfile, rules: Rules, time: string): { path: LngLat[]; hours: number; cells: number[] } | null {
    const s = this.indexOf(from), g = this.indexOf(to);
    if (s < 0 || g < 0) return null;
    if (s === g) return { path: [from, to], hours: 0, cells: [s] };
    const N = this.cols * this.rows;
    const gScore = new Float64Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const maxKmh = Math.max(profile.road[mob], ...Object.values(profile.offRoad[mob])) / 24;
    const gc = g % this.cols, gr = Math.floor(g / this.cols);
    const h = (i: number) => (Math.hypot((i % this.cols) - gc, Math.floor(i / this.cols) - gr) * this.cellKm) / maxKmh;
    const heap = new MinHeap();
    gScore[s] = 0;
    heap.push(s, h(s));
    const crossCost = (i: number): number => {
      const rv = this.river[i];
      if (!rv || this.bridgeOpen(i, time)) return 0;
      if (rv === 2) return mob === 'foot' ? rules.riverCrossHours : Infinity;
      return rules.riverCrossHours / 3;
    };
    while (heap.size) {
      const cur = heap.pop();
      if (cur === g) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % this.cols, cr = Math.floor(cur / this.cols);
      const v0 = this.speedKmh(cur, mob, profile);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = cc + dc, nr = cr + dr;
        if (!this.inside(nc, nr)) continue;
        const ni = nr * this.cols + nc;
        if (closed[ni]) continue;
        const v1 = this.speedKmh(ni, mob, profile);
        if (v1 <= 0 || v0 <= 0) continue;
        const d = (dr && dc ? SQRT2 : 1) * this.cellKm;
        const cost = d / ((v0 + v1) / 2) + crossCost(ni);
        if (!Number.isFinite(cost)) continue;
        const ng = gScore[cur] + cost;
        if (ng < gScore[ni]) { gScore[ni] = ng; came[ni] = cur; heap.push(ni, ng + h(ni)); }
      }
    }
    if (!Number.isFinite(gScore[g])) return null;
    const cells: number[] = [];
    for (let i = g; i !== -1; i = came[i]) cells.push(i);
    cells.reverse();
    const pts = cells.map((i) => this.proj.toLL(this.cellCenter(i % this.cols, Math.floor(i / this.cols))));
    pts[0] = from;
    pts[pts.length - 1] = to;
    return { path: simplify(pts), hours: gScore[g], cells };
  }

  /**
   * Продвижение по маршруту не дольше hours: где окажется формирование.
   * Возвращает новую точку, пройденные км и оставшийся путь.
   */
  advance(from: LngLat, to: LngLat, mob: Mobility, profile: SideProfile, rules: Rules, time: string, hours: number):
    { position: LngLat; km: number; arrived: boolean; path: LngLat[] } | null {
    const r = this.route(from, to, mob, profile, rules, time);
    if (!r) return null;
    if (r.hours <= hours) return { position: to, km: pathKm(this, r.path), arrived: true, path: r.path };
    // по клеткам: тратим время, пока хватает
    let left = hours, km = 0;
    let pos = from;
    for (let k = 1; k < r.cells.length; k++) {
      const a = r.cells[k - 1], b = r.cells[k];
      const pa = this.proj.toLL(this.cellCenter(a % this.cols, Math.floor(a / this.cols)));
      const pb = this.proj.toLL(this.cellCenter(b % this.cols, Math.floor(b / this.cols)));
      const d = dist(this.proj.toXY(pa), this.proj.toXY(pb));
      const v = (this.speedKmh(a, mob, profile) + this.speedKmh(b, mob, profile)) / 2;
      const rv = this.river[b];
      const cross = !rv || this.bridgeOpen(b, time) ? 0 : rv === 2 ? rules.riverCrossHours : rules.riverCrossHours / 3;
      const cost = d / v + cross;
      if (cost > left) {
        if (cross && left < cross) break; // переправа не закончена — стоим у реки
        const t = Math.max(0, (left - cross) / (d / v));
        const xa = this.proj.toXY(pa), xb = this.proj.toXY(pb);
        pos = this.proj.toLL([xa[0] + (xb[0] - xa[0]) * t, xa[1] + (xb[1] - xa[1]) * t]);
        km += d * t;
        left = 0;
        break;
      }
      left -= cost;
      km += d;
      pos = pb;
    }
    return { position: pos, km, arrived: false, path: r.path };
  }
}

function pathKm(t: Theatre, path: LngLat[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += dist(t.proj.toXY(path[i - 1]), t.proj.toXY(path[i]));
  return s;
}

/** Убрать промежуточные точки на прямых участках. */
function simplify(pts: LngLat[]): LngLat[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 1e-12) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Двоичная куча по приоритету (для A*). */
class MinHeap {
  private ids: number[] = [];
  private pr: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, p: number) {
    this.ids.push(id); this.pr.push(p);
    let i = this.ids.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (this.pr[j] <= this.pr[i]) break;
      [this.ids[i], this.ids[j]] = [this.ids[j], this.ids[i]];
      [this.pr[i], this.pr[j]] = [this.pr[j], this.pr[i]];
      i = j;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!, lastP = this.pr.pop()!;
    if (this.ids.length) {
      this.ids[0] = lastId; this.pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.pr[l] < this.pr[m]) m = l;
        if (r < this.ids.length && this.pr[r] < this.pr[m]) m = r;
        if (m === i) break;
        [this.ids[i], this.ids[m]] = [this.ids[m], this.ids[i]];
        [this.pr[i], this.pr[m]] = [this.pr[m], this.pr[i]];
        i = m;
      }
    }
    return top;
  }
}
