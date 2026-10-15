/**
 * «Калибровка»: подбор множителей правил по истории операции — в браузере, параллельно в пуле потоков.
 * Мерило — как у npm run sim:calibrate: отклонение положений до середины операции («обучение») + 3 × ошибка
 * дат событий; вторая половина («проверка») в подборе не участвует и показывает, не подогнано ли. Итог —
 * свой набор правил с блоком калибровки (до и после, множители). У каждого множителя — коридор, в котором он
 * подбирается (норматив базы знаний с источником и надёжностью или прежние границы), у итога — пометка «упирается в
 * границу» (в пределах 2 % ширины коридора от края).
 */
import { useEffect, useRef, useState } from 'react';
import { baseParams, CALIB_INFO, CALIB_KEYS, calibCorridors, calibratedRules, Calibrator, corridorReport, mergeEvaluations, spaceOf, type CalibCorridor, type CalibKey, type CalibParams, type CalibScore, type Rules, type Scenario } from '@def-ops/sim';
import { basisOf, outcomeNorms } from '../sim/kb-rules';
import { getData, onDataChange, saveRules } from '../sim/userdata';
import * as kb from '../kb/kb';
import { LineChart } from './LineChart';
import { getPool, pct, resetPool, type SimData } from './data';

/**
 * start — исходная точка подбора (множители вне коридоров нормативов перенесены к краю), moved — какие перенесены;
 * corridors — коридоры, по которым идёт подбор (записываются в сохранённый набор).
 */
interface Run { scenario: string; baseId: string; before: CalibScore; start: CalibParams; moved: CalibKey[]; corridors?: Partial<Record<CalibKey, CalibCorridor>>; history: { i: number; best: number; cur: number }[]; best: { p: CalibParams; s: CalibScore } | null; done: number; evals: number; seeds: number; trainUntil: string; finished: boolean; error?: string }

