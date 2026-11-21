import {useEffect,useRef,useState} from 'react';
import type {WeatherScenario,WeatherDataset} from '../../../../packages/core/src/weather';
import type {WeatherRegion} from '../../../../packages/core/src/weather-grid';
import type {AtlasMeta} from '../../../../services/cartography/src/atlas';
import type {AtlasJob} from '../../../../services/cartography/src/atlas-jobs';
import {coversView} from './environment-region';
import {environmentApi} from './environment-api';
import {archivePlan,readRegionArchives,type ArchiveItem} from './region-archives';
import {selectAnalogue} from './weather-analogue';
import {mapKinds,layerInfo,layerNames,layerForArea,regionZoom,type RegionLayer} from './region-layers';

type Plan={files:{url:string;bytes?:number}[];missing:string[];bytes:number};
type Row={text:string;available:boolean;map?:AtlasMeta;plan?:Plan;years?:ReturnType<typeof archivePlan>};
export interface PreparedWeather {dataset:WeatherDataset;start:number;end:number}
interface Props {
  region:WeatherRegion;name:string;scenario:WeatherScenario;runtime:boolean|null;
  catalogKey:string; removeMap:(id:string)=>Promise<void>; activate:(m:AtlasMeta,previousId?:string)=>void;weatherReady:(w:PreparedWeather)=>void;refresh:()=>Promise<void>;importLayer:()=>void;
}
const order:RegionLayer[]=['openfreemap','weather','dem','landcover','osm'];

