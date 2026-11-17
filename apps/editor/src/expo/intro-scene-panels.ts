/** Боковые сцены следуют тому же номеру реплики и времени, что и центральный экран. */
import * as THREE from 'three';
import type { IntroAnimation } from './intro-scene';
import { INTRO_CUES, type IntroSceneId } from './intro-story';

export type SideShot = {
  group: THREE.Group;
  /** Длиннофокусный ракурс для объёмных панно; остальные используют общий плоский кадр. */
  camera?: { distance: number; fov: number };
  animate: (seconds: number, progress: number, reduced: boolean) => void;
};

export function playIntroPanels(scene: THREE.Scene, camera: THREE.PerspectiveCamera, scenes: Record<IntroSceneId, SideShot>): IntroAnimation {
  const shots = INTRO_CUES.map(cue => scenes[cue.scene]);
  if (shots.some(shot => !shot)) throw new Error('Для каждого раздела интро нужна своя боковая сцена');
  for (const shot of shots) {
    shot.group.visible = false;
    scene.add(shot.group);
  }
  let active = -1;
  return (seconds, line, reduced, progress) => {
    const index = Math.max(0, Math.min(shots.length - 1, Math.floor(line) - 1));
    if (active !== index) {
      if (active >= 0) shots[active].group.visible = false;
      shots[index].group.visible = true;
      active = index;
    }
    // Поле 54 × 22 помещается и в боковом окне, и в одноканальном просмотре.
    const lens = shots[index].camera;
    const fov = lens?.fov ?? 44;
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    const distance = Math.max(lens?.distance ?? 33, 29 / (Math.tan(THREE.MathUtils.degToRad(fov / 2)) * camera.aspect));
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    shots[index].animate(seconds, Math.max(0, Math.min(1, progress)), reduced);
  };
}
