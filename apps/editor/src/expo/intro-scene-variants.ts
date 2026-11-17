/** Правое панно: тринадцать способов увидеть ход расчёта и пространство решений. */
import * as THREE from 'three';
import { introLabel, type IntroAnimation } from './intro-scene';
import { playIntroPanels, type SideShot } from './intro-scene-panels';
import { MAP, historyAt, type LL } from './map';
import { introOperationPlayback } from './intro-scene-demo';
import { introCommandFinale } from './intro-scene-finale';

const C = { cyan: 0x77e2df, gold: 0xe5b765, ivory: 0xf2ecdb, blue: 0x3a728e, muted: 0x466477, red: 0xc77f69 };
type XY = [number, number, number?];
const v = ([x, y, z = 0]: XY) => new THREE.Vector3(x, y, z);
const random = (i: number) => { const n = Math.sin(i * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };
const time = (seconds: number, reduced: boolean) => reduced ? 4 : seconds;

function label(g: THREE.Group, text: string, x: number, y: number, size = 14, color = C.ivory) {
  const sprite = introLabel(text, size, `#${color.toString(16).padStart(6, '0')}`, true);
  sprite.position.set(x, y, 0.5); g.add(sprite); return sprite;
}

function line(g: THREE.Group, points: XY[], color = C.cyan, opacity = 0.55) {
  const mesh = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(v)),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  g.add(mesh); return mesh;
}

function path(g: THREE.Group, points: XY[], color = C.cyan, opacity = 0.65, width = 0.045) {
  const curve = new THREE.CatmullRomCurve3(points.map(v));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 72, width, 4, false),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  g.add(mesh); return { curve, mesh };
}

function ring(g: THREE.Group, x: number, y: number, radius: number, color = C.cyan, opacity = 0.55) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(radius - 0.035, radius + 0.035, 72),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
  mesh.position.set(x, y, 0); g.add(mesh); return mesh;
}

function node(g: THREE.Group, x: number, y: number, color = C.cyan, radius = 0.22) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), new THREE.MeshBasicMaterial({ color }));
  mesh.position.set(x, y, 0.2); g.add(mesh);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(radius * 3.2, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, depthWrite: false }));
  glow.position.set(0, 0, -0.1); mesh.add(glow);
  return mesh;
}

function box(g: THREE.Group, x: number, y: number, w: number, h: number, color = C.cyan, opacity = 0.4) {
  return line(g, [[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2], [x - w / 2, y - h / 2]], color, opacity);
}

function particles(g: THREE.Group, count: number, color = C.ivory, size = 0.1) {
  const positions = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', positions);
  const mesh = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.85, depthWrite: false }));
  mesh.frustumCulled = false; g.add(mesh);
  return { mesh, positions };
}

function flow(g: THREE.Group, curve: THREE.Curve<THREE.Vector3>, count = 10, color = C.gold, speed = 0.045) {
  const { positions } = particles(g, count, color, 0.19);
  return (t: number, offset = 0) => {
    for (let i = 0; i < count; i++) {
      const p = curve.getPoint(((i / count + t * speed + offset) % 1 + 1) % 1);
      positions.setXYZ(i, p.x, p.y, p.z + 0.1);
    }
    positions.needsUpdate = true;
  };
}

function shot(name: string, build: (g: THREE.Group) => SideShot['animate']): SideShot {
  const group = new THREE.Group(); group.name = `variants-${name}`;
  return { group, animate: build(group) };
}

