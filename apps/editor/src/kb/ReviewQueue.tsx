/**
 * Вкладка «На проверку» раздела «Знания»: кандидаты-факты, которым проверки не дали пройти в базу сразу. Карточка —
 * вид и значения (правятся на месте), соединение (выбор из сценария и записей, предложенное первым), дата, источник;
 * справа доказательство (цитата с подсветкой чисел, картинка страницы с выделенным местом и расшифровка, строка
 * таблицы); сверху причины сомнения. «Почему сомнение» и «Предложи исправление» — запрос модели роли разбора по
 * кнопке: правка подставляется в карточку, принимает человек. Групповые действия и фильтры — над списком.
 */
import { useEffect, useMemo, useState } from 'react';
import { category, matchFormation, RELIABILITY, type Candidate, type CheckId, type Claim, type Entry, type KbDocument } from '@def-ops/knowledge';
import { confirmAsync } from '../dialogs';
import { claimText, KIND_RU } from '../modeling/basis';
import { onDataChange } from '../sim/userdata';
import type { Llm } from '../shared';
import { decideCandidates, type AcceptCtx, type StoredCandidate } from './candidates';
import { opContext, type OpContext } from './ingest';
import * as kb from './kb';
import {
  applyFixes, ASSIST_SCHEMA, assistMessages, candDoc, candKind, CHECK_RU, CLAIM_FIELDS, CROSSING_STATE_RU, evidenceText, fieldText, filterQueue,
  numberParts, onlyDoubt, reasonGroups, subjectKeys, setClaimField, setSubject, type AssistAnswer, type AssistMode, type QueueFilter, type QueueKind,
} from './queue';
import * as store from './store';
import type { PageImage } from './text';

/** Сценарий и театр операции кандидата (для выбора соединения и приёма): один раз на операцию, сброс — при правке данных. */
const ctxCache = new Map<string, Promise<OpContext>>();
if (typeof window !== 'undefined') onDataChange(() => ctxCache.clear());
export function opCtx(op?: string): Promise<OpContext> {
  if (!op) return Promise.resolve({ formations: [] });
  if (!ctxCache.has(op)) ctxCache.set(op, opContext({ operation: op } as KbDocument).catch(() => ({ formations: [] })));
  return ctxCache.get(op)!;
}
function useOpCtx(op?: string): OpContext | null {
  const [cx, setCx] = useState<OpContext | null>(null);
  useEffect(() => { let alive = true; void opCtx(op).then((x) => { if (alive) setCx(x); }); return () => { alive = false; }; }, [op]);
  return cx;
}
const acceptCtx = (cx: OpContext): AcceptCtx => ({ formations: cx.formations, ...(cx.theatre ? { theatre: cx.theatre } : {}) });

const kindRu = (k: QueueKind) => (k === 'text' ? 'запись' : KIND_RU[k] ?? k);

