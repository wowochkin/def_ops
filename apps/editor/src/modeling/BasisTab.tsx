/**
 * «Основа модели» операции: на чём держится каждый вход модели — факт базы (источник, страницы, достоверность,
 * цитата) или допущение сценария. Формирования деревом по подчинённости; расхождения между фактами — закрепить
 * нужный (пересборка через секунду, запись в журнале операции); факты о формированиях, которых в операции нет;
 * итог — доли входов на фактах A, B, C и на допущениях по видам.
 */
import { useEffect, useMemo, useState } from 'react';
import type { FactRef, Pins, Provenance } from '@def-ops/knowledge';
import type { Scenario } from '@def-ops/sim';
import * as kb from '../kb/kb';
import { getData, getEdits, onDataChange, type OperationKb } from '../sim/userdata';
import { agentScenario } from '../sim/kb-recompile';
import { BASIS_KINDS, basisSummary, KIND_RU, claimText, ruDate, splitKey, type RelCount } from './basis';

/** Открыть запись базы в разделе «Знания». */
export function openKbEntry(id: string) {
  try { localStorage.setItem('def_ops.kb.entry', id); } catch { /* */ }
  window.dispatchEvent(new CustomEvent('def_ops.kb.open', { detail: { id } }));
  location.hash = '#knowledge';
}

interface Node { id: string; name: string; echelon: string; parent: string | null; personnel?: number; tanks?: number; guns?: number; division?: boolean }
type Field = 'personnel' | 'tanks' | 'guns' | 'parent' | 'enterAt';
const FIELD_RU: Record<Field, string> = { personnel: 'людей', tanks: 'танков', guns: 'орудий', parent: 'подчинён', enterAt: 'ввод' };
const REL_RU: Record<keyof RelCount, string> = { A: 'A — справочник, исследование', B: 'B — надёжный вторичный', C: 'C — оценка', assumption: 'допущение сценария' };
const fmtN = (n?: number) => (typeof n === 'number' ? n.toLocaleString('ru-RU') : '—');
const same = (a: { entry: string; index: number }, b: { entry: string; index: number }) => a.entry === b.entry && a.index === b.index;

/** Значок надёжности входа. */
const Rel = ({ r }: { r: Provenance['reliability'] }) => r === 'assumption' ? <i className="bs-asm" title="допущение сценария — в базе нет факта">доп.</i> : <i className={`kb-rel r${r}`}>{r}</i>;

