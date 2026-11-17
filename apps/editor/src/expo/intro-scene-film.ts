/** Двенадцать монтажных сцен: живой штабной атлас, от источника до решения. */
import * as THREE from 'three';
import type { Scenario, TheatreData } from '@def-ops/sim';
import { BANK, placeAt } from './bank';
import { INTRO_CUES, type IntroSceneId } from './intro-story';
import { INTRO_BERLIN, INTRO_ODER, type IntroPoint } from './intro-terrain';
import { introLabel, type IntroAnimation } from './intro-scene';
import { atlas, capitalHalo, fieldGrid, INK, pointLight, route, smooth, type Atlas } from './intro-scene-worlds';
import atlasUrl from '../../demo/reference/berlin-atlas.jpg?url';

type Division = { id: string; hq: string; side: string; personnel: number; pos: IntroPoint };
type Headquarters = { id: string; parent: string | null; echelon: string; pos: IntroPoint };
type Agents = { divisions: Division[]; hqs: Headquarters[] };
type Shot = { group: THREE.Group; animate: (t: number, p: number, reduced: boolean) => void };
const up = new THREE.Vector3(0, 1, 0);

/** Центр картины чуть правее оси камеры: слева остаётся воздух под крупный текст. */
function pose(camera: THREE.PerspectiveCamera, eye: number[], target: number[], fov = 43, offset = 0.14) {
  camera.position.fromArray(eye);
  const at = new THREE.Vector3().fromArray(target);
  const right = at.clone().sub(camera.position).cross(up).normalize();
  at.addScaledVector(right, -camera.position.distanceTo(at) * offset);
  camera.lookAt(at);
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
}

function copyAtlas(base: Atlas) {
  const group = base.group.clone(true);
  group.visible = true;
  return { ...base, group,
    surface: group.getObjectByName('surface') as THREE.Group,
    rivers: group.getObjectByName('rivers') as THREE.Group,
    roads: group.getObjectByName('roads') as THREE.Group,
    labels: group.getObjectByName('labels') as THREE.Group,
    units: group.getObjectByName('units') as THREE.Group,
  };
}

function addFrame(parent: THREE.Group, width: number, depth: number, y: number, opacity = 0.35) {
  const pts = [new THREE.Vector3(-width / 2, y, -depth / 2), new THREE.Vector3(width / 2, y, -depth / 2), new THREE.Vector3(width / 2, y, depth / 2), new THREE.Vector3(-width / 2, y, depth / 2)];
  parent.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: INK.cyan, opacity, transparent: true })));
}

function variantRoute(a: Atlas, i: number, width = 1.5) {
  const cards = BANK.cards.filter((c) => c.front === 'su_1bf' && c.turn === 1).slice(0, 5);
  const card = cards[i % cards.length];
    const destination = card.orders.map((o) => o.place ? placeAt(o.place) : null).find((p): p is IntroPoint => p !== null)
      ?? ([14.32, 52.52] as IntroPoint);
    const start: IntroPoint = [14.62, 52.59 - i * 0.025];
    return { ...route(a, [start, destination, INTRO_BERLIN], INK.amber, width), title: card.title };
}

function hierarchy(a: Atlas, agents: Agents) {
  const group = new THREE.Group();
  const hqs = new Map(agents.hqs.map((h) => [h.id, h]));
  const level = (e: string) => e === 'front' ? 36 : e === 'army' ? 24 : e === 'corps' ? 12 : 45;
  const positions: number[] = [];
  const hqPoints = agents.hqs.filter((h) => h.pos).map((h) => ({ h, at: a.point(h.pos, level(h.echelon)) }));
  const bounds = a.terrain.bounds;
  const visible = (ll: IntroPoint) => ll[0] >= bounds[0] && ll[0] <= bounds[2] && ll[1] >= bounds[1] && ll[1] <= bounds[3];
  for (const { h, at } of hqPoints) {
    if (!visible(h.pos)) continue;
    const parent = h.parent ? hqs.get(h.parent) : undefined;
    if (parent?.pos && visible(parent.pos)) positions.push(...at.toArray(), ...a.point(parent.pos, level(parent.echelon)).toArray());
    const node = pointLight(h.id.startsWith('su') ? INK.cyan : INK.amber, h.echelon === 'front' ? 2.6 : 1.35);
    node.position.copy(at); group.add(node);
  }
  for (const d of agents.divisions) {
    const h = hqs.get(d.hq);
    if (h?.pos && visible(d.pos) && visible(h.pos)) positions.push(...a.point(d.pos, 1.8).toArray(), ...a.point(h.pos, level(h.echelon)).toArray());
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)), new THREE.LineBasicMaterial({ color: INK.cyan, opacity: 0.32, transparent: true, depthWrite: false })));
  return group;
}

