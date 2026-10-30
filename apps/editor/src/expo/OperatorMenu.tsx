import { useEffect,useState } from 'react';
import { normalizeSettings,type ExpoSettings } from './settings';
import type { DirectorEvent } from './director';
import { pinAttempt } from './operator';
import { FRONT_NAMES } from './scenes';
import './expo.css';
function NumberSetting({label,value,min,max,onValue}:{label:string;value:number;min:number;max:number;onValue:(v:number)=>void}) {
 const [draft,setDraft]=useState(String(value));
 useEffect(()=>setDraft(String(value)),[value]);
 return <label>{label}<input aria-label={label} type="number" value={draft} min={min} max={max}
 onChange={e=>{const text=e.target.value;setDraft(text);const n=Number(text);if(text&&Number.isInteger(n)&&n>=min&&n<=max)onValue(n);}}
 onBlur={()=>{const n=Number(draft);if(!draft||!Number.isInteger(n)||n<min||n>max)setDraft(String(value));}} /></label>;
}
export interface OperatorProps {
 settings:ExpoSettings;open?:boolean;setup?:boolean;
 onSave:(s:ExpoSettings)=>Promise<void>;onClose:()=>void;onExit:()=>void;
 onAction:(ev:DirectorEvent|'reboot'|'identify')=>void;
 status?:string;
}
/** Компонент остаётся смонтированным при закрытии: счётчик неверных ПИН не сбрасывается. */
export function OperatorMenu({settings,open=true,setup=false,onSave,onClose,onExit,onAction,status}:OperatorProps){
 const [authorized,setAuthorized]=useState(false),[pin,setPin]=useState(''),[lock,setLock]=useState({failures:0,until:0});
 const [order,setOrder]=useState(settings.screens.order.join(', '));
 useEffect(()=>setOrder(settings.screens.order.join(', ')),[settings.screens.order]);
 const [now,setNow]=useState(Date.now()),[error,setError]=useState('');
 useEffect(()=>{if(!open){setAuthorized(false);setPin('');setError('');}},[open]);
 useEffect(()=>{if(!open)return;const t=setInterval(()=>setNow(Date.now()),500);return()=>clearInterval(t);},[open]);
 if(!open)return null;
 const save=(patch:Partial<ExpoSettings>)=>{const s=normalizeSettings({...settings,...patch}).settings;void onSave(s).catch(e=>setError(`Не удалось сохранить: ${String(e)}`));};
 const number=(label:string,value:number,min:number,max:number,change:(v:number)=>void)=><NumberSetting label={label} value={value} min={min} max={max} onValue={change}/>;
 const flag=(label:string,value:boolean,change:(v:boolean)=>void)=><label className="expo-check"><input type="checkbox" checked={value} onChange={e=>change(e.target.checked)}/>{label}</label>;
 return <div className="expo-modal" role="dialog" aria-modal="true" aria-label="Меню оператора"><div className="expo-operator">
 <header><h2>Меню оператора</h2><button onClick={onClose}>Закрыть</button></header>
 {!authorized ? <form onSubmit={e=>{e.preventDefault();const result=pinAttempt(lock,pin,settings,Date.now());setLock(result.lock);setAuthorized(result.ok);setPin('');setError(result.ok?'':'Неверный ПИН');}}>
 <label>ПИН<input autoFocus aria-label="ПИН" type="password" inputMode="numeric" maxLength={8} value={pin} disabled={now<lock.until} onChange={e=>setPin(e.target.value.replace(/\D/g,''))}/></label>
 <button disabled={now<lock.until} type="submit">Открыть меню</button>{now<lock.until&&<p>Повторите через {Math.ceil((lock.until-now)/1000)} с</p>}
 </form>:<>
 <div className="expo-settings">
 <label>Режим ИИ<select value={settings.aiMode} onChange={e=>save({aiMode:e.target.value as ExpoSettings['aiMode']})}><option value="ai">С ИИ</option><option value="noai">Без ИИ</option></select></label>
 <label>Ввод<select value={settings.input} onChange={e=>save({input:e.target.value as ExpoSettings['input']})}><option value="touch">Касание</option><option value="mouse">Мышь</option><option value="mouse-keyboard">Мышь и клавиатура</option></select></label>
 {flag('Голосовой ввод',settings.voiceInput,v=>save({voiceInput:v}))}
 {flag('Таймер выбора',settings.timer.on,v=>save({timer:{...settings.timer,on:v}}))}
 {number('Время выбора, с',settings.timer.seconds,10,120,v=>save({timer:{...settings.timer,seconds:v}}))}
 {Object.entries(FRONT_NAMES).map(([id,name])=><div key={id}>{flag(name,settings.fronts.includes(id as ExpoSettings['fronts'][number]),v=>{const fronts=v?[...settings.fronts,id as ExpoSettings['fronts'][number]]:settings.fronts.filter(f=>f!==id);if(fronts.length)save({fronts});})}</div>)}
 {number('Число экранов',settings.screens.count,1,3,v=>save({screens:{...settings.screens,count:v as 1|2|3}}))}
 <label>Порядок экранов (идентификаторы через запятую)<input value={order} onChange={e=>setOrder(e.target.value)} onBlur={()=>save({screens:{...settings.screens,order:order.split(',').map(x=>x.trim()).filter(Boolean)}})}/></label>
 {number('Бездействие, с',settings.idleSeconds,30,600,v=>save({idleSeconds:v}))}
 {number('Возврат после итога, с',settings.resultSeconds,5,120,v=>save({resultSeconds:v}))}
 <label>Громкость голоса<input type="range" min="0" max="1" step="0.05" value={settings.volume.voice} onChange={e=>save({volume:{...settings.volume,voice:Number(e.target.value)}})}/></label>
 <label>Громкость фона<input type="range" min="0" max="1" step="0.05" value={settings.volume.ambient} onChange={e=>save({volume:{...settings.volume,ambient:Number(e.target.value)}})}/></label>
 {flag('Фоновый звук',settings.volume.ambientOn,v=>save({volume:{...settings.volume,ambientOn:v}}))}
 {flag('Запускать сразу в выставочном режиме',settings.autostart,v=>save({autostart:v}))}
 <label>Новый ПИН (4–8 цифр)<input type="password" inputMode="numeric" maxLength={8} onBlur={e=>{if(/^\d{4,8}$/.test(e.target.value)){save({pin:e.target.value});e.target.value='';}else if(e.target.value)setError('ПИН должен содержать от 4 до 8 цифр');}}/></label>
 </div>
 <p>{status}</p>
 <div className="expo-operator-actions">
 {setup?<button onClick={onExit}>Включить выставочный режим</button>:<>
 <button onClick={()=>onAction('identify')}>Показать номера экранов</button>
 <button onClick={()=>onAction({t:'restart'})}>Начать заново</button><button onClick={()=>onAction('reboot')}>Перезапустить стенд</button>
 <label>Перейти к фазе<select value="" onChange={e=>{const [phase,n]=e.target.value.split(':');onAction({t:'jump',phase:phase as Extract<DirectorEvent,{t:'jump'}>['phase'],...(n?{n:Number(n) as 1|2|3}:{})});}}><option value="">Выберите фазу…</option><option value="attract">Заставка</option><option value="welcome">Выбор фронта</option><option value="briefing">Ввод в обстановку</option>{[1,2,3].map(n=><option key={n} value={`turn:${n}`}>Перелом {n}</option>)}<option value="result">Итог</option></select></label>
 <button onClick={onExit}>Выйти в полный режим</button></>}
 </div></>}
 {error&&<p role="alert">{error}</p>}
 </div></div>;
}