/** Источники сходятся к модели; после расчёта открываются разные возможные продолжения. */
function possibilities() {
  return shot('possibilities', g => {
    const inputs = [-6, 0, 6].map((y, i) => {
      label(g, ['Данные', 'Модель', 'Интеллект'][i], -19, y + 1.8);
      ring(g, -19, y, 1, i === 1 ? C.gold : C.cyan); node(g, -19, y, C.ivory);
      return flow(g, path(g, [[-18, y], [-10, y * 0.65], [-3, 0]], C.cyan, 0.45).curve, 14, C.cyan);
    });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(2.1, 0), new THREE.MeshBasicMaterial({ color: C.cyan, wireframe: true, transparent: true, opacity: 0.6 }));
    core.position.x = -1; g.add(core);
    ring(g, -1, 0, 3.4, C.gold, 0.4);
    label(g, 'Исследование боя', -1, -5.3, 17);
    const outputs = [-6, 0, 6].map((y, i) => {
      const route = path(g, [[2, 0], [10, y * 0.7], [19, y]], i === 1 ? C.gold : C.cyan, 0.6, 0.06);
      node(g, 19, y, i === 1 ? C.gold : C.cyan, 0.3);
      label(g, ['Вариант А', 'Вариант Б', 'Вариант В'][i], 20, y + 1.4, 12);
      return flow(g, route.curve, 14, i === 1 ? C.gold : C.ivory);
    });
    return (s, _p, reduced) => { const t = time(s, reduced); core.rotation.set(t * 0.08, t * 0.11, 0.15); inputs.forEach(f => f(t)); outputs.forEach(f => f(t)); };
  });
}

/** Шумная россыпь сведений превращается в согласованные группы записей. */
function records() {
  return shot('records', g => {
    label(g, 'Разрозненные сведения', -16, 9, 16);
    label(g, 'Структура для моделирования', 12, 9, 16, C.cyan);
    const raw = particles(g, 200, C.ivory, 0.13);
    const columns = [-1, 10, 21];
    columns.forEach((x, i) => {
      label(g, ['Состав', 'Положение', 'Хронология'][i], x, 6.3, 13);
      for (let row = 0; row < 6; row++) {
        const y = 4.4 - row * 2.2;
        box(g, x, y, 7.5, 1.35, C.cyan, 0.26);
        for (let k = 0; k < 4; k++) line(g, [[x - 2.9 + k * 1.8, y - 0.2], [x - 2.1 + k * 1.8, y - 0.2]], k === i ? C.gold : C.cyan, 0.6);
      }
    });
    const arrivals = columns.map((x, i) => flow(g, path(g, [[-17, -4 + i * 4], [-9, -4 + i * 3], [x, 4.4]], C.blue, 0.3).curve, 9, C.gold, 0.035));
    return (s, _p, reduced) => {
      const t = time(s, reduced);
      for (let i = 0; i < 200; i++) {
        const a = random(i + 7) * Math.PI * 2 + t * 0.025;
        raw.positions.setXYZ(i, -17 + Math.cos(a) * (1 + random(i + 41) * 5), Math.sin(a) * (2 + random(i + 81) * 4), random(i + 121) * 3 - 1.5);
      }
      raw.positions.needsUpdate = true; arrivals.forEach(f => f(t));
    };
  });
}

/** Качественные траектории состояния без придуманных результатов и числовых шкал. */
function calculation() {
  return shot('calculation', g => {
    label(g, 'Изменение состояния во времени', 0, 9.7, 18, C.cyan);
    const states = ['Исходное', 'Движение', 'Взаимодействие', 'Результат'];
    [-20, -7, 7, 21].forEach((x, i) => {
      line(g, [[x, -7], [x, 6.5]], C.muted, 0.4);
      label(g, states[i], x, -9, 13); node(g, x, -7, C.blue, 0.18);
    });
    line(g, [[-22, -7], [23, -7]], C.cyan, 0.6);
    const curves = [
      [[-20, 0], [-7, 5.3], [7, 2], [21, 5]],
      [[-20, 0], [-7, 1.3], [7, -1.5], [21, 1]],
      [[-20, 0], [-7, -2.3], [7, -4.3], [21, -3.7]],
    ] as XY[][];
    const streams = curves.map((pts, i) => {
      const c = path(g, pts, [C.cyan, C.gold, C.blue][i], 0.8, 0.065);
      node(g, pts[3][0], pts[3][1], [C.cyan, C.gold, C.blue][i], 0.26);
      return flow(g, c.curve, 22, [C.cyan, C.gold, C.ivory][i]);
    });
    const scan = line(g, [[0, -7], [0, 6.5]], C.gold, 0.4);
    return (s, p, reduced) => { streams.forEach(f => f(time(s, reduced))); scan.position.x = -20 + 41 * (reduced ? 0.6 : p); };
  });
}

