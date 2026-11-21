import {expect,it} from 'vitest';
import {layerForArea} from '../src/modern/region-layers';
import {catalogRegions} from '../src/modern/AtlasCatalog';
import {regionSeason,seasonValue} from '../src/modern/seasonal-atlas';
import type {AtlasMeta} from '../../../services/cartography/src/atlas';
import type {AtlasJob} from '../../../services/cartography/src/atlas-jobs';

const requested:AtlasMeta['bounds']=[10,46,11,47];
function meta(id:string,bounds:AtlasMeta['bounds']):AtlasMeta{
  return {id,name:'Один район',bounds,kind:'terrain',layers:[],attribution:'Источник',minzoom:5,maxzoom:12,bytes:200,format:'png'};
}
it('рамка подготовки объединяет источники с разным покрытием, а импорт MBTiles использует свою рамку',()=>{
  const vector=meta('a',requested),dem=meta('b',[9.8,45,11.2,47.8]),other=meta('c',[10,48,11,49]);
  const job=(result:AtlasMeta,kind:'dem'|'mbtiles'):AtlasJob=>({id:result.id,state:'done',stage:'Готово',done:1,total:1,result,input:{kind,options:{bounds:requested,name:result.name,attribution:'Источник',minzoom:5,maxzoom:12}}});
  const groups=catalogRegions([vector,dem,other],[job(dem,'dem'),job(other,'mbtiles')]);
  expect(groups.map(g=>g.maps.map(p=>p.id))).toEqual([['c'],['a','b']]);
});
it('климатические нормы доступны вне прежних примеров и оставляют океан прозрачным',()=>{
  for(const [x,y] of [[19,49],[135,-25],[-104,54]]){
    const months=Array.from({length:12},(_,m)=>seasonValue('flood',m,x,y));
    expect(Math.max(...months.filter((v):v is number=>v!==null))).toBe(100);
    expect(seasonValue('mud',3,x,y)).toBeGreaterThan(0);
  }
  expect(regionSeason('ice',0,[-104,54,-103,55])).toBe('Холодная фаза');
  expect(regionSeason('ice',6,[-104,54,-103,55])).toBe('Тёплая фаза');
  expect(seasonValue('mud',6,-145,0)).toBeNull();
  expect(regionSeason('flood',6,[179,0,-179,1])).toBe('Нет данных по суше');
});

it('открывает свежую копию своей области даже при наличии более свежей карты большего района',()=>{
  const base:AtlasMeta={...meta('base',requested),kind:'vector',format:'pbf',attribution:'OpenFreeMap'};
  const old={...base,id:'old'};
  const fresh={...base,id:'fresh',importedAt:'2026-02-01T12:00:00Z'};
  const large:AtlasMeta={...base,id:'large',bounds:[9,45,12,48],importedAt:'2026-03-01T12:00:00Z'};
  expect(layerForArea('openfreemap',requested,[large,old,fresh],[])?.id).toBe('fresh');
  expect(layerForArea('openfreemap',requested,[large,old],[])?.id).toBe('old');
});
