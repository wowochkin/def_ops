import {layerNames} from './region-layers';
import {areaKey,automaticAreaName,datasetName} from './atlas-place-name';
import {AreaNameEditor} from './AreaNameEditor';
import {osmThemes,regionThemeKey} from './osm-themes';
import {useEffect,useState} from 'react';
import {environmentApi} from './environment-api';
import type {AtlasMeta} from '../../../../services/cartography/src/atlas';
import type {AtlasJob} from '../../../../services/cartography/src/atlas-jobs';

type Bounds = AtlasMeta['bounds'];
interface RegionGroup { key:string; bounds:Bounds; maps:AtlasMeta[] }
export function catalogRegions(maps:AtlasMeta[], jobs:AtlasJob[]) {
  const requested = new Map(jobs.filter(j=>j.state==='done' && j.result && j.input.kind!=='mbtiles')
    .map(j=>[j.result!.id,j.input.options.bounds]));
  const groups = new Map<string,RegionGroup>();
  for(const map of maps){
    const bounds=requested.get(map.id)??map.bounds;
    const key=areaKey(bounds);
    let group=groups.get(key);
    if(!group){group={key,bounds,maps:[]};groups.set(key,group);}
    group.maps.push(map);
  }
  return [...groups.values()].sort((a,b)=>b.bounds[3]-a.bounds[3]||a.bounds[0]-b.bounds[0]);
}
export function useAtlasCatalog() {
  const [catalog, setCatalog] = useState<{groups: RegionGroup[]; failed: boolean} | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const options = {signal: controller.signal};
    void Promise.all([
      environmentApi<AtlasMeta[]>('/atlas', options),
      environmentApi<AtlasJob[]>('/atlas/jobs', options).catch(() => []),
    ]).then(([maps, jobs]) => {
      if (!controller.signal.aborted) setCatalog({groups: catalogRegions(maps, jobs), failed: false});
    }).catch(() => {
      if (!controller.signal.aborted) setCatalog({groups: [], failed: true});
    });
    return () => controller.abort();
  }, []);
  return catalog;
}
function coordinate(lon:number,lat:number){
  const n=(v:number)=>Math.abs(v).toLocaleString('ru-RU',{maximumFractionDigits:4});
  return n(lat)+'° '+(lat<0?'ю.':'с.')+' '+n(lon)+'° '+(lon<0?'з.':'в.');
}
export function AtlasCatalog({groups,selected,disabled,terrainId,toggle,toggleLayer,terrain,show,remove,download,busy,load,names,rename}:{
  names:Record<string,string>;rename:(key:string,value:string)=>void;
  groups:RegionGroup[];selected:string[];disabled:Set<string>;terrainId:string|null;
  toggle:(id:string)=>void;toggleLayer:(key:string)=>void;terrain:(id:string)=>void;show:(bounds:Bounds)=>void;
  remove:(id:string)=>void;download:(id:string)=>string;busy:boolean;load:()=>void;
}){
  const [search,setSearch]=useState('');
  const [confirmId,setConfirmId]=useState<string|null>(null);
  return <section className="env-panel atlas-catalog"><h2>Области карты</h2>
    {!groups.length&&<><p>Загруженные карты появятся здесь.</p><button onClick={load}>Загрузить карту</button></>}
    {groups.length>1&&<label>Найти область<input type="search" placeholder="Название или координаты" value={search} onChange={e=>setSearch(e.target.value)}/></label>}
    {groups.map(g=>{
      const [w,s,e,n]=g.bounds;
      const automatic=automaticAreaName(g.bounds), name=names[g.key]||automatic;
      const terms=[name,automatic,coordinate(w,s),coordinate(e,n),g.key,...g.maps.map(m=>m.name)].join(' ').toLocaleLowerCase('ru');
      if(!terms.includes(search.trim().toLocaleLowerCase('ru')))return null;
      const activeSources=new Set(g.maps.filter(p=>p.kind==='vector' && selected.includes(p.id)).flatMap(p=>p.layers.map(l=>l.id)));
      const themes=osmThemes.filter(t=>t.sources.some(id=>activeSources.has(id)));
      return <details key={g.key} className="atlas-region">
        <summary><strong>{name}</strong><small>{coordinate(w,s)} — {coordinate(e,n)}</small>
          <small>Наборы на карте · {g.maps.filter(m=>selected.includes(m.id)).length} из {g.maps.length}</small></summary>
        <button onClick={()=>show([...g.bounds])}>Показать область</button>
        {themes.length>0&&<fieldset className="atlas-object-themes"><legend>Объекты на векторной карте</legend>
          {themes.map(t=>{
            const key=regionThemeKey(g.key,t.id);
            return <label className="env-map-label" key={key}><input type="checkbox" checked={!disabled.has(key)} onChange={()=>toggleLayer(key)}/>{t.label}</label>;
          })}
        </fieldset>}
        {g.maps.map(p=><article className="env-map-group" key={p.id}>
          <label className="env-map-label"><input type="checkbox" checked={selected.includes(p.id)} onChange={()=>toggle(p.id)}/><strong>{datasetName(p.name,g.bounds,name)}</strong></label>
          <p className="env-note">{p.kind==='terrain'?'Цифровая модель высот':p.kind==='raster'?'Растровая карта':'Векторная карта'} · {(p.bytes/1048576).toFixed(1)} МБ · z{p.minzoom}–{p.maxzoom}</p>
          {p.kind==='terrain'&&<button aria-pressed={terrainId===p.id} onClick={()=>terrain(p.id)}>Рельеф в 3D</button>}
          {selected.includes(p.id)&&<details><summary>Слои набора{p.layers.length?' · '+p.layers.length:''}</summary>
            {(p.layers.length?p.layers:[{id:'raster'}]).map(l=><label className="env-map-label" key={l.id}>
              <input type="checkbox" checked={!disabled.has(p.id+'/'+l.id)} onChange={()=>toggleLayer(p.id+'/'+l.id)}/>
              {l.id==='raster'?(p.kind==='terrain'?'Отмывка рельефа':'Изображение'):layerNames[l.id]??l.id}
            </label>)}</details>}
          <details><summary>Сведения и управление</summary><div className="env-actions"><a href={download(p.id)} className="env-source-link">Экспорт MBTiles</a>
            {confirmId===p.id?<><span>Удалить файл «{p.name}» с компьютера?</span><button disabled={busy} onClick={()=>{setConfirmId(null);remove(p.id);}}>Подтвердить удаление</button><button disabled={busy} onClick={()=>setConfirmId(null)}>Отмена</button></>:<button disabled={busy} onClick={()=>setConfirmId(p.id)}>Удалить набор</button>}</div>
            {p.importedAt&&<p className="env-note">Сохранён {new Date(p.importedAt).toLocaleString('ru-RU')}</p>}
            <p className="env-note">{p.attribution} · SHA-256: <code>{p.sha256}</code></p></details>
        </article>)}
        <details><summary>Переименовать область</summary><AreaNameEditor automatic={automatic} value={names[g.key]} save={v=>rename(g.key,v)}/></details>
      </details>;
    })}
    <p className="atlas-empty-search" role="status">Совпадений нет.</p>
  </section>;
}
