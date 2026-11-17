/** Левое панно: тринадцать самостоятельных схем о данных и устройстве модели. */
import * as THREE from 'three';
import { introLabel, type IntroAnimation } from './intro-scene';
import { playIntroPanels, type SideShot } from './intro-scene-panels';
import { INTRO_FACTORS } from './intro-story';
import { introCommandTable } from './intro-scene-demo';
import { MAP } from './map';

const C = { cyan: '#77e2df', ivory: '#f2ecdb', gold: '#e5b765', muted: '#7899ab', blue: '#21485e' };
type Point = readonly [number, number, number?];
type Drawing = { group: THREE.Group; motions: ((t: number, p: number) => void)[] };
const point = (p: Point) => new THREE.Vector3(p[0], p[1], p[2] ?? 0);
const drawing = (name: string): Drawing => { const group = new THREE.Group(); group.name = `factors-${name}`; return { group, motions: [] }; };
const finish = ({ group, motions }: Drawing): SideShot => ({ group, animate: (t, p, reduced) => motions.forEach((move) => move(reduced ? 4 : t, reduced ? 0.7 : p)) });

function label(d: Drawing, text: string, x: number, y: number, size = 14, color = C.ivory) {
  const sprite = introLabel(text, size, color, true);
  sprite.position.set(x, y, 0.2); d.group.add(sprite); return sprite;
}

/** Ленты вместо аппаратных линий: одинаковая толщина на всех экранах стенда. */
function stroke(d: Drawing, points: readonly Point[], color = C.cyan, opacity = 0.55, width = 0.055) {
  const positions: number[] = [], indices: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = point(points[i]), b = point(points[i + 1]);
    const n = b.clone().sub(a); n.set(-n.y, n.x, 0).normalize().multiplyScalar(width / 2);
    const offset = positions.length / 3;
    positions.push(...a.clone().add(n).toArray(), ...a.clone().sub(n).toArray(), ...b.clone().add(n).toArray(), ...b.clone().sub(n).toArray());
    indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
  d.group.add(mesh); return mesh;
}

function frame(d: Drawing, x: number, y: number, w: number, h: number, color = C.cyan, opacity = 0.55) {
  return stroke(d, [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2], [x - w / 2, y - h / 2]], color, opacity);
}

function dot(d: Drawing, x: number, y: number, color = C.cyan, radius = 0.16) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), new THREE.MeshBasicMaterial({ color }));
  mesh.position.set(x, y, 0.12); d.group.add(mesh); return mesh;
}

function ring(d: Drawing, x: number, y: number, radius: number, color = C.cyan, opacity = 0.7) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(radius - 0.045, radius + 0.045, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
  mesh.position.set(x, y, 0); d.group.add(mesh); return mesh;
}

function flow(d: Drawing, path: readonly Point[], color = C.gold, count = 5, speed = 0.12) {
  stroke(d, path, color, 0.38);
  const curve = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 1; i < path.length; i++) curve.add(new THREE.LineCurve3(point(path[i - 1]), point(path[i])));
  const sparks = Array.from({ length: count }, () => dot(d, 0, 0, color, 0.09));
  d.motions.push((t) => sparks.forEach((spark, i) => { spark.position.copy(curve.getPoint((t * speed + i / count) % 1)); spark.position.z += 0.15; }));
}

function title(d: Drawing, text: string) { label(d, text, 0, 9.7, 17, C.cyan); }

function identity() {
  const d = drawing('identity');
  const xs = [-17, 0, 17];
  const names = ['Исторические данные', 'Математическая модель', 'Искусственный интеллект'];
  xs.forEach((x, i) => {
    ring(d, x, 2.5, 4.4, i === 1 ? C.gold : C.cyan);
    ring(d, x, 2.5, 3.9, C.muted, 0.2);
    label(d, names[i], x, 8.4, 14);
    if (i === 0) {
      for (let k = 0; k < 4; k++) { frame(d, x + k * 0.38 - 0.6, 2.5 + k * 0.3, 3.5, 4.1, C.ivory, 0.55); }
    } else if (i === 1) {
      label(d, 'F', x, 2.5, 38, C.gold);
    } else {
      const nodes: Point[] = [[x - 2, 2.5], [x, 4.8], [x + 2, 2.5], [x, 0.2], [x, 2.5]];
      nodes.forEach((a, j) => { dot(d, a[0], a[1]); nodes.slice(j + 1).forEach((b) => stroke(d, [a, b], C.cyan, 0.35)); });
    }
    flow(d, [[x, -2], [x, -5], [0, -5]], i === 1 ? C.gold : C.cyan, 3);
  });
  label(d, 'Единая модель обстановки', 0, -8, 21, C.ivory);
  return finish(d);
}

