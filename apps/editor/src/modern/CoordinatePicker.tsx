import {atlasOverview,datasetName} from './atlas-place-name';
import {useEffect,useRef,useState} from 'react';
import type {Map as LibreMap,GeoJSONSource,StyleSpecification} from 'maplibre-gl';
import type {AtlasMeta} from '../../../../services/cartography/src/atlas';
import {environmentApi,environmentHeaders} from './environment-api';
import {pickPoint,pickBounds,selectionGeometry} from './coordinate-pick';
import 'maplibre-gl/dist/maplibre-gl.css';
const ONLINE='online';
const overview:StyleSpecification={version:8,sources:{overview:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}},layers:[{id:'overview',type:'raster',source:'overview'}]};
const OFFLINE = 'builtin-overview';
const offlineOverview: StyleSpecification = {
  version: 8,
  sources: {
    geography: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: 'Natural Earth' },
  },
  layers: [
    { id: 'sea', type: 'background', paint: { 'background-color': '#d1e4ea' } },
    { id: 'land', type: 'fill', source: 'geography', filter: ['==', '$type', 'Polygon'],
      paint: { 'fill-color': '#e2e4ce', 'fill-outline-color': '#8da797' } },
    { id: 'places', type: 'circle', source: 'geography', filter: ['==', '$type', 'Point'],
      paint: { 'circle-radius': 2.5, 'circle-color': '#47666a' } },
    { id: 'names', type: 'symbol', source: 'geography', filter: ['==', '$type', 'Point'],
      layout: { 'text-field': ['get', 'name'], 'text-font': ['sans-serif'], 'text-size': 13, 'text-offset': [0, .85] },
      paint: { 'text-color': '#233d40', 'text-halo-color': '#f8f8f0', 'text-halo-width': 1.5 } },
  ],
};

function updateOfflineOverview(map: LibreMap) {
  const source = map.getSource<GeoJSONSource>('geography');
  if (!source) return;
  const view = map.getBounds();
  const span = view.getEast() - view.getWest();
  const margin = span * .15;
  const width = Math.min(360, span + 2 * margin);
  const west = width === 360 ? -180 : pickPoint(view.getWest() - margin, 0)[0];
  const heightMargin = (view.getNorth() - view.getSouth()) * .15;
  const bounds = [west, view.getSouth() - heightMargin, west + width, view.getNorth() + heightMargin];
  const tiles = [atlasOverview(bounds, 0)];
  if (bounds[2] > 180) tiles.push(atlasOverview(bounds, 360));
  // Шаг порядка пикселя: дальний обзор не требует полной детализации всех контуров.
  const precision = 360 / (512 * 2 ** map.getZoom());
  const features: GeoJSON.Feature[] = [];
  for (const tile of tiles) {
    for (const [, , [w,s,e,n], rings] of tile.regions) {
      if (Math.max(e - w, n - s) < precision) continue;
      const polygon: GeoJSON.Position[][] = [];
      for (const ring of rings) {
        const points: GeoJSON.Position[] = [];
        tile.visitRing(ring, (lon, lat) => {
          const last = points.at(-1);
          if (!last || Math.abs(lon - last[0]) >= precision || Math.abs(lat - last[1]) >= precision) points.push([lon, lat]);
        });
        const first = points[0], last = points.at(-1);
        if (first && last && (last[0] !== first[0] || last[1] !== first[1])) points.push(first);
        if (points.length >= 4) polygon.push(points);
        else if (!polygon.length) break;
      }
      if (polygon.length) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygon } });
    }
    if (map.getZoom() >= 4) {
      for (const [name, , lon, lat] of tile.places) features.push({
        type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: [lon, lat] },
      });
    }
  }
  source.setData({ type: 'FeatureCollection', features });
}

