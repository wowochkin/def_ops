import {useEffect,useState} from 'react';
import {EXPO_DEFAULTS,settingsStore,type ExpoSettings} from './settings';
import {OperatorMenu} from './OperatorMenu';
export function ExpoSetup(){
 const [open,setOpen]=useState(false),[settings,setSettings]=useState(EXPO_DEFAULTS);
 useEffect(()=>{const show=()=>{void settingsStore().load().then(s=>{setSettings(s);setOpen(true);});};window.addEventListener('expo:setup',show);return()=>window.removeEventListener('expo:setup',show);},[]);
 const save=async(s:ExpoSettings)=>{await settingsStore().save(s);setSettings(s);};
 return <><button onClick={()=>window.dispatchEvent(new Event('expo:setup'))}>Выставочный режим…</button><OperatorMenu setup open={open} settings={settings} onSave={save} onClose={()=>setOpen(false)} onAction={()=>{}} onExit={()=>{const u=new URL(location.href);u.searchParams.set('expo','0');location.assign(u.href);}} /></>;
}
