/** Учебная хронология продолжительных осадков. Время — часы от начала сценария. */
export type RainSchedule = {mode:'auto'|'background'} | {mode:'event';startHour:number;durationHours:number;intensity:number};
export interface RainEpisode {startHour:number;durationHours:number;intensity:number}
interface EpisodeScenario {seed:number;variability:number;rain?:RainSchedule;keyframes?:{values:{precipitation?:number}}[]}
const cycleHours=48;
function fraction(seed:number,cycle:number,offset:number){
  let n=(seed^Math.imul(cycle,0x45d9f3b)^offset)|0;
  n=Math.imul(n^(n>>>16),0x45d9f3b);
  return ((n^(n>>>16))>>>0)/4294967296;
}
export function rainEpisode(s:EpisodeScenario,hour:number):RainEpisode|null {
  if(s.rain?.mode==='event')return s.rain;
  if(s.rain?.mode==='background'||(!s.rain&&!s.variability)||(!s.rain&&s.keyframes?.some(k=>k.values.precipitation!==undefined)))return null;
  const cycle=Math.floor(Math.max(0,hour)/cycleHours);
  return {startHour:cycle*cycleHours+2+Math.floor(fraction(s.seed,cycle,1109)*7),
    durationHours:6+Math.floor(fraction(s.seed,cycle,2311)*7),intensity:12+Math.floor(fraction(s.seed,cycle,5011)*9)};
}
export function episodeIntensity(event:RainEpisode|null,hour:number){
  if(!event)return 0;
  const age=hour-event.startHour,remaining=event.durationHours-age;
  if(age<=0||remaining<=0)return 0;
  const ramp=Math.min(1,age/Math.min(1,event.durationHours/4),remaining/Math.min(1,event.durationHours/4));
  return event.intensity*ramp*ramp*(3-2*ramp);
}
export function validateRainSchedule(s:RainSchedule){
  if(!s||!['auto','background','event'].includes(s.mode))throw Error('Неизвестный режим продолжительных осадков');
  if(s.mode==='event'&&(!Number.isFinite(s.startHour)||s.startHour<0||!Number.isFinite(s.durationHours)||
    s.durationHours<=0||!Number.isFinite(s.intensity)||s.intensity<=0||s.intensity>200))
    throw Error('Проверьте начало, положительную длительность и интенсивность осадков до 200 мм/ч');
}