function archive() {
  const d = drawing('archive');
  title(d, 'От источника — к структуре данных');
  const documents = ['Документы', 'Карты', 'Хронология'];
  documents.forEach((name, i) => {
    const x = -21 + i * 6, y = 1.8 - i * 1.1;
    frame(d, x, y, 7, 10, C.ivory, 0.6); label(d, name, x, y + 6.2, 12);
    for (let row = 0; row < 7; row++) stroke(d, [[x - 2.4, y + 3.2 - row], [x + (row % 3 ? 2.4 : 0.6), y + 3.2 - row]], C.muted, 0.6);
  });
  const beam = stroke(d, [[-25, 4], [-4, 4]], C.cyan, 0.95, 0.12);
  d.motions.push((t) => { beam.position.y = Math.sin(t * 0.45) * 4 - 3; });
  flow(d, [[-4, 0], [3, 0], [3, 5], [8, 5]], C.gold, 4);
  const names = ['Соединение', 'Положение', 'Состояние', 'Время'];
  names.forEach((name, i) => {
    const y = 5.3 - i * 3.5;
    dot(d, 7, y, C.gold); label(d, name, 16, y, 17); stroke(d, [[8.5, y - 1.3], [24, y - 1.3]], C.cyan, 0.3);
    for (let k = 0; k < 11; k++) dot(d, 8.5 + k * 1.4, y - 1.3, k % 3 === i % 3 ? C.gold : C.muted, 0.055);
  });
  label(d, 'Сведения сохраняют связь с источником', -13, -8.4, 12, C.muted);
  return finish(d);
}

function math() {
  const d = drawing('math');
  title(d, 'S(t + Δt) = F(состояние, приказы, среда)');
  const xs = [-20, -6.5, 7, 20], names = ['Состояние', 'Движение и бой', 'Потери и расход', 'Новое состояние'];
  xs.forEach((x, i) => {
    ring(d, x, 2, 3.2, i === 3 ? C.gold : C.cyan);
    label(d, i === 0 ? 'S(t)' : i === 3 ? 'S(t + Δt)' : i === 1 ? 'F' : 'Δ', x, 2, i === 3 ? 16 : 29, i === 3 ? C.gold : C.ivory);
    label(d, names[i], x, -2.7, 13);
    if (i < 3) flow(d, [[x + 3.4, 2], [xs[i + 1] - 3.4, 2]], C.gold, 3, 0.24);
  });
  flow(d, [[20, -1.4], [20, -6], [-20, -6], [-20, -1.4]], C.cyan, 12, 0.05);
  label(d, 'Следующий шаг расчёта', 0, -8.2, 15, C.cyan);
  return finish(d);
}

function agents() {
  const d = drawing('agents');
  label(d, 'Штаб фронта', 0, 9.2, 18, C.gold);
  frame(d, 0, 6.4, 7, 2.6, C.gold); label(d, 'Замысел', 0, 6.4, 14);
  const armies = [-17, 0, 17];
  armies.forEach((x, i) => {
    flow(d, [[0, 5], [0, 3.9], [x, 3.9], [x, 2.5]], C.gold, 3, 0.08);
    frame(d, x, 1, 8.8, 2.8); label(d, 'Штаб армии', x, 1, 14);
    for (let k = 0; k < 3; k++) {
      const xx = x + (k - 1) * 4.8;
      flow(d, [[x, -0.5], [x, -2.3], [xx, -2.3], [xx, -4.1]], C.cyan, 2, 0.15);
      frame(d, xx, -5.2, 3.4, 2.1, C.ivory, 0.65);
      stroke(d, [[xx - 1.1, -5.9], [xx + 1.1, -4.5]], C.ivory, 0.8);
      stroke(d, [[xx - 1.1, -4.5], [xx + 1.1, -5.9]], C.ivory, 0.8);
    }
    if (i < 2) flow(d, [[x + 4.7, 1], [armies[i + 1] - 4.7, 1]], C.muted, 2, 0.1);
  });
  label(d, 'Приказы', -19, -8.4, 14, C.gold); label(d, 'Соединения', 0, -8.4, 16); label(d, 'Обратная связь', 19, -8.4, 14, C.cyan);
  return finish(d);
}

