/** Читаемый объёмный атлас: география, условные знаки и пласты данных. */
import * as THREE from 'three';
import { decodeGrid, TERRAIN_CLASSES, type TheatreData } from '@def-ops/sim';
import { INTRO_BERLIN, introTerrain, type IntroBounds, type IntroPoint, type IntroTerrain } from './intro-terrain';
import { introLabel } from './intro-scene';
import { MAP, historyAt } from './map';

export const INK = { navy: 0x050c16, cyan: 0x77e2df, ivory: 0xf2ecdb, amber: 0xe5b765, blue: 0x1b405a, red: 0xc77f69 };
export const smooth = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
const classes = ['#214257', '#102e42', '#285568', '#65798a', '#35576b', '#1b778e'];

export interface Atlas {
  group: THREE.Group;
  terrain: IntroTerrain;
  surface: THREE.Group;
  rivers: THREE.Group;
  roads: THREE.Group;
  labels: THREE.Group;
  units: THREE.Group;
  point: (ll: IntroPoint, lift?: number) => THREE.Vector3;
  width: number;
  depth: number;
}

/** Плоская лента остаётся видимой в перспективе и не зависит от поддержки linewidth. */
export function ribbon(points: THREE.Vector3[], width: number, color: number, opacity = 1) {
  const positions: number[] = [], indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const d = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const ox = -d.z * width / 2, oz = d.x * width / 2, p = points[i];
    positions.push(p.x + ox, p.y, p.z + oz, p.x - ox, p.y, p.z - oz);
    if (i) { const k = i * 2; indices.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: false }));
}

function mapLines(lines: { points: IntroPoint[]; width: number }[], terrain: IntroTerrain, color: number, opacity: number) {
  const positions: number[] = [], indices: number[] = [];
  const [w, s, e, n] = terrain.bounds;
  const inside = (p: IntroPoint) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;
  for (const { points, width } of lines) for (let k = 1; k < points.length; k++) {
    const a = points[k - 1], b = points[k];
    const steps = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * 68, (b[1] - a[1]) * 111) / 0.65));
    for (let i = 0; i < steps; i++) {
      const p: IntroPoint = [a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps];
      const q: IntroPoint = [a[0] + (b[0] - a[0]) * (i + 1) / steps, a[1] + (b[1] - a[1]) * (i + 1) / steps];
      if (!inside(p) || !inside(q)) continue;
      const u = new THREE.Vector3(...terrain.point(p, 0.13)), v = new THREE.Vector3(...terrain.point(q, 0.13));
      const delta = v.clone().sub(u).setY(0).normalize();
      const ox = -delta.z * width / 2, oz = delta.x * width / 2, base = positions.length / 3;
      positions.push(u.x + ox, u.y, u.z + oz, u.x - ox, u.y, u.z - oz, v.x + ox, v.y, v.z + oz, v.x - ox, v.y, v.z - oz);
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, opacity, transparent: opacity < 1, side: THREE.DoubleSide, depthWrite: false }));
}

export function fieldGrid(width: number, depth: number, color = INK.cyan, spacing = 10) {
  const p: number[] = [];
  for (let x = -width / 2; x <= width / 2; x += spacing) p.push(x, 0, -depth / 2, x, 0, depth / 2);
  for (let z = -depth / 2; z <= depth / 2; z += spacing) p.push(-width / 2, 0, z, width / 2, 0, z);
  return new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false }));
}

export function pointLight(color = INK.cyan, size = 1) {
  const group = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.27, 12, 8), new THREE.MeshBasicMaterial({ color }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(size * 0.68, size * 0.83, 32), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
  ring.rotation.x = -Math.PI / 2;
  group.add(core, ring);
  return group;
}

