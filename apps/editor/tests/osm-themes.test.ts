import {expect,it} from 'vitest';
import type {LineLayerSpecification} from 'maplibre-gl';
import {featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {filterOsmThemes,regionThemeKey} from '../src/modern/osm-themes';

function visible(source:string, hidden:string[], properties:Record<string,string|undefined>,type:1|2=2){
  const layer:LineLayerSpecification={id:'example',type:'line',source:'atlas','source-layer':source, filter:['==',['geometry-type'],'LineString']};
  filterOsmThemes(layer,'example',new Set(hidden.map(t=>regionThemeKey('example',t))));
  return featureFilter(layer.filter,'layers[0].filter').filter({zoom:12},{type,properties});
}

it('мост с путями относится к двум темам, обычная дорога и тоннель остаются видимыми',()=>{
  for(const [source,props] of [['transportation',{class:'rail',brunnel:'bridge'}],['railways',{railway:'rail',bridge:'viaduct'}]] as const){
    for(const hidden of [['rail'],['bridge'],['rail','bridge']])expect(visible(source,hidden,props)).toBe(false);
    expect(visible(source,[],props)).toBe(true);
  }
  expect(visible('roads',['bridge'],{highway:'primary',bridge:'no'})).toBe(true);
  expect(visible('transportation',['bridge','rail'],{class:'primary',brunnel:'tunnel'})).toBe(true);
  expect(visible('structures',['bridge'],{man_made:'bridge'})).toBe(false);
  expect(visible('transportation',['rail'],{class:'primary'},1)).toBe(false);
});
it('леса и болота можно скрыть независимо в двух форматах',()=>{
  for(const props of [{natural:'wood'},{landuse:'forest'},{class:'wood'}]){
    expect(visible('landcover',['forest'],props)).toBe(false);
    expect(visible('landcover',['wetland'],props)).toBe(true);
  }
  for(const props of [{natural:'wetland'},{class:'wetland'}]){
    expect(visible('landcover',['wetland'],props)).toBe(false);
    expect(visible('landcover',['forest'],props)).toBe(true);
  }
});

it('штрихи следуют только вдоль путей, а выключение темы скрывает и основу, и штрихи',async()=>{
  const {atlasStyle}=await import('../../../services/cartography/src/atlas');
  const style=atlasStyle({id:'test',name:'Карта',format:'pbf',kind:'vector',minzoom:8,maxzoom:14,
    bounds:[0,0,1,1],attribution:'',bytes:0,layers:[{id:'transportation'},{id:'railways'}]},'/api');
  function lines(source:string,properties:Record<string,string>,hidden:string[]=[]){
    return style.layers.flatMap(original=>{
      if(original.type!=='line'||original['source-layer']!==source)return [];
      const layer={...original};
      filterOsmThemes(layer,'demo',new Set(hidden.map(t=>regionThemeKey('demo',t))));
      return featureFilter(layer.filter,'test').filter({zoom:14},{type:2,properties})?[layer]:[];
    });
  }
  expect(lines('transportation',{class:'primary'}).map(l=>l.id)).toEqual(['layer-0-line']);
  for(const [source,props] of [['transportation',{class:'rail'}],['railways',{railway:'rail'}]] as const){
    const pair=lines(source,props as Record<string,string>);
    expect(pair).toHaveLength(2);
    expect(pair[1].paint?.['line-dasharray']).toEqual([6,6]);
    expect(lines(source,props as Record<string,string>,['rail'])).toHaveLength(0);
  }
});