/** От приказа к действиям отдельных агентов и обратной связи. */
function interactions() {
  return shot('interactions', g => {
    const positions: XY[] = [[-20, 5], [-20, -5], [-9, 8], [-9, -8], [9, 8], [9, -8], [20, 5], [20, -5]];
    ring(g, 0, 0, 3.7, C.gold, 0.65); ring(g, 0, 0, 4.2, C.gold, 0.15);
    label(g, 'Замысел', 0, 0.7, 18, C.gold); label(g, 'командующего', 0, -1, 13);
    const flows = positions.map(([x, y], i) => {
      line(g, [[x - 0.7, y], [x, y + 0.7], [x + 0.7, y], [x, y - 0.7], [x - 0.7, y]], C.cyan, 0.85);
      label(g, ['Движение', 'Разведка', 'Взаимодействие', 'Подвоз', 'Резерв', 'Обратная связь', 'Бой', 'Состояние'][i], x, y + (y > 0 ? 1.5 : -1.5), 12);
      const at = new THREE.Vector3(x, y, 0).normalize().multiplyScalar(4.3);
      return flow(g, path(g, [[at.x, at.y], [x * 0.75, y * 0.55], [x, y]], i % 2 ? C.blue : C.cyan, 0.5).curve, 8, i % 2 ? C.gold : C.cyan, i % 2 ? -0.035 : 0.035);
    });
    // Горизонтальные связи показывают взаимодействие соседних агентов.
    const cross = [[0, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 7]].map(([a, b]) => flow(g, path(g, [positions[a], [(positions[a][0] + positions[b][0]) / 2, positions[a][1] * 0.8, -1], positions[b]], C.muted, 0.3).curve, 5, C.ivory, 0.025));
    return (s, _p, reduced) => { const t = time(s, reduced); flows.forEach(f => f(t + 100)); cross.forEach(f => f(t)); };
  });
}

/** Последствие одного изменения проходит через связанные факторы. */
function propagation() {
  return shot('propagation', g => {
    const positions: XY[] = [[-20, 6], [-6.5, 6], [7, 6], [20, 6], [20, -6], [7, -6], [-6.5, -6], [-20, -6]];
    const names = ['Боеприпасы', 'Огневая мощь', 'Темп действий', 'Потери', 'Резервы', 'Усталость', 'Подвоз', 'Горючее'];
    const rings = positions.map(([x, y], i) => {
      label(g, names[i], x, y + (y > 0 ? 2 : -2), 13);
      node(g, x, y, i % 2 ? C.gold : C.cyan, 0.35);
      return ring(g, x, y, 1.1, i % 2 ? C.gold : C.cyan, 0.6);
    });
    const routes = positions.map((p, i) => {
      const q = positions[(i + 1) % positions.length];
      return flow(g, path(g, [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], q], C.cyan, 0.6).curve, 10, C.gold);
    });
    path(g, [[-6.5, 6], [0, 0, -1], [7, -6]], C.blue, 0.55);
    path(g, [[7, 6], [-2, 0, -1], [-6.5, -6]], C.blue, 0.55);
    label(g, 'Изменение одного фактора', 0, 1.1, 17, C.cyan);
    label(g, 'меняет весь ход расчёта', 0, -1.1, 14);
    return (s, _p, reduced) => {
      const t = time(s, reduced); routes.forEach(f => f(t));
      rings.forEach((r, i) => { r.scale.setScalar(1 + Math.max(0, Math.sin(t * 0.8 - i * 0.7)) * 0.3); });
    };
  });
}

