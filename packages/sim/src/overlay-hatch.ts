/**
 * Штриховка болот на исторической карте: короткие горизонтальные чёрточки одного цвета с шагом по вертикали.
 * Признаки окна пикселей тайла (доля чернил, средняя длина серий по строкам и столбцам, строки с чернилами) отличают
 * штриховку от заливки (вода), надписей (нет направленности) и дорог (одна длинная линия). Окна кладутся по тайлу
 * без полей в соседние тайлы (как dropBlobs).
 */

/**
 * Признаки окна: ink — доля чернил среди непрозрачных px; hRun/vRun — средняя длина серии по строкам/столбцам;
 * rows — строк с чернилами; strokes — отдельных штрихов (строк с чернилами, над которыми в окне строка без чернил);
 * rows / strokes — средняя толщина штриха.
 */
export interface HatchStats { ink: number; px: number; hRun: number; vRun: number; rows: number; strokes: number; w: number }

/**
 * Пороги штриховки; окно ≈ groundM метров на местности, minPx…maxPx пикселей. Штрихов в окне не меньше
 * max(minStrokes, w · strokesShare), толщина штриха не больше maxThick px (толстая линия, двойная дорога — не болото),
 * средняя серия не длиннее maxRunShare · w (линия через всё окно — дорога).
 */
export const HATCH = { minInk: 0.03, maxInk: 0.4, aniso: 2, minRun: 3, minStrokes: 2, strokesShare: 1 / 8, maxThick: 2, maxRunShare: 0.75, minOpaque: 0.5, groundM: 120, minPx: 12, maxPx: 48 } as const;

/** Признаки окна w×w с левым верхним углом (x0, y0); cls — классы пикселей тайла size×size, −2 — прозрачно. */
export function hatchWindow(cls: Int8Array, size: number, x0: number, y0: number, w: number, ink: number): HatchStats {
  let n = 0, px = 0, hr = 0, vr = 0, rows = 0, strokes = 0, prev = false;
  for (let y = y0; y < y0 + w; y++) {
    let row = 0;
    for (let x = x0; x < x0 + w; x++) {
      const k = cls[y * size + x];
      if (k === -2) continue;
      px++;
      if (k !== ink) continue;
      n++; row++;
      if (x === x0 || cls[y * size + x - 1] !== ink) hr++;
    }
    if (row) { rows++; if (!prev) strokes++; }
    prev = row > 0;
  }
  if (n) for (let x = x0; x < x0 + w; x++) for (let y = y0; y < y0 + w; y++) {
    if (cls[y * size + x] === ink && (y === y0 || cls[(y - 1) * size + x] !== ink)) vr++;
  }
  return { ink: px ? n / px : 0, px, hRun: n ? n / hr : 0, vRun: n ? n / vr : 0, rows, strokes, w };
}

/** Окно — штриховка болота: разреженные короткие горизонтальные тонкие чёрточки в нескольких штрихах; полупрозрачное окно — нет. */
export function isHatch(s: HatchStats, o: { minInk?: number; maxInk?: number; aniso?: number } = {}): boolean {
  const minInk = o.minInk ?? HATCH.minInk, maxInk = o.maxInk ?? HATCH.maxInk, aniso = o.aniso ?? HATCH.aniso;
  if (s.px < HATCH.minOpaque * s.w * s.w) return false;
  if (!(s.ink >= minInk && s.ink <= maxInk && s.hRun >= aniso * s.vRun && s.hRun >= HATCH.minRun && s.hRun <= HATCH.maxRunShare * s.w)) return false;
  return s.strokes >= Math.max(HATCH.minStrokes, s.w * HATCH.strokesShare) && s.rows / s.strokes <= HATCH.maxThick;
}

/** Сторона окна в пикселях тайла уровня z на широте lat: ≈ 120 м на местности, 12…48 px. */
export function hatchPx(lat: number, z: number): number {
  const mpp = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
  return Math.min(HATCH.maxPx, Math.max(HATCH.minPx, Math.round(HATCH.groundM / mpp)));
}

/**
 * Маска окон-болот тайла: 1 у каждого непрозрачного пикселя окна, прошедшего isHatch. Окна — с шагом w от левого
 * верхнего угла, последнее в строке и столбце прижато к краю тайла (перекрывает предыдущее).
 */
export function hatchMask(cls: Int8Array, size: number, w: number, ink: number): Uint8Array {
  const m = new Uint8Array(size * size);
  const ww = Math.min(w, size);
  const starts: number[] = [];
  for (let p = 0; p + ww < size; p += ww) starts.push(p);
  starts.push(size - ww);
  for (const y0 of starts) for (const x0 of starts) {
    if (!isHatch(hatchWindow(cls, size, x0, y0, ww, ink))) continue;
    for (let y = y0; y < y0 + ww; y++) for (let x = x0; x < x0 + ww; x++) if (cls[y * size + x] !== -2) m[y * size + x] = 1;
  }
  return m;
}
