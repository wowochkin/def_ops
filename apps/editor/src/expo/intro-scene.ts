/** Three.js загружается только для интро; всё созданное сценой живёт один сеанс. */
import * as THREE from 'three';
import { buildIntroFilm } from './intro-scene-film';
import { buildIntroFactors, buildIntroSwarm } from './intro-scene-ambient';

export type IntroPane = 'film' | 'factors' | 'swarm';
export type IntroFrame = { elapsedMs: number; line: number; progress: number; paused: boolean };
export type IntroAnimation = (seconds: number, line: number, reduced: boolean, progress: number) => void;

/** Общие материалы/текстуры считаются один раз: ресурсы могут принадлежать нескольким узлам. */
export function disposeIntroScene(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  root.traverse((node) => {
    const drawable = node as THREE.Mesh;
    if (drawable.geometry) geometries.add(drawable.geometry);
    if (drawable.material) for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  textures.forEach((t) => t.dispose());
  materials.forEach((m) => m.dispose());
  geometries.forEach((g) => g.dispose());
}

export async function mountIntroScene(host: HTMLElement, pane: IntroPane, frame: () => IntroFrame, signal: AbortSignal): Promise<() => void> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#050c16');
  const camera = new THREE.PerspectiveCamera(pane === 'film' ? 44 : 44, 16 / 9, 0.1, 1200);
  let renderer: THREE.WebGLRenderer | null = null;
  let raf = 0;
  let observer: ResizeObserver | null = null;
  let closed = false;
  const dispose = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    observer?.disconnect();
    disposeIntroScene(scene);
    renderer?.dispose();
    renderer?.forceContextLoss();
    renderer?.domElement.remove();
  };
  try {
    // Подписи на текстурах не перерисовываются: дождаться основного шрифта до их создания.
    await document.fonts?.load('76px \"PT Sans Narrow\"').catch(() => []);
    if (signal.aborted) { dispose(); return dispose; }
    const animate = pane === 'film' ? await buildIntroFilm(scene, camera)
      : pane === 'factors' ? await buildIntroFactors(scene, camera) : await buildIntroSwarm(scene, camera);
    if (signal.aborted) { dispose(); return dispose; }
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(1.5, devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    host.appendChild(renderer.domElement);
    const resize = () => {
      const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer?.setSize(w, h, false);
    };
    resize();
    observer = new ResizeObserver(resize);
    observer.observe(host);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tick = () => {
      if (closed || signal.aborted) { dispose(); return; }
      const state = frame();
      animate(Math.max(0, state.elapsedMs / 1000), state.line, reduced, state.progress);
      renderer!.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}

/** Подпись в самой сцене: чёткий шрифт, прозрачный фон, без карточки. */
export function introLabel(text: string, size = 7, color = '#f4e7c8', uniformFont = false) {
  const canvas = document.createElement('canvas');
  const font = '76px "PT Sans Narrow", sans-serif';
  const measure = canvas.getContext('2d')!;
  measure.font = font;
  // Размер полотна равен тексту: короткое имя не теряется среди прозрачных полей.
  canvas.width = Math.ceil(measure.measureText(text).width) + 48;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, 64);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false }));
  sprite.scale.set(uniformFont ? size * canvas.width / 1024 : size, uniformFont ? size * canvas.height / 1024 : size * canvas.height / canvas.width, 1);
  return sprite;
}
