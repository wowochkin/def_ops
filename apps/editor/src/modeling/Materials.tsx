/**
 * Материалы операции: документы (книги, донесения, журналы боевых действий) разбирает модель — записи базы знаний
 * (в разделе этой операции) и сведения о состоянии инфраструктуры (мосты, переправы, дороги) с цитатами. Здесь
 * видно, что извлеклось из каждого документа; принятые сведения об инфраструктуре ложатся поверх театра при
 * расчёте (и пишутся в базу знаний), их можно добавить и вручную.
 */
import { useEffect, useMemo, useState } from 'react';
import { RELIABILITY, type BoundaryProposal, type InfraProposal, type PositionProposal, type Reliability, type SyncInput } from '@def-ops/knowledge';
import { areaTitle, infraEffect, INFRA_KIND_RU, INFRA_STATE_RU, resolveInfra, Theatre, type Boundary, type InfraKind, type InfraRecord, type InfraState, type Scenario, type TheatreData } from '@def-ops/sim';
import * as kb from '../kb/kb';
import { DocRow, ProposalCard } from '../KnowledgeView';
import { getEdits, getInfra, onDataChange, saveInfra, type HistPosition } from '../sim/userdata';
import type { Llm } from '../shared';
import { resetPool } from './data';
import { acceptBoundaries, acceptPositions, removeBoundary, removePosition, resolveBoundary, resolvePosition, syncInput } from './sync';

const ddmm = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
const ROADISH = new Set(['road', 'rail']);

/** Сведение из документа → запись операции (с привязкой к театру). */
function toRecord(p: InfraProposal, T: Theatre | null): InfraRecord {
  const it = p.item;
  const rec: InfraRecord = {
    id: p.id.replace(/[^a-z0-9]/gi, '-'), kind: it.kind, state: it.state, title: it.title, place: it.place ?? undefined, river: it.river ?? undefined,
    from: it.date, until: it.dateTo, side: it.side, note: it.note ?? undefined, origin: 'document', added: new Date().toISOString(),
    source: { doc: p.doc, docName: p.docName, quote: it.quote, reliability: p.reliability },
  };
  const r = T ? resolveInfra(T, rec) : null;
  return r ? { ...rec, bridge: r.bridge, at: r.at, radiusKm: r.radiusKm } : rec;
}

