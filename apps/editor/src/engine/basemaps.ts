/** Каталог подложек: встроенные и пользовательские (XYZ/WMS) — подключение других карт без кода. */
import type { BasemapSpec } from './types';

export const BUILTIN_BASEMAPS: BasemapSpec[] = [
  { id: 'osm', name: 'OpenStreetMap', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap', maxzoom: 19 },
  { id: 'topo', name: 'OpenTopoMap', tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenTopoMap (CC-BY-SA)', maxzoom: 17 },
  { id: 'esri', name: 'Спутник (Esri)', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: '© Esri', maxzoom: 19 },
];

const KEY = 'def_ops.basemaps.custom';

export function loadCustomBasemaps(): BasemapSpec[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function saveCustomBasemaps(list: BasemapSpec[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* */ }
}

/** Проверка шаблона: XYZ ({z}/{x}/{y}), квадродерево ({quadkey}) или WMS ({bbox-epsg-3857}). */
export function isValidTemplate(url: string): boolean {
  return /^https?:\/\//.test(url) && (/\{z\}/.test(url) && /\{x\}/.test(url) && /\{y\}/.test(url) || /\{quadkey\}|\{bbox-epsg-3857\}/.test(url));
}
