/**
 * «Пересчёт модели» в карточке операции: что изменилось в данных после последней калибровки (сценарий, история,
 * инфраструктура, база знаний) и одна кнопка — прогон на текущих правилах («до»), калибровка множителей по истории
 * (обучение — первая половина операции), прогон с новыми правилами («после»), контрольная операция (не подогнано
 * ли), отчёт. Новые правила сохраняются своим набором; основными их делает человек. Итог записывается и в базу
 * знаний (рубрика «Устройство модели стенда»).
 */
import { useEffect, useRef, useState } from 'react';
import { baseParams, CALIB_INFO, CALIB_KEYS, calibratedRules, Calibrator, mergeEvaluations, type CalibParams, type Rules, type RulesEvaluation, type Scenario } from '@def-ops/sim';
import * as kb from '../kb/kb';
import { BUILTIN_CATALOG, changesSince, getData, getEdits, onDataChange, saveRules, updateEdits, type ChangeLog, type OperationEdits, type Recalibration } from '../sim/userdata';
import { download, getPool, pct, type SimData } from './data';

const KIND_RU: Record<ChangeLog['kind'], string> = { scenario: 'сценарий', history: 'история', infra: 'инфраструктура', kb: 'база знаний' };
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const hits = (r: RulesEvaluation) => r.events.reduce((a, e) => a + e.days.filter((d) => d != null && Math.abs(d) <= 2).length, 0);
const total = (r: RulesEvaluation) => r.events.reduce((a, e) => a + e.days.length, 0);
const sum = (r: RulesEvaluation) => ({ within: r.within, eventsHit: hits(r), eventsTotal: total(r), score: r.score.total });

type Stage = 'before' | 'calib' | 'after' | 'control' | 'done';
const STAGE_RU: Record<Stage, string> = { before: 'прогон на текущих правилах', calib: 'калибровка', after: 'прогон с новыми правилами', control: 'контрольная операция', done: 'готово' };