export function Materials({ op, title, theatre, llm }: { op: string; title: string; theatre: TheatreData | null; llm: Llm }) {
  const [s, setS] = useState<kb.KbState>(kb.current());
  useEffect(() => { void kb.load(); return kb.subscribe(setS); }, []);
  const [records, setRecords] = useState<InfraRecord[]>([]);
  useEffect(() => { const f = () => void getInfra(op).then(setRecords); f(); return onDataChange(f); }, [op]);
  const T = useMemo(() => (theatre ? new Theatre(theatre) : null), [theatre]);
  const [rel, setRel] = useState<Reliability>('B');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'infra' | 'kb' | 'pos' | 'bnd'>('infra');
  const [input, setInput] = useState<(SyncInput & { scenario: Scenario }) | null>(null);
  const [added, setAdded] = useState<HistPosition[]>([]);
  const [addedB, setAddedB] = useState<Boundary[]>([]);
  useEffect(() => { const f = () => { void syncInput(op).then(setInput).catch(() => setInput(null)); void getEdits(op).then((e) => { setAdded(e.positions); setAddedB(e.boundaries ?? []); }); }; f(); return onDataChange(f); }, [op]);
  const [docF, setDocF] = useState<string | null>(null);

  const docs = s.documents.filter((d) => d.operation === op);
  const ids = new Set(docs.map((d) => d.id));
  const infra = s.infra.filter((p) => p.operation === op && (!docF || p.doc === docF));
  const props = s.proposals.filter((p) => ids.has(p.doc) && (!docF || p.doc === docF));
  const infraPending = infra.filter((p) => p.status === 'pending'), kbPending = props.filter((p) => p.status === 'pending');
  const pos = s.positions.filter((p) => p.operation === op && (!docF || p.doc === docF));
  const posPending = pos.filter((p) => p.status === 'pending');
  const takePositions = (ps: PositionProposal[]) => { if (input) void acceptPositions(op, ps, input, theatre); };
  const bnd = s.boundaries.filter((p) => p.operation === op && (!docF || p.doc === docF));
  const bndPending = bnd.filter((p) => p.status === 'pending');
  const takeBoundaries = (ps: BoundaryProposal[]) => { if (input) void acceptBoundaries(op, ps, input, theatre); };

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    for (const f of [...files]) {
      setBusy(`чтение «${f.name}»…`);
      try { await kb.addFile(f, rel, note, op); } catch (e) { setErr(`${f.name}: ${(e as Error).message}`); }
    }
    setBusy(null); setNote('');
  };
  const store = async (list: InfraRecord[]) => { await saveInfra(op, list); setRecords(list); resetPool(); };
  const factText = (r: InfraRecord) => `${r.title}: ${INFRA_STATE_RU[r.state]}${r.from ? ` с ${ddmm(r.from)}` : ''}${r.until ? ` до ${ddmm(r.until)}` : ''}${r.note ? ` (${r.note})` : ''}`;
  const accept = async (ps: InfraProposal[]) => {
    const recs = ps.map((p) => toRecord(p, T));
    await store([...records.filter((r) => !recs.some((x) => x.id === r.id)), ...recs]);
    for (const r of recs) await kb.addInfraFact({ id: op, title }, { text: factText(r), quote: r.source?.quote, doc: r.source?.doc, reliability: r.source?.reliability as Reliability, road: ROADISH.has(r.kind) });
    await kb.decideInfra(ps.map((p) => p.id), true);
  };

  return (
    <section className="mdl-card mat">
      <h4>Материалы операции</h4>
      <p className="muted">Книги, донесения, журналы боевых действий (PDF с текстом, Word, HTML, txt). Модель выписывает из каждой части сведения в базу знаний — в раздел этой операции — и сведения о состоянии мостов, переправ, дорог; каждое — с дословной цитатой (без цитаты отбрасывается). Вы смотрите, что извлеклось, и принимаете. Принятое об инфраструктуре ложится поверх театра при расчёте.</p>
      <div className="row">
        <label>Достоверность <select value={rel} onChange={(e) => setRel(e.target.value as Reliability)}>{(['A', 'B', 'C'] as Reliability[]).map((r) => <option key={r} value={r}>{r} — {RELIABILITY[r]}</option>)}</select></label>
        <input className="grow" placeholder="Что за документ (автор, издание) — необязательно" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="btnlike primary">{busy ?? 'Загрузить документы…'}<input type="file" multiple hidden accept=".pdf,.docx,.txt,.md,.html,.htm" onChange={(e) => { void add(e.target.files); e.target.value = ''; }} /></label>
      </div>
      {err && <div className="err">{err}</div>}
      {docs.length > 0 && <div className="mat-docs">{docs.map((d) => <DocRow key={d.id} d={d} s={s} llm={llm} open={() => {}} onFilter={() => setDocF(docF === d.id ? null : d.id)} filtered={docF === d.id} />)}</div>}

      {(infra.length > 0 || props.length > 0 || pos.length > 0 || bnd.length > 0) && <>
        <div className="mat-tabs">
          <button className={view === 'infra' ? 'on' : ''} onClick={() => setView('infra')}>Инфраструктура: {infraPending.length} ждут, {infra.filter((p) => p.status === 'accepted').length} принято</button>
          <button className={view === 'kb' ? 'on' : ''} onClick={() => setView('kb')}>В базу знаний: {kbPending.length} ждут, {props.filter((p) => p.status === 'accepted').length} принято</button>
          <button className={view === 'pos' ? 'on' : ''} onClick={() => setView('pos')}>Положения: {posPending.length} ждут, {pos.filter((p) => p.status === 'accepted').length} принято</button>
          <button className={view === 'bnd' ? 'on' : ''} onClick={() => setView('bnd')}>Разграничительные линии: {bndPending.length} ждут, {bnd.filter((p) => p.status === 'accepted').length} принято</button>
          {docF && <button className="link" onClick={() => setDocF(null)}>все документы</button>}
          <span className="grow" />
          {view === 'infra' && infraPending.length > 0 && <><button onClick={() => void accept(infraPending)}>Принять все</button><button onClick={() => void kb.decideInfra(infraPending.map((p) => p.id), false)}>Отклонить все</button></>}
          {view === 'kb' && kbPending.length > 0 && <><button onClick={() => void kb.decide(kbPending.map((p) => p.id), true)}>Принять все</button><button onClick={() => void kb.decide(kbPending.map((p) => p.id), false)}>Отклонить все</button></>}
          {view === 'bnd' && bndPending.length > 0 && <><button disabled={!input} onClick={() => takeBoundaries(bndPending)}>Принять все</button><button onClick={() => void kb.decideBoundaries(bndPending.map((p) => p.id), false)}>Отклонить все</button></>}
          {view === 'pos' && posPending.length > 0 && <><button disabled={!input} onClick={() => takePositions(posPending)}>Принять все</button><button onClick={() => void kb.decidePositions(posPending.map((p) => p.id), false)}>Отклонить все</button></>}
        </div>
        {view === 'bnd' ? <div className="mat-list">
          <p className="muted small">Разграничительная линия между объединениями (директива, приказ). Принятая ложится фактом в записи обоих объединений в базе знаний (с цитатой) и — если объединения есть в сценарии, а хотя бы два пункта на театре — в сценарий операции: полосы в расчёте (войска идут своей полосой) и линия на карте переигровки.</p>
          {bnd.map((p) => <BoundaryCard key={p.id} p={p} input={input} T={T} onAccept={() => takeBoundaries([p])} onReject={() => void kb.decideBoundaries([p.id], false)} />)}
          {!bnd.length && <p className="muted">Разграничительных линий не найдено.</p>}
        </div> : view === 'pos' ? <div className="mat-list">
          <p className="muted small">Положение формирования в день операции. Принятое ложится в боевой путь формирования в базе знаний (с цитатой) и — если формирование есть в сценарии, а пункт на театре — в историю операции: по нему сверяется расчёт и идёт калибровка.</p>
          {pos.map((p) => <PositionCard key={p.id} p={p} input={input} T={T} onAccept={() => takePositions([p])} onReject={() => void kb.decidePositions([p.id], false)} />)}
          {!pos.length && <p className="muted">Положений не найдено.</p>}
        </div> : view === 'infra' ? <div className="mat-list">
          {infra.map((p) => <InfraCard key={p.id} p={p} T={T} onAccept={() => void accept([p])} onReject={() => void kb.decideInfra([p.id], false)} />)}
          {!infra.length && <p className="muted">Сведений об инфраструктуре не найдено.</p>}
        </div> : <div className="mat-list">
          {kbPending.slice(0, 60).map((p) => <ProposalCard key={p.id} p={p} s={s} open={() => {}} />)}
          {!kbPending.length && <p className="muted">Все предложения разобраны. Принятые записи — в «Знаниях», раздел операции.</p>}
        </div>}
      </>}

      {added.length > 0 && <details className="mat-add"><summary>Положения из документов в истории операции · {added.length}</summary>
        <table className="mdl-tbl"><thead><tr><th>Формирование</th><th>День</th><th>Пункт</th><th>±км</th><th>Источник</th><th /></tr></thead><tbody>
          {added.map((h) => <tr key={h.id}><td>{input?.formations.find((f) => f.id === h.formation)?.name ?? h.formation}</td><td>{ddmm(h.time)}</td><td>{h.place}</td><td>{Math.round(h.approxKm)}</td>
            <td title={h.quote ? `«${h.quote}»` : undefined}><i className={`kb-rel r${h.reliability}`}>{h.reliability}</i> {h.source}</td>
            <td><button className="link danger" title="Убрать из истории (в базе знаний останется)" onClick={() => void removePosition(op, h.id)}>✕</button></td></tr>)}
        </tbody></table></details>}

      {(addedB.length > 0 || (input?.scenario.boundaries?.length ?? 0) > 0) && <details className="mat-add"><summary>Разграничительные линии в сценарии · {(input?.scenario.boundaries ?? []).filter((b) => b.kind !== 'air').length}</summary>
        <table className="mdl-tbl"><thead><tr><th>Линия</th><th>Срок</th><th>Пункты</th><th>Источник</th><th /></tr></thead><tbody>
          {(input?.scenario.boundaries ?? []).filter((b) => b.kind !== 'air').map((b) => { const doc = addedB.some((x) => x.id === b.id); return <tr key={b.id}><td>{b.title}</td><td>{ddmm(b.from.slice(0, 10))}{b.until ? ` — ${ddmm(b.until.slice(0, 10))}` : ''}</td><td>{(b.places ?? []).join(' — ')}</td>
            <td title={b.note}><i className={`kb-rel r${b.reliability ?? 'C'}`}>{b.reliability ?? 'C'}</i> {b.source}</td>
            <td>{doc && <button className="link danger" title="Убрать из сценария (в базе знаний останется)" onClick={() => void removeBoundary(op, b.id)}>✕</button>}</td></tr>; })}
        </tbody></table></details>}

      <InfraTable records={records} T={T} onRemove={(id) => void store(records.filter((r) => r.id !== id))}
        onAdd={(r) => { void store([...records, r]).then(() => kb.addInfraFact({ id: op, title }, { text: `${factText(r)} — добавлено вручную`, road: ROADISH.has(r.kind) })); }} />
    </section>
  );
}

