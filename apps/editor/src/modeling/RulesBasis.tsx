/**
 * «Основа правил» набора («Модели» → набор правил): на чём держится каждое число правил и профилей — норматив базы
 * знаний (источник, страницы, надёжность, цитата) или допущение. Итог — доли входов на A/B/C и допущениях, отдельно —
 * подбираемые калибровкой; множители калибровки с коридором и «упирается в границу»; входы по группам (у
 * откалиброванного — исходное значение и множитель); расхождения нормативов с закреплением; нормативы-итоги по
 * операциям с результатом последней проверки (прогон набора на операции, хранится в этом браузере).
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { normRowOf, pinKey, pinOf, subjectOf, type CompiledRules, type FactRef, type Pins } from '@def-ops/knowledge';
import { CALIB_INFO, ruleInputRefs, type CalibKey, type CalibCorridor, type OutcomeItem, type Rules, type SideProfile } from '@def-ops/sim';
import * as kb from '../kb/kb';
import { basisOf, baseRulesId, outcomeNorms } from '../sim/kb-rules';
import { getData, onDataChange } from '../sim/userdata';
import { openKbEntry } from './BasisTab';
import { claimText, type Rel } from './basis';
import { conflictTitle, relShare, rulesBasisSummary, type RelTally, type RulesBasisRow } from './rules-basis';
import { getPool, pct, type RulesItem, type SimData } from './data';
import { KB_WAIT, kbBuilding, kbReady } from '../sim/kb-recompile';
import type { KbStamp } from '../sim/kb-stamp';
import { KbStampNote } from '../KbStampNote';

const REL_RU: Record<Rel, string> = { A: 'A — справочник, устав, исследование', B: 'B — надёжный вторичный', C: 'C — оценка', assumption: 'допущение (без источника)' };
const RELS = ['A', 'B', 'C', 'assumption'] as const;
/** Исходное значение и множитель: подобранное значение (→), множитель (×), степень (^). */
const MODE_SIGN = { set: '→', scale: '×', power: '^', movement: '×' } as const;
const n3 = (x: number | null | undefined) => (x == null ? '—' : String(+x.toPrecision(3)).replace('.', ','));
const whenRu = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const rangeText = (r: [number, number]) => `${n3(r[0])}–${n3(r[1])}`;
const same = (a: { entry: string; index: number }, b: { entry: string; index: number }) => a.entry === b.entry && a.index === b.index;
/** Ключ закрепления факта-норматива: значение правила — без даты, итог — на конец периода. */
const pinKeyOf = (f: FactRef) => { const c = f.fact.claim!; return pinKey(c.kind, subjectOf(c), c.kind === 'outcome' ? c.to : ''); };

