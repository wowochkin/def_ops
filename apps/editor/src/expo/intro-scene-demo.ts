/** Демонстрационный стенд: командный стол и историческое движение войск на реальной географии. */
import * as THREE from 'three';
import type { Scenario, TheatreData } from '@def-ops/sim';
import { BANK } from './bank';
import { MAP, historyAt } from './map';
import { introLabel } from './intro-scene';
import type { SideShot } from './intro-scene-panels';
import { atlas, fieldGrid, INK, ribbon, smooth, type Atlas } from './intro-scene-worlds';
import type { IntroPoint } from './intro-terrain';

const PAPER = 0xcbdce3;
function text(g: THREE.Group, value: string, x: number, y: number, size = 14, color = '#d2e3e9') {
  const s = introLabel(value, size, color, true); s.position.set(x, y, 0); g.add(s); return s;
}
function segment(g: THREE.Group, points: THREE.Vector3[], color: number, opacity = 1) {
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
  g.add(line); return line;
}
function plate(w: number, h: number, d: number, color: number) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.6 }));
}
function token(color: number) {
  const g = new THREE.Group();
  const base = plate(3.3, 0.8, 2.1, color); base.position.y = 0.8; g.add(base);
  const top = plate(2.5, 0.24, 1.4, 0x102030); top.position.y = 1.32; g.add(top);
  for (const sign of [-1, 1]) segment(g, [new THREE.Vector3(-0.85, 1.46, sign * .45), new THREE.Vector3(.85, 1.46, -sign * .45)], PAPER);
  const pin = plate(.18, 3.2, .18, color); pin.position.y = 1.8; g.add(pin);
  return g;
}

/** Загружается вместе с конкретным панно; всё остаётся в локальной базе приложения. */
async function theatre() {
  const { getData } = await import('../sim/userdata');
  const scenario = await getData('scenarios', `${BANK.context}.json`) as Scenario;
  return await getData('theatres', `${scenario.theatre}.json`) as TheatreData;
}
function stage(name: string, data: TheatreData, right: boolean) {
  const group = new THREE.Group(); group.name = name;
  group.add(new THREE.HemisphereLight(0xc7e8fa, 0x102034, 1.8));
  const key = new THREE.DirectionalLight(0xd3e6ff, 1.8); key.position.set(-15, 25, 30); group.add(key);
  const edge = new THREE.DirectionalLight(0x72cedc, 1.3); edge.position.set(20, -10, -10); group.add(edge);
  const map = atlas(data, right ? [12.35, 51.1, 14.85, 53.05] : [12.9, 52.05, 14.85, 52.9]);
  map.units.visible = false; map.labels.visible = false;
  const table = new THREE.Group(); table.add(map.group); group.add(table);
  const scale = right ? .2 : .255;
  table.scale.setScalar(scale);
  table.rotation.set(right ? .48 : 1.06, 0, right ? -.035 : -.13);
  table.position.set(right ? 0 : -7.5, right ? 1 : -.5, right ? -8 : -5);
  // Настоящая толщина стола, подсветка кромки и опоры дают глубину без постобработки.
  const chassis = plate(map.width + 5, 4.5, map.depth + 5, 0x102a3e);
  chassis.position.y = -3; map.group.add(chassis);
  const border = new THREE.LineSegments(new THREE.EdgesGeometry(chassis.geometry), new THREE.LineBasicMaterial({ color: INK.cyan, transparent: true, opacity: .5 }));
  border.position.copy(chassis.position); map.group.add(border);
  const underlay = fieldGrid(map.width + 16, map.depth + 16, INK.cyan, 5); underlay.position.y = -6; map.group.add(underlay);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const foot = plate(4, 8, 4, 0x173c50); foot.position.set(x * (map.width / 2 - 4), -8, z * (map.depth / 2 - 4)); map.group.add(foot);
  }
  // Подписи читаются поверх географии, но не закрывают полки с приказами.
  const wanted = right ? ['Берлин', 'Зелов', 'Котбус', 'Торгау', 'Хальбе'] : ['Берлин', 'Зелов', 'Потсдам', 'Франкфурт'];
  for (const city of MAP.cities.filter(c => wanted.includes(c.name))) {
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(city.capital ? 1.5 : .7, city.capital ? 1.5 : .7, .8, 24), new THREE.MeshBasicMaterial({ color: city.capital ? INK.amber : PAPER }));
    marker.position.copy(map.point(city.at, 1)); map.group.add(marker);
    const label = introLabel(city.name, city.capital ? 44 : 34, city.capital ? '#f2deb1' : '#c2d5dd', true);
    label.position.copy(map.point(city.at, city.capital ? 12 : 7)); map.group.add(label);
  }
  return { group, map, table };
}

