/** Обращение к локальному сервису через штатный шлюз приложения. */
export const ENV_API = '/api/cartography';
export function environmentHeaders(): Record<string,string> {
 const h:Record<string,string>={'X-Source-System':'editor'};
 try{const key=localStorage.getItem('def_ops.apiKey');if(key)h['X-Api-Key']=key;}catch{/* без ключа */}return h;
}
export async function environmentApi<T>(path:string,init:RequestInit={}):Promise<T> {
 const response=await fetch(`${ENV_API}${path}`,{...init,headers:{...environmentHeaders(),...(init.body&&typeof init.body==='string'?{'content-type':'application/json'}:{}),...init.headers}});
 if(!response.ok){const b=await response.json().catch(()=>null);throw Error(b?.error?.message??`Локальный сервис недоступен (${response.status}). Запустите приложение вместе с сервисами.`);}
 return response.json();
}
export function saveEnvironmentFile(name:string,data:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export const weatherFieldLabels:Record<string,string>={temperature:'Температура, °C',humidity:'Влажность, %',pressure:'Давление, гПа',windSpeed:'Ветер, м/с',windDirection:'Направление ветра, °',gust:'Порывы, м/с',cloud:'Облачность, %',precipitation:'Осадки, мм/ч',visibility:'Видимость, м',snowDepth:'Снег, м',soilTemperature:'Температура грунта, °C',soilMoisture:'Влажность грунта, м³/м³'};
