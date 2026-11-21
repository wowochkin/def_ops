import {useState} from 'react';
export function CopySource({url,name}:{url:string;name:string}){
 const [state,setState]=useState('');
 async function copy(){try{if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(url);else{const input=document.createElement('textarea');input.value=url;input.style.position='fixed';input.style.opacity='0';document.body.append(input);input.select();const ok=document.execCommand('copy');input.remove();if(!ok)throw Error('Буфер недоступен');}setState('Ссылка скопирована');}catch{setState('Выделите и скопируйте адрес вручную');}}
 return <><button type="button" aria-label={`Копировать ссылку: ${name}`} onClick={()=>void copy()}>Копировать ссылку</button>{state&&<div role="status"><small>{state}</small>{state!=='Ссылка скопирована'&&<input aria-label={`Адрес: ${name}`} readOnly value={url} onFocus={e=>e.target.select()}/>}</div>}</>;
}