function course(map: Atlas, via: IntroPoint[], color: number, width: number) {
  const points = new THREE.CatmullRomCurve3(via.map(p => map.point(p, 2))).getPoints(96);
  const g = new THREE.Group();
  const glow = ribbon(points, width * 4, color, .12), core = ribbon(points, width, color, .9);
  g.add(glow, core);
  const head = new THREE.Mesh(new THREE.ConeGeometry(width * 2.2, width * 4.5, 3), new THREE.MeshBasicMaterial({ color }));
  g.add(head); map.group.add(g);
  const direction = new THREE.Vector3();
  return { group: g, update(p: number) {
    const k = Math.max(1, Math.min(points.length - 1, Math.floor(p * (points.length - 1))));
    core.geometry.setDrawRange(0, k * 6); glow.geometry.setDrawRange(0, k * 6);
    head.position.copy(points[k]); direction.copy(points[k]).sub(points[k - 1]).normalize();
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  } };
}

export async function introCommandTable(): Promise<SideShot> {
  const { group, map, table } = stage('factors-demo', await theatre(), false);
  text(group, 'Обстановка становится приказом', -7, 11, 19, '#dcebf0');
  text(group, 'Берлинская операция · Командный стол', -7, -12, 12, '#829fae');
  const routes = [
    course(map, [[14.62, 52.58], [14.4, 52.57], [14.12, 52.54], [13.405, 52.52]], INK.amber, 1.15),
    course(map, [[14.62, 52.58], [14.28, 52.73], [13.85, 52.76], [13.405, 52.52]], INK.cyan, .5),
    course(map, [[14.62, 52.58], [14.3, 52.35], [13.85, 52.3], [13.405, 52.52]], INK.cyan, .5),
  ];
  const armyMarkers = historyAt(MAP.days[0]).filter(a => a.front === 'su_1bf' && a.at[1] > 52.15 && a.at[1] < 52.85);
  for (const a of armyMarkers) {
    const unit = token(INK.cyan); unit.scale.setScalar(1.5); unit.position.copy(map.point(a.at, 1)); map.group.add(unit);
  }
  // Командный штандарт, объёмный знак и нисходящие связи к армиям.
  const headquarters = map.point([14.7, 52.65], 14);
  const hq = plate(14, 8, 1, 0x163b50); hq.position.copy(headquarters); map.group.add(hq);
  const hqTitle = introLabel('1-й Белорусский', 36, '#d2e3e9', true); hqTitle.position.copy(headquarters).add(new THREE.Vector3(0, 5, 0)); map.group.add(hqTitle);
  armyMarkers.forEach(a => segment(map.group, [headquarters, map.point(a.at, 2)], INK.cyan, .35));
  const shelf = new THREE.Group(); shelf.position.set(20, 0, 2); group.add(shelf);
  text(shelf, 'Ваше решение', 0, 9, 16, '#e5b765');
  const names = ['Оценить обстановку', 'Выбрать действие', 'Отдать приказ'];
  const surfaces: THREE.Mesh[] = [];
  names.forEach((name, i) => {
    const y = 5.5 - i * 5;
    const card = plate(13, 3.8, .65, i === 2 ? 0x594d31 : 0x163649); card.position.set(0, y, -.5); shelf.add(card); surfaces.push(card);
    const trim = plate(.1, 3.8, .7, i === 2 ? INK.amber : INK.cyan); trim.position.set(-6.45, y, -.4); shelf.add(trim);
    text(shelf, name, .1, y + .1, 12, i === 2 ? '#f3d8a1' : '#d2e3e9');
    if (i < 2) segment(shelf, [new THREE.Vector3(0, y - 2, 0), new THREE.Vector3(0, y - 2.9, 0)], INK.cyan, .5);
  });
  text(shelf, 'Обстановка → решение → действие', 0, -9, 9, '#829fae');
  return { group, camera: { distance: 90, fov: 17 }, animate: (_t, progress, reduced) => {
    const p = reduced ? .65 : progress;
    table.rotation.z = -.13 + p * .08;
    routes[0].update(smooth((p - .15) / .65)); routes[1].update(.75); routes[2].update(.65);
    routes[1].group.visible = p < .65; routes[2].group.visible = p < .65;
    surfaces.forEach((card, i) => {
      card.position.z = -.5 + (i === Math.min(2, Math.floor(p * 3)) ? .7 : 0);
      (card.material as THREE.MeshStandardMaterial).emissive.setHex(i === Math.min(2, Math.floor(p * 3)) ? 0x243c42 : 0);
    });
  } };
}