function factors() {
  const d = drawing('network');
  title(d, 'Единая модель обстановки');
  const positions: Point[] = INTRO_FACTORS.map((_, i) => [(i % 4 - 1.5) * 15.2, 5.4 - Math.floor(i / 4) * 4.2]);
  const dots = positions.map((p, i) => {
    if (i % 4 !== 3) stroke(d, [p, positions[i + 1]], C.cyan, 0.2);
    if (i < 12) stroke(d, [p, positions[i + 4]], C.cyan, 0.2);
    label(d, INTRO_FACTORS[i], p[0], p[1] + 1.1, 12.5); return dot(d, p[0], p[1], C.cyan, 0.14);
  });
  const chains = [[0, 4, 5, 6], [1, 3, 7, 11], [8, 9, 10, 14], [12, 13, 15]];
  chains.forEach((chain, i) => flow(d, chain.map((index) => positions[index]), i % 2 ? C.gold : C.cyan, 4, 0.08));
  d.motions.push((t) => dots.forEach((mesh, i) => mesh.scale.setScalar(1 + 0.4 * Math.sin(t * 1.1 - i * 0.7))));
  return finish(d);
}

function space() {
  const d = drawing('space');
  const corners = (y: number): Point[] => [[-22, y], [-5, y - 2.7], [6, y + 1.1], [-11, y + 3.8], [-22, y]];
  const layers = ['Положение войск', 'Реки и дороги', 'Рельеф'];
  layers.forEach((name, i) => {
    const y = 4.5 - i * 5;
    stroke(d, corners(y), i === 0 ? C.gold : C.cyan, 0.75, 0.08);
    label(d, name, 16, y + 0.5, 17, i === 0 ? C.gold : C.ivory);
    stroke(d, [[6.6, y + 0.5], [9, y + 0.5]], C.muted, 0.6);
    if (i === 0) {
      [[-17, y + 0.7], [-11, y + 2.2], [-5, y + 0.2], [-1, y + 1]].forEach(([x, yy]) => { frame(d, x, yy, 1.3, 0.9, C.gold, 0.8); });
    } else if (i === 1) {
      stroke(d, [[-19, y + 0.2], [-14, y + 1], [-10, y - 0.3], [-5, y + 0.3], [1, y + 1]], C.cyan, 0.9, 0.16);
      stroke(d, [[-16, y + 2.2], [-10, y - 1.1], [-5, y - 1.2], [2, y + 0.3]], C.ivory, 0.65, 0.1);
    } else {
      for (let k = 0; k < 6; k++) {
        const yy = y + k * 0.45;
        stroke(d, [[-20 + k, yy], [-14, yy + 0.6], [-10, yy + 0.2], [-5, yy - 0.4], [2 - k, yy + 0.1]], C.muted, 0.5);
      }
    }
  });
  flow(d, [[-22, 4.5], [-22, -5.5], [-5, -8.2], [-5, 1.8]], C.gold, 6, 0.06);
  label(d, 'Совмещение пространственных слоёв', 14, -7.8, 12, C.cyan);
  return finish(d);
}

function ai() {
  const d = drawing('analysis');
  const inputs = [['Силы', 7], ['Снабжение', 2.3], ['Местность', -2.3], ['Разведка', -7]] as const;
  inputs.forEach(([name, y]) => { label(d, name, -21, y, 16); flow(d, [[-15, y], [-8, y], [-4, 0]], C.cyan, 4, 0.1); });
  const core = ring(d, 0, 0, 4.4, C.cyan); ring(d, 0, 0, 3.7, C.gold, 0.5);
  label(d, 'Анализ', 0, 0, 21); label(d, 'Взаимосвязи', 0, 7.5, 15, C.cyan);
  const outputs = [['Связи', 6], ['Риски', 0], ['Аргументы', -6]] as const;
  outputs.forEach(([name, y]) => { flow(d, [[4.5, 0], [10, y], [16, y]], C.gold, 3, 0.12); label(d, name, 21, y, 17, C.gold); });
  d.motions.push((t) => { core.scale.setScalar(1 + Math.sin(t * 0.6) * 0.04); });
  return finish(d);
}