export function BasisTab({ op }: { op: string }) {
  const [kbOf, setKb] = useState<OperationKb | null | undefined>(undefined);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [pins, setPinsState] = useState<Pins>({});
  const [s, setS] = useState<kb.KbState>(kb.current());
  const [part, setPart] = useState<'tree' | 'conflicts' | 'unmatched'>('tree');
  const [pick, setPick] = useState<{ node: string; field: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { void kb.load(); return kb.subscribe(setS); }, []);
  useEffect(() => {
    let alive = true;
    const run = () => void Promise.all([getEdits(op), getData('scenarios', `${op}.json`) as Promise<Scenario>, agentScenario(op), kb.getPins()]).then(([e, sc, ag]) => {
      if (!alive) return;
      setKb(e.kb ?? null);
      const list: Node[] = sc.formations.map((f) => ({ id: f.id, name: f.name, echelon: f.echelon, parent: f.parent ?? null, personnel: f.personnel, tanks: f.tanks, guns: f.guns }));
      if (ag) {
        const have = new Set(list.map((n) => n.id));
        for (const h of ag.hqs) if (!have.has(h.id)) { list.push({ id: h.id, name: h.name, echelon: h.echelon, parent: h.parent ?? null }); have.add(h.id); }
        for (const d of ag.divisions) if (!have.has(d.id)) list.push({ id: d.id, name: d.name, echelon: 'division', parent: d.hq, personnel: d.personnel, tanks: d.tanks, guns: d.guns, division: true });
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

  if (kbOf === undefined) return <section className="mdl-card"><p className="muted"><span className="spinner" /> загрузка…</p></section>;
  if (kbOf === null) return <section className="mdl-card"><h4>Основа модели</h4><p className="muted">Сборки из базы знаний для операции ещё нет: она делается при запуске и при каждом изменении базы. Подождите несколько секунд.</p></section>;

  const sum = basisSummary(kbOf.provenance);
  const pinOf = (key: string) => pins[key];
  const doPin = async (key: string, f: FactRef | null) => {
    setBusy(key);
    try { await kb.setPins({ [key]: f ? { entry: f.entry, index: f.index } : null }); setPinsState(await kb.getPins()); } finally { setBusy(null); }
  };
  const srcTitle = (id?: string) => (id ? s.byId.get(id)?.title ?? s.documents.find((d) => d.id === id)?.name ?? id : '');

  /** Факт: формальная часть, надёжность, источник со страницами, цитата, переход к записи. */
  const FactView = ({ f }: { f: FactRef }) => <div className="bs-fact">
    <div><i className={`kb-rel r${f.fact.reliability ?? 'C'}`}>{f.fact.reliability ?? 'C'}</i>{f.fact.claim ? claimText(f.fact.claim, nameOf) : f.fact.value}</div>
    <div className="muted small">{f.fact.source ? <>источник: {srcTitle(f.fact.source)}{f.fact.pages ? `, ${f.fact.pages}` : ''}</> : 'источник не указан'}
      {' · '}<button className="link" onClick={() => openKbEntry(f.entry)}>запись «{s.byId.get(f.entry)?.title ?? f.entry}» →</button></div>
    {f.fact.quote && <div className="kb-quote">«{f.fact.quote}»</div>}
  </div>;

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

  const Row = ({ n, depth }: { n: Node; depth: number }) => {
    const kids = children.get(n.id) ?? [];
    const isOpen = depth === 0 ? !open.has(n.id) : open.has(n.id); // корни раскрыты, остальное свёрнуто
    const fields = fieldsOf(n);
    const extra = extraOf(n.id);
    const sel = pick?.node === n.id ? pick.field : null;
    const toggle = () => setOpen((o) => { const x = new Set(o); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; });
    return <>
      <div className={`bs-row${sel ? ' on' : ''}`}>
        <span className="bs-name" title={n.id} style={{ paddingLeft: depth * 16 }}>
          {kids.length ? <button className="link bs-tg" onClick={toggle}>{isOpen ? '▾' : '▸'}</button> : <span className="bs-tg" />}{n.name}</span>
        <span className="bs-vals">
          {fields.map(({ field, value, prov }) => <button key={field} className={`bs-v${sel === field ? ' on' : ''}`} title={FIELD_RU[field]} onClick={() => setPick(sel === field ? null : { node: n.id, field })}>
            <small>{FIELD_RU[field]}</small> {value} <Rel r={prov.reliability} /></button>)}
          {extra.length > 0 && <button className={`bs-v${sel === 'extra' ? ' on' : ''}`} onClick={() => setPick(sel === 'extra' ? null : { node: n.id, field: 'extra' })} title="изменения, контрольные точки, положения по ходу операции"><small>по ходу</small> {extra.length}</button>}
        </span>
      </div>
      {sel && <div className="bs-detail" style={{ marginLeft: 28 + depth * 16 }}>
        {sel === 'extra' ? extra.map((x) => <div key={x.input} className="bs-x"><b>{inputRu(x.input, kbOf)}</b>{x.p.map((p, i) => p.fact ? <FactView key={i} f={p.fact} /> : <span key={i} className="muted"> допущение</span>)}</div>)
          : (() => { const p = byInput.get(`${n.id}.${sel}`)?.[0]; return p?.fact ? <FactView f={p.fact} /> : <p className="muted">Допущение сценария: значение из сценария операции, в базе нет факта на начало операции. Добавьте факт с источником в запись формирования — модель возьмёт его.</p>; })()}
      </div>}
      {isOpen && kids.map((k) => <Row key={k.id} n={k} depth={depth + 1} />)}
    </>;
  };

  const totalOf = (r: RelCount) => r.A + r.B + r.C + r.assumption;
  return <section className="mdl-card bs">
    <div className="sync-h"><h4>Основа модели</h4>
      <span className="muted">сборка из базы {ruDate(kbOf.at)} · входов {kbOf.provenance.length}</span></div>
    <p className="muted small">На чём держится каждый вход модели: факт базы знаний (источник, страницы, достоверность, цитата) или допущение сценария. Где факты расходятся — закрепите нужный: модель пересоберётся, в журнале операции появится запись.</p>
    <div className="bs-sum">
      <h5>Итог</h5>
      {BASIS_KINDS.map(([k, title]) => { const r = sum[k], t = totalOf(r); return <div key={k} className="bs-sum-row">
        <span>{title}</span>
        <div className="bs-bar" title={(['A', 'B', 'C', 'assumption'] as const).map((x) => `${REL_RU[x]}: ${r[x]}`).join('\n')}>
          {t ? (['A', 'B', 'C', 'assumption'] as const).map((x) => r[x] ? <i key={x} className={`b${x}`} style={{ width: `${(r[x] / t) * 100}%` }} /> : null) : null}</div>
        <small>{t ? `${Math.round(((r.A + r.B + r.C) / t) * 100)} % на фактах · A ${r.A}, B ${r.B}, C ${r.C}, доп. ${r.assumption}` : 'нет входов'}</small>
      </div>; })}
      <div className="bs-legend">{(['A', 'B', 'C', 'assumption'] as const).map((x) => <span key={x}><i className={`b${x}`} />{REL_RU[x]}</span>)}</div>
    </div>
    <div className="mat-tabs">
      <button className={part === 'tree' ? 'on' : ''} onClick={() => setPart('tree')}>Формирования</button>
      <button className={part === 'conflicts' ? 'on' : ''} onClick={() => setPart('conflicts')}>Расхождения: {kbOf.conflicts.length}</button>
      <button className={part === 'unmatched' ? 'on' : ''} onClick={() => setPart('unmatched')}>Не сопоставлено: {kbOf.unmatched.length}</button>
    </div>

    {part === 'tree' && <div className="bs-tree">
      <p className="muted small">Щелчок по значению — на каком факте оно держится. Подчинённость — по сборке.</p>
      {(children.get(null) ?? []).map((n) => <Row key={n.id} n={n} depth={0} />)}
    </div>}

    {part === 'conflicts' && <div className="bs-list">
      {!kbOf.conflicts.length && <p className="ok">Расхождений между фактами нет.</p>}
      {kbOf.conflicts.map((c) => { const k = splitKey(c.key); const pin = pinOf(c.key); return <div key={c.key} className="bs-conf">
        <div className="bs-conf-h"><b>{KIND_RU[k.kind] ?? k.kind}: {k.subject.split('|').map(nameOf).join(' — ')}</b><span className="muted"> на {ruDate(k.moment)}</span>
          {pin && <span className="bs-pin">{pin === 'none' ? 'закреплено: не брать ни один' : 'закреплено'}</span>}
          <span className="grow" />
          {pin && <button disabled={busy === c.key} onClick={() => void doPin(c.key, null)}>Снять закрепление</button>}</div>
        {c.candidates.map((f) => { const chosen = !!c.chosen && same(c.chosen, f); const pinned = !!pin && pin !== 'none' && same(pin, f); return <div key={`${f.entry}#${f.index}`} className={`bs-cand${chosen ? ' on' : ''}`}>
          <span className="bs-mark">{chosen ? '✓ в модели' : ''}</span>
          <FactView f={f} />
          {!pinned && <button disabled={busy === c.key} onClick={() => void doPin(c.key, f)}>Закрепить этот</button>}
          {pinned && <span className="bs-pin">закреплён</span>}
        </div>; })}
      </div>; })}
    </div>}

    {part === 'unmatched' && <div className="bs-list">
      <p className="muted small">Факты в пределах времени операции о формированиях, которых в её сценарии нет: возможно, другой id или формирование стоит добавить в сценарий.</p>
      {!kbOf.unmatched.length && <p className="ok">Всё сопоставлено.</p>}
      {kbOf.unmatched.map((f) => <div key={`${f.entry}#${f.index}`} className="bs-cand"><span className="bs-mark">{(f.fact.claim && 'subject' in f.fact.claim) ? f.fact.claim.subject : ''}</span><FactView f={f} /></div>)}
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