export function CalibrateTab({ d, onCompare, initialScenario }: { d: SimData; onCompare: (scenario: string, rules: string[]) => void; initialScenario?: string | null }) {
  const [scenario, setScenario] = useState(initialScenario ?? d.catalog[0]?.id ?? '');
  const [baseId, setBaseId] = useState('ww2-draft');
  const [evals, setEvals] = useState(96);
  const [seeds, setSeeds] = useState(1);
  const [keys, setKeys] = useState<CalibKey[]>(CALIB_KEYS);
  const [period, setPeriod] = useState<{ start: string; end: string } | null>(null);
  const [trainUntil, setTrainUntil] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [title, setTitle] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const stopRef = useRef(false);
  const base = d.rules.find((r) => r.id === baseId);
  // коридоры множителей от выбранного набора — до запуска (пересобираются при изменении базы знаний)
  const [preview, setPreview] = useState<Partial<Record<CalibKey, CalibCorridor>> | null>(null);
  const [kbs, setKbs] = useState<kb.KbState>(kb.current());
  useEffect(() => { void kb.load(); return kb.subscribe(setKbs); }, []);
  useEffect(() => {
    let alive = true;
    const load = () => { if (base) void basisOf(base.rules).then((b) => { if (alive) setPreview(calibCorridors(b.corridors)); }).catch(() => { if (alive) setPreview(null); }); };
    load();
    const off = onDataChange(load);
    window.addEventListener(kb.KB_CHANGED, load);
    return () => { alive = false; off(); window.removeEventListener(kb.KB_CHANGED, load); };
  }, [base]);
  const srcOf = (c?: CalibCorridor) => (c?.source ? kbs.byId.get(c.source)?.title ?? c.source.replace(/^src:/, '') : '');
  const entry = d.catalog.find((c) => c.id === scenario);

  // сроки операции — граница «обучения» по умолчанию — середина
  useEffect(() => {
    void (getData('scenarios', `${scenario}.json`) as Promise<Scenario>).then((s) => {
      setPeriod({ start: s.start, end: s.end });
      setTrainUntil(new Date((Date.parse(s.start + 'Z') + Date.parse(s.end + 'Z')) / 2).toISOString().slice(0, 10));
    }).catch(() => setPeriod(null));
  }, [scenario]);

  const start = async () => {
    if (!base) return;
    stopRef.current = false; setSavedId(null);
    const tu = `${trainUntil}T23:59`;
    const pool = getPool();
    const p0 = baseParams(base.rules);
    const st: Run = { scenario, baseId, before: null as unknown as CalibScore, start: p0, moved: [], history: [], best: null, done: 0, evals, seeds, trainUntil: tu, finished: false };
    setRun({ ...st });
    try {
      // основа правил по базе знаний: коридоры множителей (относительно этого набора) и нормативы-итоги операции
      const basis = await basisOf(base.rules).catch(() => null);
      const outcomes = basis ? outcomeNorms(basis, scenario) : [];
      st.corridors = basis ? calibCorridors(basis.corridors) : undefined;
      const evalP = (params: CalibParams | undefined) => Promise.all(Array.from({ length: seeds }, (_, k) => pool.run({ scenario, rules: base.id, params, seeds: 1, seed0: 101 + k, trainUntil: tu, toleranceKm: entry?.toleranceKm, outcomes }))).then((l) => mergeEvaluations(l).score);
      st.before = await evalP(undefined);
      const cal = new Calibrator(p0, evals, Date.now() % 100000, keys, basis ? spaceOf(basis.corridors) : undefined);
      // исходные множители вне коридоров — старт у края коридора; его мерило считается отдельно
      st.start = cal.start;
      st.moved = keys.filter((k) => Math.abs(cal.start[k] - p0[k]) > 1e-9);
      cal.report(cal.start, st.moved.length ? await evalP(cal.start) : st.before);
      st.best = cal.best;
      setRun({ ...st });
      // партиями по числу потоков: широкий поиск, потом уточнение вокруг лучшего
      while (!cal.done && !stopRef.current) {
        const batch = cal.next(pool.size);
        await Promise.all(batch.map(async (p) => {
          const s = await evalP(p);
          cal.report(p, s);
          st.done++;
          st.best = cal.best;
          st.history = [...st.history, { i: st.done, best: cal.best!.s.total, cur: s.total }];
          setRun({ ...st });
        }));
      }
      st.finished = true;
      setRun({ ...st });
      setTitle(`${base.title.split(' (')[0]} — калибровка по «${entry?.title.split(',')[0]}»`);
    } catch (e) {
      st.error = (e as Error).message; st.finished = true;
      setRun({ ...st });
    }
  };
  const stop = () => { stopRef.current = true; };
  const abort = () => { stopRef.current = true; resetPool(); };
  const save = async () => {
    if (!run?.best || !base) return;
    const id = `user-cal-${Date.now().toString(36)}`;
    const rules = calibratedRules(base.rules, run.best.p, { id, scenario: run.scenario, evals: run.done, seeds: run.seeds, trainUntil: run.trainUntil, before: run.before, after: run.best.s, corridors: run.corridors }) as Rules;
    await saveRules({ id, title: title.trim() || id, base: base.id, scenario: run.scenario, created: new Date().toISOString(), note: `калибровка в браузере: ${run.done} вариантов, обучение до ${run.trainUntil.slice(0, 10)}`, rules });
    setSavedId(id);
  };
  const busy = !!run && !run.finished;
  const b = run?.best;
  return (
    <div className="mdl-page">
      <section className="mdl-card mdl-form">
        <p className="muted">Калибровка подбирает множители правил так, чтобы прогоны операции с историческими приказами ближе всего повторяли историю: положения войск по дням (сверх неопределённости исторических данных) и даты ключевых событий. Подбор идёт только по первой половине операции («обучение»); вторая («проверка») показывает, не подогнаны ли числа. Обязательно проверьте итог на другой операции в «Сравнении».</p>
        <div className="mdl-grid">
          <label>Операция <select value={scenario} disabled={busy} onChange={(e) => setScenario(e.target.value)}>{d.catalog.map((c) => <option key={c.id} value={c.id}>{c.title}{c.custom ? ' (своя)' : ''}</option>)}</select></label>
          <label>От набора правил <select value={baseId} disabled={busy} onChange={(e) => setBaseId(e.target.value)}>{d.rules.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
          <label title="Сколько вариантов перебрать: 40 % — широкий поиск, остальное — уточнение вокруг лучшего">Вариантов <select value={evals} disabled={busy} onChange={(e) => setEvals(+e.target.value)}>{[32, 64, 96, 160, 240].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label title="Прогонов на вариант с разными seed: 2 — надёжнее, вдвое дольше">Прогонов на вариант <select value={seeds} disabled={busy} onChange={(e) => setSeeds(+e.target.value)}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label>Обучение до <input type="date" value={trainUntil} min={period?.start.slice(0, 10)} max={period?.end.slice(0, 10)} disabled={busy} onChange={(e) => setTrainUntil(e.target.value)} /></label>
        </div>
        <div className="mdl-pick"><span>Что подбирать:</span>{CALIB_KEYS.filter((k) => !(k.startsWith('terr') && !base?.rules.territory)).map((k) => <label key={k} className={keys.includes(k) ? 'on' : ''} title={CALIB_INFO[k].hint}>
          <input type="checkbox" disabled={busy} checked={keys.includes(k)} onChange={() => setKeys((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))} />{CALIB_INFO[k].title}
          {preview && <Corr c={preview[k]} k={k} src={srcOf(preview[k])} />}</label>)}</div>
        <p className="muted small">Рядом с множителем — коридор подбора: норматив базы знаний (надёжность, источник) с допуском A ±10 %, B ±20 %, C ±35 %; «доп.» — норматива нет, прежние границы.</p>
        <div className="row">
          {busy ? <><button onClick={stop} title="Доделать текущую партию и остановиться (лучший вариант сохраняется)">Остановить</button><button onClick={abort}>Прервать сразу</button></>
            : <button className="primary" disabled={!base || !keys.length || !trainUntil} onClick={() => void start()}>Начать калибровку</button>}
          <span className="muted">потоков: {getPool().size}; оценка {evals} × {seeds} прогонов ≈ {Math.max(1, Math.round((evals * seeds * 3) / getPool().size / 60))} мин</span>
        </div>
      </section>

      {run && <section className="mdl-card">
        <h4>{run.finished ? (run.error ? 'Калибровка прервана' : 'Калибровка завершена') : 'Идёт калибровка…'}</h4>
        {run.error && <div className="err">{run.error}</div>}
        {!run.before ? <p className="muted"><span className="spinner" /> исходные правила: прогон для точки отсчёта…</p> : <>
          <div className="kb-prog"><i style={{ width: `${(run.done / run.evals) * 100}%` }} /><span>вариантов {run.done} из {run.evals}</span></div>
          {run.history.length > 1 && <LineChart height={180} unit="мерило" yLabel="Мерило лучшего варианта по ходу подбора" xFmt={(x) => String(+x)}
            series={[{ name: 'лучший вариант', points: run.history.map((h) => ({ x: String(h.i).padStart(4, '0'), y: +h.best.toFixed(2) })) }]} />}
          {b && <table className="mdl-tbl"><thead><tr><th>Мерило</th><th>исходные</th><th>лучший вариант</th></tr></thead><tbody>
            <tr><td>Итог (обучение + 3 × события)</td><td>{run.before.total}</td><td><b>{b.s.total}</b></td></tr>
            <tr><td>Отклонение положений, обучение, км</td><td>{run.before.train}</td><td><b>{b.s.train}</b></td></tr>
            <tr><td>Отклонение положений, проверка, км</td><td>{run.before.test}</td><td className={b.s.test > run.before.test ? 'worse' : 'better'}><b>{b.s.test}</b></td></tr>
            <tr><td>Ошибка дат событий, сут</td><td>{run.before.events}</td><td><b>{b.s.events}</b></td></tr>
            <tr><td>Положений в пределах 10 км</td><td>{pct(run.before.within)}</td><td><b>{pct(b.s.within)}</b></td></tr>
          </tbody></table>}
          {run.moved.length > 0 && <p className="muted small">Исходные множители вне коридоров нормативов базы — подбор начат от края коридора: {run.moved.map((k) => `${CALIB_INFO[k].title} ${p0Text(run, k)}`).join('; ')}.</p>}
          {b && <table className="mdl-tbl rb-keys"><thead><tr><th>Множитель</th><th>коридор</th><th>основа</th><th>исходный → лучший</th></tr></thead><tbody>
            {corridorReport(b.p, run.corridors, keys).map((r) => <tr key={r.key} className={r.edge ? 'rb-edge' : ''}>
              <td title={CALIB_INFO[r.key].hint}>{r.title}</td>
              <td className="num">{r.range[0].toFixed(2)}–{r.range[1].toFixed(2)}{r.wider && <small className="rb-wide" title="коридор источника шире прежних границ подбора"> шире прежних</small>}</td>
              <td>{r.reliability ? <><i className={`kb-rel r${r.reliability}`}>{r.reliability}</i>{srcOf(run.corridors?.[r.key])}</> : <span className="muted"><i className="bs-asm">доп.</i> прежние границы</span>}</td>
              <td className={`num${Math.abs(b.p[r.key] - run.start[r.key]) > 1e-3 ? ' ch' : ''}`}>{run.start[r.key].toFixed(2)} → <b>{b.p[r.key].toFixed(2)}</b>
                {r.edge && <span className="rb-edge-mark" title="итог в пределах 2 % ширины коридора от края"> упирается в {r.edge === 'low' ? 'нижнюю' : 'верхнюю'} границу — проверьте источник</span>}</td>
            </tr>)}
          </tbody></table>}
          {b && b.s.test > run.before.test && <p className="warn">Проверка (вторая половина операции) стала хуже исходной — похоже на подгонку под первую половину. Сократите число подбираемых множителей или увеличьте прогонов на вариант.</p>}
          {run.finished && b && b.s.total < run.before.total && <div className="row">
            <input className="grow" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название набора" />
            <button className="primary" disabled={!!savedId} onClick={() => void save()}>{savedId ? 'Сохранено' : 'Сохранить как свой набор'}</button>
            {savedId && <button onClick={() => onCompare(run.scenario, [run.baseId, savedId])}>Сравнить с исходными →</button>}
          </div>}
          {run.finished && b && b.s.total >= run.before.total && <p className="muted">Лучше исходных найти не удалось — попробуйте больше вариантов или другой набор множителей.</p>}
        </>}
      </section>}
    </div>
  );
}

/** Перенесённый множитель: из набора → край коридора. */
const p0Text = (run: { start: CalibParams; corridors?: Partial<Record<CalibKey, CalibCorridor>> }, k: CalibKey) => {
  const c = run.corridors?.[k]?.range;
  return c ? `→ ${run.start[k].toFixed(2)} (коридор ${c[0].toFixed(2)}–${c[1].toFixed(2)})` : `→ ${run.start[k].toFixed(2)}`;
};

/** Коридор множителя у флажка: границы, надёжность и источник (или «доп.» — прежние границы). */
function Corr({ c, k, src }: { c?: CalibCorridor; k: CalibKey; src: string }) {
  if (!c) return null;
  const r = `${+c.range[0].toPrecision(3)}–${+c.range[1].toPrecision(3)}`.replace(/\./g, ',');
  return <small className="rb-corr" title={c.reliability ? `коридор из норматива базы знаний: ${src}${c.wider ? ' (шире прежних границ)' : ''}` : `норматива нет — прежние границы «${CALIB_INFO[k].title}»`}>
    {r}{c.reliability ? <i className={`kb-rel r${c.reliability}`}>{c.reliability}</i> : <i className="bs-asm">доп.</i>}</small>;
}
