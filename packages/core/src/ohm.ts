/**
 * OpenHistoricalMap (OHM): общее для исторического слоя модели и службы картографии —
 * разбор дат OHM, участки загрузки через Overpass, склейка колец из путей.
 */
import type { LngLat } from './geo';
import type { BBox } from './cartography';

/** Сервер Overpass OpenHistoricalMap (данные OSM с датами start_date / end_date; лицензия CC0). */
export const OHM_OVERPASS = 'https://overpass-api.openhistoricalmap.org/api/interpreter';
/** Шаг участка загрузки, градусы. */
export const OHM_CELL_DEG = 0.25;
/**
 * Оценка: секунд на участок — всё задание (участки с паузой 1 с, сборка, нарезка), делённое на число
 * участков; замер по театру «Одер — Берлин — Эльба»: 285 участков, 641 с (участки — 497 с, сборка и нарезка — 144 с).
 */
export const OHM_SEC_PER_CELL = 2.25;
/** Оценка: мегабайт (10⁶ байт) на квадратный градус; тот же замер: 261,0 МБ на 16,33 кв. градуса. */
export const OHM_MB_PER_SQDEG = 16;

/** Элемент ответа Overpass (`out body geom`). */
export type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
  members?: { type: string; ref: number; role: string }[];
};
/** Ответ Overpass в JSON; `remark` — сообщение сервера (ошибка, нехватка времени). */
export type OverpassJson = { elements?: OverpassElement[]; remark?: string };

/** Дата OHM («1936», «1936-09», «1936-09-27», «~1930») → ISO-день или null, если не разобрать. */
export function ohmDate(v: string | undefined, end = false): string | null {
  const m = v && /(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(v);
  if (!m) return null;
  // неполная дата: начало — с первого дня периода, конец — по последний
  return `${m[1]}-${m[2] ?? (end ? '12' : '01')}-${m[3] ?? (end ? '28' : '01')}`;
}

/**
 * Дата OHM → десятичный год: год + (день года − 1) / (дней в году); разбор — как у ohmDate
 * (ISO с временем — по дате). Не разобрать — null.
 */
export function ohmYear(v: string | undefined, end = false): number | null {
  const d = ohmDate(v, end);
  if (!d) return null;
  const [y, m, day] = d.split('-').map(Number);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const doy = (Date.UTC(y, m - 1, day) - Date.UTC(y, 0, 1)) / 86_400_000;
  return y + doy / (leap ? 366 : 365);
}

/**
 * Участки загрузки: шаг step от юго-западного угла рамки, по строкам с юга на север, в строке —
 * с запада на восток (i = r · cols + c); последний столбец и строка обрезаются рамкой.
 */
export function ohmCells(b: BBox, step = OHM_CELL_DEG): BBox[] {
  const [w, s, e, n] = b;
  const cols = Math.max(0, Math.ceil((e - w) / step - 1e-9));
  const rows = Math.max(0, Math.ceil((n - s) / step - 1e-9));
  const fx = (v: number) => +v.toFixed(6);
  const out: BBox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push([fx(w + c * step), fx(s + r * step), fx(Math.min(e, w + (c + 1) * step)), fx(Math.min(n, s + (r + 1) * step))]);
    }
  }
  return out;
}

/** Оценка загрузки района до начала: участков, минут, мегабайт. */
export function ohmEstimate(b: BBox): { cells: number; minutes: number; mb: number } {
  const cells = ohmCells(b).length;
  return {
    cells,
    minutes: Math.ceil((cells * OHM_SEC_PER_CELL) / 60),
    mb: Math.round((b[2] - b[0]) * (b[3] - b[1]) * OHM_MB_PER_SQDEG),
  };
}

const samePt = (a: LngLat, b: LngLat) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** Замкнутое кольцо: не меньше 4 точек, первая = последней (допуск 1e-9). */
export function ringClosed(r: LngLat[]): boolean {
  return r.length >= 4 && samePt(r[0], r[r.length - 1]);
}

/** Куски путей → замкнутые кольца: склейка по совпадающим концам (с разворотом куска); незамкнувшееся — пропуск. */
export function stitchRings(parts: LngLat[][]): LngLat[][] {
  const pool = parts.filter((p) => p.length >= 2), out: LngLat[][] = [];
  while (pool.length) {
    const ring = [...pool.shift()!];
    while (!ringClosed(ring)) {
      const end = ring[ring.length - 1];
      const k = pool.findIndex((p) => samePt(p[0], end) || samePt(p[p.length - 1], end));
      if (k < 0) break;
      const p = pool.splice(k, 1)[0];
      ring.push(...(samePt(p[0], end) ? p : [...p].reverse()).slice(1));
    }
    if (ringClosed(ring)) out.push(ring);
  }
  return out;
}
