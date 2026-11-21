import {useEffect,useState} from 'react';

const minute=60000;
const clock=new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',hour:'2-digit',minute:'2-digit'});
const day=new Intl.DateTimeFormat('ru-RU',{timeZone:'UTC',day:'numeric',month:'short'});
export function WeatherTimeline({start,end,time,select,source,archiveTimes}:{start:number;end:number;time:number;select:(ms:number)=>void;source:string;archiveTimes?:number[]}) {
 const [playing,setPlaying]=useState(false);
 const step=10*minute, last=archiveTimes?archiveTimes.length-1:Math.ceil((end-start)/step);
 let index=archiveTimes?archiveTimes.findIndex(t=>t>=time):Math.round((time-start)/step);
 index=Math.min(last,Math.max(0,index<0?last:index));
 const at=(i:number)=>archiveTimes?archiveTimes[i]:Math.min(end,start+i*step);
 useEffect(()=>{
  if(!playing)return;
  if(index>=last){setPlaying(false);return;}
  const timer=setTimeout(()=>select(at(index+1)),650);
  return ()=>clearTimeout(timer);
 },[playing,index,last,start,end,archiveTimes,select]);
 const jump=(i:number)=>{setPlaying(false);select(at(Math.min(last,Math.max(0,i))));};
 return <div className="weather-film" role="group" aria-label="Кадры погоды">
  <button type="button" disabled={last<=0} aria-label={playing?'Остановить анимацию':'Воспроизвести погоду'} onClick={()=>{if(index===last&&last>0)select(start);setPlaying(!playing);}}>{playing?'Ⅱ':'▶'}</button>
  <div className="weather-film-track"><div className="weather-film-title"><span>{source}</span><time>{day.format(time)} · {clock.format(time)} UTC</time></div>
   <input type="range" aria-label="Кадр погоды" min={0} max={last} value={index} disabled={last<=0} onChange={e=>jump(Number(e.target.value))}/>
   <div className="weather-film-ticks" aria-hidden="true">{[0,.25,.5,.75,1].map(f=>{const t=at(Math.round(last*f));return <span key={f}>{end-start>24*60*minute?day.format(t):clock.format(t)}</span>;})}</div>
  </div>
  <button aria-label="Предыдущий кадр" disabled={index===0} onClick={()=>jump(index-1)}>‹</button><button aria-label="Следующий кадр" disabled={index>=last} onClick={()=>jump(index+1)}>›</button>
 </div>;
}
