/** Отчёт по готовым прогонам: сверка положений с документами (против нынешней модели), вехи операции в расчёте и
 * в вариантах, потери сторон. Данные — summary.json из evals-out (npm run agents:berlin, agents:berlin:variants). */
import { useEffect, useState } from 'react';
import type { RunSummary, ScenarioInfo } from './data';
import { hourOf, loadSummary } from './data';

interface Props { scen: ScenarioInfo; onClose: () => void }

/** Итог советских потерь операции для сравнения (16.04–8.05, Кривошеев, A; docs/sources/berlin-1945-oob.md). */
const SU_LOSSES: Record<string, { value: number; note: string }> = {
  berlin: { value: 352475, note: 'Кривошеев: безвозвратные и санитарные, 16.04–8.05 (A)' },
};

const pct = (x: number) => `${Math.round(x * 100)} %`;
const num = (x: number) => Math.round(x).toLocaleString('ru-RU');
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
/** Отклонение даты расчёта от истории, сутки (история — день события, сверка в 20:00). */
function delta(calc: string | null, date: string): string {
  if (!calc || !/^\d{4}-/.test(calc)) return '';
  const d = (hourOf('1945-01-01T00:00', calc.slice(0, 16)) - hourOf('1945-01-01T00:00', `${date}T20:00`)) / 24;
  return Math.abs(d) < 0.5 ? 'в пределах суток' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} сут`;
}
const when = (calc: string | null) => (!calc ? '—' : /^\d{4}-/.test(calc) ? `${dm(calc)} ${calc.slice(11, 16)}` : calc);

export function Report({ scen, onClose }: Props) {
  const [base, setBase] = useState<RunSummary | null>(null);
  const [vars, setVars] = useState<{ name: string; s: RunSummary }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setBase(null); setVars([]); setErr(null);
    loadSummary(scen.trace).then(setBase).catch(() => setErr(`нет сводки основного прогона — npm run agents:${scen.id}`));
    void Promise.all(scen.variants.map((v) => loadSummary(v.trace).then((s) => ({ name: v.name, s })).catch(() => null)))
      .then((xs) => setVars(xs.filter((x): x is { name: string; s: RunSummary } => x !== null)));
  }, [scen]);

  const tuned = base?.sectors.filter((x) => x.tuned) ?? [];
  const tn = tuned.reduce((a, x) => a + x.n, 0);
  const tAgent = tuned.reduce((a, x) => a + x.agent * x.n, 0) / Math.max(1, tn);
  const tCur = tuned.reduce((a, x) => a + x.current * x.n, 0) / Math.max(1, tn);
  const spread = (k: 'outOfTuning' | 'armies' | 'divisions') => {
    const v = base?.perRun.map((r) => r[k]) ?? [];
    return v.length ? `${pct(Math.min(...v))}–${pct(Math.max(...v))}` : '—';
  };
  const lastLoss = base?.losses[base.losses.length - 1];
  const hist = SU_LOSSES[scen.id];

  return (
    <div className="report">
      <div className="report-head">
        <h2>Отчёт: {scen.name}</h2>
        <span className="spacer" />
        <button onClick={onClose}>Закрыть</button>
      </div>
      {err && <div className="hint">{err}</div>}
      {base && (
        <>
          <div className="muted">По готовым прогонам: {base.info}; разброс — по {base.runs} прогонам. Допуск — {base.toleranceKm} км сверх радиуса неопределённости источника (мерило нынешней модели).</div>

          <section>
            <h3>Сверка положений с документами</h3>
            <div className="kpis">
              <div><b>{pct(base.outOfTuning.agent)}</b><span>агентная модель вне настройки<br />({base.outOfTuning.n} положений армий и немецких дивизий; по прогонам {spread('outOfTuning')})</span></div>
              <div><b>{pct(base.outOfTuning.current)}</b><span>нынешняя модель на тех же положениях</span></div>
              {tn > 0 && <div><b>{pct(tAgent)}</b><span>на участке настройки (Зееловские высоты, 16–19.04); нынешняя — {pct(tCur)}</span></div>}
            </div>
            <table className="rep">
              <thead><tr><th>участок</th><th>период</th><th>положений</th><th>агентная</th><th>нынешняя</th></tr></thead>
              <tbody>
                {base.sectors.map((x, k) => (
                  <tr key={k} className={x.tuned ? 'tuned' : ''}>
                    <td>{x.sector}</td><td>{x.period}</td><td className="num">{x.n}</td>
                    <td className="num"><span className="bar" style={{ width: `${x.agent * 60}px` }} />{pct(x.agent)}</td>
                    <td className="num"><span className="bar cur" style={{ width: `${x.current * 60}px` }} />{pct(x.current)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint">Правила модели выбирались на Зееловских высотах 16–19.04 (строка выделена); остальное — проверка без перенастройки.</div>
          </section>

          <section>
            <h3>Вехи операции</h3>
            <table className="rep">
              <thead><tr><th>веха</th><th>история</th><th>расчёт</th>{vars.map((v) => <th key={v.name}>{v.name}</th>)}</tr></thead>
              <tbody>
                {base.milestones.map((m) => (
                  <tr key={m.id || m.title}>
                    <td>{m.title}</td><td>{dm(m.date)}</td>
                    <td>{when(m.calc)} <span className="d">{delta(m.calc, m.date)}</span></td>
                    {vars.map((v) => { const c = v.s.milestones.find((x) => x.id === m.id)?.calc ?? null; return <td key={v.name}>{when(c)} <span className="d">{delta(c, m.date)}</span></td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint">История — день события; отклонение расчёта — от 20:00 этого дня. Варианты — прогон 1.</div>
          </section>

          <section>
            <h3>Потери сторон</h3>
            {(base.formationLosses?.length ?? 0) > 0 && (
              <>
                <table className="rep">
                  <thead><tr><th>советское объединение</th><th>расчёт к {dm(base.formationLosses![0].until)}</th><th>источник</th><th>расчёт / источник</th><th>суток боя на дивизию</th><th>источник</th></tr></thead>
                  <tbody>
                    {base.formationLosses!.map((x) => (
                      <tr key={x.formation}>
                        <td>{x.name}</td><td className="num">{num(x.model)}</td><td className="num">{num(x.source)}</td>
                        <td className="num"><span className={`ratio ${x.model / x.source < 0.67 || x.model / x.source > 1.5 ? 'off' : ''}`}>{(x.model / x.source).toFixed(2)}</span></td>
                        <td className="num">{x.battleDays ?? '—'}</td>
                        <td className="d">{x.ref} ({x.reliability})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="hint">Убитые, раненые и пропавшие. Отношение вне 0,67–1,5 выделено. Сутки боя — часы с потерями на дивизию объединения: наступающий теряет норму за сутки боя, поэтому перекос по армиям идёт от времени в бою.</div>
              </>
            )}
            <table className="rep">
              <thead><tr><th>день (20:00)</th><th>советская сторона</th><th>немецкая сторона</th></tr></thead>
              <tbody>{base.losses.map((l) => <tr key={l.day}><td>{dm(l.day)}</td><td className="num">{num(l.su)}</td><td className="num">{num(l.de)}</td></tr>)}</tbody>
            </table>
            {lastLoss && hist && <div className="hint">Итог советских потерь операции — {num(hist.value)} ({hist.note}); в расчёте к {dm(lastLoss.day)} — {num(lastLoss.su)}, {pct(lastLoss.su / hist.value)} от итога.</div>}
            {vars.length > 0 && lastLoss && (
              <table className="rep">
                <thead><tr><th>вариант</th><th>советские к {dm(lastLoss.day)}</th><th>немецкие</th><th>в допуске вне настройки</th></tr></thead>
                <tbody>
                  <tr><td>основной</td><td className="num">{num(lastLoss.su)}</td><td className="num">{num(lastLoss.de)}</td><td className="num">{pct(base.outOfTuning.agent)}</td></tr>
                  {vars.map((v) => { const l = v.s.losses[v.s.losses.length - 1]; return <tr key={v.name}><td>{v.name}</td><td className="num">{l ? num(l.su) : '—'}</td><td className="num">{l ? num(l.de) : '—'}</td><td className="num">{pct(v.s.outOfTuning.agent)}</td></tr>; })}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