export function atlas(data: TheatreData, bounds?: IntroBounds, city = false): Atlas {
  const terrain = introTerrain(data.heightGrid, bounds);
  const [w, s, e, n] = terrain.bounds;
  const center = new THREE.Vector3(...terrain.point([(w + e) / 2, (s + n) / 2]));
  center.y = 0;
  const point = (ll: IntroPoint, lift = 0) => new THREE.Vector3(...terrain.point(ll, lift)).sub(center);
  const width = point([e, n]).x - point([w, n]).x, depth = point([w, s]).z - point([w, n]).z;
  const group = new THREE.Group();
  const surface = new THREE.Group(), rivers = new THREE.Group(), roads = new THREE.Group(), labels = new THREE.Group(), units = new THREE.Group();
  surface.name = 'surface'; rivers.name = 'rivers'; roads.name = 'roads'; labels.name = 'labels'; units.name = 'units';
  group.add(surface, rivers, roads, labels, units);
  const geometry = new THREE.BufferGeometry();
  const positions = terrain.positions.slice();
  for (let i = 0; i < positions.length; i += 3) { positions[i] -= center.x; positions[i + 2] -= center.z; }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(terrain.indices);
  geometry.computeVertexNormals();
  const grid = data.terrainGrid, cover = grid ? decodeGrid(grid) : null;
  const colorValues = new Float32Array(positions.length), palette = classes.map((c) => new THREE.Color(c));
  for (let r = 0; r < terrain.rows; r++) for (let c = 0; c < terrain.cols; c++) {
    const lng = w + (e - w) * c / (terrain.cols - 1), lat = n - (n - s) * r / (terrain.rows - 1);
    let cls = 0;
    if (grid && cover) {
      const x = Math.max(0, Math.min(grid.cols - 1, Math.floor((lng - grid.bbox[0]) / (grid.bbox[2] - grid.bbox[0]) * grid.cols)));
      const y = Math.max(0, Math.min(grid.rows - 1, Math.floor((grid.bbox[3] - lat) / (grid.bbox[3] - grid.bbox[1]) * grid.rows)));
      cls = cover[y * grid.cols + x];
    }
    palette[cls].toArray(colorValues, (r * terrain.cols + c) * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colorValues, 3));
  surface.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.15, emissive: 0x071422, emissiveIntensity: 0.25 })));
  const plate = new THREE.Mesh(new THREE.BoxGeometry(width, city ? 0.25 : 1.2, depth), new THREE.MeshStandardMaterial({ color: 0x081b2f, metalness: 0.6, roughness: 0.5 }));
  plate.position.y = city ? -0.3 : -0.7;
  surface.add(plate);
  const border = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: INK.cyan, transparent: true, opacity: 0.35 }));
  border.position.copy(plate.position);
  surface.add(border);
  const riverMesh = mapLines(data.rivers.map((r) => ({ points: r.line, width: city ? 0.1 : r.major ? 0.95 : 0.28 })), terrain, INK.cyan, 0.85);
  const roadMesh = mapLines(data.roads.map((r) => ({ points: r.line, width: city ? 0.027 : r.kind === 'highway' ? 0.2 : 0.11 })), terrain, city ? 0xb8c7cb : 0x7b9ab0, city ? 0.6 : 0.34);
  riverMesh.position.copy(center).multiplyScalar(-1);
  roadMesh.position.copy(center).multiplyScalar(-1);
  rivers.add(riverMesh); roads.add(roadMesh);
  if (!city) {
    for (const c of MAP.cities.filter((p) => p.at[0] > w && p.at[0] < e && p.at[1] > s && p.at[1] < n)) {
      const pos = point(c.at, 0.7), marker = pointLight(c.capital ? INK.amber : INK.cyan, c.capital ? 1.6 : 0.7);
      marker.position.copy(pos); labels.add(marker);
      const tag = introLabel(c.name, c.capital ? 20 : /Зе?лов/.test(c.name) ? 15 : 12, c.capital ? '#f2ecdb' : '#b5d6dc');
      tag.position.copy(pos).add(new THREE.Vector3(0, c.capital ? 5.5 : 4, 0));
      labels.add(tag);
    }
    for (const [name, ll] of [['Одер', [14.62, 52.75]], ['Нейсе', [14.72, 51.75]]] as [string, IntroPoint][]) {
      const tag = introLabel(name, 13, '#77e2df'); tag.position.copy(point(ll, 2)); labels.add(tag);
    }
    const armies = historyAt(MAP.days[0]).filter((a) => a.at[0] > w && a.at[0] < e && a.at[1] > s && a.at[1] < n);
    const tokenGeometry = new THREE.BoxGeometry(2.3, 0.7, 1.5);
    armies.forEach((a) => {
      const token = new THREE.Mesh(tokenGeometry, new THREE.MeshStandardMaterial({ color: a.side === 'su' ? INK.cyan : INK.red, emissive: a.side === 'su' ? INK.cyan : INK.red, emissiveIntensity: 0.25, roughness: 0.7 }));
      token.position.copy(point(a.at, 0.8)); units.add(token);
      const mark = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.8, 0.37, -0.5), new THREE.Vector3(0.8, 0.37, 0.5), new THREE.Vector3(-0.8, 0.37, 0.5), new THREE.Vector3(0.8, 0.37, -0.5),
      ]), new THREE.LineBasicMaterial({ color: INK.navy }));
      mark.position.copy(token.position); units.add(mark);
    });
  }
  if (city && grid && cover) {
    const cells: { at: IntroPoint; size: [number, number] }[] = [];
    const gx = (grid.bbox[2] - grid.bbox[0]) / grid.cols, gy = (grid.bbox[3] - grid.bbox[1]) / grid.rows;
    for (let r = 0; r < grid.rows; r += 2) for (let c = 0; c < grid.cols; c += 2) {
      if (TERRAIN_CLASSES[cover[r * grid.cols + c]] !== 'urban') continue;
      const ll: IntroPoint = [grid.bbox[0] + (c + 1) * gx, grid.bbox[3] - (r + 1) * gy];
      if (ll[0] < w || ll[0] > e || ll[1] < s || ll[1] > n) continue;
      cells.push({ at: ll, size: [gx * 68 * 1.75, gy * 111 * 1.75] });
    }
    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x496c85, roughness: 0.72, metalness: 0.25 }), cells.length);
    const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
    cells.forEach((cell, i) => {
      matrix.compose(point(cell.at, 0.12), rotation, new THREE.Vector3(cell.size[0], 0.18, cell.size[1]));
      blocks.setMatrixAt(i, matrix);
    });
    surface.add(blocks);
  }
  return { group, terrain, surface, rivers, roads, labels, units, point, width, depth };
}

