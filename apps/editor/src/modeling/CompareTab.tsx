/**
 * «Сравнение»: до четырёх наборов правил на одной операции — с историей и между собой. Прогоны (по seed)
 * идут параллельно в пуле потоков. Итог: сводка (положения в допуске, медиана превышения, мерило калибровки,
 * события в ±2 сут), отклонение от истории по дням (график), даты ключевых событий против исторических,
 * чем наборы различаются; отчёт в Markdown.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffRules, mergeEvaluations, type RulesEvaluation } from '@def-ops/sim';
import { LineChart } from './LineChart';
import { dayClass, ddmm, download, fmtDays, getPool, MAX_SERIES, medianDays, pct, resetPool, SERIES, type SimData } from './data';

type Res = { state: 'run'; done: number } | { state: 'ok'; r: RulesEvaluation } | { state: 'error'; error: string };

export function CompareTab({ d, preset }: { d: SimData; preset: { scenario: string; rules: string[] } | null }) {
  const [scenario, setScenario] = useState(preset?.scenario ?? d.catalog[0]?.id ?? '');
  const entry = d.catalog.find((c) => c.id === scenario);
  const [pick, setPick] = useState<string[]>(preset?.rules ?? entry?.rules.map((r) => r.id).slice(0, 2) ?? []);
  const [seeds, setSeeds] = useState(4);
  const [res, setRes] = useState<Record<string, Res>>({});
  const [busy, setBusy] = useState(false);
  const gen = useRef(0);
  useEffect(() => { if (preset) { setScenario(preset.scenario); setPick(preset.rules); setRes({}); } }, [preset]);
  const title = (id: string) => d.rules.find((r) => r.id === id)?.title ?? id;
  const toggle = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_SERIES ? p : [...p, id]));

  const run = async () => {
    const my = ++gen.current;
    setBusy(true);
    setRes(Object.fromEntries(pick.map((id) => [id, { state: 'run', done: 0 }])));
    const pool = getPool();
    await Promise.all(pick.map(async (id) => {
      try {
        const parts = await Promise.all(Array.from({ length: seeds }, (_, k) => pool.run({ scenario, rules: id, seeds: 1, seed0: 101 + k, toleranceKm: entry?.toleranceKm })
          .then((r) => { if (my === gen.current) setRes((x) => ({ ...x, [id]: x[id]?.state === 'run' ? { state: 'run', done: x[id].done + 1 } : x[id] })); return r; })));
        if (my === gen.current) setRes((x) => ({ ...x, [id]: { state: 'ok', r: mergeEvaluations(parts) } }));
      } catch (e) {
        if (my === gen.current) setRes((x) => ({ ...x, [id]: { state: 'error', error: (e as Error).message } }));
      }
    }));
    if (my === gen.current) setBusy(false);
  };
  const stop = () => { gen.current++; resetPool(); setBusy(false); setRes({}); };

  const ok = pick.map((id) => ({ id, r: res[id]?.state === 'ok' ? (res[id] as { r: RulesEvaluation }).r : null }));
  const done = ok.filter((x) => x.r) as { id: string; r: RulesEvaluation }[];
  const events = done[0]?.r.events ?? [];
  const diffs = useMemo(() => {
    const base = d.rules.find((r) => r.id === pick[0]);
    return pick.slice(1).map((id) => { const o = d.rules.find((r) => r.id === id); return base && o ? { id, rows: diffRules(base.rules, o.rules) } : null; }).filter(Boolean) as { id: string; rows: ReturnType<typeof diffRules> }[];
  }, [pick, d.rules]);

  const report = () => {
    const L = [`# Сравнение моделей: ${entry?.title ?? scenario}`, '', `Прогонов на набор: ${seeds}. Допуск: ${entry?.toleranceKm ?? 10} км сверх неопределённости исторического положения.`, '',
      '| Набор правил | В допуске | Медиана превышения, км | Обучение, км | Проверка, км | Ошибка дат, сут |', '|---|---|---|---|---|---|',
      ...done.map(({ id, r }) => `| ${title(id)} | ${pct(r.within)} | ${r.medianExcessKm} | ${r.score.train} | ${r.score.test} | ${r.score.events} |`), '',
      '## Ключевые события (расхождение с историей, медиана по прогонам, сут)', '', `| Событие | В истории | ${done.map(({ id }) => title(id)).join(' | ')} |`, `|---|---|${done.map(() => '---').join('|')}|`,
      ...events.map((e) => `| ${e.title} | ${ddmm(e.historical)} | ${done.map(({ r }) => fmtDays(medianDays(r.events.find((x) => x.id === e.id)?.days ?? []))).join(' | ')} |`)];
    download(`compare-${scenario}.md`, L.join('\n'), 'text/markdown');
  };

  return (
    <div className="mdl-page">
      <section className="mdl-card mdl-form">
        <label>Операция <select value={scenario} disabled={busy} onChange={(e) => { setScenario(e.target.value); const c = d.catalog.find((x) => x.id === e.target.value); setPick(c?.rules.map((r) => r.id).slice(0, 2) ?? []); setRes({}); }}>
          {d.catalog.map((c) => <option key={c.id} value={c.id}>{c.title}{c.custom ? ' (своя)' : ''}</option>)}</select></label>
        <div className="mdl-pick"><span>Наборы правил (до {MAX_SERIES}; первый — точка отсчёта):</span>
          {d.rules.map((r) => <label key={r.id} className={pick.includes(r.id) ? 'on' : ''}><input type="checkbox" disabled={busy || (!pick.includes(r.id) && pick.length >= MAX_SERIES)} checked={pick.includes(r.id)} onChange={() => toggle(r.id)} />
            {pick.includes(r.id) && <i style={{ background: SERIES[pick.indexOf(r.id)] }} />}{r.title}{r.user ? ' · свой' : ''}</label>)}</div>
        <div className="row">
          <label title="Прогонов с разными случайными seed на каждый набор: больше — надёжнее, дольше">Прогонов <input type="number" min={1} max={12} value={seeds} disabled={busy} onChange={(e) => setSeeds(Math.max(1, Math.min(12, +e.target.value || 1)))} /></label>
          {busy ? <button onClick={stop}>Остановить</button> : <button className="primary" disabled={!pick.length || !scenario} onClick={() => void run()}>Сравнить</button>}
          {done.length > 0 && !busy && <button onClick={report}>Отчёт .md</button>}
          <span className="muted">потоков: {getPool().size}</span>
        </div>
      </section>

      {pick.some((id) => res[id]) && <section className="mdl-card">
        <h4>Сводка: насколько каждая модель повторяет историю</h4>
        <table className="mdl-tbl"><thead><tr><th>Набор правил</th><th title="Доля исторических положений, где расчёт в пределах допуска сверх неопределённости">В допуске</th><th title="Медиана превышения отклонения над неопределённостью исторического положения">Медиана, км</th><th title="Среднее превышение до середины операции (по ней подбирается калибровка)">Обучение, км</th><th title="Среднее превышение после середины (проверка: не подгонялось)">Проверка, км</th><th title="Средняя ошибка дат событий первой половины, сут">Ошибка дат, сут</th><th>События ±2 сут</th><th>Расчёт</th></tr></thead>
          <tbody>{pick.map((id, k) => { const x = res[id]; const r = x?.state === 'ok' ? x.r : null; const ev = r?.events.flatMap((e) => e.days) ?? [];
            return <tr key={id}><td><i className="sw" style={{ background: SERIES[k] }} />{title(id)}</td>
              {x?.state === 'run' ? <td colSpan={7} className="muted"><span className="spinner" /> прогонов {x.done} из {seeds}</td>
                : x?.state === 'error' ? <td colSpan={7} className="err">{x.error}</td>
                : r ? <><td><b>{pct(r.within)}</b></td><td>{r.medianExcessKm}</td><td>{r.score.train}</td><td>{r.score.test}</td><td>{r.score.events}</td>
                  <td>{ev.filter((v) => v != null && Math.abs(v) <= 2).length} из {ev.length}</td><td className="muted">{(r.ms / 1000).toFixed(0)} с</td></> : <td colSpan={7} />}
            </tr>; })}</tbody></table>
      </section>}

      {done.length > 0 && <section className="mdl-card">
        <h4>Отклонение от исторических положений по дням</h4>
        <p className="muted">Среднее превышение расстояния до исторического положения над его неопределённостью, км. Ноль — расчёт совпадает с историей.</p>
        <LineChart series={done.map(({ id, r }) => ({ name: title(id), points: r.byDay.map((b) => ({ x: b.day, y: b.meanExcessKm })) }))} unit="км" yLabel="Отклонение от истории по дням" zeroLabel="история" />
      </section>}

      {done.length > 0 && events.length > 0 && <section className="mdl-card">
        <h4>Ключевые события: в расчёте против истории</h4>
        <p className="muted">Расхождение с исторической датой, сутки (медиана по прогонам; + — позже истории, «—» — в большинстве прогонов не случилось); в скобках — разброс.</p>
        <table className="mdl-tbl ev"><thead><tr><th>Событие</th><th>В истории</th>{done.map(({ id }) => <th key={id}><i className="sw" style={{ background: SERIES[pick.indexOf(id)] }} />{title(id)}</th>)}</tr></thead>
          <tbody>{events.map((e) => <tr key={e.id}><td>{e.title}</td><td>{ddmm(e.historical)}</td>
            {done.map(({ id, r }) => { const ds = r.events.find((x) => x.id === e.id)?.days ?? []; const m = medianDays(ds); const v = ds.filter((x): x is number => x != null);
              return <td key={id} className={`dd ${dayClass(m)}`}><b>{fmtDays(m)}</b>{v.length > 1 && Math.min(...v) !== Math.max(...v) && <small> ({fmtDays(Math.min(...v))}…{fmtDays(Math.max(...v))})</small>}{v.length < ds.length && <small> · не было в {ds.length - v.length}</small>}</td>; })}
          </tr>)}</tbody></table>
      </section>}

      {diffs.length > 0 && <section className="mdl-card">
        <h4>Чем наборы различаются</h4>
        {diffs.map((x) => <div key={x.id}><p><b>{title(pick[0])}</b> → <b>{title(x.id)}</b>{!x.rows.length && ': параметры совпадают'}</p>
          {x.rows.length > 0 && <table className="mdl-tbl"><tbody>{x.rows.map((r) => <tr key={r.key}><td>{r.title}</td><td>{r.a}</td><td>→ <b>{r.b}</b></td></tr>)}</tbody></table>}</div>)}
      </section>}
    </div>
  );
}
