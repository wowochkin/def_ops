import type {WeatherRegion} from '../../../../packages/core/src/weather-grid';
type Bounds=WeatherRegion['bounds'];
const normalize=(lon:number)=>(lon+180)%360<0?(lon+180)%360+180:(lon+180)%360-180;
const WORLD_BOUNDS:Bounds=[-180,-85.05112878,180,85.05112878];
/** Камера ограничивает только отображение; координаты модели остаются неизменными. */
export function weatherRenderRegion(region:WeatherRegion,view:Bounds|undefined,fullViewport=false){
 if(fullViewport){const bounds=view??WORLD_BOUNDS;return {modelBounds:bounds,renderBounds:bounds,renderRegions:[bounds]};}
 const modelBounds=region.bounds;
 if(!view)return {modelBounds,renderBounds:modelBounds,renderRegions:[modelBounds]};
 const [west,south,east,north]=modelBounds;
 const end=east<west?east+360:east;
 const bottom=Math.max(south,view[1]),top=Math.min(north,view[3]);
 const result:Bounds[]=[];
 if(bottom<top){
  const width=view[2]>=view[0]?view[2]-view[0]:view[2]+360-view[0];
  if(width>=360)result.push([west,bottom,east,top]);
  else{
   const start=view[0]+360*Math.round((west-view[0])/360);
   for(const offset of [-360,0,360]){
    const left=Math.max(west,start+offset),right=Math.min(end,start+offset+width);
    if(left<right)result.push([normalize(left),bottom,normalize(right)===-180?180:normalize(right),top]);
   }
  }
 }
 return {modelBounds,renderBounds:result[0]??null,renderRegions:result};
}