/** Узлы варианта принадлежат карте; цветные ленты приподняты над географией. */
export function route(atlas: Atlas, via: IntroPoint[], color = INK.amber, width = 1.2) {
  const pts = via.map((p) => atlas.point(p, 1.5));
  const curve = new THREE.CatmullRomCurve3(pts);
  const points = curve.getPoints(90);
  const group = new THREE.Group();
  group.add(ribbon(points, width * 2.8, color, 0.12), ribbon(points, width, color, 0.9));
  const head = new THREE.Mesh(new THREE.ConeGeometry(width * 2.2, width * 5, 3), new THREE.MeshBasicMaterial({ color }));
  const end = points[points.length - 1], prev = points[points.length - 4];
  head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(prev).normalize());
  head.position.copy(end);
  group.add(head);
  const cursor = pointLight(color, width * 0.8);
  group.add(cursor);
  return { group, update: (t: number) => cursor.position.copy(curve.getPoint(((t % 1) + 1) % 1)) };
}

export function capitalHalo(a: Atlas) {
  const center = a.point(INTRO_BERLIN, 0.8), group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(5 + i * 4, 5.22 + i * 4, 96), new THREE.MeshBasicMaterial({ color: INK.amber, transparent: true, opacity: 0.5 - i * 0.12, side: THREE.DoubleSide, depthWrite: false }));
    r.rotation.x = -Math.PI / 2; r.position.copy(center); group.add(r);
  }
  return group;
}
