import { localProbes,runProbes } from './probes';
import { startupPlan,startupVerdict,watchdog,type ProbeStates } from './health';
import { StartupScene } from './StartupScene';
import { telemetry,type ExpoStats } from './stats';
import { useEffect, useRef, useState } from 'react';
import { expoBus, type ExpoBus } from './bus';
import { expoWindows, plan, type Windows } from './windows';
import { settingsStore, EXPO_DEFAULTS, type ExpoSettings } from './settings';
import { createHost } from './host';
import { initialState, type DirectorEvent } from './director';
import { ExpoView } from './ExpoView';
import { lockdown } from './lockdown';
import { cornerHold,operatorCombo } from './operator';
import { OperatorMenu } from './OperatorMenu';
export function ExpoRoot({index=0,onExit}:{index?:number;onExit?:()=>void}) {
  const [frame,setFrame]=useState({state:initialState(Date.now()),settings:EXPO_DEFAULTS,count:1 as 1|2|3});
  const [error,setError]=useState(''),[menu,setMenu]=useState(false),[identify,setIdentify]=useState({until:0,names:[] as string[]});
  const [health,setHealth]=useState<ProbeStates>({core:'wait',voice:'wait',model:'wait',windows:'wait'}),[note,setNote]=useState<string|null>(null),[stats,setStats]=useState<ExpoStats>({sessions:0,finished:0,failures:0});
  const hostRef=useRef<ReturnType<typeof createHost>|null>(null),busRef=useRef<ExpoBus|null>(null),windowsRef=useRef<Windows|null>(null);
  const menuRef=useRef(false),frameRef=useRef(frame);frameRef.current=frame;
  const send=(ev:DirectorEvent)=>index===0?hostRef.current?.dispatch(ev):busRef.current?.send({k:'input',ev});
  const close=()=>{menuRef.current=false;setMenu(false);hostRef.current?.dispatch({t:'resume'});};
  useEffect(()=>{
    let disposed=false; const abort=new AbortController();let stopWatch=()=>{};const metrics=telemetry();
    const log=(s:string)=>{void metrics.log(s).catch(()=>{});};
    const refreshStats=()=>{void metrics.today().then(s=>{if(!disposed)setStats(s);}).catch(()=>{});};refreshStats();
    const bus=expoBus();busRef.current=bus;
    const windows=expoWindows();windowsRef.current=windows;
    const open=()=>{if(index!==0)return;hostRef.current?.dispatch({t:'pause'});menuRef.current=true;setMenu(true);};
    const offLock=lockdown(document,{operatorCombo,allowKey:e=>{
      if(menuRef.current)return true;
      return frameRef.current.settings.input==='mouse-keyboard'&&['1','2','3','r','R','Enter',' ','ArrowLeft','ArrowRight'].includes(e.key);
    }});
    const combo=(e:KeyboardEvent)=>{if(operatorCombo(e)){e.preventDefault();open();}};
    document.addEventListener('keydown',combo);
    const offCorner=index===0?cornerHold(document.body,open):()=>{};
    let timer:ReturnType<typeof setInterval>|undefined;
    const off=bus.on(m=>{
      if(index>0&&m.k==='state')setFrame({state:m.state,settings:m.settings,count:m.count});
      if(m.k==='health'){setHealth(m.states);setNote(m.note);}
      if(m.k==='identify')setIdentify({until:m.until,names:m.names});
    });
    if(index===0){
      void settingsStore().load().then(async(settings:ExpoSettings)=>{
        if(disposed)return;
        const host=createHost(settings,bus,windows,()=>{if(!disposed)setFrame(host.snapshot());},e=>{if(e.e==='stat')void metrics.add(e.kind).then(refreshStats).catch(()=>{});});hostRef.current=host;
        await host.start(); if(disposed)return;
        timer=setInterval(()=>host.dispatch({t:'tick',now:Date.now()}),250);
        const probes=localProbes(host.ready);
        const publishHealth=(states:ProbeStates,reason:string|null=null)=>{if(disposed)return;setHealth({...states});setNote(reason);bus.send({k:'health',states:{...states},note:reason});};
        const states=await runProbes(probes.filter(p=>startupPlan(settings).includes(p.id)),publishHealth,abort.signal);if(disposed)return;
        const verdict=startupVerdict(states,settings);publishHealth(states,verdict.note);host.setAiMode(verdict.aiMode);
        if(verdict.ready)host.dispatch({t:'ready'});else setError('Обязательные службы не готовы. Проверьте ядро и экраны в меню оператора.');
        log(verdict.ready?'Стенд готов':'Стенд не готов');
        stopWatch=watchdog(probes.map(p=>({...p,check:async()=>{if(!startupPlan(host.configuration()).includes(p.id)){states[p.id]='off';publishHealth(states);return true;}const ok=await p.check();states[p.id]=ok?'ok':'fail';publishHealth(states);return ok;}})),id=>{
          log(`Нет связи: ${id}`);void metrics.add('failure').then(refreshStats).catch(()=>{});
          host.dispatch({t:'jump',phase:id==='core'||id==='windows'?'startup':'attract'});
          if(id==='model'||id==='voice'){host.setAiMode('noai');publishHealth(states,'Запуск в режиме без ИИ');}
          if(id==='windows')void host.checkWindows().catch(e=>log(String(e)));
        },15000,()=>{},()=>{if(states.core==='ok'&&states.windows==='ok'){setError('');host.dispatch({t:'ready'});}if(host.configuration().aiMode==='ai'&&states.model==='ok'&&states.voice==='ok')host.setAiMode('ai');});
      }).catch(e=>{if(!disposed)setError(String(e));});
    }else{
      bus.send({k:'hello',window:index});
      timer=setInterval(()=>{bus.send({k:'hello',window:index});bus.send({k:'beat',window:index,at:Date.now()});},2000);
    }
    return()=>{disposed=true;abort.abort();stopWatch();off();offCorner();offLock();document.removeEventListener('keydown',combo);clearInterval(timer);const host=hostRef.current;hostRef.current=null;if(host)void host.stop();else bus.close();};
  },[index]);
  const save=async(settings:ExpoSettings)=>{
    const host=hostRef.current;if(!host)return;
    if(settings.aiMode==='ai'&&host.configuration().aiMode!=='ai'){
      const checks=localProbes(host.ready).filter(p=>p.id==='model'||p.id==='voice');
      const ok=await Promise.all(checks.map(p=>p.check().catch(()=>false)));
      if(ok.some(v=>!v))throw Error('Для режима с ИИ нужны работающие локальная модель и голос');
    }
    await settingsStore().save(settings);await host.configure(settings);
  };
  const exit=async()=>{await hostRef.current?.stop();hostRef.current=null;const url=new URL(location.href);url.searchParams.delete('expo');history.replaceState(null,'',url);onExit?.();};
  return <>{error&&<div className="expo-error" role="alert">Не удалось запустить стенд: {error}</div>}
    <ExpoView window={index} {...frame} send={send}/>{frame.state.phase.kind==='startup'&&<StartupScene states={health} note={note}/>}
    {index===0&&<OperatorMenu open={menu} status={`Сеансов: ${stats.sessions} · Завершено: ${stats.finished} · Сбоев: ${stats.failures}. Ядро: ${health.core}; голос: ${health.voice}; модель: ${health.model}; экраны: ${health.windows}. ${note??''}`} settings={hostRef.current?.configuration()??frame.settings} onSave={save} onClose={close} onExit={()=>{void exit().catch(e=>setError(String(e)));}} onAction={action=>{
      if(action==='identify'){void windowsRef.current?.monitors().then(monitors=>{const info={until:Date.now()+10000,names:plan(monitors,hostRef.current?.configuration()??frame.settings).windows.map(slot=>{const m=monitors.find(m=>m.id===slot.monitor);return m?`${m.name} · ${m.id}`:slot.monitor;})};setIdentify(info);busRef.current?.send({k:'identify',...info});});return;}
      if(action==='reboot'){location.reload();return;}
      hostRef.current?.dispatch(action);close();
    }}/>}
    {identify.until>frame.state.now&&<div className="expo-identify"><strong>Экран {index+1}</strong><span>{identify.names[index]}</span></div>}
  </>;
}
