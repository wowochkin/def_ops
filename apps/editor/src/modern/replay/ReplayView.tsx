import {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {listSessions, readSession, saveSession, type SavedSession, type SessionSummary} from './archive';
import {createSession, restartSession, type Scenario} from './session';
import {SessionView} from './SessionView';
import {CompareSessions} from './CompareSessions';
import {ReplayAreaMap} from './ReplayAreaMap';
import {example} from './example';
import {loadRegion} from '../environment-region';
import {areaKey,automaticAreaName} from '../atlas-place-name';
import {useAreaNames} from '../AreaNameEditor';
import './replay.css';

const ScenarioForm = lazy(() => import('./ScenarioForm').then(m => ({default:m.ScenarioForm})));
const savedAt = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'});

export function ReplayView() {
  const [page,setPage] = useState<'library'|'author'|'session'|'compare'>('library');
  const [region] = useState(loadRegion);
  const {names} = useAreaNames();
  const areaName = names[areaKey(region.bounds)] || automaticAreaName(region.bounds);
  const [rows,setRows] = useState<SessionSummary[]>([]);
  const [selected,setSelected] = useState<SavedSession|null>(null);
  const [compare,setCompare] = useState<[SavedSession,SavedSession]|null>(null);
  const [first,setFirst] = useState<string|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const lock = useRef(false);
  const [load,setLoad] = useState(0);
  useEffect(() => {
    if(page!=='library')return;
    let cancelled=false;
    void listSessions().then(items=>{if(!cancelled)setRows(items);}).catch(()=>{
      if(!cancelled)setError('Не удалось открыть сохранённые сеансы на этом компьютере.');
    });
    return ()=>{cancelled=true;};
  },[page,load]);

  function library() {
    setSelected(null);setCompare(null);setFirst(null);setError('');
    setPage('library');setLoad(n=>n+1);
  }
  async function run(action:()=>Promise<void>) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setError('');
    try { await action(); }
    catch(e){setError(e instanceof Error ? e.message : 'Не удалось сохранить изменение.');}
    finally {lock.current=false;setBusy(false);}
  }
  async function start(scenario:Scenario) {
    const next=await saveSession(createSession(scenario));
    setSelected(next); setPage('session');
  }
  async function open(id:string) {
    setSelected(await readSession(id));setPage('session');
  }
  const firstSummary=rows.find(row=>row.id===first);
  const root=useRef<HTMLElement>(null);
  useEffect(()=>{root.current?.closest('.modern-workspace')?.scrollTo?.(0,0);},[page,selected?.summary.id]);
  return <section className="modern-replay" ref={root} aria-label="Двусторонняя переигровка">
    <header className="replay-heading"><div><h1>Переигровка</h1>
      {page==='library' && <p>Два пользователя за одним компьютером</p>}
      {page==='author' && <p>Подготовка авторского сценария</p>}
    </div>
      {page==='author' && <button disabled={busy} onClick={library}>К сеансам</button>}
    </header>
    {error && <div role="alert" className="replay-error">{error}{page==='library'&& <button onClick={library}>Обновить список</button>}</div>}
    {page==='author' && <Suspense fallback={<p>Открываем справочник стран…</p>}>
      <ScenarioForm onCreate={start} onSavingChange={setBusy}/>
    </Suspense>}
    {page==='session'&&selected&& <SessionView key={selected.summary.id} sessionId={selected.summary.id} session={selected.session}
      onBack={library}
      onChange={async next=>{const updated=await saveSession(next,selected.summary);setSelected(updated);}}
      onRepeat={async()=>{const copy=await saveSession(restartSession(selected.session),undefined,selected.summary.original);setSelected(copy);}}
    />}
    {page==='compare' && compare && <CompareSessions left={compare[0]} right={compare[1]} onBack={library}/>}
    {page==='library' && <>
      <article className="replay-feature">
        <div className="replay-feature-copy"><p>Текущая область атласа</p>
          <h2>{areaName}</h2>
          <p>При создании сценария можно выбрать другую область или указать границы на карте.</p>
          <button disabled={busy} onClick={()=>{setError('');setPage('author');}}>Создать сценарий</button>
        </div><ReplayAreaMap name={areaName} bounds={region.bounds}/>
      </article>
      <details className="replay-example"><summary>Учебный пример</summary>
        <p>{example.title} · {example.area}</p>
        <button disabled={busy} onClick={()=>void run(()=>start(example))}>Начать пример</button>
      </details>
      <section className="replay-library"><h2>Сохранённые сеансы</h2>
        {first && <p role="status">Выберите второе раскрытое прохождение этого сценария. <button onClick={()=>setFirst(null)}>Отменить сравнение</button></p>}
        {rows.length===0 ? <p>Здесь появятся начатые сеансы. Можно закрыть приложение и вернуться к последнему подтверждённому периоду.</p> :
          <ul>{rows.map(row=><li key={row.id}><div><h3>{row.title}</h3>
            <p>{row.area} · {row.id===row.original?'Исходный сеанс':'Повтор'} · {savedAt.format(new Date(row.updated))}</p></div>
            <div className="replay-row-status"><span>{row.status==='active'?'В процессе':'Завершён'}</span><small>Завершено периодов — {row.periodCount}</small></div>
            <div className="replay-actions">
              <button disabled={busy} onClick={()=>void run(()=>open(row.id))}>{row.status==='active'?'Продолжить':'К разбору'}</button>
              {row.disclosed && rows.some(s=>s.id!==row.id&&s.original===row.original&&s.disclosed) &&
                (!first || (first!==row.id&&firstSummary?.original===row.original)) &&
                <button disabled={busy} onClick={()=>{if(!first){setFirst(row.id);return;}
                  void run(async()=>{setCompare(await Promise.all([readSession(first),readSession(row.id)]));setPage('compare');});
                }}>{first?'Сравнить с выбранным':'Сравнить'}</button>}
            </div></li>)}</ul>}
      </section>
    </>}
  </section>;
}
