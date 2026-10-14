/**
 * «Основа модели» операции: на чём держится каждый вход модели — факт базы (источник, страницы, достоверность,
 * цитата) или допущение сценария. Формирования деревом по подчинённости; расхождения между фактами — закрепить
 * нужный (пересборка через секунду, запись в журнале операции); факты о формированиях, которых в операции нет;
 * итог — доли входов на фактах A, B, C и на допущениях по видам и кем проверены факты (человеком, автоматически,
 * встроенные); у факта — как принят и доказательство; «Задание для агента» — md-файл по пробелам операции.
 */
import { Fragment, useEffect, useMemo, useState, type ReactElement } from 'react';
import { pinOf, type FactRef, type Pins, type Provenance } from '@def-ops/knowledge';
import type { Scenario } from '@def-ops/sim';
import * as kb from '../kb/kb';
import { getData, getEdits, onDataChange, type OperationKb } from '../sim/userdata';
import { agentScenario } from '../sim/kb-recompile';
import { BASIS_KINDS, basisSummary, KIND_RU, claimText, ruDate, splitKey, type Rel, type RelCount } from './basis';
import { downloadAgentTask } from '../kb/agent-task';
import { staleNow } from '../kb/candidates';
import { evidenceRu, factOrigin, ORIGIN_LONG, ORIGIN_RU } from '../kb/fact-form';

/** Открыть запись базы в разделе «Знания». */
export function openKbEntry(id: string) {
  try { localStorage.setItem('def_ops.kb.entry', id); } catch { /* */ }
  window.dispatchEvent(new CustomEvent('def_ops.kb.open', { detail: { id } }));
  location.hash = '#knowledge';
}

interface Node { id: string; name: string; echelon: string; parent: string | null; personnel?: number; tanks?: number; guns?: number; division?: boolean;
  /** Поля читает модель: действующее формирование сценария (с типом) или дивизия агентного сценария; штабы и фронты — нет. */
  input: boolean }
type Field = 'personnel' | 'tanks' | 'guns' | 'parent' | 'enterAt';
const FIELD_RU: Record<Field, string> = { personnel: 'людей', tanks: 'танков', guns: 'орудий', parent: 'подчинён', enterAt: 'ввод' };
const REL_RU: Record<Rel, string> = { A: 'A — справочник, исследование', B: 'B — надёжный вторичный', C: 'C — оценка', assumption: 'допущение сценария' };
const fmtN = (n?: number) => (typeof n === 'number' ? n.toLocaleString('ru-RU') : '—');
const same = (a: { entry: string; index: number }, b: { entry: string; index: number }) => a.entry === b.entry && a.index === b.index;

/** Значок надёжности входа; допущение из-за закрепления «не брать» — своим значком (факты в базе есть). */
const Rel = ({ p }: { p: Provenance }) => p.reliability === 'assumption'
  ? (p.excluded ? <i className="bs-asm" title="допущение сценария — факты в базе есть, но исключены закреплением «не брать»">искл.</i> : <i className="bs-asm" title="допущение сценария — в базе нет факта">доп.</i>)
  : <i className={`kb-rel r${p.reliability}`}>{p.reliability}</i>;

