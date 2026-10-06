import type { Projection } from '../geo';
import type { Path } from '../curve';
import type { Feature, StrokeSpec } from '../model';

/** Контекст отрисовки: проекция, генератор id для <defs>, доступ к геометрии других объектов. */
export interface RenderContext {
  proj: Projection;
  defs: string[];
  uid(prefix: string): string;
  /** Сглаженная ось линии/контура объекта (для привязки хвостов стрелок). */
  featurePath(id: string): Path | null;
  feature(id: string): Feature | undefined;
}

export const f2 = (v: number) => +v.toFixed(2);

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function strokeAttrs(s: StrokeSpec, join: 'miter' | 'round' = 'miter'): string {
  let a = `fill="none" stroke="${s.color}" stroke-width="${f2(s.width)}" stroke-linejoin="${join}" stroke-miterlimit="12"`;
  if (s.opacity != null && s.opacity < 1) a += ` stroke-opacity="${s.opacity}"`;
  if (s.dash && s.dash.length) a += ` stroke-dasharray="${s.dash.join(' ')}"`;
  return a;
}

/** Интерполяция цвета #rrggbb. */
export function mixColor(a: string, b: string, t: number): string {
  const pa = parseHex(a), pb = parseHex(b);
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function parseHex(c: string): [number, number, number] {
  let h = c.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
