import type { AiMode,FrontId,InputProfile } from './settings';
import type { DirectorEvent,Phase } from './director';
export function affordances(p:InputProfile,voiceInput:boolean,aiMode:AiMode) {
 return {hoverExpand:p!=='touch',keys:p==='mouse-keyboard',minTarget:p==='touch'?96:64,voiceButton:voiceInput&&aiMode==='ai'};
}
export function keyToEvent(key:string,phase:Phase,context:{expanded?:number|null;front?:FrontId}={}):DirectorEvent|null {
 if(phase.kind==='turn'&&phase.step==='choose'){
  if(/^[1-3]$/.test(key))return {t:'choose',card:Number(key)-1};
  if(key.toLowerCase()==='r'&&context.expanded!=null&&context.expanded>0)return {t:'replace',card:context.expanded};
 }
 if(key==='Enter'||key===' '){
  if(phase.kind==='welcome'&&context.front)return {t:'pickFront',front:context.front};
  if(['attract','welcome','result'].includes(phase.kind))return {t:'touch'};
 }
 return null;
}
