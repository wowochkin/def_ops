/** География интро: те же высоты, что в модели, с усилением вертикального масштаба для пролёта. */
import { decodeHeights, type TheatreData } from '@def-ops/sim';

export type IntroBounds = [number, number, number, number];
export type IntroPoint = [number, number];
/** Коридор Одер — Берлин. Остальная часть театра не нужна для крупного плана. */
export const INTRO_BOUNDS: IntroBounds = [12.55, 51.45, 15.05, 53.25];
export const INTRO_BERLIN: IntroPoint = [13.405, 52.52];
export const INTRO_ODER: IntroPoint = [14.62, 52.58];
const KM_PER_DEG = 111.32;
const HEIGHT_SCALE = 0.004;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function introTerrain(grid: TheatreData['heightGrid'], bounds: IntroBounds = INTRO_BOUNDS) {
  if (!grid || grid.cols < 1 || grid.rows < 1) throw new Error('В театре нет сетки высот');
  const heights = decodeHeights(grid);
  if (!heights.every(Number.isFinite)) throw new Error('В сетке высот есть некорректные значения');
  const [gw, gs, ge, gn] = grid.bbox;
  const [w, s, e, n] = bounds;
  if (ge <= gw || gn <= gs || e <= w || n <= s) throw new Error('Некорректные границы рельефа');
  const xScale = KM_PER_DEG * Math.cos(INTRO_BERLIN[1] * Math.PI / 180);
  const heightAt = ([lng, lat]: IntroPoint) => {
    // DEM описывает среднюю высоту клетки, поэтому координаты отсчитываются от центров.
    const x = clamp((lng - gw) / (ge - gw) * grid.cols - 0.5, 0, grid.cols - 1);
    const z = clamp((gn - lat) / (gn - gs) * grid.rows - 0.5, 0, grid.rows - 1);
    const x0 = Math.floor(x), z0 = Math.floor(z), x1 = Math.min(x0 + 1, grid.cols - 1), z1 = Math.min(z0 + 1, grid.rows - 1);
    const a = heights[z0 * grid.cols + x0] * (1 - (x - x0)) + heights[z0 * grid.cols + x1] * (x - x0);
    const b = heights[z1 * grid.cols + x0] * (1 - (x - x0)) + heights[z1 * grid.cols + x1] * (x - x0);
    return a * (1 - (z - z0)) + b * (z - z0);
  };
  const point = (ll: IntroPoint, lift = 0): [number, number, number] => [
    (ll[0] - INTRO_BERLIN[0]) * xScale,
    heightAt(ll) * HEIGHT_SCALE + lift,
    (INTRO_BERLIN[1] - ll[1]) * KM_PER_DEG,
  ];
  const cols = clamp(Math.ceil(grid.cols * (e - w) / (ge - gw)) + 1, 2, 128);
  const rows = clamp(Math.ceil(grid.rows * (n - s) / (gn - gs)) + 1, 2, 128);
  const positions = new Float32Array(cols * rows * 3);
  const indices: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      positions.set(point([w + (e - w) * c / (cols - 1), n - (n - s) * r / (rows - 1)]), (r * cols + c) * 3);
      if (r && c) {
        const k = r * cols + c;
        indices.push(k - cols - 1, k - 1, k - cols, k - cols, k - 1, k);
      }
    }
  }
  return { cols, rows, positions, indices, point, heightAt, bounds };
}
export type IntroTerrain = ReturnType<typeof introTerrain>;