/** Схематическое поле ограничений: заполненные ячейки, водный барьер и узкая переправа. */
function spatialRoutes() {
  return shot('spatial-constraints', g => {
    label(g, 'Доступность пространства', -7, 9.7, 18, C.cyan);
    const cols = 28, rows = 12, cell = 1.22;
    const tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(cell * 0.87, cell * 0.87),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.58, depthWrite: false }), cols * rows);
    const matrix = new THREE.Matrix4();
    const riverX = (y: number) => -6 + Math.sin(y * 0.43) * 1.6;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const x = -23.5 + col * cell, y = -6.7 + row * cell;
      const river = Math.abs(x - riverX(y)) < 1.1;
      const rugged = x > 1.5 && y > 1.5 && x + y > 8;
      const constrained = !river && (rugged || (x < -16 && y < -2) || (x > -1 && y < -4));
      const color = river ? 0x0a243b : constrained ? 0x796e59 : 0x346d78;
      matrix.makeTranslation(x, y, -0.2); tiles.setMatrixAt(row * cols + col, matrix);
      tiles.setColorAt(row * cols + col, new THREE.Color(color));
    }
    g.add(tiles);
    const bank: XY[] = Array.from({ length: 40 }, (_, i) => { const y = -7.5 + i / 39 * 15.2; return [riverX(y), y, 0]; });
    path(g, bank, C.blue, 0.65, 0.7); path(g, bank, C.cyan, 0.8, 0.075);
    const crossingY = -1.5, crossingX = riverX(crossingY);
    box(g, crossingX, crossingY, 4.7, 1.2, C.gold, 1);
    const bridge = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 0.82), new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.35, depthWrite: false }));
    bridge.position.set(crossingX, crossingY, 0.15); g.add(bridge);
    for (let i = 0; i < 6; i++) line(g, [[crossingX - 2 + i * .8, crossingY - .6, .2], [crossingX - 2 + i * .8, crossingY + .6, .2]], C.ivory, .8);
    label(g, 'Переправа', crossingX + 1, -9, 13, C.gold);
    line(g, [[crossingX, crossingY - 1], [crossingX, -7.7]], C.gold, .45);
    label(g, 'Ограничения', 19, 7.8, 16);
    const categories = [['Проходимость', 4.6, 0x69b4bc], ['Рельеф', .8, C.gold], ['Водный барьер', -3, C.blue]] as const;
    categories.forEach(([name, y, color]) => {
      const swatch = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .75 }));
      swatch.position.set(13.8, y, .2); g.add(swatch); label(g, name, 20, y, 13, C.ivory);
    });
    label(g, 'Схема ограничений', 19, -7.5, 12, C.cyan);
    const scan = new THREE.Mesh(new THREE.PlaneGeometry(.08, 14.5), new THREE.MeshBasicMaterial({ color: C.ivory, transparent: true, opacity: .55, depthWrite: false }));
    scan.position.set(-23, .2, .25); g.add(scan);
    return (s, _p, reduced) => {
      const t = time(s, reduced);
      scan.position.x = -23.5 + ((t * .07) % 1) * 33;
      bridge.material.opacity = .3 + (reduced ? .1 : (Math.sin(t * 1.1) + 1) * .1);
    };
  });
}