function divisions(a: Atlas, agents: Agents) {
  const valid = agents.divisions.filter((d) => d.pos && d.pos[0] >= a.terrain.bounds[0] && d.pos[0] <= a.terrain.bounds[2] && d.pos[1] >= a.terrain.bounds[1] && d.pos[1] <= a.terrain.bounds[3]);
  const geometry = new THREE.BoxGeometry(1.1, 0.65, 0.8);
  const material = new THREE.MeshStandardMaterial({ color: INK.ivory, emissive: 0x133d53, emissiveIntensity: 0.65, roughness: 0.5, metalness: 0.25 });
  const tokens = new THREE.InstancedMesh(geometry, material, valid.length);
  const mat = new THREE.Matrix4(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1);
  valid.forEach((d, i) => { tokens.setMatrixAt(i, mat.compose(a.point(d.pos, 1.1), rotation, scale)); tokens.setColorAt(i, new THREE.Color(d.side === 'su' ? INK.cyan : INK.amber)); });
  const marks: number[] = [];
  valid.forEach((d) => {
    const p = a.point(d.pos, 1.47);
    marks.push(p.x - 0.4, p.y, p.z - 0.25, p.x + 0.4, p.y, p.z + 0.25, p.x - 0.4, p.y, p.z + 0.25, p.x + 0.4, p.y, p.z - 0.25);
  });
  const group = new THREE.Group(); group.add(tokens);
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(marks, 3)), new THREE.LineBasicMaterial({ color: INK.navy })));
  return group;
}

function mathField(agents: Agents) {
  const group = new THREE.Group(), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 1, 1.3), new THREE.MeshStandardMaterial({ color: INK.cyan, metalness: 0.55, roughness: 0.3, emissive: 0x0d4048, emissiveIntensity: 0.5 }), agents.divisions.length);
  const tops: THREE.Vector3[] = [];
  agents.divisions.forEach((d, i) => {
    const height = Math.max(0.5, Math.sqrt(Math.max(0, d.personnel)) / 12);
    const x = (i % 22 - 10.5) * 1.9, z = (Math.floor(i / 22) - 7.5) * 1.9;
    mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, height / 2, z), rotation, new THREE.Vector3(1, height, 1)));
    mesh.setColorAt(i, new THREE.Color(d.side === 'su' ? INK.cyan : INK.amber));
    tops.push(new THREE.Vector3(x, height, z));
  });
  group.add(mesh, fieldGrid(58, 46, INK.cyan, 3.8));
  const lines: number[] = [];
  tops.forEach((p, i) => { if (i % 22 !== 21 && tops[i + 1]) lines.push(...p.toArray(), ...tops[i + 1].toArray()); });
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)), new THREE.LineBasicMaterial({ color: INK.ivory, transparent: true, opacity: 0.6 })));
  return group;
}