function variants() {
  const d = drawing('parameters');
  label(d, 'Исходная обстановка', -18, 8, 17, C.cyan);
  ring(d, -20, 0, 2.2); label(d, 'S', -20, 0, 25);
  label(d, 'Направление', -6.5, 9, 14, C.gold); label(d, 'Время и резервы', 9, 9, 14, C.gold); label(d, 'Варианты', 22, 9, 14, C.gold);
  [-5.7, 0, 5.7].forEach((y) => {
    flow(d, [[-17.7, 0], [-12, 0], [-7, y]], C.cyan, 4, 0.09);
    ring(d, -7, y, 0.7, C.cyan); dot(d, -7, y);
    [-1.2, 1.2].forEach((delta) => {
      const yy = y + delta;
      flow(d, [[-6.3, y], [2, y], [8, yy], [21.5, yy]], C.gold, 6, 0.055);
      frame(d, 22, yy, 2.8, 1.7, C.gold, 0.65);
    });
  });
  label(d, 'Изменение условий создаёт новые сценарии', 0, -9, 14, C.muted);
  return finish(d);
}

function decision() {
  const d = drawing('criteria');
  title(d, 'Основания для взвешенного решения');
  const criteria = ['Цель', 'Ресурсы', 'Риски', 'Время'];
  const xs = [-18, -6, 6, 18];
  xs.forEach((x, i) => { label(d, criteria[i], x, 5.5, 17, C.cyan); ring(d, x, 1.6, 2.6, i % 2 ? C.gold : C.cyan); });
  label(d, '◎', -18, 1.6, 32); label(d, '≋', -6, 1.6, 32); label(d, '△', 6, 1.6, 32); label(d, 'Δt', 18, 1.6, 23);
  xs.forEach((x) => flow(d, [[x, -1.2], [x, -4], [0, -4], [0, -6.2]], C.gold, 5, 0.07));
  label(d, 'Сопоставление последствий', 0, -8, 19, C.ivory);
  return finish(d);
}

function berlin() {
  const d = drawing('berlin');
  label(d, 'Берлинская операция', -12, 9.2, 18, C.cyan);
  const project = (ll: readonly number[]): Point => [-24 + (ll[0] - 12.8) * 14.8, -7 + (ll[1] - 51.5) * 11];
  for (let x = -24; x <= 7; x += 4) stroke(d, [[x, -8], [x, 8]], C.muted, 0.15);
  for (let y = -8; y <= 8; y += 4) stroke(d, [[-24, y], [7, y]], C.muted, 0.15);
  const wanted = ['Берлин', 'Зелов', 'Котбус', 'Торгау', 'Хальбе', 'Эберсвальде'];
  MAP.cities.filter((city) => wanted.includes(city.name)).forEach((city) => {
    const [x, y] = project(city.at); ring(d, x, y, city.capital ? 0.55 : 0.24, city.capital ? C.gold : C.cyan); dot(d, x, y, city.capital ? C.gold : C.cyan, city.capital ? 0.17 : 0.08);
    label(d, city.name, x, y + (city.name === 'Эберсвальде' ? -1.2 : city.capital ? 1.3 : 1), city.capital ? 15 : 12, city.capital ? C.gold : C.ivory);
  });
  const categories = ['Картография', 'Боевой состав', 'Хронология'];
  categories.forEach((name, i) => {
    const y = 6 - i * 5.5;
    frame(d, 18, y, 12, 3.7, i === 1 ? C.gold : C.cyan, 0.5); label(d, name, 18, y, 16);
    flow(d, [[11.5, y], [9.4, y], [9.4, 0], [7, 0]], i === 1 ? C.gold : C.cyan, 3, 0.09);
  });
  label(d, 'Открытые исторические данные', -10, -9.3, 13, C.muted);
  return finish(d);
}

function scale() {
  const d = drawing('scale');
  title(d, 'Расширение модели под новые условия');
  const levels = [{ x: -19, w: 7, h: 7, text: 'Операция' }, { x: -3, w: 12, h: 11, text: 'Театр' }, { x: 17, w: 15, h: 14, text: 'Новые задачи' }];
  levels.forEach(({ x, w, h, text }, i) => {
    frame(d, x, 0, w, h, i === 2 ? C.gold : C.cyan, 0.7); label(d, text, x, -h / 2 - 1.6, 15, i === 2 ? C.gold : C.ivory);
    for (let row = 1; row < 4; row++) stroke(d, [[x - w / 2, -h / 2 + row * h / 4], [x + w / 2, -h / 2 + row * h / 4]], C.muted, 0.25);
    for (let col = 1; col < 4; col++) stroke(d, [[x - w / 2 + col * w / 4, -h / 2], [x - w / 2 + col * w / 4, h / 2]], C.muted, 0.25);
    if (i < 2) flow(d, [[x + w / 2 + 0.5, 0], [levels[i + 1].x - levels[i + 1].w / 2 - 0.5, 0]], C.gold, 3, 0.18);
  });
  label(d, 'Новые данные', -3, 1.7, 12); label(d, 'Настройка', -3, -1.7, 12);
  label(d, 'Адаптация', 17, 2.8, 14); label(d, 'Проверка', 17, -2.8, 14);
  return finish(d);
}

