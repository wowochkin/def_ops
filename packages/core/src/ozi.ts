/**
 * Импорт привязки OziExplorer (.map): опорные точки скана карты → ControlPoint[].
 *
 * Формат (текст, Windows-1251 или UTF-8):
 *   1  OziExplorer Map Data File Version 2.2
 *   2  название карты
 *   3  имя файла изображения
 *   5  датум: «WGS 84», «Pulkovo 1942» и т.п.
 *      Point01,xy, 123, 456,in, deg, 52, 30.0000,N, 13, 24.0000,E, grid, …
 *      MMPXY,1, x, y      (углы изображения в пикселях)
 *      MMPLL,1, lon, lat  (углы на местности, десятичные градусы)
 *      IWH,Map Image Width/Height, w, h
 * Точки в датуме карты пересчитываются в WGS 84 (поддерживаются WGS 84 и СК-42).
 */
import type { LngLat } from './geo';
import type { ControlPoint } from './cartography';

export interface OziMap {
  title: string;
  imageFile: string;
  datum: string;
  /** Опорные точки уже в WGS 84. */
  points: ControlPoint[];
  width?: number;
  height?: number;
  /** Предупреждения разбора (неизвестный датум, пропущенные точки). */
  warnings: string[];
}

/* ------------------------------ пересчёт датумов ------------------------------ */

const KRASOVSKY = { a: 6378245, f: 1 / 298.3 };
const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
const SEC = Math.PI / (180 * 3600);

function toXYZ(lat: number, lon: number, e: { a: number; f: number }): [number, number, number] {
  const e2 = e.f * (2 - e.f), φ = (lat * Math.PI) / 180, λ = (lon * Math.PI) / 180;
  const N = e.a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
  return [N * Math.cos(φ) * Math.cos(λ), N * Math.cos(φ) * Math.sin(λ), N * (1 - e2) * Math.sin(φ)];
}

function fromXYZ(x: number, y: number, z: number, e: { a: number; f: number }): LngLat {
  const e2 = e.f * (2 - e.f), p = Math.hypot(x, y);
  let φ = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 6; i++) {
    const N = e.a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
    φ = Math.atan2(z + e2 * N * Math.sin(φ), p);
  }
  return [(Math.atan2(y, x) * 180) / Math.PI, (φ * 180) / Math.PI];
}

/**
 * СК-42 (эллипсоид Красовского) → WGS 84, семипараметрическое преобразование
 * Гельмерта (ГОСТ Р 51794-2008: ΔX=23,57 ΔY=−140,95 ΔZ=−79,8 м, ωx=0, ωy=−0,35″,
 * ωz=−0,79″, m=−0,22·10⁻⁶). Точность — единицы метров.
 */
export function sk42ToWgs84(ll: LngLat): LngLat {
  const [x, y, z] = toXYZ(ll[1], ll[0], KRASOVSKY);
  const dx = 23.57, dy = -140.95, dz = -79.8, wx = 0, wy = -0.35 * SEC, wz = -0.79 * SEC, m = -0.22e-6;
  const X = dx + (1 + m) * (x + wz * y - wy * z);
  const Y = dy + (1 + m) * (-wz * x + y + wx * z);
  const Z = dz + (1 + m) * (wy * x - wx * y + z);
  return fromXYZ(X, Y, Z, WGS84);
}

/** Датум из строки .map → функция пересчёта в WGS 84 (null — неизвестен). */
function datumConverter(datum: string): ((ll: LngLat) => LngLat) | null {
  const d = datum.toLowerCase().replace(/\s+/g, ' ');
  if (/wgs ?84|wgs 1984/.test(d)) return (ll) => ll;
  if (/pulkovo ?1942|пулково|ск-?42|sk-?42|s-?42/.test(d)) return sk42ToWgs84;
  return null;
}

/* ---------------------------------- разбор ---------------------------------- */

const num = (s: string | undefined) => (s === undefined || s.trim() === '' ? NaN : Number(s.trim()));

/** Разбор файла .map OziExplorer. */
export function parseOziMap(text: string): OziMap {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (!/OziExplorer Map Data File/i.test(lines[0] ?? '')) throw new Error('Это не файл привязки OziExplorer (.map): нет заголовка «OziExplorer Map Data File»');
  const title = (lines[1] ?? '').trim();
  const imageFile = (lines[2] ?? '').trim().split(/[\\/]/).pop() ?? '';
  const datum = (lines[4] ?? '').split(',')[0].trim() || 'WGS 84';
  const warnings: string[] = [];
  let conv = datumConverter(datum);
  if (!conv) { warnings.push(`Датум «${datum}» не поддерживается — координаты взяты как WGS 84 (возможен сдвиг до сотен метров)`); conv = (ll) => ll; }

  const points: ControlPoint[] = [];
  const mmpxy: Record<number, [number, number]> = {};
  const mmpll: Record<number, LngLat> = {};
  let width: number | undefined, height: number | undefined;

  for (const line of lines) {
    const f = line.split(',');
    const tag = f[0]?.trim();
    if (/^Point\d+$/i.test(tag ?? '')) {
      const px = num(f[2]), py = num(f[3]);
      if (!Number.isFinite(px) || !Number.isFinite(py)) continue; // пустая точка-шаблон
      const latD = num(f[6]), latM = num(f[7]), lonD = num(f[9]), lonM = num(f[10]);
      if (![latD, latM, lonD, lonM].every(Number.isFinite)) {
        if (f[13]?.trim()) warnings.push(`${tag}: точка задана только в сетке (UTM) — пропущена`);
        continue;
      }
      let lat = latD + latM / 60, lon = lonD + lonM / 60;
      if (/S/i.test(f[8] ?? '')) lat = -lat;
      if (/W/i.test(f[11] ?? '')) lon = -lon;
      points.push({ px, py, lngLat: conv([lon, lat]) });
    } else if (tag === 'MMPXY') {
      const i = num(f[1]), x = num(f[2]), y = num(f[3]);
      if ([i, x, y].every(Number.isFinite)) mmpxy[i] = [x, y];
    } else if (tag === 'MMPLL') {
      const i = num(f[1]), lon = num(f[2]), lat = num(f[3]);
      if ([i, lon, lat].every(Number.isFinite)) mmpll[i] = conv([lon, lat]);
    } else if (tag === 'IWH') {
      const w = num(f[2]), h = num(f[3]);
      if (Number.isFinite(w) && Number.isFinite(h)) { width = w; height = h; }
    }
  }
  // нет опорных точек в градусах — берём углы MMPXY/MMPLL
  if (points.length < 3) {
    const corners = Object.keys(mmpxy).map(Number).filter((i) => mmpll[i]);
    if (corners.length >= 3) {
      if (points.length) warnings.push('Опорных точек меньше трёх — привязка по углам (MMPXY/MMPLL)');
      points.length = 0;
      for (const i of corners) points.push({ px: mmpxy[i][0], py: mmpxy[i][1], lngLat: mmpll[i] });
    }
  }
  if (points.length < 3) throw new Error('В файле .map меньше трёх опорных точек с координатами в градусах');
  return { title, imageFile, datum, points, width, height, warnings };
}
