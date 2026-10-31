/**
 * Кинохроника поверх стенда: зерно плёнки, виньетка, шторка со вспышкой кадра при смене сцены, перелистывание табло
 * даты, вспышки артиллерии на переднем крае и дым над горящими городами на карте. Всё — CSS-анимации и один canvas
 * со своим циклом кадров: React при этом ничего не перерисовывает. При «уменьшить движение» — ничего не движется.
 */
import { useEffect, useRef, useState } from 'react';
import type { MapEngine } from '../engine/types';
import type { LL } from './map';
import { reducedMotion } from './ExpoMap';

/** Текстура зерна: шум 256×256, один раз на окно. */
let grainUrl: string | null = null;
function grain(): string {
  if (grainUrl) return grainUrl;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return (grainUrl = c.toDataURL('image/png'));
}

/** Зерно и виньетка на весь холст. */
export function Film() {
  const [url, setUrl] = useState('');
  useEffect(() => setUrl(typeof document !== 'undefined' && !navigator.userAgent.includes('jsdom') ? grain() : ''), []);
  return (
    <div className="expo-film" aria-hidden="true">
      <div className="expo-grain" style={url ? { backgroundImage: `url(${url})` } : undefined} />
      <div className="expo-vignette" />
    </div>
  );
}

/** Шторка и вспышка кадра: новый ключ — новая склейка. */
export function Cut({ scene }: { scene: string }) {
  return <div key={scene} className="expo-cut" aria-hidden="true" />;
}

/** Перелистывание табло: цифры дня встают сверху, когда день меняется. */
export function flip(el: HTMLElement, text: string) {
  const day = text.split(',')[0];
  if (el.dataset.day === day) {
    el.textContent = text;
    return;
  }
  el.dataset.day = day;
  el.textContent = text;
  if (!reducedMotion() && typeof el.animate === 'function') el.animate([{ transform: 'perspective(400px) rotateX(-80deg)', opacity: 0.2 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'ease-out' });
}

export interface MapFxSpec {
  /** Передний край: возле этих точек — вспышки артиллерии. */
  front: LL[];
  /** Горящие города: дым. */
  smoke: LL[];
  /** События хода: крупная вспышка один раз. */
  bursts: LL[];
}

/** Вспышки и дым — canvas поверх карты, точки — через проекцию карты. */
export function MapFx({ engine, fx }: { engine: MapEngine; fx: MapFxSpec | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const spec = useRef(fx);
  spec.current = fx;
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g || reducedMotion() || typeof requestAnimationFrame !== 'function') return;
    type P = { x: number; y: number; t0: number; life: number; r: number; kind: 'flash' | 'smoke' | 'burst' };
    let parts: P[] = [];
    let id = 0, last = 0, seenBursts = '';
    const jitter = (p: LL, d: number): LL => [p[0] + (Math.random() - 0.5) * d, p[1] + (Math.random() - 0.5) * d * 0.6];
    const tick = (now: number) => {
      id = requestAnimationFrame(tick);
      if (now - last < 33) return;
      last = now;
      const { width, height } = engine.size();
      if (c.width !== width || c.height !== height) [c.width, c.height] = [width, height];
      const s = spec.current;
      if (s) {
        if (s.front.length && Math.random() < 0.55) {
          const [x, y] = engine.project(jitter(s.front[Math.floor(Math.random() * s.front.length)], 0.12));
          parts.push({ x, y, t0: now, life: 260 + Math.random() * 260, r: 5 + Math.random() * 9, kind: 'flash' });
        }
        for (const p of s.smoke)
          if (Math.random() < 0.12) {
            const [x, y] = engine.project(jitter(p, 0.06));
            parts.push({ x, y, t0: now, life: 4000 + Math.random() * 2500, r: 4 + Math.random() * 5, kind: 'smoke' });
          }
        const key = s.bursts.map((b) => b.join()).join(';');
        if (key && key !== seenBursts) {
          seenBursts = key;
          for (const b of s.bursts) {
            const [x, y] = engine.project(b);
            parts.push({ x, y, t0: now, life: 1600, r: 40, kind: 'burst' });
          }
        }
      }
      g.clearRect(0, 0, c.width, c.height);
      parts = parts.filter((p) => now - p.t0 < p.life);
      for (const p of parts) {
        const k = (now - p.t0) / p.life;
        if (p.kind === 'smoke') {
          const r = p.r * (1 + k * 2.5);
          g.fillStyle = `rgba(96, 88, 76, ${0.16 * Math.sin(Math.PI * Math.min(1, k * 1.4))})`;
          g.beginPath();
          g.arc(p.x + k * 18, p.y - k * 46, r, 0, Math.PI * 2);
          g.fill();
        } else {
          const r = p.r * (p.kind === 'burst' ? 0.6 + k : 1 - k * 0.4);
          const a = (1 - k) * (p.kind === 'burst' ? 0.75 : 0.95);
          const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
          grd.addColorStop(0, `rgba(255, 244, 200, ${a})`);
          grd.addColorStop(0.35, `rgba(255, 170, 60, ${a * 0.8})`);
          grd.addColorStop(1, 'rgba(255, 120, 30, 0)');
          g.fillStyle = grd;
          g.beginPath();
          g.arc(p.x, p.y, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [engine]);
  return <canvas ref={ref} className="expo-mapfx" aria-hidden="true" />;
}
