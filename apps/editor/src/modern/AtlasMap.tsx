import {useEffect, useRef, useState} from 'react';
import type {Map as MapLibreMap, StyleSpecification} from 'maplibre-gl';
import type {AtlasMeta} from '../../../../services/cartography/src/atlas';
import type {WeatherRegion} from '../../../../packages/core/src/weather-grid';
import {environmentApi, environmentHeaders} from './environment-api';
import {areaCameraBounds} from './area-camera';
import {filterOsmThemes} from './osm-themes';
import {drawSeasons, type Season} from './seasonal-atlas';
import {transparencyFor, type Transparency} from './layer-transparency';
import type {MapWeatherField, WeatherOverlay} from './weather-layer';
import {coversView} from './environment-region';
import 'maplibre-gl/dist/maplibre-gl.css';

export function isLandCover(p:AtlasMeta){
 return !!p.thematic || /worldcover/i.test([p.name,p.source,p.attribution].join(' '));
}
type MapBounds = WeatherRegion['bounds'];
interface AtlasMapProps {
 packages: readonly AtlasMeta[];
 bounds: MapBounds;
 regions?: ReadonlyMap<string,string>;
 disabled?: Set<string>;
 weather?: WeatherOverlay | null;
 framing?: {fill:boolean};
 overview?: boolean;
 rasterOpacity?: number;
 onViewBounds?: (bounds:MapBounds)=>void;
 transparency?: Transparency;
 seasons?: Season[];
 seasonMonth?: number;
 terrainId?: string | null;
 minZoom?: number;
 onUnavailable?: () => void;
}
const emptyRegions = new Map<string,string>();
const emptyDisabled = new Set<string>();
const defaultFraming = {fill:false};
const emptyTransparency: Transparency = {};
const emptySeasons: Season[] = [];
export function AtlasMap({packages, bounds, regions=emptyRegions, disabled=emptyDisabled, weather=null,
 framing=defaultFraming, overview=false, rasterOpacity=.6, onViewBounds, transparency=emptyTransparency,
 seasons=emptySeasons, seasonMonth=1, terrainId=null, minZoom, onUnavailable}: AtlasMapProps){
 const container=useRef<HTMLDivElement>(null),map=useRef<MapLibreMap|null>(null),[error,setError]=useState(''),[ready,setReady]=useState(false);
 const rasterOverlays=useRef<string[]>([]),latestOpacity=useRef(rasterOpacity);latestOpacity.current=rasterOpacity;
 useEffect(()=>{if(styleReady.current)for(const id of rasterOverlays.current)if(map.current?.getLayer(id))map.current.setPaintProperty(id,'raster-opacity',rasterOpacity);},[rasterOpacity]);
 const weatherVisible=!!weather;
 const latestWeather=useRef(weather),styleReady=useRef(false);latestWeather.current=weather;
 const previousTerrain=useRef<string|null>(null);
 const appearance=useRef({transparency,seasons,seasonMonth});
 appearance.current={transparency,seasons,seasonMonth};
 function opacity(field:MapWeatherField|Season) {return 1-transparencyFor(appearance.current.transparency,field)/100;}
 function updateAppearance(){
  const m=map.current;
  if(!m||!styleReady.current)return;
  const w=latestWeather.current;
  if(w){
   for(let i=0;i<w.rasters.length;i++){
    const id='weather-surface-'+i;
    if(m.getLayer(id))m.setPaintProperty(id,'raster-opacity',opacity(w.field));
   }
   if(m.getLayer('weather-values')){
    m.setPaintProperty('weather-values','circle-opacity',opacity(w.field));
    m.setPaintProperty('weather-values','circle-stroke-opacity',opacity(w.field));
   }
   if(m.getLayer('weather-labels'))m.setPaintProperty('weather-labels','text-opacity',opacity(w.field));
  }
  drawSeasons(m,appearance.current.seasons,appearance.current.seasonMonth,opacity);
 }
 useEffect(()=>{updateAppearance();},[transparency,seasons,seasonMonth]);
 function drawWeather(){
  const m=map.current;
  if(!m||!styleReady.current)return;
  const w=latestWeather.current, rasters=w?.rasters??[];
  const before=m.getStyle().layers.find(l=>l.id.startsWith('season-')||['line','circle','symbol'].includes(l.type))?.id;
  for(const [index,raster] of rasters.entries()){
   const id='weather-surface-'+index;
   if(!m.getSource(id)){
    m.addSource(id,{type:'image',coordinates:raster.coordinates});
    m.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':opacity(w!.field),'raster-fade-duration':0}},before);
   }
   (m.getSource(id) as import('maplibre-gl').ImageSource).updateImage({
    image:new ImageData(raster.pixels,raster.size,raster.size),coordinates:raster.coordinates
   });
  }
  for(let i=rasters.length;m.getSource('weather-surface-'+i);i++){
   const id='weather-surface-'+i;
   m.removeLayer(id);m.removeSource(id);
  }
  const data=w&&!w.rasters.length?w.data:{type:'FeatureCollection' as const,features:[]};
  const existing=m.getSource('weather-field') as import('maplibre-gl').GeoJSONSource|undefined;
  if(existing){existing.setData(data);updateAppearance();return;}
  if(!w){updateAppearance();return;}
  m.addSource('weather-field',{type:'geojson',data});
  m.addLayer({id:'weather-values',type:'circle',source:'weather-field',paint:{'circle-radius':3,'circle-color':'#23404c','circle-stroke-width':1,'circle-stroke-color':'#fff'}});
  m.addLayer({id:'weather-labels',type:'symbol',source:'weather-field',layout:{'text-field':['get','text'],'text-font':['OpenHistorical'],'text-size':12,'text-anchor':'bottom','text-offset':[0,-.45]},paint:{'text-color':'#142e38','text-halo-color':'#fff','text-halo-width':1.5}});
  updateAppearance();
 }
 useEffect(()=>{drawWeather();},[weather]);
 useEffect(()=>{let disposed=false;void import('maplibre-gl').then(lib=>{if(disposed||!container.current)return;const m=new lib.Map({container:container.current,style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#ede8d8'}}]},center:[13.4,52.5],zoom:7,...(minZoom === undefined ? {} : {minZoom}),attributionControl:{compact:true},transformRequest:url=>({url,headers:url.startsWith('/')||url.startsWith(location.origin)?environmentHeaders():{}})});m.addControl(new lib.NavigationControl(),'top-right');map.current=m;setReady(true);const publishBounds=()=>{
 if(!onViewBounds)return;
 const b=m.getBounds(), wrap=(v:number)=>((v+180)%360+360)%360-180;
 const world=b.getEast()-b.getWest()>=360;
 const box:WeatherRegion['bounds']=[world?-180:wrap(b.getWest()),Math.max(-85.0511,b.getSouth()),world?180:wrap(b.getEast()),Math.min(85.0511,b.getNorth())];
 if(box[1]<box[3]&&box[0]!==box[2])onViewBounds(box);
 };m.on('moveend',publishBounds);m.on('resize',publishBounds);m.on('load',publishBounds);m.on('error',e=>setError(e.error.message));m.on('style.load',()=>{styleReady.current=true;for(const id of rasterOverlays.current)if(m.getLayer(id))m.setPaintProperty(id,'raster-opacity',latestOpacity.current);drawWeather();});}).catch(e=>{if(!disposed){setError(e.message);onUnavailable?.();}});return()=>{disposed=true;map.current?.remove();map.current=null;};},[]);
 useEffect(()=>{
  const m=map.current,box=container.current;
  if(!ready||!m||!box)return;
  const target=areaCameraBounds(bounds,box.clientWidth,box.clientHeight,framing.fill);
  if(target)m.fitBounds(target,{padding:framing.fill?0:32,duration:0,bearing:0,pitch:0});
 },[ready,bounds,framing]);
 useEffect(()=>{if(!ready||!map.current)return;let stale=false;setError('');void Promise.all(packages.map(p=>environmentApi<StyleSpecification>(`/atlas/${p.id}/style`))).then(styles=>{
  if(stale||!map.current)return;const result:StyleSpecification={version:8,sources:{},glyphs:'/api/cartography/fonts/{fontstack}/{range}.pbf',layers:[{id:'background',type:'background',paint:{'background-color':'#ede8d8'}}]};
  if(weatherVisible)result.layers[0]={id:'background',type:'background',paint:{'background-color':'#253143'}};
  const rasterIds:string[]=[];
  const baseRaster=packages.find(p=>p.kind==='raster'&&!isLandCover(p));
  for(const [i,s]of styles.entries()){
   const p=packages[i];if(s.glyphs)result.glyphs=s.glyphs;
   for(const [name,source]of Object.entries(s.sources)){
    result.sources[`${p.id}-${name}`]=source;
    if(p.id===terrainId&&source.type==='raster-dem'){
     result.sources['atlas-3d-dem']={...source};
     result.terrain={source:'atlas-3d-dem',exaggeration:1};
    }
   }
   for(const l of s.layers){if(l.type==='background')continue;const layer={...l,id:`${p.id}-${l.id}`} as typeof l & {source?:string};if('source'in l)layer.source=`${p.id}-${l.source}`;
    const index=/^layer-(\d+)/.exec(l.id)?.[1],key=index!==undefined?`${p.id}/${p.layers[Number(index)]?.id}`:`${p.id}/raster`;
    layer.layout={...layer.layout,visibility:disabled.has(key)?'none':'visible'};
    if(layer.type==='raster'&&(overview||p!==baseRaster)){layer.paint={...layer.paint,'raster-opacity':latestOpacity.current};rasterIds.push(layer.id);}
    if(weatherVisible&&p.kind==='vector'){
     const water='source-layer' in layer&&/water/.test(String(layer['source-layer']));
     if(layer.type==='fill')layer.paint={...layer.paint,'fill-color':water?'#364c65':'#334153','fill-opacity':.68};
     if(layer.type==='line'&&!l.id.endsWith('-rail-base')&&!l.id.endsWith('-rail-dashes'))layer.paint={...layer.paint,'line-color':water?'#547296':'#657689','line-opacity':.68};
     if(layer.type==='symbol')layer.paint={...layer.paint,'text-color':'#e5f0fb','text-halo-color':'#283446','text-halo-width':1.5};
    }
    const region=regions.get(p.id);
    if(region && p.kind==='vector')filterOsmThemes(layer,region,disabled);
    result.layers.push(layer);
   }
  }
  if(overview){result.sources.overview={type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap',maxzoom:19};result.layers.push({id:'overview',type:'raster',source:'overview',paint:weatherVisible?{'raster-saturation':-.85,'raster-brightness-max':.68}:{} });result.glyphs='/api/cartography/fonts/{fontstack}/{range}.pbf';}
  const landCoverLayers=new Set(packages.filter(isLandCover).map(p=>p.id+'-raster'));
  const rank=(layer:StyleSpecification['layers'][number])=>{
   if(layer.type==='background')return 0;
   if(layer.id==='overview')return 1;
   if(layer.type==='raster')return landCoverLayers.has(layer.id)?2.5:2;
   if(layer.type==='fill')return 3;
   if(layer.type==='hillshade')return 4;
   if(layer.type==='symbol')return 6;
   return 5;
  };
  result.layers.sort((a,b)=>rank(a)-rank(b));
  styleReady.current=false;rasterOverlays.current=rasterIds;const terrainChanged=previousTerrain.current!==terrainId;
  map.current.setStyle(result,{diff:false});
  if(terrainChanged){
   const dem=packages.find(p=>p.id===terrainId);
   if(dem){
    const center=map.current.getCenter();
    if(!coversView(dem.bounds,[center.lng,center.lat,center.lng,center.lat])||map.current.getZoom()<dem.minzoom){
     const [w,s,e,n]=dem.bounds;
     map.current.fitBounds([[w,s],[e<w?e+360:e,n]],{padding:40,duration:0});
    }
   }
   map.current.easeTo({pitch:terrainId?50:0,duration:400});
   previousTerrain.current=terrainId;
  }

 }).catch(e=>{if(!stale){setError(e.message);onUnavailable?.();}});return()=>{stale=true;};},[packages,regions,disabled,ready,overview,weatherVisible,terrainId]);
 return <><div className="env-map" ref={container} aria-label="Автономная многослойная карта"/>{error&&<p className="env-note" role="status">Карта: {error}. Если не видны подписи, подготовьте локальные шрифты.</p>}</>;
}
