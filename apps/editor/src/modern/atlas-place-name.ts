import raw from './geography/names.json?raw';
import {centerOf} from './environment-region';
import type {WeatherRegion} from '../../../../packages/core/src/weather-grid';

type Bounds=WeatherRegion['bounds'];
type Area=[name:string,country:string,bounds:Bounds,rings:string[]];
type Place=[name:string,country:string,lon:number,lat:number];
interface Geography {places:Place[];regions:Area[];seas:Area[];countries:Record<string,string>}
const atlas:Geography=JSON.parse(raw);
const cache=new Map<string,string>();
export function areaKey(bounds:Bounds){return bounds.map(v=>v.toFixed(6)).join(',');}

// Кольцо замкнуто в исходных данных. Распаковываем только кольца, прошедшие отбор по рамке.
function visitRing(ring:string,point:(x:number,y:number)=>void){
  let position=0;
  function nextDelta(){
    let bits=0,shift=0,part=0;
    do{
      part=ring.charCodeAt(position++)-63;
      bits|=(part&31)<<shift;
      shift+=5;
    }while(part>=32);
    return (bits>>>1)^-(bits&1);
  }
  let x=0,y=0;
  while(position<ring.length){x+=nextDelta();y+=nextDelta();point(x/1000,y/1000);}
}
function insideRing(lon:number,lat:number,ring:string){
  let px=NaN,py=NaN,inside=false;
  visitRing(ring,(x,y)=>{
    if(Number.isFinite(py)&&(y>lat)!==(py>lat)&&lon<(px-x)*(lat-y)/(py-y)+x)inside=!inside;
    px=x;py=y;
  });
  return inside;
}

/** Обзорная карта использует те же подписи и контуры, что и выбор названия района. */
export function atlasOverview(bounds: readonly number[], offset:number) {
  const [w,s,e,n]=bounds;
  const intersects=(b:Bounds)=>b[2]+offset>=w&&b[0]+offset<=e&&b[3]>=s&&b[1]<=n;
  return {
    regions:atlas.regions.filter(r=>intersects(r[2])),
    places:atlas.places.filter(([, ,x,y])=>x+offset>=w&&x+offset<=e&&y>=s&&y<=n),
    visitRing,
  };
}
function containingArea(areas:Area[],lon:number,lat:number){
  return areas.find(([, , [w,s,e,n],rings])=>lon>=w&&lon<=e&&lat>=s&&lat<=n&&
    insideRing(lon,lat,rings[0])&&!rings.slice(1).some(hole=>insideRing(lon,lat,hole)));
}

function geographicName(bounds:Bounds){
  const [w,s,e,n]=bounds,center=centerOf(bounds);
  const lon=center.lon===180?-180:center.lon, lat=center.lat;
  const longitudeSpan=e>=w?e-w:360+e-w;
  if(longitudeSpan>=350&&n-s>=150)return 'Весь мир';
  const area=containingArea(atlas.regions,lon,lat);
  const cos=Math.cos(lat*Math.PI/180);
  if(Math.max(longitudeSpan*cos,n-s)<=2){
    let nearest:Place|undefined, shortest=Infinity;
    for(const place of atlas.places){
      const [,country,x,y]=place;
      if(area&&area[1]!==country)continue;
      if(y<s||y>n||!(w<=e?x>=w&&x<=e:x>=w||x<=e))continue;
      const dx=(((x-lon+540)%360)-180)*cos, distance=dx*dx+(y-lat)**2;
      if(distance<shortest){nearest=place;shortest=distance;}
    }
    if(nearest)return nearest[0];
  }
  if(area){
    const country=atlas.countries[area[1]];
    return country&&Math.max(longitudeSpan*cos,n-s)>12?country:area[0]||country;
  }
  const sea=containingArea(atlas.seas,lon,lat);
  if(sea)return sea[0];
  const point=(v:number,pos:string,neg:string)=>Math.abs(v).toLocaleString('ru-RU',{maximumFractionDigits:3})+'° '+(v<0?neg:pos);
  return point(lat,'с. ш.','ю. ш.')+' · '+point(lon,'в. д.','з. д.');
}
export function automaticAreaName(bounds:Bounds){
  const key=areaKey(bounds);
  let name=cache.get(key);
  if(!name){
    name=geographicName(bounds);
    if(cache.size>=256)cache.delete(cache.keys().next().value!);
    cache.set(key,name);
  }
  return name;
}
export function datasetName(name:string,bounds:Bounds,areaName?:string){
  return !name?.trim()||name.trim()==='Мой район' ? areaName||automaticAreaName(bounds) : name;
}