/** Основания вывода: три досье, в каждом видны сведения, проверяемые условия и границы применения. */
function evidence() {
  return shot('evidence-dossiers', g => {
    label(g, 'У каждого вывода — основания', 0, 10, 18, C.cyan);
    const xs = [-17, 0, 17];
    const dossiers = [
      ['Положение', 'Время наблюдения', 'Актуальность'],
      ['Ресурсы', 'Допущения модели', 'Ограничения'],
      ['Местность', 'Масштаб данных', 'Применимость'],
    ];
    const stages = ['Наблюдение', 'Проверка', 'Основание вывода'];
    const activeRows: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
    xs.forEach((x, col) => {
      // Контур документа с отогнутым углом отличается от схем связей слева.
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(12.8, 15.8), new THREE.MeshBasicMaterial({ color: C.ivory, transparent: true, opacity: .035, depthWrite: false }));
      paper.position.set(x, -.5, -.3); g.add(paper);
      line(g, [[x - 6.4, -8.4], [x - 6.4, 7.4], [x + 3.6, 7.4], [x + 6.4, 4.6], [x + 6.4, -8.4], [x - 6.4, -8.4]], C.ivory, .65);
      line(g, [[x + 3.6, 7.4], [x + 3.6, 4.6], [x + 6.4, 4.6]], C.cyan, .8);
      const highlight = new THREE.Mesh(new THREE.PlaneGeometry(12.2, 3.6), new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: .09, depthWrite: false }));
      highlight.position.set(x, 0, -.1); g.add(highlight); activeRows.push(highlight);
      [4.4, -.5, -5.4].forEach((y, row) => {
        label(g, stages[row], x, y + .7, row === 2 ? 11.2 : 11.8, C.cyan);
        label(g, dossiers[col][row], x, y - .7, 13.2, C.ivory);
        if (row < 2) {
          line(g, [[x - 4.8, y - 2.3], [x + 4.8, y - 2.3]], C.muted, .5);
          line(g, [[x, y - 1.9], [x, y - 2.7]], C.gold, .8);
        }
      });
    });
    return (s, p, reduced) => {
      const row = reduced ? 1 : Math.min(2, Math.floor(p * 3));
      activeRows.forEach((highlight, i) => {
        highlight.position.y = 4.4 - row * 4.9;
        highlight.material.opacity = reduced ? .12 : .09 + .025 * Math.sin(s * .8 + i * .6);
      });
    };
  });
}

/** Одна матрица для сопоставления: условные пиктограммы, без придуманных оценок результата. */
function branching() {
  return shot('comparison-matrix', g => {
    label(g, 'Сопоставление последствий', 0, 10, 18, C.cyan);
    const xs = [-7, 5, 17], ys = [3.4, -1.1, -5.6];
    ['Вариант А', 'Вариант Б', 'Вариант В'].forEach((name, i) => label(g, name, xs[i], 7.1, 16, i === 1 ? C.gold : C.ivory));
    ['Ход действий', 'Ресурсы', 'Последствия'].forEach((name, i) => label(g, name, -21, ys[i], 13, C.cyan));
    for (let i = 0; i < 4; i++) line(g, [[-13 + i * 12, -8], [-13 + i * 12, 5.7]], C.muted, .55);
    for (let i = 0; i < 4; i++) line(g, [[-13, 5.7 - i * 4.5], [23, 5.7 - i * 4.5]], C.cyan, .45);
    const scan = new THREE.Mesh(new THREE.PlaneGeometry(36, 4.5), new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: .08, depthWrite: false }));
    scan.position.set(5, ys[1], -.2); g.add(scan);
    const pulses: ((t: number) => void)[] = [];
    xs.forEach((x, col) => {
      // Условные способы действия; форма не кодирует преимущество или вероятность.
      const action: XY[] = col === 0 ? [[x - 4, 3.4], [x + 4, 3.4]]
        : col === 1 ? [[x - 4, 2.6], [x - 1.8, 4.2], [x + 1.5, 4.2], [x + 4, 2.6]]
          : [[x - 4, 3.4], [x - 1.2, 2.5], [x + 1, 4.1], [x + 4, 3.4]];
      const trail = path(g, action, col === 1 ? C.gold : C.cyan, .8, .055);
      pulses.push(flow(g, trail.curve, 9, C.ivory, .045));
      node(g, x - 4, action[0][1], C.ivory, .17); node(g, x + 4, action[action.length - 1][1], C.ivory, .17);
      // Ресурсы обозначены тремя одинаковыми классами, а не разными количествами.
      [-2.7, 0, 2.7].forEach((dx, i) => {
        if (i === 0) { box(g, x + dx, -1.1, 1.3, 1.3, C.ivory, .8); line(g, [[x + dx - .5, -1.6], [x + dx + .5, -.6]], C.ivory, .6); }
        else if (i === 1) ring(g, x + dx, -1.1, .7, C.gold, .8);
        else line(g, [[x + dx - .7, -1.7], [x + dx, -.3], [x + dx + .7, -1.7], [x + dx - .7, -1.7]], C.cyan, .85);
      });
      // Внизу — области результата, которые предстоит сопоставить, без победителя и баллов.
      box(g, x, -5.6, 8.5, 2.4, C.ivory, .45);
      label(g, 'Потери / сроки / риски', x, -5.6, 10.5, C.ivory);
    });
    label(g, 'Единые критерии сравнения', 2, -10, 13, C.gold);
    return (s, p, reduced) => {
      const row = reduced ? 1 : Math.min(2, Math.floor(p * 3));
      scan.position.y = ys[row];
      scan.material.opacity = reduced ? .09 : .075 + .02 * Math.sin(s * .7);
      pulses.forEach(f => f(time(s, reduced)));
    };
  });
}