function InfraCard({ p, T, onAccept, onReject }: { p: InfraProposal; T: Theatre | null; onAccept: () => void; onReject: () => void }) {
  const rec = useMemo(() => toRecord(p, T), [p, T]);
  const where = T ? resolveInfra(T, rec) : null;
  const eff = infraEffect(rec);
  const it = p.item;
  return (
    <div className={`mat-infra st-${p.status}`}>
      <div className="mat-infra-h"><i className={`k-${it.kind}`}>{INFRA_KIND_RU[it.kind]}</i><i className={`s-${it.state}`}>{INFRA_STATE_RU[it.state]}</i><b>{it.title}</b>
        <span className="muted">{[it.place, it.river && `р. ${it.river}`, it.date && `с ${ddmm(it.date)}`, it.dateTo && `до ${ddmm(it.dateTo)}`].filter(Boolean).join(' · ')}</span></div>
      {it.note && <p>{it.note}</p>}
      <div className="kb-quote">«{it.quote}» <span className="muted">— {p.docName}, часть {p.chunk + 1}</span></div>
      <div className="mat-res">{where ? <>на театре: {where.how}</> : <span className="warn">на театре не найдено — останется сведением (в базе знаний)</span>}
        {' · '}{eff ? <b>в расчёте: {eff}</b> : <span className="muted">в расчёт не входит</span>}</div>
      {p.status === 'pending' ? <div className="row"><button className="primary" onClick={onAccept}>Принять</button><button onClick={onReject}>Отклонить</button></div>
        : <span className="muted">{p.status === 'accepted' ? '✓ принято' : 'отклонено'}</span>}
    </div>
  );
}

