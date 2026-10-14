/**
 * «Агентная модель»: сравнение вариантов параметров агентной модели (дивизии) с историей и калибровка — прогоны
 * считает ядро настольного приложения (run_scenario с поправками параметров), сверку — фоновый поток (та же мерка,
 * что в «Переигровке»: положения дивизий в допуске, события ±2 сут). Калибровка — покоординатный перебор множителей
 * выбранных параметров вокруг лучшего; итог сохраняется вариантом — его можно выбрать в «Переигровке».
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentsScore } from '@def-ops/sim';
import { getData } from '../sim/userdata';
import { AGENT_SCENARIOS, agentHistory, agentVariants, deleteAgentVariant, DESKTOP, runAgents, saveAgentVariant, type AgentVariant } from '../sim/agent-scenarios';
import type { ScoreRequest, ScoreResponse } from '../sim/agents-score-worker';
import { pct, SERIES } from './data';

/** Параметры для калибровки: путь в agents-v0.json, что это; у кривых темпа множитель — к км/сут. */
const PARAMS: { path: string; title: string }[] = [
  { path: 'combat.advance.hasty', title: 'темп наступления против поспешной обороны' },
  { path: 'combat.advance.prepared', title: 'темп против подготовленной обороны' },
  { path: 'combat.advance.fortified', title: 'темп против укреплённой полосы' },
  { path: 'combat.penetrationKmDay', title: 'темп в прорыве, км/сут' },
  { path: 'combat.armorFactor', title: 'вес танков в боевой силе' },
  { path: 'combat.attackerLossDay', title: 'потери наступающего в сутки' },
  { path: 'combat.defenderLossDay', title: 'потери обороняющегося в сутки' },
  { path: 'combat.breakpointLoss', title: 'предел потерь (срыв атаки)' },
  { path: 'march.kmh.foot', title: 'скорость марша пеших, км/ч' },
  { path: 'march.kmh.tracked', title: 'скорость марша гусеничных, км/ч' },
  { path: 'doctrine.su.commitDepthKm', title: 'глубина ввода второго эшелона, км' },
  { path: 'doctrine.de.withdrawStrengthShare', title: 'немцы отходят при доле сил' },
];
const MULTS = [0.7, 0.85, 1.15, 1.3];

type Val = number | [number, number][];
const valueAt = (ag: unknown, path: string): Val | null => {
  let cur = ag as Record<string, unknown> | undefined;
  for (const k of path.split('.')) cur = cur?.[k] as Record<string, unknown> | undefined;
  const v = cur && typeof cur === 'object' && 'value' in cur ? (cur as { value: unknown }).value : cur;
  return typeof v === 'number' || Array.isArray(v) ? (v as Val) : null;
};
const scaled = (v: Val, m: number): Val => (typeof v === 'number' ? +(v * m).toPrecision(4) : v.map(([x, y]) => [x, +(y * m).toPrecision(4)] as [number, number]));
const show = (v: Val) => (typeof v === 'number' ? String(v) : `кривая: ${v.slice(0, 3).map((p) => p[1]).join(', ')}…`);