export async function introOperationPlayback(): Promise<SideShot> {
  const { group, map, table } = stage('swarm-demo', await theatre(), true);
  text(group, 'Увидеть операцию в движении', 0, 11.5, 20, '#dcebf0');
  // Исторические положения привязаны ко времени; нет выдуманных результатов новой симуляции.
  const ids = ['su_47a', 'su_3ua', 'su_5ua', 'su_8gva', 'su_1gta', 'su_2gta', 'su_3gta', 'su_4gta', 'su_5gva'];
  const armies = MAP.armies.filter(a => ids.includes(a.id));
  const first = Date.parse(MAP.days[0] + ':00Z'), last = Date.parse(MAP.days.at(-1)! + ':00Z');
  const tracks = armies.map(a => {
    const color = a.front === 'su_1uf' ? INK.amber : INK.cyan;
    const unit = token(color); unit.scale.setScalar(1.5); map.group.add(unit);
    const tag = introLabel(a.label, 22, a.front === 'su_1uf' ? '#e5c88d' : '#b6edeb', true); unit.add(tag); tag.position.set(0, 7, 0); tag.visible = ['su_47a', 'su_1gta', 'su_3gta', 'su_5gva'].includes(a.id);
    const positions = a.track.flatMap((p, i) => p ? [{ at: p, time: Date.parse(MAP.days[i] + ':00Z') }] : []);
    const vertices: THREE.Vector3[] = [];
    // Сохранить реальные временные интервалы, чтобы продвижение не обгоняло маркер армии.
    for (let i = 1; i < positions.length; i++) {
      const a = positions[i - 1], b = positions[i];
      for (let k = 0; k < 5; k++) vertices.push(map.point([a.at[0] + (b.at[0] - a.at[0]) * k / 5, a.at[1] + (b.at[1] - a.at[1]) * k / 5], 2));
    }
    if (positions.length) vertices.push(map.point(positions.at(-1)!.at, 2));
    const trail = ribbon(vertices, 1.1, color, .8), glow = ribbon(vertices, 3.8, color, .1);
    map.group.add(glow, trail);
    const startMarker = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.7, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .5 }));
    startMarker.rotation.x = -Math.PI / 2; startMarker.position.copy(map.point(positions[0].at, .5)); map.group.add(startMarker);
    return { id: a.id, unit, trail, glow, positions };
  });
  const timeline = new THREE.Group(); timeline.position.set(0, -10.7, 3); group.add(timeline);
  segment(timeline, [new THREE.Vector3(-25, 0, 0), new THREE.Vector3(25, 0, 0)], INK.cyan, .55);
  const dates = ['16 апреля', '20 апреля', '25 апреля', '1 мая'];
  [-25, -12, 4, 25].forEach((x, i) => {
    segment(timeline, [new THREE.Vector3(x, -.3, 0), new THREE.Vector3(x, .3, 0)], PAPER, .7);
    text(timeline, dates[i], x, -1, 10, '#94abb7');
  });
  const cursor = new THREE.Mesh(new THREE.BoxGeometry(.16, .9, .16), new THREE.MeshBasicMaterial({ color: INK.amber, depthTest: false })); cursor.renderOrder = 10; timeline.add(cursor);
  text(group, 'Исторический пример · Траектории соединений', 0, 9.8, 11, '#829fae');
  return { group, camera: { distance: 90, fov: 17 }, animate: (_t, progress, reduced) => {
    const p = reduced ? .6 : smooth(progress);
    const timestamp = first + (last - first) * p;
    const current = new Map(historyAt(new Date(timestamp).toISOString().slice(0, 16)).map(a => [a.id, a.at]));
    table.rotation.z = -.035 + p * .07;
    for (const track of tracks) {
      const at = current.get(track.id); track.unit.visible = Boolean(at);
      if (at) track.unit.position.copy(map.point(at, 1));
      let end = 0;
      for (let i = 1; i < track.positions.length; i++) {
        const a = track.positions[i - 1], b = track.positions[i];
        end += Math.max(0, Math.min(1, (timestamp - a.time) / (b.time - a.time))) * 5;
      }
      track.trail.geometry.setDrawRange(0, Math.floor(end) * 6);
      track.glow.geometry.setDrawRange(0, Math.floor(end) * 6);
    }
    cursor.position.x = -25 + p * 50;
  } };
}
