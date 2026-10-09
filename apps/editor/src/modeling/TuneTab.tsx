/**
 * «Настройка»: свой вариант правил поверх любого набора — множители (те же, что подбирает калибровка) и прямые
 * параметры (соприкосновение, разброс, окружение, реки, усталость, снабжение). Проверка на операции: было —
 * стало, по тем же мерилам, что в сравнении. Сохраняется как свой набор — появляется в переигровке и сравнении.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { baseParams, CALIB_INFO, CALIB_KEYS, CALIB_SPACE, diffRules, mergeEvaluations, rulesWith, type CalibParams, type Rules, type RulesEvaluation } from '@def-ops/sim';
import { saveRules } from '../sim/userdata';
import { getPool, pct, type SimData } from './data';

const DIRECT: { key: string; title: string; hint: string; min: number; max: number; step: number; get: (r: Rules) => number; set: (r: Rules, v: number) => Rules }[] = [
  { key: 'contactKm', title: 'Соприкосновение, км', hint: 'ближе — бой', min: 0.5, max: 15, step: 0.5, get: (r) => r.contactKm, set: (r, v) => ({ ...r, contactKm: v }) },
  { key: 'noise', title: 'Разброс исхода боя', hint: 'σ случайного множителя к соотношению сил', min: 0, max: 0.6, step: 0.02, get: (r) => r.noise, set: (r, v) => ({ ...r, noise: v }) },
  { key: 'prepareHours', title: 'Подготовка обороны, ч', hint: 'через сколько часов на месте оборона «подготовлена»', min: 0, max: 72, step: 2, get: (r) => r.defense.prepareHours, set: (r, v) => ({ ...r, defense: { ...r.defense, prepareHours: v } }) },
  { key: 'encircleHours', title: 'Окружение, ч без подвоза', hint: 'после этого формирование считается окружённым', min: 6, max: 96, step: 2, get: (r) => r.encircleHours ?? 36, set: (r, v) => ({ ...r, encircleHours: v }) },
  { key: 'heightBonus', title: 'Превышение (доля за 50 м)', hint: 'оборона выше наступающих сильнее, ниже — слабее (сетка высот театра; 0 — не учитывать, предел ±30 %)', min: 0, max: 0.2, step: 0.01, get: (r) => r.heightAdvantage?.bonus ?? 0, set: (r, v) => ({ ...r, heightAdvantage: v > 0 ? { perM: 50, max: 0.3, ...r.heightAdvantage, bonus: v } : undefined }) },
  { key: 'routeVariety', title: 'Разброс выбора пути', hint: 'одни идут дорогой, другие лесом или полем напрямик (на время движения не влияет); 0 — всегда самый быстрый путь', min: 0, max: 0.5, step: 0.05, get: (r) => r.routeVariety ?? 0, set: (r, v) => ({ ...r, routeVariety: v }) },
  { key: 'riverCrossHours', title: 'Река без моста, ч', hint: 'задержка пехоты; техника — только по мостам', min: 0, max: 48, step: 1, get: (r) => r.riverCrossHours, set: (r, v) => ({ ...r, riverCrossHours: v }) },
  { key: 'fatigueEffect', title: 'Влияние усталости', hint: 'доля силы, теряемая при полной усталости', min: 0, max: 0.8, step: 0.05, get: (r) => r.fatigueEffect, set: (r, v) => ({ ...r, fatigueEffect: v }) },
  { key: 'ammoShort', title: 'Нехватка боеприпасов', hint: 'множитель силы при запасе < 0,5 бк', min: 0.2, max: 1, step: 0.05, get: (r) => r.ammoShort, set: (r, v) => ({ ...r, ammoShort: v }) },
  { key: 'fuelOut', title: 'Без горючего', hint: 'множитель силы техники без горючего', min: 0.1, max: 1, step: 0.05, get: (r) => r.fuelOut, set: (r, v) => ({ ...r, fuelOut: v }) },
];

export function TuneTab({ d, preset }: { d: SimData; preset: string | null }) {
  const [baseId, setBaseId] = useState(preset ?? 'ww2-berlin-cal');
  const base = d.rules.find((r) => r.id === baseId);
  const [p, setP] = useState<CalibParams | null>(null);
  const [direct, setDirect] = useState<Record<string, number>>({});
  const [scenario, setScenario] = useState(d.catalog[0]?.id ?? '');
  const [check, setCheck] = useState<{ before?: RulesEvaluation; after?: RulesEvaluation; busy?: boolean; error?: string }>({});
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [bind, setBind] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => { if (preset) setBaseId(preset); }, [preset]);
  const justSaved = useRef<string | null>(null);
  useEffect(() => {
    if (!base) return;
    setP(baseParams(base.rules)); setDirect({}); setCheck({});
    if (justSaved.current !== base.id) setSaved(null);
    justSaved.current = null;
    setTitle(base.user ? base.title : `${base.title} — мой вариант`); setNote(base.saved?.note ?? '');
    if (base.saved?.scenario) setScenario(base.saved.scenario);
  }, [baseId, base?.rules]); // eslint-disable-line react-hooks/exhaustive-deps

  const edited = useMemo(() => {
    if (!base || !p) return null;
    let r = rulesWith(base.rules, p);
    for (const f of DIRECT) if (direct[f.key] != null) r = f.set(r, direct[f.key]);
    return r;
  }, [base, p, direct]);
  const diff = useMemo(() => (base && edited ? diffRules(base.rules, edited) : []), [base, edited]);
  const p0 = base ? baseParams(base.rules) : null;
  const entry = d.catalog.find((c) => c.id === scenario);

  const runCheck = async () => {
    if (!base || !edited) return;
    setCheck({ busy: true });
    const pool = getPool();
    const seeds = 3;
    const go = (rules: string | Rules) => Promise.all(Array.from({ length: seeds }, (_, k) => pool.run({ scenario, rules, seeds: 1, seed0: 101 + k, toleranceKm: entry?.toleranceKm }))).then(mergeEvaluations);
    try { const [before, after] = await Promise.all([go(base.id), go(edited)]); setCheck({ before, after }); }
    catch (e) { setCheck({ error: (e as Error).message }); }
  };
  const save = async (overwrite: boolean) => {
    if (!base || !edited || !title.trim()) return;
    const id = overwrite && base.user ? base.id : `user-${Date.now().toString(36)}`;
    await saveRules({ id, title: title.trim(), note: note.trim() || undefined, base: base.saved?.base ?? base.id, scenario: bind ? scenario : undefined, created: new Date().toISOString(),
      rules: { ...edited, id, _status: note.trim() || `свой вариант поверх «${base.title}»` } as Rules });
    justSaved.current = id; setSaved(id); setBaseId(id);
  };
  if (!base || !p || !p0) return <div className="mdl-page"><p className="muted">Загрузка наборов правил…</p></div>;
  const cmp = (a: number, b: number, lower = true) => (Math.abs(a - b) < 1e-9 ? '' : (lower ? b < a : b > a) ? 'better' : 'worse');
  return (
    <div className="mdl-page">
      <section className="mdl-card mdl-form">
        <label>Взять за основу <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>{d.rules.map((r) => <option key={r.id} value={r.id}>{r.title}{r.user ? ' · свой' : ''}</option>)}</select></label>
        <p className="muted">Измените множители и параметры, проверьте на операции и сохраните своим набором — он появится в «Переигровке» (для выбранной операции или для всех) и в сравнении. Встроенные наборы не меняются.</p>
      </section>
      <div className="mdl-cols">
        <section className="mdl-card mdl-form">
          <h4>Множители (как в калибровке)</h4>
          {CALIB_KEYS.filter((k) => !(k.startsWith('terr') && !base.rules.territory)).map((k) => {
            const [lo, hi] = CALIB_SPACE[k];
            return <label key={k} className={`mdl-slider${Math.abs(p[k] - p0[k]) > 1e-6 ? ' changed' : ''}`} title={CALIB_INFO[k].hint}>
              <span>{CALIB_INFO[k].title}<small>{CALIB_INFO[k].hint}</small></span>
              <input type="range" min={lo} max={hi} step={(hi - lo) / 100} value={p[k]} onChange={(e) => setP({ ...p, [k]: +e.target.value })} />
              <b>{p[k].toFixed(2)}{CALIB_INFO[k].unit && CALIB_INFO[k].unit !== '×' && CALIB_INFO[k].unit !== '+' && CALIB_INFO[k].unit !== '^' ? ` ${CALIB_INFO[k].unit}` : ''}</b>
              {Math.abs(p[k] - p0[k]) > 1e-6 && <button className="link" onClick={() => setP({ ...p, [k]: p0[k] })} title="как в основе">↺</button>}
            </label>;
          })}
          <h4>Параметры</h4>
          {DIRECT.map((f) => { const v = direct[f.key] ?? f.get(base.rules); const ch = direct[f.key] != null && direct[f.key] !== f.get(base.rules);
            return <label key={f.key} className={`mdl-slider${ch ? ' changed' : ''}`}><span>{f.title}<small>{f.hint}</small></span>
              <input type="range" min={f.min} max={f.max} step={f.step} value={v} onChange={(e) => setDirect({ ...direct, [f.key]: +e.target.value })} />
              <b>{+v.toFixed(2)}</b>{ch && <button className="link" onClick={() => { const n = { ...direct }; delete n[f.key]; setDirect(n); }}>↺</button>}</label>; })}
        </section>
        <section className="mdl-card mdl-form">
          <h4>Изменения ({diff.length})</h4>
          {diff.length ? <table className="mdl-tbl"><tbody>{diff.map((r) => <tr key={r.key}><td>{r.title}</td><td className="muted">{r.a}</td><td>→ <b>{r.b}</b></td></tr>)}</tbody></table> : <p className="muted">Пока как в основе.</p>}
          <h4>Проверка на операции</h4>
          <div className="row"><select value={scenario} onChange={(e) => { setScenario(e.target.value); setCheck({}); }}>{d.catalog.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
            <button disabled={check.busy || !diff.length} onClick={() => void runCheck()}>{check.busy ? <><span className="spinner" /> 2 × 3 прогона…</> : 'Проверить: было — стало'}</button></div>
          {check.error && <div className="err">{check.error}</div>}
          {check.before && check.after && <table className="mdl-tbl"><thead><tr><th /><th>основа</th><th>мой вариант</th></tr></thead><tbody>
            <tr><td>В допуске</td><td>{pct(check.before.within)}</td><td className={cmp(check.before.within, check.after.within, false)}><b>{pct(check.after.within)}</b></td></tr>
            <tr><td>Медиана превышения, км</td><td>{check.before.medianExcessKm}</td><td className={cmp(check.before.medianExcessKm, check.after.medianExcessKm)}><b>{check.after.medianExcessKm}</b></td></tr>
            <tr><td>Обучение / проверка, км</td><td>{check.before.score.train} / {check.before.score.test}</td><td className={cmp(check.before.score.train + check.before.score.test, check.after.score.train + check.after.score.test)}><b>{check.after.score.train} / {check.after.score.test}</b></td></tr>
            <tr><td>Ошибка дат событий, сут</td><td>{check.before.score.events}</td><td className={cmp(check.before.score.events, check.after.score.events)}><b>{check.after.score.events}</b></td></tr>
          </tbody></table>}
          <h4>Сохранить</h4>
          <label>Название <input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>Пояснение <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="что и почему изменено" /></label>
          <label className="row"><input type="checkbox" checked={bind} onChange={(e) => setBind(e.target.checked)} /> только для операции «{entry?.title.split(',')[0]}» (иначе — для всех)</label>
          <div className="row">
            <button className="primary" disabled={!title.trim() || (!diff.length && !base.user)} onClick={() => void save(false)}>Сохранить как новый набор</button>
            {base.user && <button disabled={!title.trim()} onClick={() => void save(true)}>Перезаписать «{base.title}»</button>}
          </div>
          {saved && <p className="ok">Сохранено: набор доступен в «Переигровке» и сравнении.</p>}
        </section>
      </div>
    </div>
  );
}
