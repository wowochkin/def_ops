/** Финал справа: два фронта, за один из которых посетитель примет командование. */
import * as THREE from 'three';
import { BANK } from './bank';
import { introLabel } from './intro-scene';
import type { SideShot } from './intro-scene-panels';

export function introCommandFinale(): SideShot {
  const group = new THREE.Group();
  group.name = 'variants-command';
  const standards: THREE.Group[] = [];
  const tags = ['1 БФ', '1 УФ'];
  const colors = ['#77e2df', '#e5b765'];
  const label = (parent: THREE.Group, text: string, y: number, size: number, color: string) => {
    const sprite = introLabel(text, size, color, true);
    sprite.position.set(0, y, 0.3);
    parent.add(sprite);
  };

  (['su_1bf', 'su_1uf'] as const).forEach((id, i) => {
    const front = BANK.fronts[id], color = colors[i];
    const standard = new THREE.Group();
    standard.position.x = i === 0 ? -13 : 13;
    group.add(standard);
    standards.push(standard);

    // Полотнище с раздвоенным нижним краем, древко и навершие образуют штандарт.
    const outline = [
      new THREE.Vector2(-7, 6.5), new THREE.Vector2(7, 6.5),
      new THREE.Vector2(7, -6), new THREE.Vector2(0, -3.8), new THREE.Vector2(-7, -6),
    ];
    const cloth = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(outline)),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    cloth.position.z = -0.1;
    standard.add(cloth);
    const rim = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(outline.map(p => new THREE.Vector3(p.x, p.y, 0))),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    standard.add(rim);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 17, 8),
      new THREE.MeshBasicMaterial({ color: '#c5d2d0' }));
    pole.position.set(-7.4, 0, 0);
    standard.add(pole);
    const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.38), new THREE.MeshBasicMaterial({ color }));
    finial.position.set(-7.4, 8.8, 0);
    standard.add(finial);

    for (const y of [4.6, -2.4]) {
      const rule = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 0.045), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 }));
      rule.position.set(0, y, 0.05);
      standard.add(rule);
    }
    label(standard, tags[i], 1.1, 45, color);
    label(standard, `Маршал ${front.marshal}`, -1.5, 15, '#f2ecdb');

    const caption = new THREE.Group();
    caption.position.x = standard.position.x;
    group.add(caption);
    label(caption, front.name, -8.3, 18, '#f2ecdb');
  });
  label(group, 'Принять командование', 10.1, 20, '#f2ecdb');
  label(group, 'Далее — выбор фронта', -10.5, 13, '#9db9c3');

  return {
    group,
    animate: (seconds, _progress, reduced) => {
      standards.forEach((standard, i) => {
        standard.rotation.y = reduced ? 0 : Math.sin(seconds * 0.22 + i * 0.9) * 0.07;
      });
    },
  };
}
