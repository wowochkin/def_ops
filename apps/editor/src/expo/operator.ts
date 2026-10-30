import type { ExpoSettings } from './settings';
export const operatorCombo=(e:KeyboardEvent)=>e.ctrlKey&&e.altKey&&e.shiftKey&&e.code==='KeyO';
export const checkPin=(entered:string,s:ExpoSettings)=>entered===s.pin;
export interface PinLock {failures:number;until:number}
export function pinAttempt(lock:PinLock,entered:string,s:ExpoSettings,now:number):{ok:boolean;lock:PinLock} {
 if(now<lock.until)return {ok:false,lock};
 if(checkPin(entered,s))return {ok:true,lock:{failures:0,until:0}};
 const failures=(lock.until>0?0:lock.failures)+1;
 return {ok:false,lock:{failures,until:failures>=5?now+60000:0}};
}
export function cornerHold(el:HTMLElement,onHold:()=>void,ms=3000):()=>void {
 let timer:ReturnType<typeof setTimeout>|undefined;
 const cancel=()=>{clearTimeout(timer);timer=undefined;};
 const inside=(e:PointerEvent)=>e.clientX>=0&&e.clientX<80&&e.clientY>=0&&e.clientY<80;
 const down=(e:PointerEvent)=>{cancel();if(inside(e))timer=setTimeout(()=>{cancel();onHold();},ms);};
 const move=(e:PointerEvent)=>{if(!inside(e))cancel();};
 el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);
 for(const name of ['pointerup','pointercancel','pointerleave'])el.addEventListener(name,cancel);
 return()=>{cancel();el.removeEventListener('pointerdown',down);el.removeEventListener('pointermove',move);for(const name of ['pointerup','pointercancel','pointerleave'])el.removeEventListener(name,cancel);};
}
