import { missingWindows } from './health';
import { initialState, step, type DirectorEvent, type Effect } from './director';
import type { ExpoSettings } from './settings';
import type { ExpoBus } from './bus';
import { plan, type Windows, type MonitorInfo } from './windows';
/** Единственный владелец сеанса; окна видов имеют право только на ввод посетителя. */
export function createHost(initial: ExpoSettings, bus: ExpoBus, windows: Windows, changed:()=>void, effect:(e:Effect)=>void=()=>{}) {
  let settings=initial, state=initialState(Date.now()), count:1|2|3=1, stopped=false;
  let offMonitors=()=>{};
  let queue=Promise.resolve();
  const beats=new Map<number,number>();let aiMode=initial.aiMode;
  const ready=()=>Array.from({length:count-1},(_,i)=>i+1).every(i=>(beats.get(i)??0)>0&&Date.now()-(beats.get(i)??0)<=10000);
  const snapshot=()=>({state,settings:{...settings,aiMode},count});
  const publish=()=>{ if(stopped)return; bus.send({k:'state',...snapshot(),settings:{...settings,aiMode,pin:''}});changed(); };
  const dispatch=(ev:DirectorEvent)=>{
    if(stopped)return;
    const next=step(state,ev,settings);state=next.state;publish();
    for(const e of next.effects){effect(e);if(e.e==='aiPick')dispatch({t:'choose',card:0});}
  };
  const arrange=(monitors:MonitorInfo[])=>{
    queue=queue.catch(()=>{}).then(async()=>{if(stopped)return;const p=plan(monitors,settings);await windows.open(p);if(stopped)return;count=p.count;for(let i=1;i<count;i++)if(!beats.has(i))beats.set(i,0);publish();});
    return queue;
  };
  const off=bus.on(m=>{
    if(m.k==='hello'||m.k==='beat'){if(m.window>0&&m.window<count)beats.set(m.window,Date.now());if(m.k==='hello')publish();}
    if(m.k==='input' && !state.paused && ['touch','pickFront','next','choose','replace','restart'].includes(m.ev.t))dispatch(m.ev);
  });
  return {
    snapshot,dispatch,ready,configuration:()=>settings,
    setAiMode(mode:ExpoSettings['aiMode']){aiMode=mode;publish();},
    async checkWindows(){if(missingWindows(count,beats,Date.now()).length){await windows.closeAll();await arrange(await windows.monitors());}},
    async start(){await windows.guard(true);if(stopped)return;await arrange(await windows.monitors());offMonitors=windows.onMonitors(m=>{void arrange(m).catch(()=>dispatch({t:'jump',phase:'startup'}));});},
    async configure(next:ExpoSettings){if(next.aiMode!==settings.aiMode)aiMode=next.aiMode;settings=next;await arrange(await windows.monitors());publish();},
    async stop(){stopped=true;off();offMonitors();await queue.catch(()=>{});await windows.guard(false);await windows.closeAll();bus.close();},
  };
}