export function CoordinatePicker({mode,value,onChange,onClose,onConfirm,datasetLabels,offline=false}:{offline?:boolean;datasetLabels?:ReadonlyMap<string,string>;mode:'point'|'bounds';value:number[];onChange(value:number[]):void;onClose():void;onConfirm?():void}){
 const root=useRef<HTMLDivElement>(null),map=useRef<LibreMap|null>(null),close=useRef<HTMLButtonElement>(null),current=useRef({mode,value,onChange});current.current={mode,value,onChange};
 const styleReady=useRef(false);
 const corner=useRef<[number,number]|null>(null),[first,setFirst]=useState<[number,number]|null>(null),[maps,setMaps]=useState<AtlasMeta[]>([]),[source,setSource]=useState(''),[ready,setReady]=useState(false),[error,setError]=useState('');
 function draw(){const m=map.current;if(!m||!styleReady.current)return;const data=selectionGeometry(current.current.mode,current.current.value);if(m.getSource('coordinate-selection'))(m.getSource('coordinate-selection') as GeoJSONSource).setData(data);else{
  m.addSource('coordinate-selection',{type:'geojson',data});m.addLayer({id:'coordinate-area',type:'fill',source:'coordinate-selection',filter:['!=',['geometry-type'],'Point'],paint:{'fill-color':'#008c9a','fill-opacity':.22}});m.addLayer({id:'coordinate-outline',type:'line',source:'coordinate-selection',filter:['!=',['geometry-type'],'Point'],paint:{'line-color':'#008c9a','line-width':3}});m.addLayer({id:'coordinate-point',type:'circle',source:'coordinate-selection',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':8,'circle-color':'#008c9a','circle-stroke-color':'#fff','circle-stroke-width':3}});
 }}
 function show(){const m=map.current,v=current.current.value;if(!m||!selectionGeometry(mode,v).features.length)return;if(mode==='point')m.jumpTo({center:[v[0],Math.max(-85,Math.min(85,v[1]))],zoom:Math.max(5,m.getZoom())});else m.fitBounds([[v[0],v[1]],[v[2]<v[0]?v[2]+360:v[2],v[3]]],{padding:45,duration:0});}
 useEffect(()=>{if(offline)return;let disposed=false;void environmentApi<AtlasMeta[]>('/atlas').then(list=>{if(disposed)return;const usable=list.filter(m=>m.kind!=='terrain');setMaps(usable);setSource(usable[0]?.id??ONLINE);}).catch(()=>{if(!disposed)setSource(ONLINE);});
  return()=>{disposed=true;};
 },[offline]);
 useEffect(()=>{const focus=document.activeElement as HTMLElement|null;close.current?.focus();let disposed=false;
  void import('maplibre-gl').then(lib=>{if(disposed||!root.current)return;const m=new lib.Map({container:root.current,style:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e8e6dc'}}]},center:[13,52],zoom:5,transformRequest:url=>({url,headers:url.startsWith('/')||url.startsWith(location.origin)?environmentHeaders():{}})});m.addControl(new lib.NavigationControl(),'top-right');map.current=m;m.getCanvas().style.cursor='crosshair';m.on('error',e=>setError(e.error.message));m.on('click',e=>{const p=pickPoint(e.lngLat.lng,e.lngLat.lat);const c=current.current;if(c.mode==='point')c.onChange(p);else if(!corner.current){corner.current=p;setFirst(p);}else{const bounds=pickBounds(corner.current,p);if(bounds){c.onChange(bounds);corner.current=null;setFirst(null);}else setError('Углы должны отличаться по широте и долготе');}});setReady(true);show();}).catch(e=>setError(e.message));
  return()=>{disposed=true;map.current?.remove();map.current=null;focus?.focus();};
 },[]);
 useEffect(() => {
   const m = map.current;
   if (!offline || !ready || !m) return;
   const update = () => updateOfflineOverview(m);
   m.on('moveend', update);
   return () => { m.off('moveend', update); };
 }, [offline, ready]);
 const base=offline?OFFLINE:source;
 useEffect(()=>{if(!ready||!base||!map.current)return;let stale=false;setError('');const promise=offline?Promise.resolve(offlineOverview):base===ONLINE?Promise.resolve(overview):environmentApi<StyleSpecification>(`/atlas/${base}/style`);void promise.then(style=>{if(stale||!map.current)return;styleReady.current=false;map.current.once('style.load',()=>{styleReady.current=true;draw();if(offline && map.current)updateOfflineOverview(map.current);const local=maps.find(m=>m.id===base);if(local&&map.current){const [w,s,e,n]=local.bounds;map.current.fitBounds([[w,s],[e<w?e+360:e,n]],{padding:40,duration:0});}});map.current.setStyle(style);}).catch(e=>{if(!stale)setError(e.message);});return()=>{stale=true;};},[base,ready,offline]);
 useEffect(()=>{draw();},[value.join(',')]);
 return <div className="coordinate-backdrop"><section role="dialog" aria-modal="true" aria-label={mode==='point'?'Выбор точки погоды':'Выбор области карты'} className="coordinate-dialog" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose();}if(e.key==='Tab'){const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button,select,canvas[tabindex]'));const a=buttons[0],b=buttons.at(-1);if(e.shiftKey&&document.activeElement===a){e.preventDefault();b?.focus();}else if(!e.shiftKey&&document.activeElement===b){e.preventDefault();a.focus();}}}}>
 <div className="coordinate-heading"><h2>{mode==='point'?'Выберите точку на карте':'Выберите область на карте'}</h2><button type="button" ref={close} onClick={onClose} aria-label="Закрыть выбор на карте">✕</button></div>
 <p>{mode==='point'?'Щёлкните по нужному месту — широта и долгота обновятся.':first?`Первый угол: ${first[1]}, ${first[0]}. Щёлкните по противоположному углу.`:'Два щелчка задают противоположные углы прямоугольника.'}</p>
 <div className="env-actions">{offline?<span>Встроенная карта · Natural Earth</span>:<label>Подложка<select value={source} onChange={e=>setSource(e.target.value)}>{!source&&<option value="">Загрузка…</option>}{maps.map(m=><option key={m.id} value={m.id}>{datasetLabels?.get(m.id)??datasetName(m.name,m.bounds)} · локальная</option>)}<option value={ONLINE}>Обзорная OpenStreetMap · интернет</option></select></label>}<button type="button" onClick={show}>Показать координаты</button>{mode==='bounds'&&<button type="button" onClick={()=>{corner.current=null;setFirst(null);}}>Сбросить первый угол</button>}</div>
 <div ref={root} className="coordinate-map" aria-label="Карта выбора координат"/>
 {error&&<p className="env-error" role="status">Подложка: {error}. {!offline && 'Без сети выберите локальную карту; координаты можно задать и на пустом фоне.'}</p>}
 <div className="coordinate-footer"><output>{mode==='point'?`Широта: ${value[1]} · долгота: ${value[0]}`:`Запад, юг, восток, север: ${value.join(', ')}`}</output><button type="button" disabled={!!first} onClick={onConfirm??onClose}>Готово</button></div><p className="env-note">Координаты WGS84. Карта ограничена широтами ±85°.{mode==='point' && ' Полярные точки погоды задаются в полях.'}</p>
 </section></div>;
}
