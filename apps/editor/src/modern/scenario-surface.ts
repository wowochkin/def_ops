import type {WeatherScenario,WeatherState} from '../../../../packages/core/src/weather';
import {rainEpisode,episodeIntensity} from '../../../../packages/core/src/weather-episodes';

type Surface = 'visibility'|'soilMoisture'|'snowDepth';
const unit=(v:number)=>Math.max(0,Math.min(1,v));

// Условные состояния иллюстрации меняются по времени сценария.
// Одна хронология для карты и карточки, включая произвольную перемотку.
export function surfacePreview(s:WeatherScenario,time:string,field?:string){
  const automatic=(key:Surface)=>(!field||key===field)&&s[key]===undefined&&!s.keyframes?.some(frame=>frame.values[key]!==undefined);
  const visibility=automatic('visibility'),moisture=automatic('soilMoisture'),snow=automatic('snowDepth');
  const hour=Math.max(0,(Date.parse(time)-Date.parse(s.start))/3600000);
  const event=rainEpisode(s,hour);
  function envelope(at:number){
    const e=rainEpisode(s,at);
    if(!e||at<0||hour<e.startHour)return 0;
    const age=hour-e.startHour;
    return unit(age/e.durationHours)*Math.exp(-Math.max(0,age-e.durationHours)/24)*unit(e.intensity/12);
  }
  const afterRain=Math.max(envelope(hour),envelope(hour-48));
  const rain=unit(episodeIntensity(event,hour)/12);
  return (state:WeatherState):WeatherState=>{
    if(!visibility&&!moisture&&!snow)return state;
    const result={...state};
    const wet=unit((state.precipitation??0)/12);
    const cold=unit((2-(state.temperature??5))/4);
    if(visibility)result.visibility=Math.round(26000-11000*unit((state.humidity??65)/100)-12500*wet);
    const background=s.precipitation>0||s.keyframes?.some(frame=>frame.values.precipitation!==undefined);
    const wetPeriod=Math.max(afterRain,background?wet*(1-Math.exp(-hour/12)):0);
    if(snow)result.snowDepth=.24*cold*wetPeriod;
    if(moisture)result.soilMoisture=.16+.18*wetPeriod+.04*Math.max(rain,wet);
    return result;
  };
}
