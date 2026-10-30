import {PROBE_NAMES,type ProbeStates} from './health';
export function StartupScene({states,note}:{states:ProbeStates;note?:string|null}){
 return <section className="expo-startup"><h1>Стенд готовится</h1>{Object.entries(PROBE_NAMES).map(([id,name])=><p key={id}>{name} — {{wait:'проверяю…',ok:'готово ✓',fail:'нет связи',off:'не требуется'}[states[id as keyof ProbeStates]]}</p>)}{note&&<p>{note}</p>}</section>;
}