function PositionCard({ p, input, T, onAccept, onReject }: { p: PositionProposal; input: SyncInput | null; T: Theatre | null; onAccept: () => void; onReject: () => void }) {
  const r = useMemo(() => (input ? resolvePosition(p, input, T) : null), [p, input, T]);
  const it = p.item;
  return (
    <div className={`mat-infra st-${p.status}`}>
      <div className="mat-infra-h"><i className="k-pos">положение</i><b>{it.formation}</b><span className="muted">{ddmm(it.date)} · {it.place}</span></div>
      {it.note && <p>{it.note}</p>}
      <div className="kb-quote">«{it.quote}» <span className="muted">— {p.docName}, часть {p.chunk + 1}</span></div>
      {r && <div className="mat-res">
        {r.formation ? <>в сценарии: {r.formation.name}</> : <span className="warn">в сценарии такого формирования нет</span>}
        {' · '}{r.place ? <>на театре: {r.place.title}</> : <span className="warn">пункт на театре не найден</span>}
        {' · '}{r.formation && r.place ? <b>в историю и в боевой путь (база)</b> : <span className="muted">только в базу знаний (боевой путь{r.entry ? '' : ', новая запись'})</span>}</div>}
      {p.status === 'pending' ? <div className="row"><button className="primary" disabled={!input} onClick={onAccept}>Принять</button><button onClick={onReject}>Отклонить</button></div>
        : <span className="muted">{p.status === 'accepted' ? '✓ принято' : 'отклонено'}</span>}
    </div>
  );
}

function BoundaryCard({ p, input, T, onAccept, onReject }: { p: BoundaryProposal; input: (SyncInput & { scenario: Scenario }) | null; T: Theatre | null; onAccept: () => void; onReject: () => void }) {
  const r = useMemo(() => (input ? resolveBoundary(p, input, T) : null), [p, input, T]);
  const it = p.item;
  return (
    <div className={`mat-infra st-${p.status}`}>
      <div className="mat-infra-h"><i className="k-line">разгр. линия</i><b>{it.between.join(' / ')}</b><span className="muted">{[it.date && `с ${ddmm(it.date)}`, it.dateTo && `до ${ddmm(it.dateTo)}`].filter(Boolean).join(' · ')}</span></div>
      <p>{it.points.join(' — ')}{it.inclusive ? ` · включительно для: ${it.inclusive}` : ''}{it.note ? ` · ${it.note}` : ''}</p>
      <div className="kb-quote">«{it.quote}» <span className="muted">— {p.docName}, часть {p.chunk + 1}</span></div>
      {r && <div className="mat-res">
        {r.a && r.b ? <>в сценарии: {r.a.name} / {r.b.name}</> : <span className="warn">в сценарии нет {!r.a && !r.b ? 'обоих объединений' : `«${!r.a ? it.between[0] : it.between[1]}»`}</span>}
        {' · '}на театре: {r.points.length} из {it.points.length} пунктов{r.missing.length ? <span className="warn"> (нет: {r.missing.join(', ')})</span> : null}
        {' · '}{r.boundary ? <b>в сценарий (справа — {r.boundary.right === r.a?.id ? r.a?.name : r.b?.name}) и в базу</b> : <span className="muted">только в базу знаний</span>}</div>}
      {p.status === 'pending' ? <div className="row"><button className="primary" disabled={!input} onClick={onAccept}>Принять</button><button onClick={onReject}>Отклонить</button></div>
        : <span className="muted">{p.status === 'accepted' ? '✓ принято' : 'отклонено'}</span>}
    </div>
  );
}

