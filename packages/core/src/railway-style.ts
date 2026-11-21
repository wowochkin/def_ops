import type {ExpressionSpecification} from '@maplibre/maplibre-gl-style-spec';

export const railwaySources = ['railways', 'transportation', 'transportation_name'];

export function railwayFilter(source: string): boolean | ExpressionSpecification {
  if (source === 'railways') return true;
  return ['any', ['==', ['get', 'class'], 'rail'], ['all',
    ['==', ['get', 'class'], 'transit'],
    ['in', ['get', 'subclass'], ['literal', ['tram','light_rail','subway','monorail','funicular','narrow_gauge','rail']]],
  ]];
}