/** Последняя проверка итогов набора на операции — в этом браузере. */
interface OutcomeCheck { at: string; n: number; within: number; items: OutcomeItem[]; kb?: KbStamp | null }
/** Отпечаток набора правил (FNV-1a по JSON): изменился набор с тем же id — прежняя проверка к нему не относится. */
function rulesHash(r: Rules): string {
  const t = JSON.stringify(r);
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
const checkKey = (rules: string, hash: string, op: string) => `def_ops.rules-check.${rules}.${hash}.${op}`;
function readCheck(rules: string, hash: string, op: string): OutcomeCheck | null {
  try { const s = localStorage.getItem(checkKey(rules, hash, op)); return s ? (JSON.parse(s) as OutcomeCheck) : null; } catch { return null; }
}
function writeCheck(rules: string, hash: string, op: string, c: OutcomeCheck) { try { localStorage.setItem(checkKey(rules, hash, op), JSON.stringify(c)); } catch { /* */ } }
/** Ключ норматива-итога — как id строки норматива в мериле (outcomeNorms): строка norms.json или запись#номер. */
const outcomeId = (f: FactRef) => normRowOf(f.fact)?.id ?? `${f.entry}#${f.index}`;

const RelMark = ({ r }: { r: Rel }) => r === 'assumption' ? <i className="bs-asm" title="допущение — в базе нет норматива с источником">доп.</i> : <i className={`kb-rel r${r}`} title={REL_RU[r]}>{r}</i>;

function SumRow({ title, t, hint }: { title: string; t: RelTally; hint?: string }) {
  const share = relShare(t);
  return <div className="bs-sum-row" title={hint}>
    <span>{title}</span>
    <div className="bs-bar" title={RELS.map((x) => `${REL_RU[x]}: ${t[x]}`).join('\n')}>
      {t.total ? RELS.map((x) => t[x] ? <i key={x} className={`b${x}`} style={{ width: `${(t[x] / t.total) * 100}%` }} /> : null) : null}</div>
    <small>{share == null ? 'нет входов' : `${share} % входов на нормативах · A ${t.A}, B ${t.B}, C ${t.C}, доп. ${t.assumption} из ${t.total}`}</small>
  </div>;
}

export function RulesBasis({ item, d }: { item: RulesItem; d: SimData }) {
  const [basis, setBasis] = useState<CompiledRules | null | undefined>(undefined);
  const [baseValues, setBaseValues] = useState<Record<string, number | null> | undefined>(undefined);
  const [pins, setPinsState] = useState<Pins>({});
  const [s, setS] = useState<kb.KbState>(kb.current());
  const [open, setOpen] = useState<string | null>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [waitKb, setWaitKb] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, OutcomeCheck | null>>({});
  const from = baseRulesId(item.rules);
  const baseRules = from ? d.rules.find((r) => r.id === from)?.rules : undefined;
  const calibration = (item.rules as Rules & { calibration?: { multipliers?: Partial<Record<CalibKey, number>>; corridors?: Partial<Record<CalibKey, CalibCorridor>>; scenario?: string; outcomes?: { before?: { n: number; within: number }; after?: { n: number; within: number } } } }).calibration;

  useEffect(() => { void kb.load(); return kb.subscribe(setS); }, []);
  // номер сборки: пересборки на изменения базы перекрываются — применяется только последняя начатая
  const runNo = useRef(0);
  useEffect(() => {
    let alive = true;
    const run = () => {
      const no = ++runNo.current;
      const live = () => alive && no === runNo.current;
      void Promise.all([basisOf(item.rules, baseRules ?? item.rules), kb.getPins()]).then(([b, p]) => { if (live()) { setBasis(b); setPinsState(p); } })
        .catch((e) => { if (live()) { setBasis(null); setErr(`Основа правил не собрана: ${(e as Error).message}`); } });
      if (baseRules) {
        const profiles: Record<string, SideProfile> = Object.fromEntries(d.profiles.map((p) => [p.id, p]));
        void getData('rules', 'agents-v0.json').then((agents) => {
          if (live()) setBaseValues(Object.fromEntries(ruleInputRefs(baseRules, profiles, agents).map((r) => [r.path, r.value])));
        }).catch(() => {});
      } else setBaseValues(undefined);
    };
    run();
    const off = onDataChange(run);
    window.addEventListener(kb.KB_CHANGED, run);
    return () => { alive = false; off(); window.removeEventListener(kb.KB_CHANGED, run); };
  }, [item.id, item.rules, baseRules, d.profiles]);

  const sum = useMemo(() => basis ? rulesBasisSummary(basis, calibration?.multipliers ? { baseValues, baseMovementScale: baseRules?.movementScale ?? 1, multipliers: calibration.multipliers, fitted: calibration.corridors } : {}) : null,
    [basis, baseValues, calibration, baseRules]);
  const hash = useMemo(() => rulesHash(item.rules), [item.rules]);
  useEffect(() => {
    if (sum) setChecks(Object.fromEntries(sum.outcomes.map((o) => [o.scenario, readCheck(item.id, hash, o.scenario)])));
  }, [sum, item.id, hash]);

  if (basis === undefined) return <section className="mdl-card"><h4>Основа правил</h4><p className="muted"><span className="spinner" /> сборка из базы знаний…</p></section>;
  if (!basis || !sum) return <section className="mdl-card"><h4>Основа правил</h4>{err && <div className="err">{err}</div>}</section>;

  const docName = (id: string) => s.documents.find((x) => x.id === id)?.name ?? id;
  const srcTitle = (id?: string) => (id ? s.byId.get(id)?.title ?? (id.startsWith('doc:') ? docName(id.slice(4)) : id) : '');
  const opName = (id: string) => d.catalog.find((c) => c.id === id)?.title.split(',')[0];
  const opTitle = (id: string) => opName(id) ?? id;
  const doPin = async (key: string, f: FactRef | null) => {
    setBusy(key); setErr(null);
    try { await kb.setPins({ [key]: f ? pinOf(f) : null }); setPinsState(await kb.getPins()); }
    catch (e) { setErr(`Закрепление не удалось: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };
  const check = async (op: string) => {
    setBusy(`check:${op}`); setErr(null);
    try {
      // данные операции — после сборки из базы знаний
      setWaitKb(kbBuilding());
      const kbs = await kbReady(op);
      setWaitKb(false);
      const outcomes = outcomeNorms(basis, op);
      const ev = await getPool().run({ scenario: op, rules: item.id, seeds: 1, seed0: 101, outcomes });
      const o = ev.score.outcomes;
      const c: OutcomeCheck = { at: new Date().toISOString(), n: o?.n ?? 0, within: o?.within ?? 0, items: o?.items ?? [], kb: kbs };
      writeCheck(item.id, hash, op, c);
      setChecks((x) => ({ ...x, [op]: c }));
    } catch (e) { setErr(`Проверка не удалась: ${(e as Error).message}`); }
    finally { setBusy(null); setWaitKb(false); }
  };

  /** Факт-норматив: формальная часть, надёжность, источник со страницами, цитата, переход к записи. */
  const factView = (f: FactRef) => <div className="bs-fact">
    <div><RelMark r={(f.fact.reliability ?? 'assumption') as Rel} />{f.fact.claim ? claimText(f.fact.claim, undefined, opName) : f.fact.value}</div>
    <div className="muted small">{f.fact.source ? <>источник: {srcTitle(f.fact.source)}{f.fact.pages ? `, ${f.fact.pages}` : ''}</>
        : f.fact.norm?.src ? <>источник: {f.fact.norm.src}</> : f.fact.reliability ? 'источник не указан' : 'источник не указан — допущение'}
      {' · '}<button className="link" onClick={() => openKbEntry(f.entry)}>запись «{s.byId.get(f.entry)?.title ?? f.entry}» →</button></div>
    {f.fact.quote && <div className="kb-quote">«{f.fact.quote}»</div>}
  </div>;

  const calibrated = !!calibration?.multipliers;
  const row = (r: RulesBasisRow) => {
    const on = open === r.path;
    return <Fragment key={r.path}>
      <tr className={`rb-row${on ? ' on' : ''}`} onClick={() => setOpen(on ? null : r.path)} title={r.path}>
        <td>{r.title}{r.table && <small className="muted"> · таблица</small>}</td>
        <td className="num"><b>{n3(r.value)}</b> <small>{r.unit ?? ''}</small></td>
        <td><RelMark r={r.reliability} /></td>
        <td className="num">{r.corridor ? rangeText(r.corridor) : <span className="muted">—</span>}</td>
        {calibrated && <td className="num">{r.multiplier != null ? <>{n3(r.base)} <small title={r.mode === 'movement' ? 'значение профиля × масштаб марша набора' : undefined}>{MODE_SIGN[r.mode ?? 'scale']} {n3(r.multiplier)}</small></> : ''}</td>}
      </tr>
      {on && <tr className="rb-detail"><td colSpan={calibrated ? 5 : 4}><div className="bs-detail">
        {r.mult && <div className="muted small">{r.calib ? 'подбирается калибровкой' : 'меняется калибровкой'}: «{CALIB_INFO[r.mult].title}»{!r.calib && ' (коридор множителя задаёт наибольший темп)'}</div>}
        {r.fact ? factView(r.fact) : <p className="muted">Допущение: в базе нет норматива с источником на этот вход — значение задано в наборе правил{r.calib ? ', калибровка подбирает множитель в прежних границах' : ''}. Добавьте факт «значение правила» с источником в запись базы — модель возьмёт его коридор.</p>}
        {r.multiplier != null && r.mult && <div className="small">У откалиброванного набора: {r.mode === 'movement' ? <>значение профиля {n3(r.base)} {r.unit ?? ''} × масштаб марша «{CALIB_INFO[r.mult].title}» {n3(r.multiplier)}</>
          : r.mode === 'set' ? <>исходное значение {n3(r.base)} {r.unit ?? ''}; калибровка подобрала значение «{CALIB_INFO[r.mult].title}» {n3(r.multiplier)}</>
          : <>исходное значение {n3(r.base)} {r.unit ?? ''}; {r.mode === 'power' ? 'степень' : 'множитель'} «{CALIB_INFO[r.mult].title}» {n3(r.multiplier)}</>} → {n3(r.value)} {r.unit ?? ''}.</div>}
      </div></td></tr>}
    </Fragment>;
  };
  const tableOf = (rows: RulesBasisRow[]) => <table className="mdl-tbl rb-tbl"><thead><tr><th>Вход</th><th>значение</th><th>надёжн.</th><th>коридор норматива</th>{calibrated && <th title="→ — калибровка подобрала само значение, × — множитель к исходному (у марша — к значению профиля), ^ — степень к поправке местности">исходное, калибровка</th>}</tr></thead>
    <tbody>{rows.map(row)}</tbody></table>;

  const armyGroups = sum.groups.filter((g) => g.group !== 'агентная модель');
  const agentGroup = sum.groups.find((g) => g.group === 'агентная модель');
  const edgeKeys = sum.keys.filter((k) => k.edge);
  const outKeys = sum.keys.filter((k) => k.outside);

  return <section className="mdl-card bs rb">
    <div className="sync-h"><h4>Основа правил</h4><span className="muted">входов {sum.total.total}{from ? ` · коридоры — относительно исходного набора «${d.rules.find((r) => r.id === from)?.title ?? from}»` : ''}</span></div>
    {err && <div className="err" onClick={() => setErr(null)}>{err}</div>}
    <p className="muted small">На чём держится каждое число правил и профилей: норматив базы знаний (источник, надёжность, цитата) или допущение. Норматив задаёт коридор — значение источника с допуском по надёжности (A ±10 %, B ±20 %, C ±35 %); калибровка подбирает множители внутри коридоров. Щелчок по входу — источник.</p>
    <div className="bs-sum">
      <h5>Итог</h5>
      <SumRow title="входы правил и профилей" t={sum.total} />
      <SumRow title="из них подбираемые калибровкой" t={sum.calib} hint="входы, по которым норматив задаёт коридор множителя калибровки" />
      {sum.agents.total > 0 && <SumRow title="агентная модель (общая)" t={sum.agents} hint="параметры агентной модели — общие для всех наборов, в итог набора не входят" />}
      <div className="bs-legend">{RELS.map((x) => <span key={x}><i className={`b${x}`} />{REL_RU[x]}</span>)}</div>
    </div>

    <h5 className="rb-h">Множители калибровки</h5>
    <table className="mdl-tbl rb-keys"><thead><tr><th>Множитель</th><th>коридор</th><th>основа</th>{calibrated && <th>в наборе</th>}</tr></thead><tbody>
      {sum.keys.map((k) => <tr key={k.key} className={k.outside ? 'rb-out-row' : k.edge ? 'rb-edge' : ''}>
        <td title={CALIB_INFO[k.key].hint}>{k.title}</td>
        <td className="num">{rangeText(k.range)} <small>{k.unit ?? ''}</small>{k.fitted && <small className="muted" title="коридор, по которому подбирался набор (записан в наборе)"> · при подборе</small>}</td>
        <td>{k.fact ? <><RelMark r={(k.fact.fact.reliability ?? 'assumption') as Rel} /><button className="link" onClick={() => openKbEntry(k.fact!.entry)}>{srcTitle(k.fact.fact.source) || s.byId.get(k.fact.entry)?.title || k.fact.entry}</button>
          {k.wider && <small className="rb-wide" title="коридор источника шире прежних границ подбора — берётся коридор источника"> шире прежних границ</small>}
          {k.tableMissing && <small className="muted" title="норматив есть, но пересчитать его в множитель нельзя — прежние границы"> не пересчитывается</small>}</>
          : <span className="muted"><i className="bs-asm">доп.</i> прежние границы</span>}</td>
        {calibrated && <td className="num">{k.multiplier != null ? <b>{n3(k.multiplier)}</b> : '—'}{k.edge && <span className="rb-edge-mark" title="множитель в пределах 2 % ширины коридора от края — проверьте источник"> упирается в {k.edge === 'low' ? 'нижнюю' : 'верхнюю'} границу</span>}
          {k.outside && <span className="rb-outside-mark" title={k.fitted ? 'множитель за пределами коридора, по которому подбирался набор' : 'набор подбирался не по этому коридору: коридор — нынешний из базы знаний'}> вне коридора ({k.outside === 'low' ? 'ниже' : 'выше'})</span>}</td>}
      </tr>)}
    </tbody></table>
    {outKeys.length > 0 && <p className="warn small">Вне коридора нормативов базы: {outKeys.map((k) => k.title).join(', ')} — набор подбирался в других границах; перекалибруйте его или проверьте норматив.</p>}
    {edgeKeys.length > 0 && <p className="warn small">Упирается в границу коридора: {edgeKeys.map((k) => k.title).join(', ')} — проверьте источник: возможно, норматив слишком узок или модели не хватает другого механизма.</p>}

    <h5 className="rb-h">Входы по группам</h5>
    {armyGroups.map((g) => <div key={g.group} className="rb-group"><h6>{g.group}</h6>{tableOf(g.rows)}</div>)}
    {agentGroup && <div className="rb-group">
      <h6><button className="link" onClick={() => setAgentsOpen((x) => !x)}>{agentsOpen ? '▾' : '▸'} агентная модель</button> <small className="muted">параметры агентной модели — общие для всех наборов</small></h6>
      {agentsOpen && tableOf(agentGroup.rows)}
    </div>}

    <h5 className="rb-h">Расхождения нормативов: {basis.conflicts.length}</h5>
    {!basis.conflicts.length && <p className="ok small">Нормативы на один вход не расходятся.</p>}
    {basis.conflicts.length > 0 && <div className="bs-list">
      <p className="muted small">Несколько нормативов с непересекающимися коридорами: модель берёт лучший по надёжности и свежести; закрепите нужный — основа правил пересоберётся. Норматив с пометкой «не берётся» отброшен сборщиком — исправьте его в базе.</p>
      {basis.conflicts.map((c, ci) => {
        if (c.why) return <div key={`${c.path}:${ci}`} className="bs-conf">
          <div className="bs-conf-h"><b title={c.path}>{conflictTitle(c.path, opName)}</b></div>
          <p className="warn small">{c.why}</p>
          {c.facts.map((f) => <div key={`${f.entry}#${f.index}`} className="bs-cand"><span className="bs-mark" />{factView(f)}</div>)}
        </div>;
        const chosen = sum.groups.flatMap((g) => g.rows).find((r) => r.path === c.path)?.fact ?? sum.keys.find((k) => k.key === c.path)?.fact ?? basis.outcomes.find((o) => c.facts.some((f) => same(f, o.fact)))?.fact ?? null;
        return <div key={`${c.path}:${ci}`} className="bs-conf">
          <div className="bs-conf-h"><b title={c.path}>{conflictTitle(c.path, opName)}</b>{c.pinned && <span className="bs-pin">закреплено</span>}</div>
          {c.facts.map((f) => {
            const key = pinKeyOf(f), pin = pins[key];
            const pinned = !!pin && pin !== 'none' && same(pin, f);
            const isChosen = !!chosen && same(chosen, f);
            return <div key={`${f.entry}#${f.index}`} className={`bs-cand${isChosen ? ' on' : ''}`}>
              <span className="bs-mark">{isChosen ? '✓ в модели' : ''}</span>
              {factView(f)}
              {pinned ? <button disabled={busy === key} onClick={() => void doPin(key, null)}>Снять закрепление</button>
                : <button disabled={busy === key} onClick={() => void doPin(key, f)}>Закрепить этот</button>}
            </div>;
          })}
        </div>;
      })}
    </div>}

    <h5 className="rb-h">Нормативы-итоги</h5>
    {!sum.outcomes.length && <p className="muted small">В базе нет нормативов-итогов.</p>}
    {calibration?.outcomes && <p className="small">При калибровке по «{opTitle(calibration.scenario ?? '')}» итогов в допуске: {calibration.outcomes.before ? pct(calibration.outcomes.before.within) : '—'} → <b>{calibration.outcomes.after ? pct(calibration.outcomes.after.within) : '—'}</b>.</p>}
    {sum.outcomes.map((o) => {
      const ch = checks[o.scenario];
      const inCatalog = d.catalog.some((c) => c.id === o.scenario);
      return <div key={o.scenario} className="rb-group">
        <h6>{opTitle(o.scenario)} <small className="muted">· {o.items.length} {o.items.length === 1 ? 'итог' : 'итогов'}{ch ? ` · последняя проверка ${whenRu(ch.at)}: в допуске ${ch.n ? pct(ch.within) : '—'}` : ' · не проверялись'}</small>
          {inCatalog && <button className="rb-check" disabled={!!busy} onClick={() => void check(o.scenario)} title="один прогон набора на операции с историческими приказами и замер итогов">{busy === `check:${o.scenario}` ? (waitKb ? KB_WAIT : 'проверяю…') : 'Проверить'}</button>}</h6>
        {ch && <KbStampNote s={ch.kb} />}
        <table className="mdl-tbl rb-out"><thead><tr><th>Итог</th><th>надёжн.</th><th>ожидается</th><th>последняя проверка</th></tr></thead><tbody>
          {o.items.map((x) => {
            const it = ch?.items.find((y) => y.id === outcomeId(x.fact));
            return <tr key={`${x.fact.entry}#${x.fact.index}`}>
              <td title={claimText(x.claim, undefined, opName)}>{x.fact.fact.norm?.title ?? claimText(x.claim, undefined, opName)}{' '}<button className="link small" onClick={() => openKbEntry(x.fact.entry)}>→</button></td>
              <td><RelMark r={(x.fact.fact.reliability ?? 'assumption') as Rel} /></td>
              <td className="num">{rangeText(x.claim.range)} <small>{x.claim.unit}</small></td>
              <td className={`num ${it ? (it.ok ? 'better' : 'worse') : ''}`}>{it ? <><b>{n3(it.mean)}</b> {it.ok ? 'в допуске' : 'вне допуска'}</> : ch ? <span className="muted">не измерен</span> : <span className="muted">—</span>}</td>
            </tr>;
          })}
        </tbody></table>
      </div>;
    })}
  </section>;
}