function final() {
  const d = drawing('final');
  title(d, 'Цифровая модель операции');
  const table = new THREE.Group();
  table.rotation.set(0.46, -0.16, -0.075);
  table.position.y = 1.3;
  d.group.add(table);
  const surface: Drawing = { group: table, motions: d.motions };
  const plateGeometry = new THREE.BoxGeometry(42, 14, 1.05);
  const plate = new THREE.Mesh(plateGeometry, new THREE.MeshBasicMaterial({ color: '#102c40' }));
  table.add(plate);
  table.add(new THREE.LineSegments(new THREE.EdgesGeometry(plateGeometry), new THREE.LineBasicMaterial({ color: C.cyan, transparent: true, opacity: 0.8 })));

  // Ячейки — элементы общей основы, а не столбцы с выдуманными результатами расчёта.
  const columns = 24, rows = 7;
  const cells = new THREE.InstancedMesh(new THREE.BoxGeometry(1.48, 1.48, 0.3), new THREE.MeshBasicMaterial({ color: '#ffffff' }), columns * rows);
  const colors = ['#26566c', '#2c6972', '#48566a', '#77643d'].map(value => new THREE.Color(value));
  for (let i = 0; i < columns * rows; i++) cells.setColorAt(i, colors[Math.floor((i % columns) / 6)]);
  cells.frustumCulled = false;
  table.add(cells);
  const matrix = new THREE.Matrix4();
  d.motions.push((_t, p) => {
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const progress = Math.max(0, Math.min(1, (p * 2.8 - col * 0.008 - row * 0.012) / 0.4));
      const settled = progress * progress * (3 - 2 * progress);
      matrix.makeTranslation((col - 11.5) * 1.62, (row - 3) * 1.62, -0.25 + settled);
      cells.setMatrixAt(row * columns + col, matrix);
    }
    cells.instanceMatrix.needsUpdate = true;
  });

  const [west, south, east, north] = MAP.bbox;
  const project = (ll: readonly number[]): Point => [-18 + (ll[0] - west) / (east - west) * 36, -5 + (ll[1] - south) / (north - south) * 10, 1.25];
  const wanted = ['Берлин', 'Зелов', 'Котбус', 'Торгау'];
  for (const city of MAP.cities.filter(city => wanted.includes(city.name))) {
    const at = project(city.at);
    const marker = dot(surface, at[0], at[1], city.capital ? C.gold : C.ivory, city.capital ? 0.24 : 0.15);
    marker.position.z = 1.4;
    const name = label(surface, city.name, at[0], at[1] + (city.name === 'Котбус' ? -1 : 1.15), city.capital ? 16 : 12, city.capital ? C.ivory : '#c7d9df');
    name.position.z = 1.7;
  }
  // Исторические положения обозначают операционный контекст уже собранного поля.
  MAP.armies.filter(army => army.track[0]).forEach(army => {
    const at = project(army.track[0]!);
    if (Math.abs(at[0]) > 18 || Math.abs(at[1]) > 5) return;
    const token = frame(surface, at[0], at[1], 0.55, 0.35, army.side === 'su' ? C.cyan : C.gold, 0.85);
    token.position.z = 1.2;
  });
  const sweep = stroke(surface, [[-20, -6, 1.5], [-20, 6, 1.5]], C.cyan, 0.55, 0.1);
  d.motions.push((_t, p) => { sweep.position.x = p * 40; sweep.material.opacity = 0.6 * Math.sin(Math.PI * p); });
  const components = ['Данные', 'Математика', 'Агенты', 'Пространство'];
  components.forEach((name, i) => {
    const x = -18 + i * 12;
    stroke(d, [[x - 4.3, -9.1], [x + 4.3, -9.1]], i === 3 ? C.gold : C.cyan, 0.7, 0.085);
    label(d, name, x, -10.5, 15, i === 3 ? C.gold : C.ivory);
  });
  return finish(d);
}

export async function buildIntroFactors(scene: THREE.Scene, camera: THREE.PerspectiveCamera): Promise<IntroAnimation> {
  const demo = await introCommandTable();
  return playIntroPanels(scene, camera, {
    identity: identity(), demo, archive: archive(), math: math(), agents: agents(), factors: factors(), space: space(),
    ai: ai(), variants: variants(), decision: decision(), berlin: berlin(), scale: scale(), final: final(),
  });
}