/** Сверка в фоновом потоке. */
let worker: Worker | null = null, seq = 0;
const waiting = new Map<number, (r: ScoreResponse) => void>();
function score(scenario: string, trace: ScoreRequest['trace'], history: ScoreRequest['history']): Promise<AgentsScore> {
  if (!worker) {
    worker = new Worker(new URL('../sim/agents-score-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<ScoreResponse>) => { waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id); };
  }
  const id = ++seq;
  return new Promise((res, rej) => { waiting.set(id, (r) => (r.ok ? res(r.score) : rej(new Error(r.error)))); worker!.postMessage({ id, scenario, trace, history } satisfies ScoreRequest); });
}

interface Eval { score: number; within: number; medianExcessKm: number; eventsHit: number; eventsTotal: number; events: { title: string; days: (number | null)[] }[]; byGroup: { id: string; within: number }[]; seeds: number }
/** Вариант параметров на нескольких seed: средние по прогонам. */
async function evaluate(scenario: string, params: Record<string, unknown>, seeds: number, opts: { de: 'script' | 'doctrine'; su: 'script' | 'doctrine' }, stop: () => boolean): Promise<Eval | null> {
  const history = await agentHistory(scenario);
  const list: AgentsScore[] = [];
  for (let k = 0; k < seeds; k++) {
    if (stop()) return null;
    const trace = await runAgents(scenario, { seed: 101 + k, params, ...opts });
    list.push(await score(scenario, trace, history));
  }
  const avg = (f: (s: AgentsScore) => number) => +(list.reduce((a, s) => a + f(s), 0) / list.length).toFixed(3);
  const groups = new Map<string, number[]>();
  for (const s of list) for (const g of s.byGroup) groups.set(g.id, [...(groups.get(g.id) ?? []), g.within]);
  return {
    score: avg((s) => s.score), within: avg((s) => s.within), medianExcessKm: +avg((s) => s.medianExcessKm).toFixed(1),
    eventsHit: list.reduce((a, s) => a + s.eventsHit, 0), eventsTotal: list.reduce((a, s) => a + s.eventsTotal, 0),
    events: list[0].events.map((e, i) => ({ title: e.title, days: list.map((s) => s.events[i]?.days ?? null) })),
    byGroup: [...groups].map(([id, l]) => ({ id, within: +(l.reduce((a, x) => a + x, 0) / l.length).toFixed(2) })),
    seeds,
  };
}
const daysText = (l: (number | null)[]) => l.map((d) => (d == null ? '—' : d > 0 ? `+${d}` : String(d))).join(' / ');

export function AgentsTab() {
  const ops = Object.entries(AGENT_SCENARIOS);
  const [scenario, setScenario] = useState(ops[0]?.[0] ?? '');
  const [seeds, setSeeds] = useState(2);
  const [de, setDe] = useState<'script' | 'doctrine'>('script');
  const [su, setSu] = useState<'script' | 'doctrine'>('script');
  const [ag, setAg] = useState<unknown>(null);
  useEffect(() => { void getData('rules', 'agents-v0.json').then(setAg); }, []);
  const [variants, setVariants] = useState<AgentVariant[]>(agentVariants);
  useEffect(() => { const f = () => setVariants(agentVariants()); window.addEventListener('def_ops.agents.variants', f); return () => window.removeEventListener('def_ops.agents.variants', f); }, []);
  const mine = variants.filter((v) => !v.scenario || v.scenario === scenario);

  // ── сравнение ──
  const [pick, setPick] = useState<string[]>(['base']);
  const [cmp, setCmp] = useState<Record<string, Eval | 'run' | string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const stopRef = useRef(false);
  const varOf = (id: string): { title: string; params: Record<string, unknown> } => (id === 'base' ? { title: 'базовые (agents-v0)', params: {} } : mine.find((v) => v.id === id) ?? { title: id, params: {} });
  const compare = async () => {
    stopRef.current = false; setCmp({});
    for (const id of pick) {
      if (stopRef.current) break;
      setBusy(`сравнение: ${varOf(id).title}…`); setCmp((c) => ({ ...c, [id]: 'run' }));
      try { const r = await evaluate(scenario, varOf(id).params, seeds, { de, su }, () => stopRef.current); if (r) setCmp((c) => ({ ...c, [id]: r })); }
      catch (e) { setCmp((c) => ({ ...c, [id]: String(e) })); }
    }
    setBusy(null);
  };
  const done = pick.filter((id) => typeof cmp[id] === 'object') as string[];

  // ── калибровка ──
  const [keys, setKeys] = useState<string[]>(['combat.advance.prepared', 'combat.penetrationKmDay', 'march.kmh.foot']);
  const [cal, setCal] = useState<{ base: Eval | null; best: { mul: Record<string, number>; e: Eval } | null; tried: { key: string; m: number; score: number; ok: boolean }[]; n: number; total: number; error?: string; finished: boolean } | null>(null);
  const [title, setTitle] = useState('');
  const paramsOf = (mul: Record<string, number>) => Object.fromEntries(Object.entries(mul).filter(([, m]) => m !== 1).map(([k, m]) => [k, scaled(valueAt(ag, k)!, m)]));
  const calibrate = async () => {
    if (!ag) return;
    stopRef.current = false;
    const total = 1 + keys.length * MULTS.length;
    const st = { base: null as Eval | null, best: null as { mul: Record<string, number>; e: Eval } | null, tried: [] as { key: string; m: number; score: number; ok: boolean }[], n: 0, total, finished: false };
    setCal({ ...st });
    try {
      setBusy('калибровка: исходные параметры…');
      st.base = await evaluate(scenario, {}, seeds, { de, su }, () => stopRef.current);
      if (!st.base) { setBusy(null); return; }
      st.n = 1; st.best = { mul: {}, e: st.base }; setCal({ ...st });
      // по параметру: множители вокруг лучшего, принимается лучший, если он лучше
      for (const k of keys) {
        let bestHere: { m: number; e: Eval } | null = null;
        for (const m of MULTS) {
          if (stopRef.current) break;
          setBusy(`калибровка: ${PARAMS.find((p) => p.path === k)?.title} ×${m}…`);
          const mul: Record<string, number> = { ...st.best!.mul, [k]: +((st.best!.mul[k] ?? 1) * m).toFixed(3) };
          const e = await evaluate(scenario, paramsOf(mul), seeds, { de, su }, () => stopRef.current);
          if (!e) break;
          st.n++;
          st.tried.push({ key: k, m: mul[k], score: e.score, ok: false });
          if (!bestHere || e.score > bestHere.e.score) bestHere = { m: mul[k], e };
          setCal({ ...st, tried: [...st.tried] });
        }
        if (bestHere && bestHere.e.score > st.best!.e.score + 0.002) {
          st.best = { mul: { ...st.best!.mul, [k]: bestHere.m }, e: bestHere.e };
          const t = st.tried.find((x) => x.key === k && x.m === bestHere!.m); if (t) t.ok = true;
        }
        setCal({ ...st, tried: [...st.tried] });
        if (stopRef.current) break;
      }
      st.finished = true; setCal({ ...st });
    } catch (e) { setCal({ ...st, error: String(e) }); }
    setBusy(null);
  };
  const saveVariant = () => {
    if (!cal?.best) return;
    const now = new Date();
    const id = `av_${now.getTime().toString(36)}`;
    saveAgentVariant({ id, title: title.trim() || `калибровка ${now.toLocaleDateString('ru')}: ${Object.entries(cal.best.mul).map(([k, m]) => `${k.split('.').pop()} ×${m}`).join(', ') || 'без изменений'}`, params: paramsOf(cal.best.mul), scenario, note: `итог ${cal.best.e.score} против ${cal.base?.score}`, created: now.toISOString() });
    setTitle('');
  };
  const evRows = useMemo(() => (done.length ? (cmp[done[0]] as Eval).events.map((e, i) => ({ title: e.title, cells: done.map((id) => (cmp[id] as Eval).events[i]?.days ?? []) })) : []), [cmp, done.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!DESKTOP) return <div className="mdl-page"><section className="mdl-card"><h3>Агентная модель</h3><p className="muted">Агентная модель (дивизии) считается ядром настольного приложения: сравнение и калибровка доступны в нём (<code>npm run desktop:app</code>). В браузере — только нынешняя модель (вкладки «Сравнение» и «Калибровка»).</p></section></div>;
  return (
    <div className="mdl-page">
      <section className="mdl-card mdl-form">
        <h3>Агентная модель — сравнение с историей и калибровка</h3>
        <p className="muted small">Каждый прогон считает ядро (дивизии, шаг час; Берлинская операция — несколько секунд), сверка — та же, что в «Переигровке»: положения дивизий в допуске ±10 км сверх неопределённости источника и события ±2 сут. Итог для калибровки — их среднее. Варианты параметров сохраняются и выбираются в «Переигровке» («Параметры»).</p>
        <div className="row">
          <label>Операция <select value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={!!busy}>{ops.map(([id, o]) => <option key={id} value={id}>{o.title}</option>)}</select></label>
          <label title="Прогонов с разными seed на вариант: средние по ним">Прогонов <select value={seeds} onChange={(e) => setSeeds(+e.target.value)} disabled={!!busy}>{[1, 2, 3, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
          <label title="Кто решает за немецкие штабы">Немецкие штабы <select value={de} onChange={(e) => setDe(e.target.value as 'script' | 'doctrine')} disabled={!!busy}><option value="script">приказы сценария</option><option value="doctrine">по доктрине</option></select></label>
          <label title="Кто решает за советские штабы">Советские штабы <select value={su} onChange={(e) => setSu(e.target.value as 'script' | 'doctrine')} disabled={!!busy}><option value="script">приказы сценария</option><option value="doctrine">по доктрине</option></select></label>
        </div>
        {busy && <div className="row"><span className="spinner" /> <span className="muted">{busy}</span><button onClick={() => { stopRef.current = true; }}>Остановить</button></div>}
      </section>

      <section className="mdl-card">
        <h3>Сравнение вариантов</h3>
        <div className="mdl-pick">
          <label><input type="checkbox" checked={pick.includes('base')} onChange={(e) => setPick(e.target.checked ? ['base', ...pick] : pick.filter((x) => x !== 'base'))} /> базовые (agents-v0)</label>
          {mine.map((v) => <label key={v.id} title={JSON.stringify(v.params)}><input type="checkbox" checked={pick.includes(v.id)} disabled={!pick.includes(v.id) && pick.length >= SERIES.length} onChange={(e) => setPick(e.target.checked ? [...pick, v.id] : pick.filter((x) => x !== v.id))} /> {v.title}
            <button className="link" title="Удалить вариант" onClick={() => deleteAgentVariant(v.id)}>✕</button></label>)}
          {!mine.length && <span className="muted small">Своих вариантов пока нет — их даёт калибровка ниже.</span>}
        </div>
        <button className="primary" disabled={!!busy || !pick.length} onClick={() => void compare()}>Сравнить с историей</button>
        {pick.some((id) => cmp[id]) && <table className="mdl-tbl"><thead><tr><th>Вариант</th><th>В допуске</th><th>Медиана, км</th><th>События ±2 сут</th><th>Итог</th></tr></thead><tbody>
          {pick.filter((id) => cmp[id]).map((id, i) => { const r = cmp[id]; return <tr key={id}><td><i className="sw" style={{ background: SERIES[i] }} />{varOf(id).title}</td>
            {r === 'run' ? <td colSpan={4}><span className="spinner" /></td> : typeof r === 'string' ? <td colSpan={4} className="err">{r}</td>
              : <><td>{pct(r.within)}</td><td>{r.medianExcessKm}</td><td>{r.eventsHit} / {r.eventsTotal}</td><td><b>{r.score}</b></td></>}</tr>; })}
        </tbody></table>}
        {evRows.length > 0 && <><h4 className="cmd-h4">События: расхождение с историей, сут (по прогонам)</h4>
          <table className="mdl-tbl ev"><thead><tr><th>Событие</th>{done.map((id, i) => <th key={id}><i className="sw" style={{ background: SERIES[pick.indexOf(id)] ?? SERIES[i] }} />{varOf(id).title}</th>)}</tr></thead>
            <tbody>{evRows.map((r) => <tr key={r.title}><td>{r.title}</td>{r.cells.map((c, j) => <td key={j}>{daysText(c)}</td>)}</tr>)}</tbody></table></>}
        {done.length > 0 && <><h4 className="cmd-h4">По армиям: доля положений в допуске</h4>
          <table className="mdl-tbl"><thead><tr><th>Армия</th>{done.map((id) => <th key={id}>{varOf(id).title}</th>)}</tr></thead>
            <tbody>{(cmp[done[0]] as Eval).byGroup.slice(0, 20).map((g) => <tr key={g.id}><td>{g.id}</td>{done.map((id) => <td key={id}>{pct((cmp[id] as Eval).byGroup.find((x) => x.id === g.id)?.within ?? 0)}</td>)}</tr>)}</tbody></table></>}
      </section>

      <section className="mdl-card">
        <h3>Калибровка по истории</h3>
        <p className="muted small">Для каждого выбранного параметра пробуются множители {MULTS.map((m) => `×${m}`).join(', ')} вокруг лучшего найденного; принимается лучший, если итог вырос. Прогонов: 1 + {keys.length} × {MULTS.length} = {1 + keys.length * MULTS.length}, на каждый — {seeds} seed.</p>
        <div className="mdl-pick ag-params">{PARAMS.map((p) => { const v = valueAt(ag, p.path); return <label key={p.path} title={p.path}><input type="checkbox" checked={keys.includes(p.path)} disabled={!v} onChange={(e) => setKeys(e.target.checked ? [...keys, p.path] : keys.filter((k) => k !== p.path))} /> {p.title} <span className="muted small">{v ? show(v) : 'нет'}</span></label>; })}</div>
        <button className="primary" disabled={!!busy || !keys.length || !ag} onClick={() => void calibrate()}>Калибровать</button>
        {cal && <>
          <div className="muted small">Прогонов: {cal.n} из {cal.total}{cal.error ? ` — ошибка: ${cal.error}` : cal.finished ? ' — готово' : ''}</div>
          {cal.base && cal.best && <table className="mdl-tbl"><thead><tr><th></th><th>В допуске</th><th>Медиана, км</th><th>События ±2 сут</th><th>Итог</th></tr></thead><tbody>
            <tr><td>исходные</td><td>{pct(cal.base.within)}</td><td>{cal.base.medianExcessKm}</td><td>{cal.base.eventsHit} / {cal.base.eventsTotal}</td><td>{cal.base.score}</td></tr>
            <tr><td><b>лучшие</b> {Object.entries(cal.best.mul).map(([k, m]) => `${PARAMS.find((p) => p.path === k)?.title ?? k} ×${m}`).join('; ') || '(без изменений)'}</td><td>{pct(cal.best.e.within)}</td><td>{cal.best.e.medianExcessKm}</td><td>{cal.best.e.eventsHit} / {cal.best.e.eventsTotal}</td><td><b>{cal.best.e.score}</b></td></tr>
          </tbody></table>}
          {cal.tried.length > 0 && <table className="mdl-tbl"><thead><tr><th>Параметр</th><th>Множитель</th><th>Итог</th></tr></thead><tbody>
            {cal.tried.map((t, i) => <tr key={i} className={t.ok ? 'on' : ''}><td>{PARAMS.find((p) => p.path === t.key)?.title}</td><td>×{t.m}</td><td>{t.score}{t.ok ? ' ✓ принят' : ''}</td></tr>)}</tbody></table>}
          {cal.best && cal.finished && <div className="row"><input placeholder="Название варианта" value={title} onChange={(e) => setTitle(e.target.value)} /><button className="primary" onClick={saveVariant}>Сохранить вариант</button>
            <span className="muted small">— появится в «Сравнении вариантов» выше и в «Переигровке» («Параметры»).</span></div>}
        </>}
      </section>
    </div>
  );
}
