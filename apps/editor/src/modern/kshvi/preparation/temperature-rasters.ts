import type { Bounds } from '../../../../../../packages/kshvi/src/environment/provider';
import { weatherRasters, type WeatherRaster } from '../../weather-layer';
import type { WeatherMapPoint } from './InitialMapCanvas';

export function temperatureRasters(points: readonly WeatherMapPoint[], bounds: Bounds): WeatherRaster[] {
  const cells = points.map(({ lon, lat, value }) => ({ lon, lat, state: { temperature: value, provenance: 'synthetic' as const } }));
  return weatherRasters({ bounds: [...bounds], cols: 3, rows: 3 }, cells, 'temperature');
}
