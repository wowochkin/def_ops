import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {weatherAt,type WeatherDataset,type WeatherScenario} from '../../../../packages/core/src/weather';
import type {WeatherRegion} from '../../../../packages/core/src/weather-grid';
import {environmentApi,weatherFieldLabels} from './environment-api';
import {centerOf,coversView} from './environment-region';
import {WeatherField} from './WeatherField';
import {WeatherTimeline} from './WeatherTimeline';
import {selectAnalogue,type Analogue} from './weather-analogue';
import type {WeatherOverlay,MapWeatherField} from './weather-layer';

import {archivePlan,readRegionArchives,type ArchiveItem} from './region-archives';
const stamp=(ms:number)=>new Date(ms).toISOString().slice(0,16).replace('T',' ');
const hourMs=3600000;

export function HistoricalWeather({region,scenario,items,refresh,field,setField,onOverlay,timelineHost}:{
  region:WeatherRegion;scenario:WeatherScenario;items:ArchiveItem[];refresh:()=>Promise<unknown>;
  field:MapWeatherField;setField:(v:MapWeatherField)=>void;onOverlay?:(v:WeatherOverlay)=>void;timelineHost?:HTMLDivElement|null;
}){
  const date=new Date(scenario.start),duration=scenario.durationHours??168,month=date.getUTCMonth();
  const [year,setYear]=useState(Math.min(new Date().getUTCFullYear()-1,date.getUTCFullYear()-1));
  const [threshold,setThreshold]=useState(.1);
  const [count,setCount]=useState(3),[kind,setKind]=useState<'wet'|'typical'>('typical'),[source,setSource]=useState('');
  const [result,setResult]=useState<Analogue|null>(null),[time,setTime]=useState(0);
  const [point,setPoint]=useState(()=>centerOf(region.bounds));
  const [progress,setProgress]=useState(''),[error,setError]=useState('');
  const abort=useRef<AbortController|null>(null);
  const cache=useRef(new Map<string,WeatherDataset>());
  useEffect(()=>()=>abort.current?.abort(),[]);
  useEffect(()=>{if(!result)onOverlay?.({field,rasters:[],bounds:region.bounds,label:'Выберите период',data:{type:'FeatureCollection',features:[]}});},[result,field,region,onOverlay]);
  const archives=items.filter(i=>i.source.kind!=='synthetic'&&(i.region?
    i.region.bounds.every((v,k)=>v===region.bounds[k]):i.points.length===1&&i.points.some(p=>{const [lat,lon]=p.split(',').map(Number);return coversView(region.bounds,[lon,lat,lon,lat]);})));
  const block=useMemo(()=>result&&({...result.dataset,rows:result.dataset.rows.filter(r=>{
    const t=Date.parse(r.time);
    return t>=result.start&&t<=result.start+Math.ceil(duration)*hourMs;
  })}),[result,duration]);
  const times=useMemo(()=>{if(!block||!result)return [];
    return [...new Set([...block.rows.map(r=>Date.parse(r.time)).filter(t=>t<=result.end),result.end])].sort((a,b)=>a-b);
  },[block,result]);
  const reading=block?weatherAt(block,point.lat,point.lon,new Date(time).toISOString()):null;
  async function select(){
    if(abort.current)return;
    const controller=new AbortController();abort.current=controller;
    setError('');setProgress('Читаем архив…');setResult(null);
    try{
      const sets:WeatherDataset[]=[];
      const read=async(id:string)=>cache.current.get(id)??await environmentApi<WeatherDataset>(`/environment/weather/${id}`,{signal:controller.signal});
      if(source)sets.push(await read(source));
      else{
        const plan=archivePlan(items,region,year,count,month,duration);
        sets.push(...await readRegionArchives(region,plan,controller.signal,setProgress,cache.current));
      }
      for(const d of sets)cache.current.set(d.id,d);
      const match=selectAnalogue(sets,month,duration,kind,kind==='wet'?threshold:.1);
      const center=centerOf(region.bounds);
      const available=match.dataset.rows.filter(r=>Date.parse(r.time)===match.start);
      const distance=(r:{lat:number;lon:number})=>(r.lat-center.lat)**2+((((r.lon-center.lon+540)%360)-180)*Math.cos(center.lat*Math.PI/180))**2;
      const initial=available.reduce((a,b)=>distance(b)<distance(a)?b:a);
      setPoint({lat:initial.lat,lon:initial.lon});setTime(kind==='wet'?match.wetMiddle:match.start);setResult(match);
    }catch(e){if(!controller.signal.aborted)setError((e as Error).message);}
    finally{abort.current=null;if(!controller.signal.aborted){setProgress('');void refresh();}}
  }
  return <section className="env-panel"><h2>Исторический аналог</h2>
    <p>{date.toLocaleDateString('ru-RU',{month:'long',timeZone:'UTC'})} · {duration} ч. Месяц и длительность задаются в настройках симуляции.</p>
    <fieldset disabled={!!progress}><label>Источник аналога<select value={source} onChange={e=>{setSource(e.target.value);setResult(null);}}>
      <option value="">Архив за несколько лет</option>{archives.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
    {!source&&<div className="env-input-grid"><label>Последний год выборки<input type="number" value={year} onChange={e=>{setYear(Number(e.target.value));setResult(null);}}/></label>
      <label>Число лет<select value={count} onChange={e=>{setCount(Number(e.target.value));setResult(null);}}>{[1,3,5].map(n=><option key={n}>{n}</option>)}</select></label></div>}
    <label>Какой период показать<select value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setResult(null);}}>
      <option value="typical">Близкий к средним условиям</option><option value="wet">С самыми долгими осадками</option></select></label>
    {kind==='wet'&&<label>Порог осадков, мм/ч<input type="number" step=".1" min=".1" value={threshold} onChange={e=>{setThreshold(Number(e.target.value));setResult(null);}}/></label>}
    <button disabled={kind==='wet'&&(!Number.isFinite(threshold)||threshold<=0)} onClick={()=>void select()}>Подобрать период</button></fieldset>
    {progress&&<p role="status">{progress}</p>}{error&&<p role="alert">{error}</p>}
    {result&&block&&<><p><strong>{stamp(result.start)} — {stamp(result.end)} UTC</strong></p>
      <p>В опорной точке за этот период осадки от {(kind==='wet'?threshold:0.1).toLocaleString('ru-RU')} мм/ч шли {result.wetHours.toLocaleString('ru-RU')} ч, дольше всего подряд — {result.longestWet.toLocaleString('ru-RU')} ч. Пик {result.peak.toLocaleString('ru-RU')} мм/ч.</p>
      <p className="env-note">{block.source.title} · {block.source.spatialResolution}. Все слои воспроизводятся синхронно.</p>
      {timelineHost?createPortal(<WeatherTimeline key={result.start} start={result.start} end={result.end} time={time} source="Исторический аналог" archiveTimes={times} select={setTime}/>,timelineHost):
      <WeatherTimeline key={result.start} start={result.start} end={result.end} time={time} source="Исторический аналог" archiveTimes={times} select={setTime}/>}
      <WeatherField region={block.region??region} scenario={scenario} dataset={block} time={new Date(time).toISOString()} field={field} setField={setField} onOverlay={onOverlay} onPoint={(lon,lat)=>setPoint({lon,lat})}/>
      <p>{weatherFieldLabels[field]} · {reading?.[field]?.toLocaleString('ru-RU',{maximumFractionDigits:3})??'Нет данных'}</p></>}
  </section>;
}