export function BasisTab({ op }: { op: string }) {
  const [kbOf, setKb] = useState<OperationKb | null | undefined>(undefined);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [pins, setPinsState] = useState<Pins>({});
  const [s, setS] = useState<kb.KbState>(kb.current());
  const [part, setPart] = useState<'tree' | 'conflicts' | 'unmatched'>('tree');
  const [pick, setPick] = useState<{ node: string; field: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stale, setStale] = useState<Set<string>>(new Set());

  useEffect(() => { void kb.load(); return kb.subscribe(setS); }, []);
  // исправления, у которых встроенный факт изменился, — «пересмотрите»
  useEffect(() => { let alive = true; void staleNow().then((l) => { if (alive) setStale(new Set(l.map((x) => `${x.entry}#${x.index}`))); }).catch(() => {}); return () => { alive = false; }; }, [s.entries]);
  useEffect(() => {
    let alive = true;
    const run = () => void Promise.all([getEdits(op), getData('scenarios', `${op}.json`) as Promise<Scenario>, agentScenario(op), kb.getPins()]).then(([e, sc, ag]) => {
      if (!alive) return;
      setKb(e.kb ?? null);
      const list: Node[] = sc.formations.map((f) => ({ id: f.id, name: f.name, echelon: f.echelon, parent: f.parent ?? null, personnel: f.personnel, tanks: f.tanks, guns: f.guns, input: !!f.type }));
      if (ag) {
        const have = new Set(list.map((n) => n.id));
        for (const h of ag.hqs) if (!have.has(h.id)) { list.push({ id: h.id, name: h.name, echelon: h.echelon, parent: h.parent ?? null, input: false }); have.add(h.id); }
        for (const d of ag.divisions) if (!have.has(d.id)) list.push({ id: d.id, name: d.name, echelon: 'division', parent: d.hq, personnel: d.personnel, tanks: d.tanks, guns: d.guns, division: true, input: true });
      }
      setNodes(list);
    });
    const pinsNow = () => void kb.getPins().then((p) => { if (alive) setPinsState(p); });
    run(); pinsNow();
    const off = onDataChange(run);
    window.addEventListener(kb.KB_CHANGED, pinsNow);
    return () => { alive = false; off(); window.removeEventListener(kb.KB_CHANGED, pinsNow); };
  }, [op]);

  const byInput = useMemo(() => {
    const m = new Map<string, Provenance[]>();
    for (const p of kbOf?.provenance ?? []) m.set(p.input, [...(m.get(p.input) ?? []), p]);
    return m;
  }, [kbOf]);
  const nameOf = useMemo(() => { const m = new Map(nodes.map((n) => [n.id, n.name])); return (id: string) => m.get(id) ?? id; }, [nodes]);
  const children = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.id));
    const m = new Map<string | null, Node[]>();
    for (const n of nodes) {
      // подчинённость в модели — из сборки, если она её меняет
      const p0 = kbOf?.compiled.formations[n.id]?.parent ?? n.parent;
      const p = p0 && ids.has(p0) ? p0 : null;
      m.set(p, [...(m.get(p) ?? []), n]);
    }
    return m;
  }, [nodes, kbOf]);
  const isInput = useMemo(() => { const m = new Set(nodes.filter((n) => n.input).map((n) => n.id)); return (id: string) => m.has(id); }, [nodes]);

  if (kbOf === undefined) return <section className="mdl-card"><p className="muted"><span className="spinner" /> загрузка…</p></section>;
  if (kbOf === null) return <section className="mdl-card"><h4>Основа модели</h4><p className="muted">Сборки из базы знаний для операции ещё нет: она делается при запуске и при каждом изменении базы. Подождите несколько секунд.</p></section>;

  const sum = basisSummary(kbOf.provenance, isInput);
  const pinAt = (key: string) => pins[key];
  const doPin = async (key: string, f: FactRef | null) => {
    setBusy(key); setErr(null);
    try { await kb.setPins({ [key]: f ? pinOf(f) : null }); setPinsState(await kb.getPins()); }
    catch (e) { setErr(`Закрепление не удалось: ${(e as Error).message}`); }
    finally { setBusy(null); }
  };
  const docName = (id: string) => s.documents.find((d) => d.id === id)?.name ?? id;
  const srcTitle = (id?: string) => (id ? s.byId.get(id)?.title ?? (id.startsWith('doc:') ? docName(id.slice(4)) : s.documents.find((d) => d.id === id)?.name ?? id) : '');
  const agentTask = async () => {
    setBusy('agent'); setErr(null);
    try { await downloadAgentTask(op); } catch (e) { setErr(`Задание не составлено: ${(e as Error).message}`); } finally { setBusy(null); }
  };

  /** Факт: формальная часть, надёжность, источник со страницами, как принят, доказательство (или цитата), переход к записи. */
  const factView = (f: FactRef, key?: string | number) => { const o = factOrigin(f.fact); return <div key={key} className="bs-fact">
    <div><i className={`kb-rel r${f.fact.reliability ?? 'C'}`}>{f.fact.reliability ?? 'C'}</i>{f.fact.claim ? claimText(f.fact.claim, nameOf) : f.fact.value}
      {' '}<i className={`kb-origin o-${o}`} title={ORIGIN_LONG[o]}>{ORIGIN_RU[o]}</i>
      {f.fact.corrects && <i className="kb-origin o-fix" title="факт пользователя вместо встроенного">исправляет встроенный</i>}
      {stale.has(`${f.entry}#${f.index}`) && <i className="kb-origin o-stale" title="встроенный факт, который исправлялся, изменён при обновлении базы">встроенный факт изменился — пересмотрите</i>}</div>
    <div className="muted small">{f.fact.source ? <>источник: {srcTitle(f.fact.source)}{f.fact.pages ? `, ${f.fact.pages}` : ''}</> : f.fact.check ? 'источник не указан — допущение' : 'источник не указан'}
      {' · '}{ORIGIN_LONG[o]}{f.fact.check?.docRolledBack ? ' · документ откачен' : ''}
      {' · '}<button className="link" onClick={() => openKbEntry(f.entry)}>запись «{s.byId.get(f.entry)?.title ?? f.entry}» →</button></div>
    {f.fact.evidence ? <div className="kb-quote">доказательство: {evidenceRu(f.fact.evidence, docName)}</div> : f.fact.quote && <div className="kb-quote">«{f.fact.quote}»</div>}
  </div>; };

  const fieldsOf = (n: Node): { field: Field; value: string; prov: Provenance }[] => {
    const c = kbOf.compiled.formations[n.id] ?? {};
    const out: { field: Field; value: string; prov: Provenance }[] = [];
    for (const k of ['personnel', 'tanks', 'guns', 'parent', 'enterAt'] as Field[]) {
      const p = byInput.get(`${n.id}.${k}`)?.[0];
      if (!p) continue;
      const v = k === 'parent' ? nameOf((p.fact?.fact.claim as { parent?: string } | undefined)?.parent ?? c.parent ?? n.parent ?? '—')
        : k === 'enterAt' ? ruDate(c.enterAt ?? '') : fmtN((c[k] as number | undefined) ?? n[k]);
      out.push({ field: k, value: v, prov: p });
    }
    return out;
  };
  /** Входы формирования по ходу операции: изменения, контрольные точки, положения. */
  const extraOf = (id: string) => {
    const idx = (list: { formation: string }[], pre: string) => list.flatMap((x, i) => (x.formation === id ? [{ input: `${pre}:${i}`, p: byInput.get(`${pre}:${i}`) ?? [] }] : []));
    return [...idx(kbOf.compiled.changes, 'change'), ...idx(kbOf.compiled.checkpoints, 'checkpoint'), ...idx(kbOf.compiled.positions, 'position')];
  };

  // строки дерева — вызовом функции, не компонентом: при щелчке не пересоздаются заново
  const row = (n: Node, depth: number): ReactElement => {
    const kids = children.get(n.id) ?? [];
    const isOpen = depth === 0 ? !open.has(n.id) : open.has(n.id); // корни раскрыты, остальное свёрнуто
    const fields = fieldsOf(n);
    const extra = extraOf(n.id);
    const sel = pick?.node === n.id ? pick.field : null;
    const toggle = () => setOpen((o) => { const x = new Set(o); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; });
    return <Fragment key={n.id}>
      <div className={`bs-row${sel ? ' on' : ''}`}>
        <span className="bs-name" title={n.id} style={{ paddingLeft: depth * 16 }}>
          {kids.length ? <button className="link bs-tg" onClick={toggle}>{isOpen ? '▾' : '▸'}</button> : <span className="bs-tg" />}{n.name}</span>
        <span className="bs-vals">
          {fields.map(({ field, value, prov }) => <button key={field} className={`bs-v${sel === field ? ' on' : ''}`} title={FIELD_RU[field]} onClick={() => setPick(sel === field ? null : { node: n.id, field })}>
            <small>{FIELD_RU[field]}</small> {value} <Rel p={prov} /></button>)}
          {extra.length > 0 && <button className={`bs-v${sel === 'extra' ? ' on' : ''}`} onClick={() => setPick(sel === 'extra' ? null : { node: n.id, field: 'extra' })} title="изменения, контрольные точки, положения по ходу операции"><small>по ходу</small> {extra.length}</button>}
        </span>
      </div>
      {sel && <div className="bs-detail" style={{ marginLeft: 28 + depth * 16 }}>
        {sel === 'extra' ? extra.map((x) => <div key={x.input} className="bs-x"><b>{inputRu(x.input, kbOf)}</b>{x.p.map((p, i) => p.fact ? factView(p.fact, i) : <span key={i} className="muted"> допущение</span>)}</div>)
          : (() => { const p = byInput.get(`${n.id}.${sel}`)?.[0]; return p?.fact ? factView(p.fact)
            : p?.excluded ? <p className="muted">Исключено закреплением «не брать»: факты в базе есть, модель берёт значение сценария. Снять закрепление — во вкладке «Расхождения».</p>
            : <p className="muted">Допущение сценария: значение из сценария операции, в базе нет факта на начало операции. Добавьте факт с источником в запись формирования — модель возьмёт его.</p>; })()}
      </div>}
      {isOpen && kids.map((k) => row(k, depth + 1))}
    </Fragment>;
  };

  const totalOf = (r: RelCount) => r.A + r.B + r.C + r.assumption;
  return <section className="mdl-card bs">
    <div className="sync-h"><h4>Основа модели</h4>
      <span className="muted">сборка из базы {ruDate(kbOf.at)} · входов {kbOf.provenance.length}</span>
      <span className="grow" />
      <button disabled={busy === 'agent'} onClick={() => void agentTask()} title="md-файл для внешнего агента: каких фактов не хватает операции, где искать и в каком виде вернуть ответ">{busy === 'agent' ? 'Составляется…' : 'Задание для агента'}</button></div>
    {err && <div className="err" onClick={() => setErr(null)}>{err}</div>}
    <p className="muted small">На чём держится каждый вход модели: факт базы знаний (источник, страницы, достоверность, цитата) или допущение сценария. Где факты расходятся — закрепите нужный: модель пересоберётся, в журнале операции появится запись.</p>
    <div className="bs-sum">
      <h5 title="Поля штабов и фронтов модель не читает — в итог не входят">Итог</h5>
      {BASIS_KINDS.map(([k, title]) => { const r = sum[k], t = totalOf(r); return <div key={k} className="bs-sum-row">
        <span>{title}</span>
        <div className="bs-bar" title={(['A', 'B', 'C', 'assumption'] as const).map((x) => `${REL_RU[x]}: ${r[x]}`).join('\n')}>
          {t ? (['A', 'B', 'C', 'assumption'] as const).map((x) => r[x] ? <i key={x} className={`b${x}`} style={{ width: `${(r[x] / t) * 100}%` }} /> : null) : null}</div>
        <small>{t ? `${Math.round(((r.A + r.B + r.C) / t) * 100)} % на фактах · A ${r.A}, B ${r.B}, C ${r.C}, доп. ${r.assumption}` : 'нет входов'}
          {r.human + r.auto + r.seed > 0 && <span className="bs-by" title="кем проверены факты, на которых держатся входы"> · человеком {r.human}, автоматически {r.auto}, встроенное {r.seed}</span>}</small>
      </div>; })}
      {(() => { const by = BASIS_KINDS.reduce((a, [k]) => ({ human: a.human + sum[k].human, auto: a.auto + sum[k].auto, seed: a.seed + sum[k].seed }), { human: 0, auto: 0, seed: 0 });
        return <div className="bs-by-total small">Входы на фактах: проверено человеком <b>{by.human}</b> · автоматически <b>{by.auto}</b> · встроенное <b>{by.seed}</b></div>; })()}
      <div className="bs-legend">{(['A', 'B', 'C', 'assumption'] as const).map((x) => <span key={x}><i className={`b${x}`} />{REL_RU[x]}</span>)}</div>
    </div>
    <div className="mat-tabs">
      <button className={part === 'tree' ? 'on' : ''} onClick={() => setPart('tree')}>Формирования</button>
      <button className={part === 'conflicts' ? 'on' : ''} onClick={() => setPart('conflicts')}>Расхождения: {kbOf.conflicts.length}</button>
      <button className={part === 'unmatched' ? 'on' : ''} onClick={() => setPart('unmatched')}>Не сопоставлено: {kbOf.unmatched.length}</button>
    </div>

    {part === 'tree' && <div className="bs-tree">
      <p className="muted small">Щелчок по значению — на каком факте оно держится. Подчинённость — по сборке.</p>
      {(children.get(null) ?? []).map((n) => row(n, 0))}
    </div>}

    {part === 'conflicts' && <div className="bs-list">
      {!kbOf.conflicts.length && <p className="ok">Расхождений между фактами нет.</p>}
      {kbOf.conflicts.map((c) => { const k = splitKey(c.key); const pin = pinAt(c.key); return <div key={c.key} className="bs-conf">
        <div className="bs-conf-h"><b>{KIND_RU[k.kind] ?? k.kind}: {k.subject.split('|').map(nameOf).join(' — ')}</b><span className="muted"> на {ruDate(k.moment)}</span>
          {pin && <span className={`bs-pin${c.pin === 'missing' ? ' bad' : ''}`} title={c.pin === 'missing' ? 'закреплённого факта в базе больше нет (удалён, изменён или сдвинут) — выбор по правилу' : undefined}>
            {c.pin === 'missing' ? 'закреплённый факт удалён' : pin === 'none' ? 'закреплено: не брать' : 'закреплено'}</span>}
          <span className="grow" />
          {pin && <button disabled={busy === c.key} onClick={() => void doPin(c.key, null)}>Снять закрепление</button>}</div>
        {!c.candidates.length && <p className="muted small">Фактов на этот момент в базе нет.</p>}
        {c.candidates.map((f) => { const chosen = !!c.chosen && same(c.chosen, f); const pinned = !!pin && pin !== 'none' && c.pin !== 'missing' && same(pin, f); return <div key={`${f.entry}#${f.index}`} className={`bs-cand${chosen ? ' on' : ''}`}>
          <span className="bs-mark">{chosen ? '✓ в модели' : ''}</span>
          {factView(f)}
          {!pinned && <button disabled={busy === c.key} onClick={() => void doPin(c.key, f)}>Закрепить этот</button>}
          {pinned && <span className="bs-pin">закреплён</span>}
        </div>; })}
      </div>; })}
    </div>}

    {part === 'unmatched' && <div className="bs-list">
      <p className="muted small">Факты в пределах времени операции о формированиях, которых в её сценарии нет: возможно, другой id или формирование стоит добавить в сценарий.</p>
      {!kbOf.unmatched.length && <p className="ok">Всё сопоставлено.</p>}
      {kbOf.unmatched.map((f) => <div key={`${f.entry}#${f.index}`} className="bs-cand"><span className="bs-mark">{(f.fact.claim && 'subject' in f.fact.claim) ? f.fact.claim.subject : ''}</span>{factView(f)}</div>)}
    </div>}
  </section>;
}

/** Вход по ходу операции по-русски: «пополнение 18.04», «потери 16.04–20.04», «положение 20.04 06:00». */
function inputRu(input: string, k: OperationKb): string {
  const [pre, i] = input.split(':');
  const n = +i;
  if (pre === 'change') { const c = k.compiled.changes[n]; return c.kind === 'reinforce' ? `пополнение ${ruDate(c.at)}` : `переподчинение ${ruDate(c.at)}`; }
  if (pre === 'checkpoint') { const c = k.compiled.checkpoints[n]; return c.kind === 'losses' ? `потери ${ruDate(c.from)} — ${ruDate(c.at)}: ${fmtN(c.personnel)}` : `численность на ${ruDate(c.at)}`; }
  if (pre === 'position') { const c = k.compiled.positions[n]; return `положение ${ruDate(c.time)}${c.place ? `: ${c.place}` : ''}`; }
  return input;
}