function selection() {
  return shot('selection', g => {
    node(g, -21, 0, C.ivory, 0.4); label(g, 'Варианты действий', -17, 9, 16, C.cyan);
    const endpoints = [6.5, 0, -6.5];
    const paths = endpoints.map((y, i) => {
      const route = path(g, [[-21, 0], [-10, y], [7, y], [20, y]], i === 1 ? C.gold : C.blue, i === 1 ? 0.95 : 0.4, i === 1 ? 0.09 : 0.045);
      ring(g, 20, y, i === 1 ? 1.5 : 0.9, i === 1 ? C.gold : C.blue, 0.7); node(g, 20, y, i === 1 ? C.gold : C.blue, 0.25);
      label(g, ['Вариант А', 'Выбранный вариант', 'Вариант В'][i], i === 1 ? 12 : 18, y + (i === 2 ? -1.8 : 1.8), 13, i === 1 ? C.gold : C.ivory);
      return { ...route, move: flow(g, route.curve, 25, i === 1 ? C.gold : C.blue, 0.04) };
    });
    const decision = ring(g, 20, 0, 2.2, C.gold, 0.25);
    label(g, 'Решение командующего', 0, -9.5, 18, C.gold);
    return (s, p, reduced) => {
      const t = time(s, reduced); paths.forEach((route, i) => {
        route.move(t); if (i !== 1) route.mesh.material.opacity = 0.4 - (reduced ? 0.2 : p * 0.25);
      });
      decision.scale.setScalar(reduced ? 1 : 1 + Math.sin(t * 0.8) * 0.06);
    };
  });
}

