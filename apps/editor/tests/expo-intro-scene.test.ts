import { expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture } from 'three';
import { disposeIntroScene } from '../src/expo/intro-scene';

it('освобождает общие геометрию, материал и текстуру ровно один раз после интро', () => {
  const geometry = new BoxGeometry(), texture = new Texture(), material = new MeshBasicMaterial({ map: texture });
  const group = new Group();
  group.add(new Mesh(geometry, material), new Mesh(geometry, [material, material]));
  const released: string[] = [];
  geometry.addEventListener('dispose', () => released.push('geometry'));
  material.addEventListener('dispose', () => released.push('material'));
  texture.addEventListener('dispose', () => released.push('texture'));
  disposeIntroScene(group);
  expect(released.sort()).toEqual(['geometry', 'material', 'texture']);
});