export function ReviewQueue({ s, llm, open, filter, setFilter }: { s: kb.KbState; llm: Llm; open: (id: string) => void; filter: QueueFilter; setFilter: (f: QueueFilter) => void }) {
  const pending = useMemo(() => s.candidates.filter((c) => c.state === 'pending'), [s.candidates]);
  const list = useMemo(() => filterQueue(pending, filter), [pending, filter]);
  const [limit, setLimit] = useState(30);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setLimit(30), [filter]);
  // для фильтров: из всей очереди (без фильтра по себе)
  const docs = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of filterQueue(pending, { ...filter, doc: undefined })) { const d = candDoc(c); if (d) m.set(d, (m.get(d) ?? 0) + 1); }
    return [...m].map(([id, n]) => ({ id, n, name: s.documents.find((d) => d.id === id)?.name ?? id }));
  }, [pending, filter, s.documents]);
  const kinds = useMemo(() => { const m = new Map<QueueKind, number>(); for (const c of filterQueue(pending, { ...filter, kind: undefined })) m.set(candKind(c), (m.get(candKind(c)) ?? 0) + 1); return [...m]; }, [pending, filter]);
  const subjects = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of filterQueue(pending, { ...filter, subject: undefined })) {
      const ids = subjectKeys(c);
      for (const x of new Set(ids.filter(Boolean))) m.set(x, (m.get(x) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 200);
  }, [pending, filter]);
  const reasons = useMemo(() => reasonGroups(filterQueue(pending, { ...filter, reason: undefined })), [pending, filter]);
  const [bulk, setBulk] = useState<CheckId | ''>('');
  const bulkReason = bulk || reasons.find((r) => r.only)?.reason || '';
  const bulkList = bulkReason ? onlyDoubt(list, bulkReason) : [];
  const nameOf = useNames(s);

  const acceptAll = async (cs: StoredCandidate[]) => {
    setBusy(true); setMsg(null);
    try {
      let accepted = 0; const left: string[] = [];
      // по операциям: у каждой свой сценарий и театр
      for (const op of new Set(cs.map((c) => c.op))) {
        const r = await decideCandidates(cs.filter((c) => c.op === op).map((c) => c.id), true, {}, acceptCtx(await opCtx(op)));
        accepted += r.accepted; left.push(...r.pending);
      }
      setMsg(`Принято: ${accepted}${left.length ? `; не принято (соединение не найдено — указать в карточке): ${left.length}` : ''}.`);
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const rejectDoc = async (doc: string) => {
    const cs = filterQueue(pending, { doc });
    const name = s.documents.find((d) => d.id === doc)?.name ?? doc;
    if (!await confirmAsync(`Отклонить все ${cs.length} кандидатов из «${name}», ждущих проверки?`, { ok: 'Отклонить', danger: true })) return;
    setBusy(true);
    try { await decideCandidates(cs.map((c) => c.id), false); setMsg(`Отклонено: ${cs.length}.`); } finally { setBusy(false); }
  };
  const set = (p: Partial<QueueFilter>) => setFilter({ ...filter, ...p });
  const any = !!(filter.doc || filter.kind || filter.subject || filter.reason);

  return (
    <div className="rq">
      <div className="rq-bar">
        <label>Документ <select value={filter.doc ?? ''} onChange={(e) => set({ doc: e.target.value || undefined })}><option value="">все</option>
          {filter.doc && !docs.some((d) => d.id === filter.doc) && <option value={filter.doc}>{s.documents.find((d) => d.id === filter.doc)?.name ?? filter.doc} (0)</option>}
          {docs.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.n})</option>)}</select></label>
        <label>Вид <select value={filter.kind ?? ''} onChange={(e) => set({ kind: (e.target.value || undefined) as QueueKind | undefined })}><option value="">все</option>
          {kinds.map(([k, n]) => <option key={k} value={k}>{kindRu(k)} ({n})</option>)}</select></label>
        <label>Соединение <select value={filter.subject ?? ''} onChange={(e) => set({ subject: e.target.value || undefined })}><option value="">все</option>
          {subjects.map(([x, n]) => <option key={x} value={x}>{nameOf(x)} ({n})</option>)}</select></label>
        <label>Причина <select value={filter.reason ?? ''} onChange={(e) => set({ reason: (e.target.value || undefined) as CheckId | undefined })}><option value="">все</option>
          {reasons.map((r) => <option key={r.reason} value={r.reason}>{CHECK_RU[r.reason]} ({r.n})</option>)}</select></label>
        {any && <button className="link" onClick={() => setFilter(filter.op ? { op: filter.op } : {})}>сбросить</button>}
      </div>
      <div className="rq-bar rq-group">
        <span><b>{list.length}</b> {any ? `из ${pending.length} ` : ''}ждут проверки</span>
        {reasons.length > 0 && <span className="rq-reasons">{reasons.map((r) => <button key={r.reason} className={`rq-chip${filter.reason === r.reason ? ' on' : ''}`} title={`только эта причина: ${r.only}`} onClick={() => set({ reason: filter.reason === r.reason ? undefined : r.reason })}>{CHECK_RU[r.reason]} {r.n}</button>)}</span>}
        <span className="grow" />
        {reasons.some((r) => r.only) && <span className="rq-bulk">
          <button disabled={busy || !bulkList.length} onClick={() => void acceptAll(bulkList)}>Принять все, где сомнение только в</button>
          <select value={bulkReason} onChange={(e) => setBulk(e.target.value as CheckId)}>{reasons.filter((r) => r.only).map((r) => <option key={r.reason} value={r.reason}>{CHECK_RU[r.reason]}</option>)}</select>
          <span className="muted">({bulkList.length})</span></span>}
        {filter.doc && <button className="danger-btn" disabled={busy || !list.length} onClick={() => void rejectDoc(filter.doc!)}>Отклонить все из документа</button>}
      </div>
      {msg && <div className="rq-msg">{msg}</div>}
      <div className="rq-list">
        {!list.length && <p className="muted">{pending.length ? 'Под фильтр ничего не попало.' : 'Очередь пуста: всё, что извлечено из документов, либо принято, либо отброшено (итоги — у документа во вкладке «Документы»).'}</p>}
        {list.slice(0, limit).map((c) => <CandidateCard key={c.id} c={c} s={s} llm={llm} open={open} />)}
        {list.length > limit && <button className="link" onClick={() => setLimit(limit + 30)}>ещё {list.length - limit}…</button>}
      </div>
    </div>
  );
}