const KINDS = Object.keys(INFRA_KIND_RU) as InfraKind[];
const STATES = Object.keys(INFRA_STATE_RU) as InfraState[];

/** Сведения в расчёте: список, удаление, добавление вручную. */
function InfraTable({ records, T, onRemove, onAdd }: { records: InfraRecord[]; T: Theatre | null; onRemove: (id: string) => void; onAdd: (r: InfraRecord) => void }) {
  const [f, setF] = useState({ kind: 'bridge' as InfraKind, state: 'destroyed' as InfraState, title: '', place: '', river: '', from: '', until: '', note: '' });
  const places = useMemo(() => (T ? T.data.areas.map((a) => areaTitle(a.name)).sort((a, b) => a.localeCompare(b, 'ru')) : []), [T]);
  const draft: InfraRecord = { id: `u${Date.now().toString(36)}`, kind: f.kind, state: f.state, title: f.title || `${INFRA_KIND_RU[f.kind]} у ${f.place}`, place: f.place || undefined, river: f.river || undefined, from: f.from || null, until: f.until || null, note: f.note || undefined, origin: 'user' };
  const where = T && f.place ? resolveInfra(T, draft) : null;
  const rec: InfraRecord = where ? { ...draft, bridge: where.bridge, at: where.at, radiusKm: where.radiusKm } : draft;
  return (
    <div className="mat-table">
      <h4>Состояние инфраструктуры в расчёте {records.length ? `· ${records.length}` : ''}</h4>
      {!records.length && <p className="muted">Пока нет сведений: театр — как собран (мосты и даты разрушения — из исторического слоя театра).</p>}
      {records.length > 0 && <table className="mdl-table"><thead><tr><th>Что</th><th>Состояние</th><th>Сроки</th><th>В расчёте</th><th>Откуда</th><th /></tr></thead><tbody>
        {records.map((r) => <tr key={r.id}><td>{INFRA_KIND_RU[r.kind]}: {r.title}{r.place ? <small> · {r.place}</small> : null}</td><td>{INFRA_STATE_RU[r.state]}</td>
          <td>{r.from ? ddmm(r.from) : 'с начала'}{r.until ? ` — ${ddmm(r.until)}` : ''}</td>
          <td>{infraEffect(r) ?? <span className="muted">сведение{!r.at && !r.bridge ? ' (пункт не найден на театре)' : ''}</span>}</td>
          <td title={r.source?.quote}>{r.origin === 'user' ? 'вручную' : r.source?.docName ?? 'документ'}</td>
          <td><button className="link danger" title="Убрать из расчёта" onClick={() => onRemove(r.id)}>✕</button></td></tr>)}
      </tbody></table>}
      <details className="mat-add"><summary>Добавить сведение вручную</summary>
        <div className="mdl-grid">
          <label>Что <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as InfraKind })}>{KINDS.map((k) => <option key={k} value={k}>{INFRA_KIND_RU[k]}</option>)}</select></label>
          <label>Состояние <select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value as InfraState })}>{STATES.map((k) => <option key={k} value={k}>{INFRA_STATE_RU[k]}</option>)}</select></label>
          <label>Пункт <input list="mat-places" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} placeholder="ближайший пункт театра" /></label>
          <datalist id="mat-places">{places.map((p) => <option key={p} value={p} />)}</datalist>
          <label>Река <input value={f.river} onChange={(e) => setF({ ...f, river: e.target.value })} placeholder="для мостов и переправ" /></label>
          <label>С <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label>До <input type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></label>
          <label className="wide">Название <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="мост через Шпрее у Фюрстенвальде" /></label>
          <label className="wide">Подробности <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="источник, кто подорвал, грузоподъёмность" /></label>
        </div>
        <p className="muted small">{f.place ? (where ? `На театре: ${where.how}. ` : 'Пункт на театре не найден — сведение не войдёт в расчёт. ') : ''}{infraEffect(rec) ? `В расчёте: ${infraEffect(rec)}.` : 'В расчёт не входит.'}</p>
        <button className="primary" disabled={!f.place && !f.title} onClick={() => { onAdd(rec); setF({ ...f, title: '', place: '', river: '', note: '' }); }}>Добавить</button>
      </details>
    </div>
  );
}
