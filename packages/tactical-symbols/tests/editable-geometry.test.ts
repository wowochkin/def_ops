import { expect, it } from 'vitest';
import { areaFeature, getSymbol, lineFeature } from '../src/index';

it('линия использует произвольный маршрут пользователя и сохраняет свойства источника', () => {
  const symbol = getSymbol('source-68');
  const coordinates = [[30, 50], [30.4, 50.2], [31, 51]] as const;
  const feature = lineFeature(symbol, coordinates, 'route-custom');
  expect(feature.geometry).toEqual({ type: 'LineString', coordinates });
  expect(feature.properties).toMatchObject({ symbolId: symbol.id, setVersion: 'ru-modern-v3', geometryTemplate: 'SOURCE_VECTOR' });
  expect(() => lineFeature(symbol, [[30, 50]], 'bad')).toThrow('две точки');
});

it('область использует новый полигон, а не контур эталонной страницы', () => {
  const symbol = getSymbol('source-118');
  const ring = [[30, 50], [31.2, 50.1], [31.4, 51.3], [30.5, 51.5], [30, 50]] as const;
  const feature = areaFeature(symbol, ring, 'area-custom');
  expect(feature.geometry).toEqual({ type: 'Polygon', coordinates: [ring] });
  expect(feature.properties).toMatchObject({ symbolId: symbol.id, objectType: symbol.objectType, kind: 'AREA' });
  expect(() => areaFeature(symbol, [[30, 50], [31, 51], [30, 50]], 'bad')).toThrow('четырёх');
  expect(() => areaFeature(symbol, [[30, 50], [31, 50], [31, 51], [30.5, 51.2]], 'open')).toThrow('замкнуто');
});
