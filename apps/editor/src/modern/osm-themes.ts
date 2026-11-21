import {railwayFilter,railwaySources} from '../../../../packages/core/src/railway-style';
import type {ExpressionSpecification, LayerSpecification} from 'maplibre-gl';

type Expression = ExpressionSpecification;
interface Theme {
  id:string;
  label:string;
  sources:readonly string[];
  matches:(source:string)=>Expression | boolean;
}

const equals = (key:string, value:string):Expression => ['==',['get',key],value];
const inValues = (key:string, values:string[]):Expression => ['in',['get',key],['literal',values]];
const transport = ['transportation','transportation_name'];
export const osmThemes:readonly Theme[] = [
  {
    id:'forest', label:'Леса', sources:['landcover','landuse'],
    matches:()=>['any', equals('natural','wood'), equals('landuse','forest'), inValues('landcover',['trees','forest']), inValues('class',['wood','forest'])],
  },
  {
    id:'wetland', label:'Болота', sources:['landcover','landuse'],
    matches:()=>['any', equals('natural','wetland'), equals('class','wetland')],
  },
  {
    id:'rail', label:'Железные дороги', sources:railwaySources, matches:railwayFilter,
  },
  {
    id:'bridge', label:'Мосты', sources:['roads','railways','structures','water','waterway',...transport],
    matches:()=>['any',equals('brunnel','bridge'),equals('man_made','bridge'),
      ['all',['has','bridge'],['!', ['in',['downcase',['to-string',['get','bridge']]],['literal',['','no','false','0']]]]]],
  },
];

export function regionThemeKey(region:string, theme:string) { return 'theme/'+region+'/'+theme; }

/** Сохраняет геометрию и подписи исходного стиля. Один объект может относиться к нескольким темам. */
export function filterOsmThemes(layer:LayerSpecification, region:string, disabled:ReadonlySet<string>) {
  if(layer.type!=='fill' && layer.type!=='line' && layer.type!=='circle' && layer.type!=='symbol')return;
  if(!layer['source-layer'])return;
  const source = layer['source-layer'];
  const hidden = osmThemes.filter(t=>disabled.has(regionThemeKey(region,t.id)) && t.sources.includes(source));
  if(!hidden.length)return;
  // atlasStyle создаёт фильтры в синтаксисе выражений MapLibre.
  const conditions:Expression[] = layer.filter ? [layer.filter as Expression] : [];
  for(const theme of hidden)conditions.push(['!',theme.matches(source)]);
  layer.filter=['all',...conditions];
}
