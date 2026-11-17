import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { INTRO_CUES } from '../src/expo/intro-story';
import * as intro from '../src/expo/intro-scene';
import { buildIntroFactors, buildIntroSwarm } from '../src/expo/intro-scene-ambient';

vi.mock('../src/sim/userdata', () => ({ getData: async (kind: string) => kind === 'scenarios' ? { theatre: 'oder-berlin-1945' } : (await import('../../../packages/sim/data/theatres/oder-berlin-1945.json')).default }));

// Canvas только растеризует подписи; сцены, геометрия и переключение остаются настоящими.
afterEach(() => vi.restoreAllMocks());

describe.each([
  ['левый', buildIntroFactors],
  ['правый', buildIntroSwarm],
] as const)('%s экран интро', (_name, build) => {
  it('меняет видимую геометрию в каждом разделе и восстанавливает кадр при возвращении', async () => {
    vi.spyOn(intro, 'introLabel').mockImplementation(() => new THREE.Sprite(new THREE.SpriteMaterial()));
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(44, 1920 / 840, .1, 1200);
    const animate = await build(scene, camera);
    const visible = () => {
      const objects: string[] = [];
      scene.traverseVisible(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          objects.push(object.uuid);
        }
      });
      return objects.sort();
    };
    const frames: string[][] = [];
    for (let line = 1; line <= INTRO_CUES.length; line++) {
      animate(100, line, true, .6);
      const frame = visible();
      expect(frame.length).toBeGreaterThan(0);
      for (const previous of frames) expect(frame).not.toEqual(previous);
      frames.push(frame);
    }
    animate(100, 5, true, .6);
    expect(visible()).toEqual(frames[4]);
    const geometryFrame = () => {
      scene.updateMatrixWorld(true);
      const drawn: unknown[] = [];
      scene.traverseVisible(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          drawn.push({
            id: object.uuid,
            matrix: [...object.matrixWorld.elements],
            vertices: [...object.geometry.attributes.position.array],
            instances: object instanceof THREE.InstancedMesh ? [...object.instanceMatrix.array] : null,
            range: { ...object.geometry.drawRange },
            opacity: materials.map(material => material.opacity),
          });
        }
      });
      return drawn;
    };
    for (let line = 1; line <= INTRO_CUES.length; line++) {
      animate(100, line, false, .6);
      const beforePause = geometryFrame();
      animate(200, line, false, .9);
      animate(100, line, false, .6);
      expect(geometryFrame()).toEqual(beforePause);
      animate(10, line, true, .6);
      const still = geometryFrame();
      animate(200, line, true, .6);
      expect(geometryFrame()).toEqual(still);
    }
    intro.disposeIntroScene(scene);
  });
});