export function RecalcPanel({ op, title, d }: { op: string; title: string; d: SimData }) {
  const [edits, setEdits] = useState<OperationEdits | null>(null);
  useEffect(() => { const f = () => void getEdits(op).then(setEdits); f(); return onDataChange(f); }, [op]);
  const [evals, setEvals] = useState(64);
  const [run, setRun] = useState<{ stage: Stage; done: number; evals: number; text: string; error?: string } | null>(null);
  const [result, setResult] = useState<Recalibration | null>(null);
  const stopRef = useRef(false);
  const entry = d.catalog.find((c) => c.id === op);
  const baseId = entry?.rules[0]?.id;
  const base = d.rules.find((r) => r.id === baseId);
  // контрольная — другая встроенная операция оперативного масштаба (Висло-Одерская; для неё — Берлинская)
  const ctl = BUILTIN_CATALOG.find((c) => c.id !== op && c.id === (op === 'vistula-oder-1945' ? 'berlin-1945-tasks' : 'vistula-oder-1945'));

  if (!edits) return null;
  const changes = changesSince(edits);
  const last = edits.recalibrations[edits.recalibrations.length - 1];
  const busy = !!run && run.stage !== 'done' && !run.error;

  const start = async () => {
    if (!base || !entry) return;
    stopRef.current = false; setResult(null);
    const pool = getPool();
    const sc = (await getData('scenarios', `${op}.json`)) as Scenario;
    const trainUntil = `${new Date((Date.parse(sc.start + 'Z') + Date.parse(sc.end + 'Z')) / 2).toISOString().slice(0, 10)}T23:59`;
    const tol = entry.toleranceKm;
    const st: { stage: Stage; done: number; evals: number; text: string; error?: string } = { stage: 'before', done: 0, evals, text: '' };
    const upd = (x: Partial<typeof st>) => { Object.assign(st, x); setRun({ ...st }); };
    try {
      upd({ stage: 'before', text: '5 прогонов' });
      const before = await pool.run({ scenario: op, rules: base.id, seeds: 5, seed0: 1, trainUntil, toleranceKm: tol });
      upd({ stage: 'calib', text: '' });
      const keys = CALIB_KEYS.filter((k) => !(k.startsWith('terr') && !base.rules.territory));
      const p0 = baseParams(base.rules);
      const cal = new Calibrator(p0, evals, Date.now() % 100000, keys);
      // вариант — по двум прогонам (seed 101, 102): по одному подбор подстраивается под случайность
      const evalP = (params?: CalibParams) => Promise.all([101, 102].map((seed0) => pool.run({ scenario: op, rules: base.id, params, seeds: 1, seed0, trainUntil, toleranceKm: tol }))).then((l) => mergeEvaluations(l).score);
      const tried: { p: CalibParams; s: number }[] = [];
      cal.report(p0, await evalP());
      while (!cal.done && !stopRef.current) {
        await Promise.all(cal.next(Math.max(1, Math.floor(pool.size / 2))).map(async (p) => {
          const sc = await evalP(p);
          cal.report(p, sc);
          tried.push({ p, s: sc.total });
          upd({ done: st.done + 1 });
        }));
      }
      // перепроверка: три лучших варианта — на тех же 5 прогонах, что и «до»; берётся лучший по мерилу
      upd({ stage: 'after', text: 'перепроверка трёх лучших вариантов на 5 прогонах' });
      const top = tried.sort((a, b) => a.s - b.s).slice(0, 3);
      const checked = await Promise.all(top.map(async (t) => ({ p: t.p, r: await pool.run({ scenario: op, rules: base.id, params: t.p, seeds: 5, seed0: 1, trainUntil, toleranceKm: tol }) })));
      const winner = checked.sort((a, b) => a.r.score.total - b.r.score.total)[0];
      const better = !!winner && winner.r.score.total < before.score.total;
      const best = { p: better ? winner.p : p0, s: better ? winner.r.score : before.score };
      const after = better ? winner.r : before;
      const control: Recalibration['control'] = [];
      if (ctl && better) {
        upd({ stage: 'control', text: ctl.title.split(',')[0] });
        const [cb, ca] = await Promise.all([
          pool.run({ scenario: ctl.id, rules: base.id, seeds: 2, seed0: 1, toleranceKm: ctl.toleranceKm }),
          pool.run({ scenario: ctl.id, rules: base.id, params: best.p, seeds: 2, seed0: 1, toleranceKm: ctl.toleranceKm }),
        ]);
        control.push({ scenario: ctl.id, title: ctl.title.split(',')[0], before: cb.within, after: ca.within, eventsBefore: hits(cb), eventsAfter: hits(ca), eventsTotal: total(cb) });
      }
      // сохранить набор правил (свой), записать итог — в операцию и в базу знаний
      const at = new Date().toISOString();
      const id = `user-recal-${op}-${Date.now().toString(36)}`;
      const rules = calibratedRules(base.rules, best.p, { id, scenario: op, evals: st.done + 1, seeds: 1, trainUntil, before: before.score, after: best.s, note: `пересчёт после уточнения данных (${changes.length} изменений)` }) as Rules;
      const rtitle = `пересчёт ${ddmmyyyy(at)} (${title.split(',')[0]})`;
      if (better) await saveRules({ id, title: rtitle, base: base.id, scenario: op, created: at, note: `пересчёт после уточнения данных: ${changes.length} изменений`, rules });
      const moved = keys.filter((k) => Math.abs(best.p[k] - p0[k]) > 1e-3).map((k) => `${CALIB_INFO[k].title}: ${p0[k].toFixed(2)} → ${best.p[k].toFixed(2)}`);
      const rec: Recalibration = { at, rules: id, base: base.id, title: rtitle, before: sum(before), after: sum(after), control, changes: changes.length, report: '', better };
      rec.report = report(title, rec, changes, moved, base.title, trainUntil);
      await updateEdits(op, (e) => { e.recalibrations.push(rec); });
      await kb.recordCalibration({ id: op, title }, at, rtitle, rec.report.split('\n').slice(2).join('\n'), [
        { key: 'numbers', value: better ? `${ddmmyyyy(at)}: положения в допуске ${pct(rec.before.within)} → ${pct(rec.after.within)}; события ±2 сут ${rec.before.eventsHit} → ${rec.after.eventsHit} из ${rec.after.eventsTotal} (правила ${id})` : `${ddmmyyyy(at)}: лучше текущих правил не найдено; положения в допуске ${pct(rec.before.within)}, события ±2 сут ${rec.before.eventsHit} из ${rec.before.eventsTotal}` },
      ]);
      setResult(rec);
      upd({ stage: 'done' });
    } catch (e) {
      upd({ error: (e as Error).message });
    }
  };
  const makeDefault = (id: string) => void updateEdits(op, (e) => { e.defaultRules = id; e.log.push({ at: new Date().toISOString(), kind: 'scenario', text: `основные правила — ${id}` }); });
  const shown = result ?? last;
  const isDefault = shown && (edits.defaultRules === shown.rules);
  const fails = shown && (shown.better === false || shown.control?.some((c) => c.after < c.before - 0.02));

  return (
    <section className="mdl-card recalc">
      <div className="sync-h"><h4>Пересчёт модели</h4>
        <span className={`sync-n ${changes.length ? 'warn' : 'ok'}`}>{changes.length ? `данные изменились${last ? ` после пересчёта ${ddmmyyyy(last.at)}` : ''}: ${changes.length}` : last ? `✓ данные не менялись после ${ddmmyyyy(last.at)}` : 'пересчётов ещё не было'}</span></div>
      <p className="muted small">После уточнения данных (цифры сценария из базы, положения из документов, состояние мостов и дорог) правила арбитра стоит перекалибровать: прогон на текущих правилах, подбор множителей по первой половине операции, прогон с новыми правилами, проверка на контрольной операции{ctl ? ` (${ctl.title.split(',')[0]})` : ''}. Новые правила сохраняются своим набором; основными их делаете вы. Итог пишется и в базу знаний.</p>
      {changes.length > 0 && <details className="recalc-ch"><summary>Что изменилось: {(['scenario', 'history', 'infra', 'kb'] as const).map((k) => { const n = changes.filter((c) => c.kind === k).length; return n ? `${KIND_RU[k]} ${n}` : null; }).filter(Boolean).join(', ')}</summary>
        <ul>{changes.slice(-40).reverse().map((c, i) => <li key={i}><small className="muted">{ddmmyyyy(c.at)} · {KIND_RU[c.kind]}</small> {c.text}</li>)}</ul></details>}
      <div className="row">
        {busy ? <button onClick={() => { stopRef.current = true; }} title="Закончить подбор на текущем лучшем варианте">Остановить подбор</button>
          : <button className="primary" disabled={!base} onClick={() => void start()}>Пересчитать</button>}
        <label className="muted small">вариантов <select value={evals} disabled={busy} onChange={(e) => setEvals(+e.target.value)}>{[32, 64, 128].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <span className="muted small">от правил: {base?.title ?? '—'} · потоков {getPool().size}</span>
      </div>
      {run && !run.error && run.stage !== 'done' && <div className="kb-prog"><i style={{ width: `${run.stage === 'calib' ? (run.done / run.evals) * 100 : run.stage === 'before' ? 3 : run.stage === 'after' ? 96 : 99}%` }} />
        <span><span className="spinner" /> {STAGE_RU[run.stage]}{run.stage === 'calib' ? `: ${run.done} из ${run.evals}` : run.text ? `: ${run.text}` : ''}</span></div>}
      {run?.error && <div className="err">Пересчёт прерван: {run.error}</div>}
      {shown && <div className="recalc-res">
        <table className="mdl-tbl"><thead><tr><th>{result ? 'Итог пересчёта' : `Последний пересчёт ${ddmmyyyy(shown.at)}`}</th><th>до</th><th>после</th></tr></thead><tbody>
          <tr><td>Положения в допуске (5 прогонов)</td><td>{pct(shown.before.within)}</td><td className={shown.after.within >= shown.before.within ? 'better' : 'worse'}><b>{pct(shown.after.within)}</b></td></tr>
          <tr><td>События в пределах ±2 сут</td><td>{shown.before.eventsHit} из {shown.before.eventsTotal}</td><td className={shown.after.eventsHit >= shown.before.eventsHit ? 'better' : 'worse'}><b>{shown.after.eventsHit} из {shown.after.eventsTotal}</b></td></tr>
          {shown.control?.map((c) => <tr key={c.scenario}><td>Контрольная: {c.title}</td><td>{pct(c.before)}, {c.eventsBefore} из {c.eventsTotal}</td><td className={c.after >= c.before - 0.02 ? 'better' : 'worse'}><b>{pct(c.after)}, {c.eventsAfter} из {c.eventsTotal}</b></td></tr>)}
        </tbody></table>
        {shown.better === false && <p className="warn small">Лучше текущих правил подбор не нашёл (перепроверка на 5 прогонах): правила остаются прежними. Можно повторить с большим числом вариантов.</p>}
        {shown.control?.some((c) => c.after < c.before - 0.02) && <p className="warn small">На контрольной операции стало хуже — похоже на подгонку под эту операцию. Основными такие правила делать не стоит.</p>}
        <div className="row">
          <button onClick={() => download(`${op}-пересчёт-${shown.at.slice(0, 10)}.md`, shown.report, 'text/markdown')}>Отчёт .md</button>
          {isDefault ? <span className="ok small">✓ основные правила операции</span>
            : shown.better !== false && <button className={fails ? '' : 'primary'} onClick={() => { if (!fails || confirm('На контрольной операции новые правила хуже. Всё равно сделать их основными?')) makeDefault(shown.rules); }} title="Набор станет первым в «Переигровке» и в следующем пересчёте">Сделать основными</button>}
          {edits.defaultRules && <button className="link" onClick={() => void updateEdits(op, (e) => { delete e.defaultRules; })}>вернуть встроенные</button>}
        </div>
      </div>}
    </section>
  );
}

function report(title: string, r: Recalibration, changes: ChangeLog[], moved: string[], baseTitle: string, trainUntil: string): string {
  const L: string[] = [];
  L.push(`# Пересчёт модели: ${title}`, '');
  L.push(`${ddmmyyyy(r.at)} · от правил «${baseTitle}» · обучение до ${ddmmyyyy(trainUntil)}, после — проверка · новый набор \`${r.rules}\``, '');
  L.push('## Что изменилось в данных', '');
  if (!changes.length) L.push('Изменений после прошлого пересчёта нет — пересчёт по тем же данным.');
  for (const c of changes) L.push(`- ${ddmmyyyy(c.at)}, ${KIND_RU[c.kind]}: ${c.text}`);
  L.push('', '## До и после', '', '| Мерило | до | после |', '|---|---|---|');
  L.push(`| Положения в допуске (5 прогонов) | ${pct(r.before.within)} | ${pct(r.after.within)} |`);
  L.push(`| События в пределах ±2 сут | ${r.before.eventsHit} из ${r.before.eventsTotal} | ${r.after.eventsHit} из ${r.after.eventsTotal} |`);
  L.push(`| Мерило калибровки (меньше — лучше) | ${r.before.score.toFixed(2)} | ${r.after.score.toFixed(2)} |`);
  for (const c of r.control ?? []) L.push(`| Контрольная «${c.title}»: положения, события | ${pct(c.before)}, ${c.eventsBefore} из ${c.eventsTotal} | ${pct(c.after)}, ${c.eventsAfter} из ${c.eventsTotal} |`);
  L.push('', '## Множители правил', '');
  L.push(moved.length ? moved.map((m) => `- ${m}`).join('\n') : 'Множители не изменились: лучше исходных найти не удалось.');
  if (r.better === false) L.push('', '**Лучше текущих правил подбор не нашёл** (перепроверка трёх лучших вариантов на 5 прогонах) — правила остаются прежними.');
  if ((r.control ?? []).some((c) => c.after < c.before - 0.02)) L.push('', '**На контрольной операции стало хуже** — новые правила, вероятно, подогнаны под эту операцию.');
  return L.join('\n');
}
