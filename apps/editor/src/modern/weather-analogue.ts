import type {WeatherDataset,WeatherField,WeatherRow} from '../../../../packages/core/src/weather';
import {centerOf} from './environment-region';

const hourMs=3600000;
const profileFields = ['temperature','precipitation','snowDepth','soilTemperature','soilMoisture','visibility'] as const satisfies readonly WeatherField[];

export interface Analogue {
  dataset: WeatherDataset;
  start: number;
  end: number;
  wetHours: number;
  longestWet: number;
  wetMiddle: number;
  peak: number;
  mean: (number|null)[];
}

export function historicalWindow(year:number,month:number,duration:number){
  const start=Date.UTC(year,month,1);
  // Все даты начала внутри месяца имеют одинаковое продолжение за его границей.
  const end=Date.UTC(year,month+1,0)+Math.ceil(duration/24)*86400000;
  return {start:new Date(start).toISOString().slice(0,10),end:new Date(end).toISOString().slice(0,10)};
}

function windows(dataset:WeatherDataset,month:number,duration:number,wetSearch:boolean,threshold:number) {
  if(dataset.source.kind==='synthetic'||!dataset.rows.length)return [];
  const {lat,lon}=dataset.region?centerOf(dataset.region.bounds):dataset.rows[0];
  const cosLat=Math.cos(lat*Math.PI/180);
  const distance=(r:WeatherRow)=>(r.lat-lat)**2+((((r.lon-lon+540)%360)-180)*cosLat)**2;
  const first=dataset.rows.reduce((nearest,row)=>distance(row)<distance(nearest)?row:nearest);
  const rows=dataset.rows.filter(r=>r.lat===first.lat&&r.lon===first.lon);
  const result:Analogue[]=[];
  const steps=Math.ceil(duration);
  // Сравниваем равные интервалы. Осадки в строке относятся к предшествующему часу.
  for(let i=0;i+steps<rows.length;i++){
    const date=new Date(rows[i].time);
    if(date.getUTCMonth()!==month||date.getUTCMinutes()!==0||date.getUTCSeconds()!==0)continue;
    const startsWet=(rows[i+1].precipitation??0)>=threshold&&(i===0||(rows[i].precipitation??0)<threshold);
    if(date.getUTCHours()!==0&&!(wetSearch&&startsWet))continue;
    const start=date.getTime();
    let run=0,longestWet=0,wetMiddle=start,peak=0,wetHours=0,complete=true;
    const sums=profileFields.map(()=>0), counts=profileFields.map(()=>0);
    for(let j=1;j<=steps;j++){
      const row=rows[i+j],rain=row.precipitation;
      if(Date.parse(row.time)!==start+j*hourMs || rain==null){complete=false;break;}
      const weight=Math.min(1,duration-j+1);
      run=rain>=threshold?run+weight:0;
      if(rain>=threshold)wetHours+=weight;
      if(run>longestWet){
        longestWet=run;
        wetMiddle=start+Math.min(duration,Math.ceil(Math.min(j,duration)-run/2))*hourMs;
      }
      peak=Math.max(peak,rain);
      profileFields.forEach((key,k)=>{if(row[key]!=null){counts[k]+=weight;sums[k]+=weight*row[key]!;}});
    }
    if(complete)result.push({dataset,start,end:start+duration*hourMs,wetHours,longestWet,wetMiddle,peak,
      mean:sums.map((v,k)=>Math.abs(counts[k]-duration)<1e-9&&counts[k]>0?v/counts[k]:null)});
  }
  return result;
}

/** Ретроспективный подбор только для просмотра погоды в атласе. */
export function selectAnalogue(datasets:WeatherDataset[],month:number,duration:number,kind:'typical'|'wet',threshold=.1){
  if(!Number.isFinite(threshold)||threshold<=0)throw Error('Укажите положительный порог осадков.');
  if(!Number.isFinite(duration)||duration<=0)throw Error('Укажите положительную длительность.');
  const candidates=datasets.flatMap(d=>windows(d,month,duration,kind==='wet',threshold));
  if(!candidates.length)throw Error('В архиве нет непрерывного почасового ряда осадков для этого месяца и длительности.');
  if(kind==='wet'){
    const best=candidates.reduce((a,b)=>b.longestWet>a.longestWet||b.longestWet===a.longestWet&&b.peak>a.peak?b:a);
    if(!best.longestWet)throw Error('За полные периоды осадки не достигли выбранного порога.');
    return best;
  }
  const features=(a:Analogue)=>[...a.mean,a.wetHours,a.longestWet];
  const columns=features(candidates[0]).map((_,k)=>candidates.map(a=>features(a)[k]));
  // При разном покрытии сравниваем лишь показатели, доступные у каждого кандидата.
  const stats=columns.map(col=>{
    if(col.some(v=>v===null))return null;
    const vals=col as number[];
    const avg=vals.reduce((s,v)=>s+v,0)/vals.length;
    const sd=Math.sqrt(vals.reduce((s,v)=>s+(v-avg)**2,0)/vals.length);
    return sd>1e-8?{avg,sd}:null;
  });
  const score=(a:Analogue)=>features(a).reduce<number>((s,v,k)=>{
    const stat=stats[k];
    return stat&&v!==null?s+((v-stat.avg)/stat.sd)**2:s;
  },0);
  return candidates.reduce((a,b)=>score(b)<score(a)?b:a);
}