export function RegionData({region,name,scenario,runtime,catalogKey,removeMap,activate,weatherReady,refresh,importLayer}:Props){
  const [rows,setRows]=useState<Partial<Record<RegionLayer,Row>>>({});
  const [selected,setSelected]=useState<RegionLayer[]>(order.filter(k=>k!=='osm'));
  const [updates,setUpdates]=useState<Partial<Record<RegionLayer,string>>>({});
  const [busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
  const [confirmId,setConfirmId]=useState<string|null>(null);
  const [deleteError,setDeleteError]=useState('');
  const [removing,setRemoving]=useState(false);
  const [done,setDone]=useState(false);
  const active=useRef<AbortController|null>(null);
  const [customMaps,setCustomMaps]=useState<AtlasMeta[]>([]);
  const zoom=regionZoom(region.bounds);
  const runtimeReady=runtime===true;
  const date=new Date(scenario.start),duration=scenario.durationHours??168;
  useEffect(()=>()=>active.current?.abort(),[]);
  useEffect(()=>{
    const c=new AbortController(),signal=c.signal;
    const put=(k:RegionLayer,row:Row)=>{if(!signal.aborted)setRows(old=>({...old,[k]:row}));};
    const fail=(k:RegionLayer,e:unknown)=>put(k,{available:false,text:(e as Error).message});
    setRows({});setCustomMaps([]);
    void (async()=>{
      const [maps,jobs]=await Promise.all([environmentApi<AtlasMeta[]>('/atlas',{signal}),environmentApi<AtlasJob[]>('/atlas/jobs',{signal})]);
      if(!signal.aborted)setCustomMaps(maps.filter(m=>coversView(m.bounds,region.bounds)&&!mapKinds.some(k=>layerForArea(k,region.bounds,[m],jobs))));
      await Promise.all(mapKinds.map(async k=>{
        try{
          const map=layerForArea(k,region.bounds,maps,jobs);
          if(map){const partial=jobs.find(j=>j.result?.id===map.id)?.input.missingSheets;
            put(k,{available:true,map,text:partial?`На компьютере · отсутствуют листы: ${partial}`:'На компьютере'});return;}
          if(Math.abs(region.bounds[1])>85.05112878||Math.abs(region.bounds[3])>85.05112878)throw Error('Рамка выходит за пределы тайловой проекции (±85,05°).');
          if(k==='openfreemap'){put(k,{available:true,text:`OpenFreeMap · ${zoom.tiles} тайлов · z${zoom.minzoom}–${zoom.maxzoom}`});return;}
          if(!runtimeReady){put(k,{available:false,text:runtime===null?'Проверяем модуль ГИС…':'Для подготовки требуется модуль ГИС'});return;}
          const plan=await environmentApi<Plan>('/atlas/resolve',{method:'POST',body:JSON.stringify({kind:k,bounds:region.bounds}),signal});
          if(!plan.files.length)throw Error('Источник не содержит данных для этой области.');
          const size=plan.files.some(f=>!f.bytes)?'размер уточняется':`${(plan.bytes/1048576).toLocaleString('ru-RU',{maximumFractionDigits:1})} МБ`;
          put(k,{available:true,plan,text:`${plan.files.length} файл(ов) · ${size}${plan.missing.length?' · отсутствуют листы: '+plan.missing.length:''}`});
        }catch(e){fail(k,e);}
      }));
    })().catch(e=>mapKinds.forEach(k=>fail(k,e)));
    void environmentApi<ArchiveItem[]>('/environment/weather',{signal}).then(items=>{
      const year=Math.max(1942,Math.min(new Date().getUTCFullYear()-1,date.getUTCFullYear()-1));
      const years=archivePlan(items,region,year,3,date.getUTCMonth(),duration);
      const local=years.filter(y=>y.id).length;
      put('weather',{available:true,years,text:`${date.toLocaleString('ru-RU',{month:'long',timeZone:'UTC'})} · ${years[0].year}–${year} · на компьютере ${local} из ${years.length}`});
    }).catch(e=>fail('weather',e));
    return()=>c.abort();
  },[region.bounds,runtime,scenario.start,duration,attempt,catalogKey]);

  async function run(wanted:RegionLayer[]=selected,newBaseCopy=false){
    if(active.current)return;
    const c=new AbortController(),signal=c.signal;active.current=c;
    setBusy(true);setDone(false);
    const note=(k:RegionLayer,text:string)=>{if(!signal.aborted)setUpdates(old=>({...old,[k]:text}));};
    for(const k of order){
      const row=rows[k];
      if(!wanted.includes(k)||!row?.available||signal.aborted)continue;
      try{
        if(k==='weather'){
          const sets=await readRegionArchives(region,row.years!,signal,s=>note(k,s));
          signal.throwIfAborted();
          setRows(old=>({...old,weather:{...row,years:row.years!.map((y,i)=>({...y,id:sets[i].id})),text:'На компьютере · '+sets.length+' года'}}));
          const match=selectAnalogue(sets,date.getUTCMonth(),duration,'typical');
          signal.throwIfAborted();weatherReady({dataset:match.dataset,start:match.start,end:match.end});
          note(k,'Архивный период открыт на карте');
        }else if(row.map&&!(k==='openfreemap'&&newBaseCopy)){activate(row.map);note(k,'Включён на карте');}
        else{
          const options={bounds:region.bounds,name:`${name} · ${layerInfo[k].name}`,attribution:layerInfo[k].credit,minzoom:zoom.minzoom,maxzoom:zoom.maxzoom};
          let job:AtlasJob|undefined;
          while(!job){
            const existing=await environmentApi<AtlasJob[]>('/atlas/jobs',{signal});
            const running=existing.find(j=>j.state==='running');
            if(running?.input.kind===k&&running.input.options.bounds.every((v,i)=>v===region.bounds[i]))job=running;
            else if(!running){
              try{job=await environmentApi<AtlasJob>('/atlas/download',{method:'POST',signal,body:JSON.stringify({kind:k,options,
                ...(row.plan?{urls:row.plan.files.map(f=>f.url),missingSheets:row.plan.missing.length}:{})})});}
              catch(e){if(!(e instanceof Error)||!e.message.includes('Дождитесь текущей операции'))throw e;}
            }
            if(!job){
              note(k,'Ожидаем завершения текущей загрузки');
              await new Promise(r=>setTimeout(r,1000));signal.throwIfAborted();
            }
          }
          while(job.state==='running'){
            note(k,job.total?`${job.stage} · ${Math.round(100*job.done/job.total)}%`:job.stage);
            await new Promise(r=>setTimeout(r,1000));signal.throwIfAborted();
            const list=await environmentApi<AtlasJob[]>('/atlas/jobs',{signal});
            const next=list.find(j=>j.id===job!.id);if(!next)throw Error('Задание отсутствует в каталоге.');job=next;
          }
          if(job.state!=='done'||!job.result)throw Error(job.error||job.stage);
          signal.throwIfAborted();const map=job.result;
          setRows(old=>({...old,[k]:{...row,map,text:'На компьютере'}}));activate(map,newBaseCopy?row.map?.id:undefined);note(k,job.stage==='Готово'?'Включён на карте':job.stage);
        }
      }catch(e){note(k,(e as Error).message);}
    }
    active.current=null;
    if(!signal.aborted){setBusy(false);setDone(true);void refresh().catch(()=>{});}
  }
  const base=rows.openfreemap;
  const pack=base?.map;
  const locked=busy||removing;
  async function deletePackage(id:string){
    if(locked||id!==confirmId)return;
    setRemoving(true);setDeleteError('');
    try{
      await removeMap(id);
      setConfirmId(null);
      setUpdates(old=>({...old,openfreemap:undefined}));
    }catch(e){setDeleteError((e as Error).message);}
    finally{setRemoving(false);}
  }
  const checking=selected.some(k=>!rows[k]||(runtime===null&&!rows[k]?.map&&k!=='openfreemap'&&k!=='weather'));
  return <section className="env-panel region-data"><h2>Данные области</h2><p>{name}</p>
    <section className="region-osm-package" aria-label="Комплект слоёв OSM">
      <h3>Комплект слоёв OSM</h3>
      {pack?<><p>{pack.name} · {(pack.bytes/1048576).toLocaleString('ru-RU',{maximumFractionDigits:1})} МБ · z{pack.minzoom}–{pack.maxzoom}</p>
        {pack.importedAt&&<small>Сохранён {new Date(pack.importedAt).toLocaleString('ru-RU')}</small>}
        <details><summary>Слои по описанию файла · {pack.layers.length}</summary>
          <p>{pack.layers.map(l=>layerNames[l.id]??l.id).join(', ')||'Источник не указал список слоёв.'}</p></details>
        {confirmId===pack.id?<div><p>Удалить с компьютера файл «{pack.name}» со всеми его слоями?</p>
          <button disabled={locked} onClick={()=>void deletePackage(pack.id)}>Подтвердить удаление</button>{' '}
          <button disabled={locked} onClick={()=>setConfirmId(null)}>Отмена</button></div>:
          <div className="env-actions"><button disabled={locked} onClick={()=>activate(pack)}>Открыть на карте</button>
          <button disabled={locked} onClick={()=>void run(['openfreemap'],true)}>Скачать новую копию</button>
          <button disabled={locked} onClick={()=>{setDeleteError('');setConfirmId(pack.id);}}>Удалить комплект</button></div>}
      </>:<><p>Все векторные слои OpenFreeMap для выбранной рамки и масштабов в одном файле MBTiles.</p>
        <button disabled={locked||!base?.available} onClick={()=>void run(['openfreemap'])}>Скачать комплект OSM</button></>}
      {updates.openfreemap&&<small role="status">{updates.openfreemap}</small>}
      {deleteError&&<p role="alert">{deleteError}</p>}
    </section>
    {order.map(k=><label key={k} className="region-layer"><input type="checkbox" checked={selected.includes(k)} disabled={locked||rows[k]?.available===false}
      onChange={e=>setSelected(old=>e.target.checked?[...old,k]:old.filter(x=>x!==k))}/>
      <span><strong>{layerInfo[k].name}</strong><small>{rows[k]?.text??'Проверяем доступность…'}</small>
      {k!=='openfreemap'&&updates[k]&&<small role="status">{updates[k]}</small>}</span></label>)}
    <p className="env-note">Климатические и сезонные слои уже встроены. Их можно включить во вкладке «Слои».</p>
    <button disabled={locked||checking||!selected.some(k=>rows[k]?.available)} onClick={()=>void run()}>{busy?'Подготовка…':
      selected.some(k=>rows[k]?.available&&!rows[k]?.map&&(k!=='weather'||rows.weather?.years?.some(y=>!y.id)))?'Скачать и открыть слои':'Открыть локальные слои'}</button>
    {(!busy&&(done||order.some(k=>rows[k]?.available===false)))&&<button onClick={()=>setAttempt(n=>n+1)}>Проверить доступность снова</button>}
    {customMaps.map(m=><button key={m.id} disabled={busy} onClick={()=>activate(m)}>Открыть · {m.name}</button>)}
    <button disabled={busy} onClick={importLayer}>Импортировать свой набор</button>
  </section>;
}