/** Положения и пути — из той же исторической подложки, что использует стенд. */
function berlinHistory() {
  return shot('berlin-history', g => {
    // Северные армии в начале операции выходят за рамку основного листа карты.
    // В обзорной хронологии рамка охватывает все имеющиеся исторические положения.
    let [west, south, east, north] = MAP.bbox;
    for (const army of MAP.armies) for (const p of army.track) if (p) {
      west = Math.min(west, p[0] - 0.1); south = Math.min(south, p[1] - 0.1);
      east = Math.max(east, p[0] + 0.1); north = Math.max(north, p[1] + 0.1);
    }
    const project = ([lng, lat]: LL): XY => [((lng - west) / (east - west) - 0.5) * 43, ((lat - south) / (north - south) - 0.5) * 15];
    label(g, 'Хронология Берлинской операции', 0, 10, 18, C.cyan);
    for (let x = -22; x <= 22; x += 4.4) line(g, [[x, -7.5], [x, 7.5]], C.blue, 0.18);
    for (let y = -7.5; y <= 7.5; y += 3) line(g, [[-22, y], [22, y]], C.blue, 0.18);
    const armies = MAP.armies.filter(a => a.side === 'su' && a.track.filter(Boolean).length > 2);
    const tracks = armies.map((army) => {
      const points = army.track.filter((p): p is LL => p !== null).map(project);
      const color = army.front === 'su_1uf' ? C.gold : C.cyan;
      line(g, points, color, 0.43);
      const marker = node(g, points[0][0], points[0][1], color, 0.18);
      return { id: army.id, marker };
    });
    for (const city of MAP.cities.filter(c => c.capital || /Котбус|Зелов|Зеелов|Торгау/.test(c.name))) {
      const [x, y] = project(city.at); ring(g, x, y, city.capital ? 0.65 : 0.25, C.ivory, 0.6);
      label(g, city.name, x, y + 1.15, city.capital ? 15 : 11, city.capital ? C.ivory : C.cyan);
    }
    const start = MAP.days[0].slice(8, 10) + '.' + MAP.days[0].slice(5, 7);
    const last = MAP.days[MAP.days.length - 1];
    const startMs = Date.parse(`${MAP.days[0]}:00Z`), endMs = Date.parse(`${last}:00Z`);
    label(g, `${start} — ${last.slice(8, 10)}.${last.slice(5, 7)}.1945`, 0, -10, 14);
    return (_s, p, reduced) => {
      const at = new Date(startMs + (endMs - startMs) * (reduced ? 0.65 : p)).toISOString().slice(0, 16);
      const positions = new Map(historyAt(at).map(army => [army.id, army.at]));
      tracks.forEach(({ id, marker }) => {
        const pos = positions.get(id);
        marker.visible = Boolean(pos);
        if (!pos) return;
        const [x, y] = project(pos); marker.position.set(x, y, 0.2);
      });
    };
  });
}

function development() {
  return shot('development', g => {
    label(g, 'Новые источники и новые условия', 0, 10, 18, C.cyan);
    const streams = [-6, -2, 2, 6].map((y, i) => {
      const points: XY[] = Array.from({ length: 80 }, (_, j) => {
        const x = -23 + j / 79 * 19;
        return [x, y + Math.sin(j / 79 * Math.PI * (3 + i)) * 0.45, -0.5];
      });
      line(g, points, i % 2 ? C.gold : C.cyan, 0.55);
      return flow(g, new THREE.CatmullRomCurve3(points.map(v)), 18, i % 2 ? C.gold : C.cyan, 0.035);
    });
    label(g, 'Входящие сведения', -15, -9, 13);
    const layers = new THREE.Group(); g.add(layers);
    [0, 1, 2].forEach(i => {
      const x = i * 3, y = i * 1.8;
      line(layers, [[x - 1, y - 5], [x + 10, y - 5], [x + 13, y + 2], [x + 2, y + 2], [x - 1, y - 5]], i === 2 ? C.gold : C.cyan, 0.65);
      for (let k = 1; k < 5; k++) line(layers, [[x - 1 + k * 2.2, y - 5], [x + 2 + k * 2.2, y + 2]], C.blue, 0.45);
    });
    label(g, 'Настройка модели', 11, 6, 14, C.gold);
    label(g, 'Проверка результатов', 13, -8, 14);
    label(g, 'Возможность развития', -13, 8, 13, C.gold);
    return (s, _p, reduced) => { const t = time(s, reduced); streams.forEach(f => f(t)); layers.rotation.y = reduced ? 0 : Math.sin(t * 0.13) * 0.1; };
  });
}

export async function buildIntroSwarm(scene: THREE.Scene, camera: THREE.PerspectiveCamera): Promise<IntroAnimation> {
  const demo = await introOperationPlayback();
  return playIntroPanels(scene, camera, {
    identity: possibilities(), demo, archive: records(), math: calculation(), agents: interactions(), factors: propagation(),
    space: spatialRoutes(), ai: evidence(), variants: branching(), decision: selection(), berlin: berlinHistory(),
    scale: development(), final: introCommandFinale(),
  });
}
