/**
 * Материалы операции: документы (книги, донесения, журналы боевых действий, сканы, таблицы, пакеты агента) разбирает
 * модель — кандидаты-факты проверяются по сценарию и театру этой операции и ложатся в базу знаний, в очередь
 * «На проверку» (раздел «Знания», с фильтром по операции и документу) или в отброшенные (итоги документа). Здесь —
 * документы операции, переход к их очереди, положения и линии в правках операции (прежний приём) и сведения об
 * инфраструктуре в расчёте; переправа, добавленная вручную, — фактом базы (тот же путь, что принятый кандидат).
 */
import { useEffect, useMemo, useState } from 'react';
import { RELIABILITY, type Candidate, type Claim, type Reliability, type SyncInput } from '@def-ops/knowledge';
import { areaTitle, infraEffect, INFRA_KIND_RU, INFRA_STATE_RU, resolveInfra, Theatre, type Boundary, type InfraKind, type InfraRecord, type InfraState, type Scenario, type TheatreData } from '@def-ops/sim';
import { addManual } from '../kb/candidates';
import * as kb from '../kb/kb';
import { candDoc } from '../kb/queue';
import { openKbQueue, opCtx } from '../kb/ReviewQueue';
import { ACCEPT } from '../kb/text';
import { DocRow } from '../KnowledgeView';
import { claimText } from './basis';
import { getEdits, getInfra, onDataChange, saveInfra, type HistPosition } from '../sim/userdata';
import type { Llm } from '../shared';
import { resetPool } from './data';
import { removeBoundary, removePosition, syncInput } from './sync';

const ddmm = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');
const ROADISH = new Set(['road', 'rail']);
/** Состояние сведения → состояние переправы базы (нет — не читается как проходима / разрушена / наведена). */
const CROSSING_OF: Partial<Record<InfraState, Extract<Claim, { kind: 'crossing' }>['state']>> = {
  intact: 'open', built: 'built', repaired: 'built', destroyed: 'destroyed', impassable: 'destroyed',
};

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
  const [msg, setMsg] = useState<string | null>(null);
  const [input, setInput] = useState<(SyncInput & { scenario: Scenario }) | null>(null);
  const [added, setAdded] = useState<HistPosition[]>([]);
  const [addedB, setAddedB] = useState<Boundary[]>([]);
  useEffect(() => { const f = () => { void syncInput(op).then(setInput).catch(() => setInput(null)); void getEdits(op).then((e) => { setAdded(e.positions); setAddedB(e.boundaries ?? []); }); }; f(); return onDataChange(f); }, [op]);

  const docs = s.documents.filter((d) => d.operation === op);
  const ids = new Set(docs.map((d) => d.id));
  // очередь операции: кандидаты операции и её документов
  const waiting = s.candidates.filter((c) => c.state === 'pending' && (c.op === op || ids.has(candDoc(c) ?? '')));

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
  /**
   * Сведение вручную: мост или переправа с состоянием «цел / наведён / разрушен …» — фактом базы (переправа; в расчёт —
   * через сборщик операции), прочее — в сведения операции и текстовым фактом в базу, как прежде.
   */
  const addRecord = async (r: InfraRecord) => {
    setMsg(null);
    const state = CROSSING_OF[r.state];
    if ((r.kind === 'bridge' || r.kind === 'crossing') && state) {
      const subject = `${r.title}${r.river && !r.title.includes(r.river) ? ` через ${r.river}` : ''}${r.place && !r.title.includes(r.place) ? ` у ${r.place}` : ''}`;
      const from = r.from ?? input?.operation.start.slice(0, 10) ?? '';
      if (!from) { setMsg('Укажите дату «С»: переправа ложится в базу фактом с датой.'); return; }
      const claim: Claim = { kind: 'crossing', subject, from, state };
      const c: Candidate = {
        id: `manual:${op}:${Date.now().toString(36)}`, claim, names: { subject, ...(r.place ? { place: r.place } : {}) }, key: 'переправа', value: claimText(claim),
        source: 'вручную', origin: 'manual', evidence: { kind: 'manual', ...(r.note ? { note: r.note } : {}) }, op, checks: [], verdict: 'auto', state: 'pending',
      };
      const res = await addManual(c, { formations: (await opCtx(op)).formations });
      setMsg('pending' in res ? 'Переправа ждёт в очереди «На проверку».' : 'Переправа добавлена в базу знаний (запись «Состояние инфраструктуры» операции) и войдёт в расчёт через сборщик операции.');
      return;
    }
    await store([...records, r]);
    await kb.addInfraFact({ id: op, title }, { text: `${factText(r)} — добавлено вручную`, road: ROADISH.has(r.kind) });
  };

  return (
    <section className="mdl-card mat">
      <h4>Материалы операции</h4>
      <p className="muted">Книги, донесения, журналы боевых действий — текст (PDF, Word, HTML, txt), сканы (PDF без текста, JPG, PNG), таблицы (CSV, XLSX), пакеты фактов (JSON). Модель выписывает факты с дословной цитатой; проверки по сценарию и театру этой операции решают — в базу сразу, на проверку или отбросить. Сомнительное (в том числе положения, линии, переправы, дороги) — в очереди «На проверку» раздела «Знания».</p>
      <div className="row">
        <label>Достоверность <select value={rel} onChange={(e) => setRel(e.target.value as Reliability)}>{(['A', 'B', 'C'] as Reliability[]).map((r) => <option key={r} value={r}>{r} — {RELIABILITY[r]}</option>)}</select></label>
        <input className="grow" placeholder="Что за документ (автор, издание) — необязательно" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="btnlike primary">{busy ?? 'Загрузить…'}<input type="file" multiple hidden accept={ACCEPT} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} /></label>
      </div>
      {err && <div className="err">{err}</div>}
      {docs.length > 0 && <div className="mat-docs">{docs.map((d) => <DocRow key={d.id} d={d} s={s} llm={llm} onQueue={() => openKbQueue({ op, doc: d.id })} />)}</div>}
      <div className="mat-queue">
        {waiting.length ? <>На проверку по операции: <b>{waiting.length}</b> <button onClick={() => openKbQueue({ op })}>Открыть очередь</button></>
          : <span className="muted">Очередь «На проверку» по операции пуста.</span>}
      </div>

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

      <InfraTable records={records} T={T} onRemove={(id) => void store(records.filter((r) => r.id !== id))} onAdd={(r) => void addRecord(r).catch((e) => setMsg((e as Error).message))} />
      {msg && <p className="ok small">{msg}</p>}
    </section>
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
