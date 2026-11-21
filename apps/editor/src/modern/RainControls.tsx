import {rainEpisode,type RainSchedule} from '../../../../packages/core/src/weather-episodes';
import type {WeatherScenario} from '../../../../packages/core/src/weather';

export function RainControls({scenario,hour,duration,change,jump}:{
  scenario:WeatherScenario;hour:number;duration:number;change:(v:RainSchedule)=>void;jump:(h:number)=>void;
}){
  const schedule=scenario.rain;
  const mode=schedule?.mode??(scenario.keyframes?.some(k=>k.values.precipitation!==undefined)?'background':'auto');
  let event=rainEpisode(scenario,hour);
  if(event&&mode==='auto'&&hour>=event.startHour+event.durationHours)event=rainEpisode(scenario,hour+48);
  const visible=event&&event.startHour<duration?event:null;
  return <section className="env-panel"><label>Продолжительные осадки<select value={mode} onChange={e=>{
    if(e.target.value==='event')change({mode:'event',startHour:0,durationHours:Math.min(duration,8),intensity:16});
    else change({mode:e.target.value==='auto'?'auto':'background'});
  }}><option value="auto">Эпизоды по зерну сценария</option><option value="event">Задать эпизод</option><option value="background">Только фон и ключевые состояния</option></select></label>
  {schedule?.mode==='event'&&<div className="env-input-grid">
    {([['startHour','Начало, ч от старта'],['durationHours','Длительность осадков, ч'],['intensity','Интенсивность, мм/ч']] as const).map(([k,label])=>
      <label key={k}>{label}<input type="number" min={k==='startHour'?0:.01} step="any" value={schedule[k]} onChange={e=>change({...schedule,[k]:Number(e.target.value)})}/></label>)}</div>}
  {visible&&<p>Осадки с {visible.startHour} до {Math.min(duration,visible.startHour+visible.durationHours)} ч · фон эпизода {visible.intensity} мм/ч.
    {' '}<button type="button" onClick={()=>jump((visible.startHour+Math.min(duration,visible.startHour+visible.durationHours))/2)}>Показать эпизод</button></p>}
  {!visible&&mode!=='background'&&<p className="env-note">В оставшееся время сценария эпизодов нет.</p>}
  </section>;
}