async function archiveSpace() {
  const group = new THREE.Group();
  const texture = await new THREE.TextureLoader().loadAsync(atlasUrl).catch(() => null);
  if (texture) texture.colorSpace = THREE.SRGBColorSpace;
  for (let i = 0; i < 4; i++) {
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(35, 48), new THREE.MeshBasicMaterial({ map: texture, color: texture ? 0xc5d3dc : INK.blue, side: THREE.DoubleSide, transparent: true, opacity: 0.76 - i * 0.12 }));
    paper.rotation.set(-Math.PI * 0.39, 0, -0.09 + i * 0.05);
    paper.position.set(i * 9 - 9, -i * 3, -i * 15);
    group.add(paper);
  }
  const beam = new THREE.Mesh(new THREE.PlaneGeometry(68, 0.25), new THREE.MeshBasicMaterial({ color: INK.cyan, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
  beam.rotation.x = -Math.PI / 2; beam.position.y = 12; group.add(beam);
  return { group, beam };
}

export async function buildIntroFilm(scene: THREE.Scene, camera: THREE.PerspectiveCamera): Promise<IntroAnimation> {
  const [{ getData }, agentModule] = await Promise.all([import('../sim/userdata'), import('../../../../packages/sim/data/scenarios/agents/berlin-1945.json')]);
  const scenario = await getData('scenarios', `${BANK.context}.json`) as Scenario;
  const [data, cityData] = await Promise.all([
    getData('theatres', `${scenario.theatre}.json`) as Promise<TheatreData>,
    getData('theatres', 'berlin-city-1945.json') as Promise<TheatreData>,
  ]);
  const agents = agentModule.default as unknown as Agents;
  const base = atlas(data), cityBase = atlas(cityData, [13.24, 52.44, 13.49, 52.59], true);
  const city = cityBase.group;
  // Базы включены в дерево, поэтому общий disposal освобождает и ресурсы клонированных карт.
  base.group.visible = false; city.visible = false;
  scene.add(base.group, city);
  scene.fog = new THREE.FogExp2(INK.navy, 0.0015);
  scene.add(new THREE.HemisphereLight(0xc1e0e8, 0x061121, 2.1));
  const key = new THREE.DirectionalLight(0xd0edee, 2.3); key.position.set(-120, 180, 90); scene.add(key);
  const rim = new THREE.DirectionalLight(INK.cyan, 1.3); rim.position.set(130, 25, -100); scene.add(rim);
  camera.far = 1200; camera.updateProjectionMatrix();
  const scenes = new Map<IntroSceneId, Shot>();
  const add = (id: IntroSceneId, group: THREE.Group, animate: Shot['animate']) => { group.visible = false; scene.add(group); scenes.set(id, { group, animate }); };

  // Визитная карточка: крупный театр, ясные реки, города, стрелки к Берлину.
  const identity = copyAtlas(base);
  identity.group.add(capitalHalo(identity));
  const identityRoutes = [
    route(identity, [[14.62, 52.59], [14.14, 52.72], [13.73, 52.65], INTRO_BERLIN], INK.cyan, 1.8),
    route(identity, [[14.7, 51.7], [14.1, 51.86], [13.5, 52.2], INTRO_BERLIN], INK.amber, 1.8),
  ];
  identityRoutes.forEach((r) => identity.group.add(r.group));
  add('identity', identity.group, (t, p) => { pose(camera, [150 - p * 18, 175 - p * 12, 205 - p * 15], [12, 0, -4], 44); identityRoutes.forEach((r, i) => r.update(t * 0.12 + i * 0.4)); });

  // Стенд: один приказ на карте и движение к его цели.
  const demo = copyAtlas(base);
  const demoOrder = route(demo, [[14.72, 51.72], [14.1, 51.86], [13.5, 52.2]], INK.amber, 2.2);
  demo.group.add(demoOrder.group);
  const demoTarget = pointLight(INK.amber, 2);
  demoTarget.position.copy(demo.point([13.5, 52.2], 4)); demo.group.add(demoTarget);
  const demoLabel = introLabel('Ваш приказ → Ход операции', 24, '#f2ecdb');
  demoLabel.position.copy(demo.point([14.0, 51.55], 16)); demo.group.add(demoLabel);
  add('demo', demo.group, (t, p) => {
    pose(camera, [88 + p * 20, 190 - p * 20, 204 - p * 15], [15, 0, 8], 44);
    demoOrder.update(t * 0.12);
    demoTarget.scale.setScalar(1 + Math.sin(t * 1.4) * 0.1);
  });

  // Источники: реальные карты уходят в глубину, сканирующая плоскость движется поверх.
  const archive = await archiveSpace();
  add('archive', archive.group, (_t, p) => { pose(camera, [49 - p * 6, 42, 82 - p * 10], [9, 0, -11], 43, 0.19); archive.beam.position.z = 24 - p * 80; });

  // Математика: данные дивизий превращены в числовое поле, с хорошо видимым объёмом.
  const math = mathField(agents);
  add('math', math, (_t, p) => { pose(camera, [48 - p * 12, 43, 52 + p * 5], [0, 4, 0], 42, 0.2); math.rotation.y = -0.16 + p * 0.18; });

  // Агенты: вместо редких точек — множество единиц и несколько этажей командования.
  const agentWorld = copyAtlas(base);
  agentWorld.units.visible = false; agentWorld.labels.visible = false;
  agentWorld.group.add(divisions(agentWorld, agents));
  const chain = hierarchy(agentWorld, agents); agentWorld.group.add(chain);
  add('agents', agentWorld.group, (_t, p) => { pose(camera, [92 + p * 70, 98 + p * 55, 132 + p * 52], [28, 16, -25], 43); chain.position.y = smooth(p) * 3; });

  // Факторы: разделённые слои складываются в один театр, каждый видим отдельно.
  const factors = copyAtlas(base);
  factors.labels.visible = false;
  const factorTags = [['местность', 0], ['реки и дороги', 19], ['войска и снабжение', 39]] as const;
  factorTags.forEach(([name, height]) => {
    addFrame(factors.group, base.width, base.depth, height + 1, 0.35);
    const label = introLabel(name, 27, '#77e2df'); label.position.set(base.width / 2 - 20, height + 4, base.depth / 2 + 5); factors.group.add(label);
  });
  add('factors', factors.group, (_t, p) => {
    const spread = 0.6 + Math.sin(p * Math.PI) * 0.4;
    factors.rivers.position.y = 19 * spread; factors.roads.position.y = 19 * spread; factors.units.position.y = 39 * spread;
    pose(camera, [185 - p * 48, 128 + p * 14, 213 + p * 14], [8, 14, 0], 46);
  });

  // Пространство: камера опускается к Одеру и переправам, а не к вымышленным горам.
  const space = copyAtlas(base);
  const bridgeGeometry = new THREE.BoxGeometry(1.2, 0.35, 0.55);
  for (const bridge of data.bridges) {
    if (bridge.at[0] < 13.7 || bridge.at[0] > 14.9 || bridge.at[1] < 51.8 || bridge.at[1] > 53.1) continue;
    const marker = new THREE.Mesh(bridgeGeometry, new THREE.MeshBasicMaterial({ color: INK.amber }));
    marker.position.copy(space.point(bridge.at, 0.7)); space.group.add(marker);
  }
  const oder = space.point(INTRO_ODER);
  const forward = route(space, [[14.62, 52.59], [14.38, 52.53], [13.98, 52.47]], INK.amber, 1.2); space.group.add(forward.group);
  add('space', space.group, (t, p) => { pose(camera, [oder.x + 46 - p * 12, 57 - p * 7, oder.z + 83 - p * 14], [oder.x - 21, 0, oder.z - 4], 45); forward.update(t * 0.16); });

  // ИИ: видимый поток сведений по реальным связям штабов, карта остаётся под ним.
  const aiWorld = copyAtlas(base); aiWorld.labels.visible = false;
  const aiChain = hierarchy(aiWorld, agents); aiWorld.group.add(aiChain);
  const nodes = [INTRO_ODER, [14.4, 51.7], [13.7, 52.7], [13.15, 52.45]] as IntroPoint[];
  const intelligence = nodes.map((ll, i) => {
    const a = aiWorld.point(ll, 1), b = aiWorld.point(INTRO_BERLIN, 49);
    const curve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3(a.x, 40, a.z), b);
    const geo = new THREE.TubeGeometry(curve, 64, 0.28, 6, false);
    const track = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: i % 2 ? INK.amber : INK.cyan, transparent: true, opacity: 0.6 }));
    const pulse = pointLight(i % 2 ? INK.amber : INK.cyan, 1.5);
    aiWorld.group.add(track, pulse);
    return { curve, pulse };
  });
  const resolve = introLabel('разбор обстановки', 36, '#f2ecdb'); resolve.position.copy(aiWorld.point(INTRO_BERLIN, 57)); aiWorld.group.add(resolve);
  add('ai', aiWorld.group, (t, p) => {
    pose(camera, [140 - p * 36, 113 + p * 10, 180 + p * 18], [0, 24, -8], 45);
    intelligence.forEach(({ curve, pulse }, i) => pulse.position.copy(curve.getPoint((t * 0.18 + i * 0.23) % 1)));
  });

  // Варианты: пять отдельных карт, пять действительных направлений из банка решений.
  const fan = new THREE.Group();
  const fanMaps = Array.from({ length: 5 }, (_, i) => {
    const a = copyAtlas(base); a.labels.visible = false; a.units.visible = false;
    a.group.scale.setScalar(0.26);
    const selected = variantRoute(a, i, 3.5);
    a.group.add(selected.group);
    const number = introLabel(`Вариант ${i + 1}`, 72, '#e5b765'); number.position.set(0, 1, -base.depth / 2 - 9); a.group.add(number);
    a.group.position.set((i - 2) * 29, Math.abs(i - 2) * 2.5, Math.abs(i - 2) * 11);
    a.group.rotation.y = -(i - 2) * 0.2;
    fan.add(a.group);
    return { a, selected };
  });
  add('variants', fan, (t, p) => { pose(camera, [45 - p * 22, 99 - p * 7, 153 - p * 12], [0, 1, 4], 45, 0.09); fanMaps.forEach(({ selected }, i) => selected.update(t * 0.12 + i * 0.2)); });

  // Решение: одна карта крупно, один приказ. Другие варианты остаются дальними следами.
  const decision = copyAtlas(base); decision.group.add(capitalHalo(decision));
  const chosen = variantRoute(decision, 1); decision.group.add(chosen.group);
  const command = introLabel('приказ', 15, '#e5b765'); command.position.copy(decision.point([14.03, 52.66], 7)); decision.group.add(command);
  add('decision', decision.group, (t, p) => { pose(camera, [80 - p * 15, 118 - p * 12, 125 - p * 7], [-1, 0, -12], 41, 0.19); chosen.update(t * 0.14); });

  // Берлин: другая сетка и крупность, кварталы, Шпрее, действительные городские ориентиры.
  const berlin = new THREE.Group(); city.visible = true; scene.remove(city); berlin.add(city);
  const landmarks: [string, IntroPoint][] = [['Рейхстаг', [13.3762, 52.5186]], ['Шпрее', [13.349, 52.521]], ['Тиргартен', [13.350, 52.514]], ['Темпельхоф', [13.386, 52.474]]];
  for (const [name, ll] of landmarks) {
    const marker = pointLight(name === 'Рейхстаг' ? INK.amber : INK.cyan, name === 'Рейхстаг' ? 0.35 : 0.15); marker.position.copy(cityBase.point(ll, 0.35)); city.add(marker);
    const label = introLabel(name, name === 'Рейхстаг' ? 2.2 : 1.8, name === 'Рейхстаг' ? '#f2ecdb' : '#b5d6dc'); label.position.copy(cityBase.point(ll, 0.7)); city.add(label);
  }
  const cityArrow = route(cityBase, [[13.449, 52.55], [13.407, 52.538], [13.3762, 52.5186]], INK.amber, 0.17); city.add(cityArrow.group);
  city.scale.setScalar(4);
  add('berlin', berlin, (t, p) => { pose(camera, [41 - p * 16, 69 - p * 11, 67 + p * 2], [3, 0, -4], 43, 0.17); cityArrow.update(t * 0.15); });

  // Масштаб: город, театр и сеть видны как разные уровни единой модели.
  const scale = new THREE.Group();
  const region = copyAtlas(base); region.labels.visible = false; region.units.visible = false;
  scale.add(region.group);
  const cityInset = city.clone(true); cityInset.scale.setScalar(1.9); cityInset.position.set(0, 36, -5); scale.add(cityInset);
  const broad = fieldGrid(320, 300, INK.cyan, 20); broad.position.y = -10; scale.add(broad);
  const stems = [new THREE.Vector3(-33, 0, -33), new THREE.Vector3(-33, 36, -33), new THREE.Vector3(33, 0, 33), new THREE.Vector3(33, 36, 33)];
  scale.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(stems), new THREE.LineBasicMaterial({ color: INK.cyan, transparent: true, opacity: 0.4 })));
  add('scale', scale, (_t, p) => { pose(camera, [91 + p * 110, 105 + p * 130, 122 + p * 140], [0, 16, 0], 44, 0.14); });

  // Возврат к целому: готовый театр и направленный поток вариантов к решению.
  const final = copyAtlas(base); final.group.add(capitalHalo(final));
  const finalRoutes = [
    route(final, [[14.62, 52.6], [14.08, 52.71], INTRO_BERLIN], INK.cyan, 1.8),
    route(final, [[14.72, 51.72], [13.8, 52.05], INTRO_BERLIN], INK.amber, 1.8),
    route(final, [[14.35, 53.09], [13.8, 52.82], INTRO_BERLIN], INK.cyan, 1.4),
  ];
  finalRoutes.forEach((r) => final.group.add(r.group));
  add('final', final.group, (t, p) => { pose(camera, [154 - p * 14, 176 - p * 9, 208 + p * 4], [0, 0, 0], 43, 0.16); finalRoutes.forEach((r, i) => r.update(t * 0.11 + i * 0.27)); });

  const shots = INTRO_CUES.map(cue => {
    const shot = scenes.get(cue.scene);
    if (!shot) throw new Error(`Нет центральной сцены интро: ${cue.scene}`);
    return shot;
  });
  let previous = -1;
  return (seconds: number, line: number, reduced: boolean, progress = 0) => {
    const index = Math.max(0, Math.min(shots.length - 1, Math.floor(line) - 1));
    if (previous !== index) { shots.forEach((shot, i) => { shot.group.visible = i === index; }); previous = index; }
    shots[index].animate(reduced ? 8 : seconds, reduced ? 0.5 : smooth(progress), reduced);
  };
}
