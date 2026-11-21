import {useState} from 'react';

const storageKey='defops.atlas.regionNames';
export function useAreaNames(){
  const [names,setNames]=useState<Record<string,string>>(()=>{
    try {
      const value=JSON.parse(localStorage.getItem(storageKey)??'{}');
      return Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string]=>typeof entry[1]==='string' && !!entry[1].trim()));
    }catch{return {};}
  });
  function rename(key:string,value:string){
    const next={...names}, name=value.trim();
    if(name)next[key]=name;
    else delete next[key];
    setNames(next);
    try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{/* В этом окне имя уже установлено. */}
  }
  return {names,rename};
}
export function AreaNameEditor({value,automatic,save}:{value?:string;automatic:string;save:(s:string)=>void}){
  const [draft,setDraft]=useState<string|null>(null);
  function submit(){
    if(draft===null)return;
    const name=draft.trim();
    save(name===automatic?'':name);setDraft(null);
  }
  return <div><label>Название области<input maxLength={100} value={draft??(value||automatic)}
    onChange={e=>setDraft(e.target.value)} onBlur={submit} onKeyDown={e=>{
      if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}
      if(e.key==='Escape'){e.preventDefault();setDraft(null);}
    }}/></label>
    {draft!==null&&<button type="button" onClick={submit}>Сохранить</button>}
    {value&&<button type="button" onClick={()=>{setDraft(null);save('');}}>Вернуть автоназвание</button>}
  </div>;
}
