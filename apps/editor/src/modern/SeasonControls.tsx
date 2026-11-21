import {RegionalClimate} from './RegionalClimate';
import type {WeatherRegion} from '../../../../packages/core/src/weather-grid';
import {months, regionSeason, seasonDetails, seasonKeys, seasonLegend, seasonalNames,type Season} from './seasonal-atlas';
import {TransparencyInput,transparencyFor,type Transparency} from './layer-transparency';

export function SeasonControls({bounds,enabled,toggle,month,choice,choose,values,change}:{
 bounds:WeatherRegion['bounds'];enabled:Season[];toggle:(s:Season)=>void;month:number;choice:number;choose:(m:number)=>void;
 values:Transparency;change:(k:Season,v:number)=>void;
}){
 return <details className="seasonal-atlas"><summary>Климатические слои и сезонность</summary>
  <label>Месяц климата<select value={choice} onChange={e=>choose(Number(e.target.value))}>
   <option value={-1}>По времени на карте · {months[month]}</option>
   {months.map((m,i)=><option key={m} value={i}>{m}</option>)}
  </select></label>
  <p className="env-note">Типичный год · NOAA, 1991–2020 · ячейка 5°</p>
  {seasonKeys.map(k=><section key={k}>
   <label className="env-map-label"><input type="checkbox" checked={enabled.includes(k)} onChange={()=>toggle(k)}/>{seasonalNames[k]}</label>
   {enabled.includes(k)&&<>
    <p><strong>{regionSeason(k,month,bounds)}</strong> · выбранная область</p><p className="env-note">{seasonDetails[k]}</p>
    <div className="season-scale">{seasonLegend(k).map(s=><small key={s.text} style={{borderTopColor:s.color}}>{s.text}</small>)}</div>
    <TransparencyInput title={seasonalNames[k]} value={transparencyFor(values,k)} onChange={v=>change(k,v)}/>
   </>}
  </section>)}
  <details><summary>Годовой ход температуры</summary><RegionalClimate bounds={bounds}/></details>
 </details>;
}