/** Название соединения по id: формирование сценария (любой операции, если известна), запись базы, иначе id. */
function useNames(s: kb.KbState): (id: string) => string {
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const e of s.entries) if (e.category === 'formations') for (const a of e.aliases ?? []) if (/^[a-z]+_/.test(a)) m.set(a, e.title);
    return (id: string) => m.get(id) ?? s.byId.get(id)?.title ?? id;
  }, [s.entries, s.byId]);
}

/** Карточка кандидата: правка на месте, соединение, доказательство, решение, подсказка модели. */
function CandidateCard({ c, s, llm, open }: { c: StoredCandidate; s: kb.KbState; llm: Llm; open: (id: string) => void }) {
  const cx = useOpCtx(c.op);
  const [claim, setClaim] = useState<Claim | undefined>(c.claim);
  const [names, setNames] = useState<Candidate['names']>(c.names);
  const [note, setNote] = useState<{ text: string; kind?: 'warn' | 'ok' } | null>(null);
  const [assist, setAssist] = useState<{ mode: AssistMode; text: string; busy?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setClaim(c.claim); setNames(c.names); }, [c]);
  const edited = !!claim && JSON.stringify(claim) !== JSON.stringify(c.claim);
  const doc = s.documents.find((d) => d.id === candDoc(c));
  const fname = useNames(s);
  const nameOf = (id: string) => cx?.formations.find((f) => f.id === id)?.name ?? fname(id);
  const match = (n: string) => (cx ? matchFormation(n, cx.formations, s.entries) : null);

  const decide = async (accept: boolean) => {
    setBusy(true); setNote(null);
    try {
      const edits = edited && claim ? { [c.id]: { claim, names, value: claimText(claim, nameOf) } } : {};
      const r = await decideCandidates([c.id], accept, edits, acceptCtx(cx ?? await opCtx(c.op)));
      if (r.pending.includes(c.id)) setNote({ text: 'Соединение не найдено ни в сценарии, ни в записях базы: выберите его в карточке.', kind: 'warn' });
    } catch (e) { setNote({ text: (e as Error).message, kind: 'warn' }); } finally { setBusy(false); }
  };
  const ask = async (mode: AssistMode) => {
    setAssist({ mode, text: '', busy: true });
    try {
      const e = c.evidence;
      const tr = e.kind === 'scan' ? (await store.one<{ text: string }>('transcripts', `${e.doc}:${e.page}`))?.text : undefined;
      const cur = { ...c, ...(claim ? { claim } : {}), names } as StoredCandidate;
      const r = await kb.llmClient(kb.kbLlm(llm.settings), 'off').chat({ messages: assistMessages(cur, mode, evidenceText(cur, tr)), schema: { name: 'kb_assist', schema: ASSIST_SCHEMA } });
      const j = (r.json && typeof r.json === 'object' ? r.json : null) as AssistAnswer | null;
      const fix = j ? applyFixes(cur, j.fixes, match) : {};
      if (fix.claim) { setClaim(fix.claim); if (fix.names) setNames(fix.names); }
      setAssist({ mode, text: `${(j?.explanation ?? r.content ?? '').trim() || 'Модель не ответила.'}${fix.claim ? '\n\nПравка подставлена в карточку — проверьте и примите.' : ''}` });
    } catch (e) { setAssist({ mode, text: `Нет ответа модели: ${(e as Error).message}` }); }
  };

  const doubts = c.checks.filter((r) => r.level !== 'ok');
  const kind = candKind(c);
  return (
    <div className="rq-card">
      <div className="rq-left">
        <div className="rq-h"><i className={`rq-kind k-${kind}`}>{kindRu(kind)}</i><b>{c.key}</b><span>{edited && claim ? claimText(claim, nameOf) : c.value}</span></div>
        <div className="rq-src muted">{doc ? <button className="link" onClick={() => open(`doc:${doc.id}`)}>{doc.name}</button> : <span>{c.source}</span>}{c.pages && <span>· {c.pages}</span>}
          {c.reliability && <i className={`kb-rel r${c.reliability}`} title={RELIABILITY[c.reliability]}>{c.reliability}</i>}</div>
        {doubts.length > 0 && <ul className="rq-why">{doubts.map((r, i) => <li key={i} className={r.level}><b>{CHECK_RU[r.check]}:</b> {r.why ?? (r.level === 'fail' ? 'не прошло' : 'сомнение')}</li>)}</ul>}
        {claim ? <ClaimEditor claim={claim} names={names} cx={cx} s={s} nameOf={nameOf} match={match}
          onChange={(x, n) => { setClaim(x); if (n) setNames(n); }} />
          : 'proposal' in c && c.proposal ? <ProposalView c={c} s={s} open={open} /> : null}
        {edited && <div className="rq-edited">изменено <button className="link" onClick={() => { setClaim(c.claim); setNames(c.names); }}>вернуть как было</button></div>}
        <div className="rq-act">
          <button className="primary" disabled={busy} onClick={() => void decide(true)}>{edited ? 'Принять с правкой' : 'Принять'}</button>
          <button disabled={busy} onClick={() => void decide(false)}>Отклонить</button>
          <span className="grow" />
          <button className="link" disabled={assist?.busy || llm.check.state !== 'ok'} title={llm.check.state !== 'ok' ? 'Модель недоступна' : 'Модель роли «разбор документов» объяснит сомнение'} onClick={() => void ask('why')}>Почему сомнение</button>
          {claim && <button className="link" disabled={assist?.busy || llm.check.state !== 'ok'} title={llm.check.state !== 'ok' ? 'Модель недоступна' : 'Модель предложит правку полей; принимает человек'} onClick={() => void ask('fix')}>Предложи исправление</button>}
        </div>
        {note && <div className={note.kind ?? ''}>{note.text}</div>}
        {assist && <div className="rq-assist">{assist.busy ? <><span className="spinner" /> модель {assist.mode === 'why' ? 'разбирает сомнение' : 'ищет исправление'}…</> : assist.text}
          {!assist.busy && <button className="link" onClick={() => setAssist(null)}>скрыть</button>}</div>}
      </div>
      <EvidenceView c={c} />
    </div>
  );
}

