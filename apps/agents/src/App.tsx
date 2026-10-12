/** Приложение агентной модели: карта, иерархия, шкала времени с показом, карточка агента и разговор с ним. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunData, Settings, StaffLiveMsg } from './data';
import { SCENARIOS, isTauri, llmRun, loadRun, scenarioById, loadSettings, posAt, rowAt, saveSettings, shortName, stateGroup, timeLabel } from './data';
import { SettingsPanel } from './Settings';
import { StaffLog } from './StaffLog';
import { StaffLive } from './StaffLive';
import { Operation } from './Operation';
import { MapView } from './MapView';
import { Inspector } from './Inspector';
import { Chat } from './Chat';

const SPEEDS = [1, 4, 12, 24];

export function App() {
  const [data, setData] = useState<RunData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hour, setHour] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<[number, number] | null>(null);
  const [tab, setTab] = useState<'card' | 'chat'>('card');
  const [seed, setSeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [live, setLive] = useState<StaffLiveMsg[]>([]);
  const [runId, setRunId] = useState(0);
  const [showDestroyed, setShowDestroyed] = useState(true);
  const [scen, setScen] = useState(() => {
    const q = new URLSearchParams(location.search).get('scen');
    if (q) return scenarioById(q).id;
    try { return scenarioById(localStorage.getItem('agents.scenario')).id; } catch { return SCENARIOS[0].id; }
  });
  // вариант для сравнения: тот же сценарий с другими условиями
  const [cmpId, setCmpId] = useState('');
  const [cmp, setCmp] = useState<RunData | null>(null);
  const [cmpMsg, setCmpMsg] = useState<string | null>(null);
  const pickScen = (id: string) => { setScen(id); setSelected(null); try { localStorage.setItem('agents.scenario', id); } catch { /* без хранилища */ } };
  const setSettings = (s: Settings) => { setSettingsState(s); saveSettings(s); };

  // ход решений штабов на модели — событием из ядра
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    let off2: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) => listen<string>('staff-progress', (e) => setProgress(e.payload))).then((u) => { off = u; });
    // ответы штабов по мере прихода: последнее состояние каждого штаба, готовые — внизу
    void import('@tauri-apps/api/event').then(({ listen }) => listen<StaffLiveMsg>('staff-stream', (e) => setLive((l) => {
      const rest = l.filter((x) => x.hq !== e.payload.hq);
      return [e.payload, ...rest].sort((a, b) => Number(a.phase === 'done' || a.phase === 'error') - Number(b.phase === 'done' || b.phase === 'error')).slice(0, 8);
    }))).then((u) => { off2 = u; });
    return () => { off?.(); off2?.(); };
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    setBusy(true);
    setProgress(null);
    setLive([]);
    const opts = { seed, de: settings.de, su: settings.su, llm: settings.staffModel ? llmRun(settings) : null };
    loadRun(scenarioById(scen).path, opts).then((d) => {
      setData(d);
      if (q.get('h')) setHour(Number(q.get('h')));
      if (q.get('sel')) setSelected(q.get('sel'));
      if (q.get('tab') === 'chat') setTab('chat');
      if (q.get('settings')) setShowSettings(true);
    }).catch((e) => setErr(String(e))).finally(() => { setBusy(false); setProgress(null); });
    // пересчёт — по кнопке (runId) или смене прогона; настройки сами по себе расчёт не запускают
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, runId, scen]);

  useEffect(() => {
    setCmp(null);
    setCmpMsg(null);
    const v = scenarioById(scen).variants.find((x) => x.id === cmpId);
    if (!v) return;
    setCmpMsg('расчёт варианта…');
    loadRun(scenarioById(scen).path, { seed, de: v.de ?? settings.de, su: v.su ?? settings.su, llm: settings.staffModel ? llmRun(settings) : null, withoutFires: v.withoutFires, withoutWithdrawals: v.withoutWithdrawals, traceFile: v.trace })
      .then((d) => { setCmp(d); setCmpMsg(null); })
      .catch(() => setCmpMsg(isTauri() ? 'вариант не посчитан' : 'нет готового хода варианта — npm run agents:berlin:variants'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmpId, scen, seed, runId]);

  // показ: часы модели в секунду, плавно (между кадрами положение интерполируется)
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !data) return;
    let raf = 0;
    const tick = (t: number) => {
      const dt = last.current === null ? 0 : (t - last.current) / 1000;
      last.current = t;
      setHour((h) => { const n = h + dt * speed; if (n >= data.trace.hours) { setPlaying(false); return data.trace.hours; } return n; });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); last.current = null; };
  }, [playing, speed, data]);

  const tree = useMemo(() => {
    if (!data) return [];
    const { trace } = data;
    // все штабы, у которых есть свои соединения (фронтовые корпуса и дивизии — под фронтом)
    return trace.hqs
      .map((h) => ({ hq: h, divs: trace.divisions.map((d, i) => ({ d, i })).filter((x) => x.d.hq === h.id) }))
      .filter((g) => g.divs.length);
  }, [data]);

  if (err) return <div className="splash">Не удалось загрузить прогон: {err}<br />Для разработки в браузере сначала выполните <code>npm run agents:seelow</code>.</div>;
  if (!data) return <div className="splash">Расчёт…{progress && <div className="hint">{progress}</div>}<StaffLive items={live} /></div>;
  const { trace } = data;
  const select = (id: string | null) => {
    setSelected(id);
    const i = trace.divisions.findIndex((d) => d.id === id);
    if (i >= 0) setFocus(posAt(trace, i, hour));
  };
  const dayTicks = Array.from({ length: Math.floor(trace.hours / 24) + 1 }, (_, k) => k * 24);

  return (
    <div className="app">
      <header>
        <select className="scen" value={scen} onChange={(e) => pickScen(e.target.value)} disabled={busy} title="Сценарий">{SCENARIOS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <span className="muted">{trace.divisions.length} дивизий · {trace.hours} ч · прогон {trace.seed}{data.live ? '' : ' · из evals-out (браузер)'}</span>
        <span className="muted">· штабы: советские — {trace.sources?.[0] === 'doctrine' ? 'по доктрине' : 'исторические приказы'}, немецкие — {({ script: 'исторические приказы', doctrine: 'по доктрине', llm: `модель ${trace.llm?.model ?? ''}` } as Record<string, string>)[trace.sources?.[1] ?? 'script']}</span>
        <span className="spacer" />
        <label className="cmp">сравнить с <select value={cmpId} onChange={(e) => setCmpId(e.target.value)}><option value="">—</option>{scenarioById(scen).variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        {cmpMsg && <span className="progress">{cmpMsg}</span>}
        {busy && <span className="progress">{progress ?? 'расчёт…'}</span>}
        {isTauri() && (
          <label>прогон <select value={seed} onChange={(e) => setSeed(Number(e.target.value))} disabled={busy}>{[1, 2, 3, 4, 5].map((s) => <option key={s}>{s}</option>)}</select></label>
        )}
        <button onClick={() => setShowSettings(!showSettings)}>Модель и штабы</button>
      </header>
      {showSettings && <SettingsPanel value={settings} onChange={setSettings} busy={busy} onClose={() => setShowSettings(false)} onRun={() => { setRunId((x) => x + 1); }} />}
      <aside className="tree">
        {tree.map((g) => (
          <div key={g.hq.id} className="group">
            <div className={`hq ${g.hq.side}`}>{g.hq.name}</div>
            {g.divs.map(({ d, i }) => {
              const st = rowAt(trace, i, hour)[2];
              return (
                <div key={d.id} className={`item ${selected === d.id ? 'sel' : ''}`} onClick={() => select(d.id)} title={st}>
                  <span className={`dot ${stateGroup(st)}`} />{shortName(d)}
                </div>
              );
            })}
          </div>
        ))}
      </aside>
      <main>
        <MapView data={data} compare={cmp} hour={hour} selected={selected} onSelect={select} focus={focus} showDestroyed={showDestroyed} />
        <div className="legend">
          {(['march', 'deploy', 'attack', 'defense', 'withdraw', 'reserve'] as const).map((g) => <span key={g}><i className={`dot ${g}`} />{({ march: 'марш', deploy: 'развёртывание', attack: 'наступление', defense: 'оборона', withdraw: 'отход', reserve: 'резерв' })[g]}</span>)}
          <span><i className="ghost-key" />положение по документам</span>
          {cmp && <span><i className="variant-key" />вариант (смещение)</span>}
          <label title="Разгромленные и сведённые в другие дивизии — на месте выбытия, перечёркнутые"><input type="checkbox" checked={showDestroyed} onChange={(e) => setShowDestroyed(e.target.checked)} /><i className="strike-key" />выбывшие</label>
        </div>
      </main>
      <section className="side">
        {selected ? (
          <>
            <div className="tabs">
              <button className={tab === 'card' ? 'on' : ''} onClick={() => setTab('card')}>Карточка</button>
              <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Разговор</button>
              <span className="spacer" />
              <button onClick={() => setSelected(null)} title="Закрыть">×</button>
            </div>
            {tab === 'card' ? <Inspector data={data} compare={cmp} compareName={scenarioById(scen).variants.find((v) => v.id === cmpId)?.name ?? null} id={selected} hour={hour} onHour={setHour} /> : <Chat key={selected} data={data} id={selected} hour={hour} onHour={setHour} settings={settings} onSettings={() => setShowSettings(true)} />}
          </>
        ) : (
          <>
            <div className="empty">Выберите дивизию на карте или в списке слева: карточка с переменными, машиной состояний, журналом и сверкой с документами, разговор с командиром или разбор.</div>
            {busy ? <StaffLive items={live} /> : <>
              <Operation data={data} compare={cmp} compareName={scenarioById(scen).variants.find((v) => v.id === cmpId)?.name ?? null} hour={hour} onHour={setHour} />
              <StaffLog data={data} hour={hour} onHour={setHour} />
            </>}
          </>
        )}
      </section>
      <footer>
        <button className="play" onClick={() => { if (hour >= trace.hours) setHour(0); setPlaying(!playing); }}>{playing ? '❚❚' : '▶'}</button>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{SPEEDS.map((s) => <option key={s} value={s}>{s} ч/с</option>)}</select>
        <div className="time">{timeLabel(trace.start, hour)} <span className="muted">МСК</span></div>
        <div className="slider">
          <input type="range" min={0} max={trace.hours} step={0.25} value={hour} onChange={(e) => { setPlaying(false); setHour(Number(e.target.value)); }} />
          <div className="days">{dayTicks.map((h) => <span key={h} style={{ left: `${(h / trace.hours) * 100}%` }}>{timeLabel(trace.start, h).slice(0, 5)}</span>)}</div>
        </div>
      </footer>
    </div>
  );
}
