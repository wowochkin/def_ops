import {it,expect,vi} from 'vitest';
import {http} from '../src/net';
import {rasterSources,chooseExtracts,resolveSources} from '../src/atlas-sources';
it('DEM покрывает все градусные листы; WorldCover использует шаг 3° и южные координаты',()=>{
 expect(rasterSources('dem',[13.9,52.9,14.1,53.1])).toHaveLength(4);
 expect(rasterSources('landcover',[-1,-1,1,1]).map(f=>f.url).some(u=>u.includes('S03W003'))).toBe(true);
 expect(rasterSources('dem',[179.9,1,-179.9,2])).toHaveLength(2);
});
it('выбирает наименьшую целиком покрывающую регион выгрузку, не соседний bbox',()=>{
 const feature=(id:string,w:number,s:number,e:number,n:number)=>({type:'Feature' as const,properties:{id,name:id,urls:{pbf:`https://download.geofabrik.de/${id}-latest.osm.pbf`}},geometry:{type:'Polygon' as const,coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}});
 const index={features:[feature('large',0,0,20,20),feature('small',10,10,15,15)]};
 expect(chooseExtracts(index,[11,11,12,12])[0].name).toBe('small');
 expect(chooseExtracts(index,[9,11,12,12])[0].name).toBe('large');
});

it('отличает отклонённое перенаправление файла от отсутствия сети',async()=>{
 const fetch=vi.spyOn(http,'fetch').mockResolvedValue(new Response(null,{status:307,headers:{location:'https://other.invalid/file.tif'}}));
 try{
  await expect(resolveSources('dem',[11,47,11.2,47.2])).rejects.toThrow(/Проверка исходного файла.*перенаправил/);
  expect(fetch).toHaveBeenCalledTimes(1);
 }finally{fetch.mockRestore();}
});
