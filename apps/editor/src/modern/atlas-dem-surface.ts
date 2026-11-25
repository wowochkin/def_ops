import type { AddProtocolAction, RasterDEMSourceSpecification } from 'maplibre-gl';
import { environmentHeaders } from './environment-api';

export const demSurfaceProtocol = 'atlas-dem';
const prefix = demSurfaceProtocol + '://';

// В числовом API прозрачность обозначает отсутствие измерения. MapLibre читает
// только RGB, поэтому для отображения заполняем маску цветом нулевой высоты.
export function displayDemSource(source: RasterDEMSourceSpecification): RasterDEMSourceSpecification {
 if ((source.encoding ?? 'mapbox') !== 'mapbox' || !source.tiles) return source;
 return { ...source, tiles: source.tiles.map(url => url.startsWith('/api/cartography/') ? prefix + url : url) };
}

export const loadDemSurface: AddProtocolAction = async ({url}, {signal}) => {
 const path = url.slice(prefix.length);
 if (!path.startsWith('/api/cartography/') || new URL(path, location.href).origin !== location.origin) {
  throw Error('Некорректный адрес тайла высот');
 }
 const response = await fetch(path, {signal, headers: environmentHeaders()});
 if (!response.ok) throw Error(`Не удалось загрузить рельеф (HTTP ${response.status})`);
 const expiry = {
  cacheControl: response.headers.get('cache-control') ?? undefined,
  expires: response.headers.get('expires') ?? undefined,
 };
 const blob = await response.blob();
 if (!blob.size) return {data: new ArrayBuffer(0), ...expiry};
 const tile = await createImageBitmap(blob, {colorSpaceConversion: 'none'});
 try {
  signal.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.width = tile.width;
  canvas.height = tile.height;
  const context = canvas.getContext('2d');
  if (!context) throw Error('Не удалось открыть поверхность для тайла высот');
  // Mapbox Terrain-RGB: 0 м = 100000 = 0x0186a0.
  context.fillStyle = '#0186a0';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(tile, 0, 0);
  return {data: await createImageBitmap(canvas), ...expiry};
 } finally {
  tile.close();
 }
};
