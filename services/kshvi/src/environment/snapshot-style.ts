import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { Bounds } from '../../../../packages/kshvi/src/environment/provider';

/** Дополняет только HTTP-представление стиля; сохранённый artifact остаётся неизменным. */
export function styleWithBounds(style: unknown, bounds: Bounds): StyleSpecification {
  if (!style || typeof style !== 'object') throw new Error('Стиль снимка должен быть объектом');
  const copy = structuredClone(style) as StyleSpecification;
  const source = copy.sources.atlas;
  if (!source || !('tiles' in source)) throw new Error('В стиле снимка нет источника atlas');
  source.bounds = [...bounds];
  return copy;
}
