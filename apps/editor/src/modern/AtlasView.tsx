import { useEffect, useMemo, useState } from 'react';
import {AtlasMap,isLandCover} from './AtlasMap';
import type { AtlasMeta } from '../../../../services/cartography/src/atlas';
import type { AtlasJob, AtlasInput } from '../../../../services/cartography/src/atlas-jobs';
import { ENV_API, environmentApi, environmentHeaders, weatherFieldLabels } from './environment-api';
import './environment.css';
import {SeasonControls} from './SeasonControls';
import {AreaNameEditor,useAreaNames} from './AreaNameEditor';
import {areaKey,automaticAreaName,datasetName} from './atlas-place-name';
import {AtlasCatalog,catalogRegions} from './AtlasCatalog';
import type {Season} from './seasonal-atlas';
import {TransparencyInput, transparencyFor, useTransparency} from './layer-transparency';
import {RegionData,type PreparedWeather} from './RegionData';
import {WeatherView,loadWeatherScenario} from './WeatherView';
import {mapWeatherFields,weatherScale,type MapWeatherField,type WeatherOverlay} from './weather-layer';
import {coversView,loadRegion} from './environment-region';
import {weatherRenderRegion} from './weather-domain';
import {openAtlasRegion,resolveOverview,type AtlasRegionSettings} from './atlas-region-state';
import {weatherGrid,type WeatherRegion} from '../../../../packages/core/src/weather-grid';
import {GeoJsonHelp} from './GeoJsonHelp';
import {CopySource} from './CopySource';
import {CoordinatePicker} from './CoordinatePicker';
type Source={id:string;name:string;url:string;license:string;detail:string};
const WORLD_BOUNDS:WeatherRegion['bounds']=[-180,-85.05112878,180,85.05112878];
function downloadLink(id:string){const u=new URL(`${ENV_API}/atlas/${id}/export`,location.origin);const key=localStorage.getItem('def_ops.apiKey');if(key)u.searchParams.set('api_key',key);return u.href;}
export function AtlasView(){
 const [pickerBounds,setPickerBounds]=useState<number[]|null>(null);
 const [offerStarted,setOfferStarted]=useState(false);
 const [preparedWeather,setPreparedWeather]=useState<PreparedWeather|null>(null);
 const [packetScenario,setPacketScenario]=useState(loadWeatherScenario);
 function offerData(){
   setOfferStarted(true);setPacketScenario(loadWeatherScenario());setControlTab('data');
 }
 const [region,setRegion]=useState(loadRegion);
 const [customRegion,setCustomRegion]=useState(true);
 const [draft,setDraft]=useState(()=>region.bounds.join(','));
 const [regionError,setRegionError]=useState('');
 const [rasterOpacity,setRasterOpacity]=useState(.4);
 const [framing,setFraming]=useState({fill:true});
 const [showOverview,setShowOverview]=useState<boolean|null>(null);
 const {names,rename}=useAreaNames();
 const nameKey=areaKey(region.bounds), automaticName=automaticAreaName(region.bounds);
 const name=customRegion?names[nameKey]||automaticName:'Текущий вид карты';
 const regionKey=region.bounds.join(',');
 useEffect(()=>{setDraft(regionKey);setRegionError('');setPlan(null);},[regionKey]);
 function applyBounds(values:number[]){
  try{
   const next={...region,bounds:values as WeatherRegion['bounds']};weatherGrid(next);
   setCustomRegion(true);setRegion(next);setRegionError('');setPlan(null);setPreparedWeather(null);offerData();
  }catch{setRegionError('Укажите четыре координаты области в порядке запад, юг, восток, север.');}
 }

 const [viewBounds,setViewBounds]=useState<WeatherRegion['bounds']>();
 useEffect(()=>{
  if(customRegion||!viewBounds)return;
  setRegion(previous=>previous.bounds.every((value,index)=>value===viewBounds[index])?previous:{...previous,bounds:viewBounds});
 },[customRegion,viewBounds]);
 const [timelineHost,setTimelineHost]=useState<HTMLDivElement|null>(null);
 const [mapField,setMapField]=useState<MapWeatherField>('precipitation');
 const scale=weatherScale(mapField);
 const {values:transparency,change}=useTransparency();
 const [seasons,setSeasons]=useState<Season[]>([]);
 const [monthChoice,setMonthChoice]=useState(-1),[terrainId,setTerrainId]=useState<string|null>(null);
 const [controlTab,setControlTab]=useState<'layers'|'maps'|'weather'|'data'>('layers'),[weather,setWeather]=useState<WeatherOverlay|null>(null),[showWeather,setShowWeather]=useState(true);
 const [sourcePlan,setPlan]=useState<{key?:string;files:{name:string;url:string;bytes?:number}[];missing:string[];bytes:number;note:string}|null>(null);
 const [packages,setPackages]=useState<AtlasMeta[]>([]),[jobs,setJobs]=useState<AtlasJob[]>([]),[sources,setSources]=useState<Source[]>([]),[selected,setSelected]=useState<string[]>([]),[disabled,setDisabled]=useState(new Set<string>()),[error,setError]=useState(''),[busy,setBusy]=useState(false),[runtime,setRuntime]=useState<{ok:boolean;error?:string}|null>(null);
 const [regionStates,setRegionStates]=useState<Record<string,AtlasRegionSettings>>(()=>{
  try{const value=JSON.parse(localStorage.getItem('def_ops.modern.atlas.regionStates')??'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}
 });
 useEffect(()=>{try{localStorage.setItem('def_ops.modern.atlas.regionStates',JSON.stringify(regionStates));}catch{/* настройки области остаются в текущем окне */}},[regionStates]);
 function openRegion(group:Parameters<typeof openAtlasRegion>[1]){
  const byRegion={...regionStates,[regionKey]:{selected,disabled:[...disabled],terrainId}};
  const next=openAtlasRegion({regionKey,selected,disabled:[...disabled],terrainId,showOverview,byRegion},group);
  setRegionStates(next.byRegion);setSelected([...next.selected]);setDisabled(new Set(next.disabled));setTerrainId(next.terrainId);setShowOverview(next.showOverview);
  applyBounds([...group.bounds]);setControlTab('layers');
 }
 const [kind,setKind]=useState<AtlasInput['kind']>('mbtiles'),[lo,setLo]=useState(8),[hi,setHi]=useState(13),[url,setUrl]=useState(''),[attribution,setAttribution]=useState('© OpenStreetMap contributors, ODbL'),[hash,setHash]=useState(''),[upload,setUpload]=useState(0);
 const groups=useMemo(()=>catalogRegions(packages,jobs),[packages,jobs]);
 // Опрос прогресса загрузки меняет jobs, но не состав областей на карте.
 const regionEntries=JSON.stringify(groups.flatMap(g=>g.maps.map(p=>[p.id,g.key])));
 const regions=useMemo(()=>new Map<string,string>(JSON.parse(regionEntries)),[regionEntries]);
 const datasetLabels=useMemo(()=>{
  const labels=new Map<string,string>();
  for(const g of groups){
   for(const p of g.maps)labels.set(p.id,datasetName(p.name,g.bounds,names[g.key]));
  }
  return labels;
 },[groups,names]);
 const seasonMonth=monthChoice>=0?monthChoice:new Date(weather?.time??Date.now()).getUTCMonth();
 const [actionError,setActionError]=useState<{tab:typeof controlTab;scope:string;message:string}|null>(null);
 const actionScope=controlTab==='maps'?regionKey+'/'+kind:regionKey;
 const visibleActionError=actionError?.tab===controlTab && actionError.scope===actionScope
   ? <p className="env-error" role="alert">{actionError.message}</p> : null;
 const planKey=kind+'/'+regionKey+'/'+lo;
 const plan=sourcePlan?.key===planKey?sourcePlan:null;
 async function refresh(){const [maps,operations]=await Promise.all([environmentApi<AtlasMeta[]>('/atlas'),environmentApi<AtlasJob[]>('/atlas/jobs')]);setPackages(old=>old.length===maps.length&&maps.every((m,i)=>m.id===old[i].id&&m.sha256===old[i].sha256)?old:maps);setJobs(operations);}
 useEffect(()=>{void refresh().catch(e=>setError(e.message));void environmentApi<Source[]>('/atlas/sources').then(setSources).catch(()=>{});void environmentApi<{ok:boolean;error?:string}>('/atlas/runtime').then(setRuntime).catch(e=>setRuntime({ok:false,error:e.message}));},[]);
 useEffect(()=>{if(!jobs.some(j=>j.state==='running'))return;const timer=setInterval(()=>void refresh().catch(e=>setError(e.message)),1500);return()=>clearInterval(timer);},[jobs.some(j=>j.state==='running')]);
 async function task(fn:()=>Promise<void>){setBusy(true);setActionError(null);try{await fn();}catch(e){setActionError({tab:controlTab,scope:actionScope,message:(e as Error).message});}finally{setBusy(false);}}
 const options=()=>{if(regionError)throw Error(regionError);return {name,attribution,bounds:region.bounds,minzoom:lo,maxzoom:hi};};
 function importFile(file:File){return new Promise<void>((resolve,reject)=>{
  const xhr=new XMLHttpRequest();xhr.open('POST',`${ENV_API}/atlas/import?kind=${kind}&options=${encodeURIComponent(JSON.stringify(options()))}`);for(const [k,v]of Object.entries(environmentHeaders()))xhr.setRequestHeader(k,v);
  xhr.upload.onprogress=e=>setUpload(e.lengthComputable?Math.round(e.loaded/e.total*100):0);xhr.onerror=()=>reject(Error('Не удалось передать файл локальному сервису'));xhr.onload=()=>{let body;try{body=JSON.parse(xhr.responseText);}catch{reject(Error('Локальный сервис не вернул результат'));return;}if(xhr.status>=400)reject(Error(body.error?.message??'Ошибка импорта'));else resolve();};xhr.send(file);
 });}
 async function removeMap(id:string){
   await environmentApi(`/atlas/${id}`,{method:'DELETE'});
   setPackages(old=>old.filter(p=>p.id!==id));
   setSelected(old=>old.filter(x=>x!==id));
   setDisabled(old=>new Set([...old].filter(key=>!key.startsWith(id+'/'))));
   setTerrainId(old=>old===id?null:old);
 }
 async function removeRegion(group:Parameters<typeof openAtlasRegion>[1]){
  if(group.maps.some(map=>!map.sha256))throw Error('Не все наборы имеют подтверждённый SHA-256');
  const items=group.maps.map(map=>({id:map.id,sha256:map.sha256!}));
  const result=await environmentApi<{deleted:string[];unchanged:{id:string;reason:string}[]}>('/atlas/regions/delete',{method:'POST',body:JSON.stringify({items})});
  const removed=new Set(result.deleted);
  await refresh();
  setSelected(old=>old.filter(id=>!removed.has(id)));
  setDisabled(old=>new Set([...old].filter(key=>!removed.has(key.split('/')[0]))));
  setTerrainId(old=>old&&removed.has(old)?null:old);
  if(group.key===areaKey(region.bounds)&&removed.size){
   setCustomRegion(false);
   setRegion(previous=>({...previous,bounds:viewBounds??WORLD_BOUNDS}));
   setWeather(null);setPreparedWeather(null);setPlan(null);setPickerBounds(null);setShowOverview(null);setFraming({fill:true});setShowWeather(true);
  }
  setRegionStates(old=>{
   const current=old[group.key];
   const next={...old};
   if(!result.unchanged.length)delete next[group.key];
   else if(current)next[group.key]={...current,selected:current.selected.filter(id=>!removed.has(id)),disabled:current.disabled.filter(key=>!removed.has(key.split('/')[0])),terrainId:current.terrainId&&removed.has(current.terrainId)?null:current.terrainId};
   return next;
  });
  if(result.unchanged.length)setActionError({tab:'layers',scope:regionKey,message:`Не удалено: ${result.unchanged.map(item=>`${item.id} — ${item.reason}`).join('; ')}`});
  else rename(group.key,'');
 }
 function toggle(id:string){if(terrainId===id)setTerrainId(null);setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);}
 const active=useMemo(()=>selected.map(id=>packages.find(p=>p.id===id)).filter((p):p is AtlasMeta=>!!p),[selected,packages]);
 const overview=resolveOverview({requested:showOverview});
 const weatherRegion=useMemo(()=>({...region,bounds:weatherRenderRegion(region,viewBounds,overview||!customRegion).modelBounds}),[region,viewBounds,overview,customRegion]);
 const outsideLocalCoverage=!overview&&active.length>0&&!active.some(p=>(p.kind==='vector'||(p.kind==='raster'&&!isLandCover(p)))&&coversView(p.bounds,viewBounds??region.bounds));
 return <section className="env-view atlas-workbench" aria-label="Модуль картографии">
  <div className="atlas-bar"><h1>Карта и погода</h1><span className="atlas-current-region" title={name}>{name}</span><button onClick={()=>setPickerBounds(region.bounds)}>Выбрать область на карте</button></div>
  {pickerBounds&&<CoordinatePicker datasetLabels={datasetLabels} mode="bounds" value={pickerBounds} onChange={setPickerBounds} onClose={()=>setPickerBounds(null)} onConfirm={()=>{applyBounds(pickerBounds);setPickerBounds(null);}}/>}
  {error&&<p className="env-error" role="alert">{error}</p>}
  <div className="atlas-desk"><aside className="atlas-inspector">
   <nav className="atlas-tabs" aria-label="Инструменты карты">
    <button aria-pressed={controlTab==='layers'} onClick={()=>setControlTab('layers')}>Слои</button>
    <button aria-pressed={controlTab==='weather'} onClick={()=>setControlTab('weather')}>Погода</button>
    <button aria-pressed={controlTab==='data'} onClick={offerData}>Данные области</button>
    <button aria-pressed={controlTab==='maps'} onClick={()=>setControlTab('maps')}>Загрузка{jobs.some(j=>j.state==='running')?' •':''}</button>
   </nav>
   {offerStarted&&<div className="atlas-panel" hidden={controlTab!=='data'}>
    <RegionData key={JSON.stringify([regionKey,packetScenario.start,packetScenario.durationHours])} region={region} name={name} scenario={packetScenario}
      catalogKey={packages.map(p=>p.id).join(',')} removeMap={removeMap} runtime={runtime?.ok??null} refresh={refresh} importLayer={()=>setControlTab('maps')} activate={(m,previousId)=>{
       setPackages(old=>old.some(p=>p.id===m.id)?old:[...old,m]);
       setSelected(old=>[...old.filter(id=>id!==previousId&&id!==m.id),m.id]);
       if(previousId&&m.kind==='terrain')setTerrainId(old=>old===previousId?m.id:old);
      }} weatherReady={w=>{setShowWeather(true);setPreparedWeather(w);}}/>
   </div>}
   <div className="atlas-panel" hidden={controlTab!=='layers'}>
    <h2>На карте</h2>{controlTab==='layers'&&visibleActionError}
    <div className="env-actions"><button onClick={()=>setFraming({fill:true})}>Заполнить окно</button><button onClick={()=>setFraming({fill:false})}>Область целиком</button></div><label className="env-map-label"><input type="checkbox" checked={overview} onChange={e=>setShowOverview(e.target.checked)}/>Обзорная карта OSM · онлайн</label><label className="env-map-label"><input type="checkbox" checked={showWeather} onChange={e=>setShowWeather(e.target.checked)}/>Погодный слой{weather?` · ${weather.label}`:''}</label>{active.some(p=>p.kind==='raster')&&(overview||active.length>1||active.some(isLandCover))&&<label>Непрозрачность растровых наложений · {Math.round(rasterOpacity*100)}%<input type="range" min={0} max={100} value={Math.round(rasterOpacity*100)} onChange={e=>setRasterOpacity(Number(e.target.value)/100)}/></label>}
   {outsideLocalCoverage&&<p className="env-note" role="status">Текущий вид выходит за локальное покрытие. Состав слоёв не меняется автоматически; при необходимости включите обзорную OSM вручную.</p>}
   <AtlasCatalog names={names} rename={rename} groups={groups} selected={selected} disabled={disabled} terrainId={terrainId} toggle={toggle} show={openRegion}
    toggleLayer={key=>setDisabled(old=>{const next=new Set(old);if(!next.delete(key))next.add(key);return next;})}
    terrain={id=>{if(terrainId===id){setTerrainId(null);return;}setSelected(old=>old.includes(id)?old:[...old,id]);setTerrainId(id);}}
    download={downloadLink} busy={busy} load={()=>setControlTab('maps')} remove={id=>void task(()=>removeMap(id))} removeRegion={group=>void task(()=>removeRegion(group))}/>
   <SeasonControls bounds={region.bounds} enabled={seasons} toggle={k=>setSeasons(old=>old.includes(k)?old.filter(x=>x!==k):[...old,k])}
    month={seasonMonth} choice={monthChoice} choose={setMonthChoice} values={transparency} change={change}/>
    <details><summary>Координаты области</summary><label>Рамка: запад, юг, восток, север<input value={draft} onChange={e=>{setDraft(e.target.value);setPlan(null);}} onBlur={()=>{if(draft!==regionKey)applyBounds(draft.split(',').map(v=>v.trim()?Number(v):NaN));}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/></label>{regionError&&<p role="alert">{regionError}</p>}</details>
   </div>
   <div className="atlas-panel weather-sidebar" hidden={controlTab!=='weather'}>
    <WeatherView preparedWeather={preparedWeather} datasetLabels={datasetLabels} timelineHost={showWeather?timelineHost:null} viewBounds={viewBounds} mapField={mapField} onMapField={setMapField} embedded sharedRegion={weatherRegion} onRegionChange={setRegion} catalog={packages} onOverlay={setWeather}/>
   </div>
   <div className="atlas-panel" hidden={controlTab!=='maps'}>{controlTab==='maps'&&visibleActionError}{!!jobs.length&&<details className="env-jobs" open><summary>Задания загрузки ({jobs.length})</summary><button type="button" disabled={!jobs.some(j=>j.state!=='running')} onClick={()=>void task(async()=>{await environmentApi('/atlas/jobs',{method:'DELETE'});await refresh();})}>Очистить завершённые</button>{jobs.slice().reverse().map(j=><article className="env-job" key={j.id}><strong>{datasetName(j.input.options.name,j.input.options.bounds,j.input.options.bounds&&names[areaKey(j.input.options.bounds)])}</strong><p>{j.stage}</p>{j.state==='running'&&<progress max={j.total||undefined} value={j.total?j.done:undefined}/>}<p>{j.state==='done'?'Готово':j.state==='error'?'Ошибка':j.state==='cancelled'?'Отменено':j.total?Math.round(j.done/j.total*100)+'%':'Выполняется'}{j.error&&` · ${j.error}`}</p><div className="env-actions">{j.state==='running'?<button onClick={()=>void task(async()=>{await environmentApi(`/atlas/jobs/${j.id}/cancel`,{method:'POST'});await refresh();})}>Отменить</button>:j.state!=='done'?<button disabled={busy} onClick={()=>void task(async()=>{await environmentApi(`/atlas/jobs/${j.id}/resume`,{method:'POST'});await refresh();})}>Продолжить</button>:j.result&&packages.some(m=>m.id===j.result?.id)&&<button onClick={()=>{setSelected(s=>s.includes(j.result!.id)?s:[...s,j.result!.id]);setControlTab('layers');}}>Показать карту</button>}</div></article>)}</details>}<section className="env-panel"><h2>Подготовить карту</h2><label>Формат источника<select value={kind} onChange={e=>{const next=e.target.value as AtlasInput['kind'];setKind(next);setPlan(null);if(next==='geojson')setAttribution('');else if(next==='dem')setAttribution('© Copernicus DEM (DLR / Airbus); Copernicus DEM licence');else if(next==='landcover')setAttribution('© ESA WorldCover consortium 2021; modified Copernicus Sentinel data; CC BY 4.0');else if(next==='osm'||next==='openfreemap')setAttribution('© OpenStreetMap contributors; ODbL');}}><option value="mbtiles">Готовые MBTiles</option><option value="openfreemap">Скачать район OpenFreeMap</option><option value="geojson">Векторные объекты GeoJSON</option><option value="osm">Исходные OSM PBF / XML</option><option value="dem">GeoTIFF высот · Copernicus DEM</option><option value="landcover">GeoTIFF покрова · WorldCover</option></select></label>
   {kind==='geojson'&&<GeoJsonHelp bounds={region.bounds}/>}
   <details><summary>Название, масштаб и лицензия</summary><AreaNameEditor key={nameKey} value={names[nameKey]} automatic={automaticName} save={v=>rename(nameKey,v)}/><div className="env-input-grid"><label>Масштаб от<input type="number" min={0} max={16} value={lo} onChange={e=>setLo(Number(e.target.value))}/></label><label>Масштаб до<input type="number" min={lo} max={16} value={hi} onChange={e=>setHi(Number(e.target.value))}/></label></div><label>Источник и лицензия<input value={attribution} onChange={e=>setAttribution(e.target.value)}/></label></details>
   {['osm','dem','landcover'].includes(kind)&&<section className="env-auto-source"><h3>Автоматически по области</h3><button disabled={busy} onClick={()=>void task(async()=>{const result=await environmentApi<Omit<NonNullable<typeof sourcePlan>,'key'>>('/atlas/resolve',{method:'POST',body:JSON.stringify({kind,bounds:options().bounds,minzoom:lo})});setPlan({...result,key:planKey});})}>{busy?'Подбираем…':'Подобрать исходные файлы'}</button>{plan&&<><p className="env-note">{plan.note}</p><p>Файлов: {plan.files.length} · {(plan.bytes/1048576).toFixed(1)} МБ{plan.files.some(f=>!f.bytes)?' (размер части файлов неизвестен)':''}</p>{!!plan.missing.length&&<p className="env-note">У источника нет {plan.missing.length} листов; на этих участках будут пропуски.</p>}<details><summary>Файлы источника</summary>{plan.files.map(f=><p key={f.url}><a href={f.url} target="_blank" rel="noreferrer" className="env-source-link">{f.name}</a><CopySource url={f.url} name={f.name}/></p>)}</details><button disabled={busy} onClick={()=>void task(async()=>{await environmentApi('/atlas/download',{method:'POST',body:JSON.stringify({kind,urls:plan.files.map(f=>f.url),options:options()})});await refresh();})}>Скачать выбранные файлы и подготовить</button></>}</section>}
   {kind==='openfreemap'?<><p className="env-note">До 3000 тайлов и 50 МБ за выгрузку. Массовое скачивание публичного сервера OSM не используется.</p><button disabled={busy} onClick={()=>void task(async()=>{await environmentApi('/atlas/download',{method:'POST',body:JSON.stringify({kind,options:options()})});await refresh();})}>Скачать район</button></>:<><label className="env-file-button">Выбрать исходный файл<input type="file" disabled={busy} accept={kind==='mbtiles'?'.mbtiles':kind==='geojson'?'.json,.geojson':kind==='osm'?'.pbf,.osm':'.tif,.tiff'} onChange={e=>{const file=e.target.files?.[0];if(file)void task(async()=>{setUpload(0);await importFile(file);setUpload(0);await refresh();});e.target.value='';}}/></label>{busy&&upload>0&&<p>Передача файла: {upload}%</p>}<details><summary>Скачать исходный файл по адресу</summary><label>HTTPS-адрес источника<input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://download.geofabrik.de/…osm.pbf"/></label><label>SHA-256 (если опубликован)<input value={hash} onChange={e=>setHash(e.target.value)}/></label><button disabled={busy||!url} onClick={()=>void task(async()=>{await environmentApi('/atlas/download',{method:'POST',body:JSON.stringify({kind,url,options:options(),...(hash?{expectedSha256:hash}:{})})});await refresh();})}>Скачать и подготовить</button><p className="env-note">Разрешены официальные серверы Geofabrik, OpenFreeMap и S3-наборы DEM / WorldCover. Остальные источники можно загрузить файлом.</p></details></>}
   <p className="env-note">{runtime?runtime.ok?'GIS-runtime готов: преобразование OSM, высот и покрова доступно.':`MBTiles и GeoJSON доступны. Для исходных OSM/GeoTIFF нужен GIS-runtime. ${runtime.error??''}`:'Проверяем GIS-runtime…'}</p>
  </section><details className="env-panel"><summary>Источники и лицензии</summary>{sources.map(s=><article key={s.id} className="env-catalog-card"><a className="env-source-link" href={s.url} target="_blank" rel="noreferrer">{s.name} ↗</a><p>{s.detail}</p><p>{s.license}</p><CopySource url={s.url} name={s.name}/></article>)}<p className="env-note">Наборы разных лет и разрешений сохраняются отдельно. Присутствие объекта на карте не подтверждает его текущее состояние.</p></details><details><summary>Шрифты карты</summary><button disabled={busy} onClick={()=>void task(async()=>{await environmentApi('/atlas/fonts',{method:'POST'});})}>Подготовить локальные шрифты</button></details></div>
  </aside><div className="atlas-viewport"><AtlasMap framing={framing} regions={regions} transparency={transparency} seasons={seasons} seasonMonth={seasonMonth} terrainId={terrainId} onViewBounds={setViewBounds} rasterOpacity={rasterOpacity} bounds={customRegion?region.bounds:WORLD_BOUNDS} overview={overview} packages={active} disabled={disabled} weather={showWeather?weather:null}/>
   {showWeather&&<div className="weather-map-tools" role="group" aria-label="Погода на карте">{mapWeatherFields.map(f=><button key={f} aria-pressed={mapField===f} onClick={()=>setMapField(f)}>{f==='snowDepth'?'Глубина снега':weatherFieldLabels[f].split(',')[0]}</button>)}</div>}
   <div className="weather-map-footer">
   <div className="weather-film-host" ref={setTimelineHost}/>
   {showWeather&&weather&&<div className="atlas-weather-key">
    <strong>{weatherFieldLabels[mapField]}</strong>
    {weather.data.features.length?<><div className="atlas-weather-scale">{scale.map(([v,color])=><span key={v} style={{borderColor:color}}>{v.toLocaleString('ru-RU')}</span>)}</div>

    {!weather.rasters.length&&<small>Данные в отдельных точках</small>}</>:<small>Нет данных за выбранное время</small>}
    <TransparencyInput title={weatherFieldLabels[mapField]} value={transparencyFor(transparency,mapField)} onChange={v=>change(mapField,v)}/>
   </div>}</div></div></div>
 </section>;
}