/** Поля формальной части: соединение (выбор), даты, числа, пункты, состояние переправы. */
function ClaimEditor({ claim, names, cx, s, nameOf, match, onChange }: {
  claim: Claim; names: Candidate['names']; cx: OpContext | null; s: kb.KbState; nameOf: (id: string) => string; match: (n: string) => string | null;
  onChange: (c: Claim, n?: Candidate['names']) => void;
}) {
  const pick = (i: number) => <SubjectPicker key={`s${i}`} label={claim.kind === 'boundary' ? (i ? 'второе объединение' : 'первое объединение') : 'соединение'}
    value={claim.kind === 'boundary' ? claim.between[i] : 'subject' in claim ? claim.subject : ''} name={claim.kind === 'boundary' ? names.between?.[i] : names.subject}
    cx={cx} entries={s.entries} nameOf={nameOf} match={match} onChange={(id) => onChange(setSubject(claim, id, i))} />;
  return (
    <div className="rq-fields">
      {claim.kind === 'boundary' ? [pick(0), pick(1)] : claim.kind !== 'event' && claim.kind !== 'crossing' ? pick(0) : null}
      {CLAIM_FIELDS[claim.kind].map((f) => f.type === 'subject'
        ? <SubjectPicker key={f.key} label={f.title} value={fieldText(claim, f.key)} name={names.parent} cx={cx} entries={s.entries} nameOf={nameOf} match={match}
          onChange={(id) => onChange({ ...claim, [f.key]: id } as Claim)} />
        : <label key={f.key} className={`rq-f t-${f.type}`}><span>{f.title}</span>
          {f.type === 'state' ? <select value={fieldText(claim, f.key)} onChange={(e) => onChange(setClaimField(claim, f.key, e.target.value))}>
            {Object.entries(CROSSING_STATE_RU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            : <FieldInput claim={claim} k={f.key} onChange={onChange} placeholder={f.type === 'date' ? 'ГГГГ-ММ-ДД' : ''} />}</label>)}
    </div>
  );
}

/** Поле ввода: правка применяется по уходу с поля (числа «4 910» не теряются на полпути). */
function FieldInput({ claim, k, onChange, placeholder }: { claim: Claim; k: string; onChange: (c: Claim) => void; placeholder: string }) {
  const v = fieldText(claim, k);
  const [t, setT] = useState(v);
  useEffect(() => setT(v), [v]);
  const commit = () => { if (t !== v) { const n = setClaimField(claim, k, t); if (n === claim) setT(v); else onChange(n); } };
  return <input value={t} placeholder={placeholder} onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />;
}

/**
 * Выбор соединения: предложенное (сопоставленное или найденное по названию из источника) — первым, затем формирования
 * сценария операции; другая запись базы — поиском по названию.
 */
function SubjectPicker({ label, value, name, cx, entries, nameOf, match, onChange }: {
  label: string; value: string; name?: string; cx: OpContext | null; entries: Entry[]; nameOf: (id: string) => string; match: (n: string) => string | null; onChange: (id: string) => void;
}) {
  const proposed = value || (name ? match(name) ?? '' : '');
  const [find, setFind] = useState(false);
  const [q, setQ] = useState('');
  const forms = cx?.formations ?? [];
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n.length < 2 ? [] : entries.filter((e) => e.category === 'formations' && [e.title, ...(e.aliases ?? [])].some((a) => a.toLowerCase().includes(n))).slice(0, 12);
  }, [q, entries]);
  return (
    <div className="rq-f t-subject"><span>{label}</span>
      <div className="rq-subj">
        <select value={value} onChange={(e) => { if (e.target.value === '\u0000') setFind(true); else onChange(e.target.value); }} className={value ? '' : 'warn'}>
          {!value && <option value="">— не найдено{name ? `: «${name}»` : ''} —</option>}
          {proposed && <option value={proposed}>{nameOf(proposed)}{proposed === value ? '' : ' (предложено)'}</option>}
          {forms.filter((f) => f.id !== proposed).length > 0 && <optgroup label="сценарий операции">{forms.filter((f) => f.id !== proposed).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>}
          {value && value !== proposed && <option value={value}>{nameOf(value)}</option>}
          <option value={'\u0000'}>другая запись базы…</option>
        </select>
        {name && <small className="muted" title="как в источнике">«{name}»</small>}
      </div>
      {find && <div className="rq-find"><input autoFocus placeholder="название формирования" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="link" onClick={() => { setFind(false); setQ(''); }}>✕</button>
        {hits.map((e) => <button key={e.id} className="link" onClick={() => { onChange(e.id); setFind(false); setQ(''); }}>{e.title}</button>)}
        {q.trim().length >= 2 && !hits.length && <span className="muted">не найдено</span>}</div>}
    </div>
  );
}

/** Предложение записи (без формальной части): что добавится в базу. */
function ProposalView({ c, s, open }: { c: StoredCandidate; s: kb.KbState; open: (id: string) => void }) {
  const p = 'proposal' in c ? c.proposal : undefined;
  if (!p) return null;
  const cat = category(p.entry.category);
  return (
    <div className="rq-prop">
      <div>{p.kind === 'new' ? 'Новая запись' : 'Дополнение записи'} {p.kind === 'update' && s.byId.has(p.target!) ? <button className="link" onClick={() => open(p.target!)}>{s.byId.get(p.target!)!.title}</button> : <b>{p.entry.title}</b>}<span className="muted"> · {cat?.title}</span></div>
      {p.kind === 'new' && p.entry.summary && <p>{p.entry.summary}</p>}
      <ul>{p.facts.map((f, i) => <li key={i}><b>{cat?.fields.find((x) => x.key === f.key)?.title ?? f.key}:</b> {f.value}</li>)}</ul>
    </div>
  );
}

/** Доказательство: цитата с подсветкой чисел, картинка страницы с местом и расшифровкой, строка таблицы, выписка агента. */
function EvidenceView({ c }: { c: StoredCandidate }) {
  const e = c.evidence;
  const [img, setImg] = useState<PageImage | null>(null);
  const [tr, setTr] = useState<string | null>(null);
  useEffect(() => {
    if (e.kind !== 'scan') return;
    let alive = true;
    void store.one<PageImage>('pages', `${e.doc}:${e.page}`).then((x) => { if (alive) setImg(x ?? null); });
    void store.one<{ text: string }>('transcripts', `${e.doc}:${e.page}`).then((x) => { if (alive) setTr(x?.text ?? null); });
    return () => { alive = false; };
  }, [e]);
  const marked = (t: string) => numberParts(t).map((p, i) => (p.num ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>));
  return (
    <div className="rq-ev">
      {e.kind === 'quote' && <><small className="muted">цитата, часть {e.chunk + 1}</small><blockquote>«{marked(e.quote)}»</blockquote></>}
      {e.kind === 'scan' && <>
        <small className="muted">страница {e.page} скана</small>
        {img ? <div className="rq-page"><img src={img.url} alt={`страница ${e.page}`} />
          {e.box && <i style={{ left: `${e.box[0] * 100}%`, top: `${e.box[1] * 100}%`, width: `${(e.box[2] - e.box[0]) * 100}%`, height: `${(e.box[3] - e.box[1]) * 100}%` }} />}</div>
          : <p className="muted">картинки страницы нет (документ загружен в другом браузере или удалён)</p>}
        <blockquote>«{marked(e.quote)}»</blockquote>
        {tr && <details><summary>расшифровка страницы</summary><div className="rq-tr">{marked(tr)}</div></details>}
      </>}
      {e.kind === 'row' && <><small className="muted">строка {e.row} таблицы</small>
        <table className="rq-row"><tbody>{Object.entries(e.cells).map(([k, v]) => <tr key={k}><th>{k}</th><td>{marked(v)}</td></tr>)}</tbody></table></>}
      {e.kind === 'agent' && <><small className="muted">выписка внешнего агента</small><div><b>{e.ref}</b></div>{e.quote && <blockquote>«{marked(e.quote)}»</blockquote>}</>}
      {e.kind === 'manual' && <><small className="muted">ручной ввод</small>{e.note && <p>{e.note}</p>}</>}
    </div>
  );
}

/** Открыть очередь «На проверку» в «Знаниях» с фильтром (документ, операция) — из «Моделирования» → «Материалы». */
export function openKbQueue(f: { op?: string; doc?: string }) {
  try { localStorage.setItem('def_ops.kb.queue', JSON.stringify(f)); } catch { /* */ }
  window.dispatchEvent(new CustomEvent('def_ops.kb.queue', { detail: f }));
  location.hash = '#knowledge';
}
