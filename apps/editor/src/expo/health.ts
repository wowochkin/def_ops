import type {AiMode,ExpoSettings} from './settings';
export type ProbeId='core'|'voice'|'model'|'windows';
export type ProbeState='wait'|'ok'|'fail'|'off';
export type ProbeStates=Record<ProbeId,ProbeState>;
export interface Probe {id:ProbeId;label:string;check:()=>Promise<boolean>;restart?:()=>Promise<void>}
export const PROBE_NAMES:Record<ProbeId,string>={core:'Ядро',voice:'Голос',model:'Языковая модель',windows:'Экраны'};
export function startupPlan(s:ExpoSettings):ProbeId[]{return s.aiMode==='ai'?['core','voice','model','windows']:['core','windows'];}
export function startupVerdict(states:ProbeStates,s:ExpoSettings):{ready:boolean;aiMode:AiMode;note:string|null}{
 const ready=states.core==='ok'&&states.windows==='ok'&&!startupPlan(s).some(id=>states[id]==='wait');
 const aiMode=s.aiMode==='ai'&&states.voice==='ok'&&states.model==='ok'?'ai':'noai';
 return {ready,aiMode,note:s.aiMode==='ai'&&aiMode==='noai'?'Запуск в режиме без ИИ':null};
}
export function watchdog(probes:Probe[],onFail:(id:ProbeId)=>void,every=15000,onRecover:(id:ProbeId)=>void=()=>{},onSweep:()=>void=()=>{}):()=>void {
 let stopped=false,busy=false;const failures=new Map<ProbeId,number>(),down=new Set<ProbeId>();
 const timer=setInterval(()=>{if(busy||stopped)return;busy=true;void Promise.all(probes.map(async p=>{
  const ok=await checkProbe(p,5000);
  if(stopped)return;
  if(ok){failures.set(p.id,0);if(down.delete(p.id))onRecover(p.id);return;}
  const n=(failures.get(p.id)??0)+1;failures.set(p.id,n);
  if(n>=(p.id==='model'?2:1)&&!down.has(p.id)){down.add(p.id);onFail(p.id);try{await p.restart?.();}catch{}}
 })).then(()=>{if(!stopped)onSweep();}).finally(()=>{busy=false;});},every);
 return()=>{stopped=true;clearInterval(timer);};
}
export function missingWindows(count:number,beats:Map<number,number>,now:number):number[]{
 return Array.from({length:Math.max(0,count-1)},(_,i)=>i+1).filter(i=>now-(beats.get(i)??now)>10000);
}

/** Ни зависший IPC, ни закрытие окна не оставляют проверку ожидающей бессрочно. */
export function checkProbe(probe:Probe,timeoutMs:number,signal?:AbortSignal):Promise<boolean>{
 if(signal?.aborted)return Promise.resolve(false);
 return new Promise(resolve=>{
  let finished=false;
  const done=(ok:boolean)=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(ok);};
  const abort=()=>done(false);
  const timer=setTimeout(()=>done(false),Math.max(0,timeoutMs));
  signal?.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(probe.check).then(done,()=>done(false));
 });
}
