/**
 * Форма факта с формальной частью: «+ Факт» (свой факт в запись), «изменить» (свой факт), «исправить» (встроенный
 * факт — факт пользователя с пометкой corrects и закреплением). Поля — по виду факта, источник, страницы, надёжность,
 * заметка; без источника — факт-допущение. Ручной ввод проходит проверки 3–7: сомнения — замечаниями под формой,
 * сохранить можно.
 */
import { useEffect, useMemo, useState } from 'react';
import { RELIABILITY, runChecks, type CheckCtx, type Claim, type Entry, type Fact, type FactRef, type Reliability } from '@def-ops/knowledge';
import { claimText, KIND_RU } from '../modeling/basis';
import { addManual, correctBuiltin, editFact } from './candidates';
import { claimToForm, FACT_KEY, FORM_FIELDS, formToClaim, formWarnings, manualCandidate, type FormMeta } from './fact-form';
import { strengthFrom, type OpContext } from './ingest';
import { opCtx } from './ReviewQueue';
import * as kb from './kb';
import * as store from './store';

export type FactFormMode =
  | { kind: 'add'; entry: Entry }
  | { kind: 'edit'; entry: Entry; index: number }
  | { kind: 'correct'; ref: FactRef };

const KINDS = Object.keys(FORM_FIELDS) as Claim['kind'][];
const STATE_OPTS: [string, string][] = [['open', 'действует'], ['destroyed', 'разрушена'], ['built', 'наведена']];

/** Вид нового факта по категории записи. */
const defaultKind = (e: Entry): Claim['kind'] => (e.category === 'terrain' ? 'crossing' : e.category === 'operations' || e.category === 'chronology' ? 'event' : 'strength');
/** id формирования записи (su_61a, de_9a). */
const formationId = (e: Entry) => (e.aliases ?? []).find((a) => /^[a-z]+_/.test(a)) ?? '';

/** Данные операций записи для проверок: формирования всех операций, театр и сроки — если операция одна. */
async function checkContext(ops: string[]): Promise<OpContext> {
  const list = await Promise.all(ops.map((o) => opCtx(o)));
  const seen = new Set<string>();
  const formations = list.flatMap((x) => x.formations).filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  return { formations, ...(list[0]?.theatre ? { theatre: list[0].theatre } : {}), ...(list.length === 1 && list[0].op ? { op: list[0].op } : {}) };
}

/** Встроенные записи (сид) по id — для «встроенный» (тот же факт на том же месте, что в сиде); null — ещё не загружен. */
export function useSeed(): Map<string, Entry> | null {
  const [m, setM] = useState<Map<string, Entry> | null>(null);
  useEffect(() => { let alive = true; void store.seed().then((l) => { if (alive) setM(new Map(l.map((e) => [e.id, e]))); }); return () => { alive = false; }; }, []);
  return m;
}

export function FactForm({ mode, ops, starts, allStarts = [], onDone }: { mode: FactFormMode; ops: string[]; starts: string[]; allStarts?: string[]; onDone: (msg?: string) => void }) {
  const entry = mode.kind === 'correct' ? null : mode.entry;
  const base: Fact | null = mode.kind === 'correct' ? mode.ref.fact : mode.kind === 'edit' ? mode.entry.facts?.[mode.index] ?? null : null;
  const [kind, setKind] = useState<Claim['kind']>(base?.claim?.kind ?? (entry ? defaultKind(entry) : 'strength'));
  const [fields, setFields] = useState<Record<string, string>>(() => (base?.claim ? claimToForm(base.claim) : entry ? { subject: formationId(entry) } : {}));
  const [meta, setMeta] = useState<FormMeta>(() => mode.kind === 'edit' && base
    ? { source: base.source ?? '', pages: base.pages ?? '', reliability: base.reliability, note: base.evidence?.kind === 'manual' ? base.evidence.note ?? '' : '' }
    : { source: '', pages: '', reliability: 'B', note: '' });
  const [cx, setCx] = useState<OpContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const opsKey = ops.join(',');
  useEffect(() => { let alive = true; void checkContext(ops).then((x) => { if (alive) setCx(x); }); return () => { alive = false; }; }, [opsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = kb.current();
  /** Известные id формирований: сценарии операций записи и псевдонимы записей формирований. */
  const known = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of s.entries) if (e.category === 'formations') for (const a of e.aliases ?? []) if (/^[a-z]+_/.test(a)) m.set(a, e.title);
    for (const f of cx?.formations ?? []) m.set(f.id, f.name);
    return m;
  }, [s.entries, cx]);
  const name = (id: string) => known.get(id) ?? id;

  /** Формальная часть: введённое название (не id) — пустой id и название для сопоставления проверкой «соединение». */
  const built = useMemo(() => {
    const r = formToClaim(kind, fields);
    if ('error' in r) return r;
    const c = { ...r.claim } as Claim & Record<string, unknown>;
    const names: Record<string, unknown> = {};
    const unknownName = (v: string) => !known.has(v);
    if (c.kind === 'boundary') {
      const b = [...c.between] as [string, string];
      const nm: [string, string] = ['', ''];
      let any = false;
      b.forEach((v, i) => { if (unknownName(v)) { nm[i] = v; b[i] = ''; any = true; } });
      c.between = b;
      if (any) names.between = nm;
    } else if (c.kind !== 'event' && c.kind !== 'crossing' && c.kind !== 'param' && c.kind !== 'outcome') {
      if (unknownName(c.subject)) { names.subject = c.subject; c.subject = ''; }
      if (c.kind === 'parent' && unknownName(c.parent)) { names.parent = c.parent; c.parent = ''; }
    }
    return { claim: c as Claim, names: names as { subject?: string; parent?: string; between?: [string, string] } };
  }, [kind, fields, known]);

  /** Проверки 3–7 (без самого изменяемого факта среди имеющихся — иначе «повтор»). */
  const checked = useMemo(() => {
    if ('error' in built || !cx) return null;
    const existing = s.entries.flatMap((e) => (e.facts ?? []).filter((f, i) => f.claim && !(mode.kind === 'edit' && e.id === mode.entry.id && i === mode.index)));
    const c = manualCandidate(structuredClone(built.claim), meta, { id: `manual:${Date.now().toString(36)}`, names: built.names, value: '', ...(ops.length === 1 ? { op: ops[0] } : {}) });
    const ctx: CheckCtx = { formations: cx.formations, entries: s.entries, ...(cx.theatre ? { theatre: cx.theatre } : {}), ...(cx.op ? { op: cx.op } : {}), strengthOf: strengthFrom(existing), existing };
    c.checks = runChecks(c, ctx);
    // не сопоставлено — остаётся введённое название (факт попадёт в «Не сопоставлено» сборки, а не потеряет соединение)
    const cl = c.claim as Claim & Record<string, unknown>;
    if (cl.kind === 'boundary') cl.between = cl.between.map((v, i) => v || built.names.between?.[i] || '') as [string, string];
    else {
      if ('subject' in cl && !cl.subject && built.names.subject) cl.subject = built.names.subject;
      if (cl.kind === 'parent' && !cl.parent && built.names.parent) cl.parent = built.names.parent;
    }
    c.value = claimText(c.claim, name);
    return c;
  }, [built, meta, cx, s.entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const warnings = checked ? formWarnings(checked.checks, meta) : [];

  const save = async () => {
    if (!checked) return;
    setBusy(true); setErr(null);
    try {
      const claim = checked.claim;
      const source = meta.source.trim();
      if (mode.kind === 'correct') {
        await correctBuiltin(mode.ref, claim, { source, ...(source && meta.pages?.trim() ? { pages: meta.pages.trim() } : {}), ...(source && meta.reliability ? { reliability: meta.reliability } : {}), ...(meta.note?.trim() ? { note: meta.note.trim() } : {}), starts });
        onDone('Исправление сохранено: встроенный факт больше не берётся в модель там, где выбирался.');
      } else if (mode.kind === 'edit' && base) {
        const { reliability: _r, pages: _p, ...rest } = base;
        const fact: Fact = {
          ...rest, key: base.key || FACT_KEY[claim.kind], value: checked.value, claim, source: checked.source,
          ...(checked.pages ? { pages: checked.pages } : {}), ...(checked.reliability ? { reliability: checked.reliability } : {}),
          // доказательство документа остаётся; ручной ввод — с новой заметкой
          evidence: !base.evidence || base.evidence.kind === 'manual' ? checked.evidence : base.evidence,
          check: { by: 'human', at: '', results: checked.checks },
        };
        await editFact(mode.entry.id, mode.index, fact, { starts, allStarts });
        onDone('Факт изменён.');
      } else if (entry) {
        const r = await addManual(checked, { formations: cx?.formations ?? [], ...(cx?.theatre ? { theatre: cx.theatre } : {}) }, entry.id);
        onDone('pending' in r ? 'Факт ждёт в очереди «На проверку»: соединение не найдено.' : 'Факт добавлен в запись.');
      }
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const set = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const title = mode.kind === 'correct' ? 'Исправить встроенный факт' : mode.kind === 'edit' ? 'Изменить факт' : 'Новый факт';
  return <div className="kb-edit kb-fact-form">
    <b>{title}</b>
    {mode.kind === 'correct' && <p className="muted small">Сохранение создаёт ваш факт с источником и пометкой «исправляет встроенный»; встроенный в модель больше не берётся. Сам встроенный факт не меняется.</p>}
    <div className="row">
      <label>Вид <select value={kind} disabled={mode.kind !== 'add'} onChange={(e) => { setKind(e.target.value as Claim['kind']); }}>
        {KINDS.map((k) => <option key={k} value={k}>{KIND_RU[k] ?? k}</option>)}</select></label>
    </div>
    <datalist id="kb-ff-formations">{[...known].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</datalist>
    <div className="kb-ff-fields">
      {FORM_FIELDS[kind].map((f) => <label key={f.key}>{f.title}{f.required ? ' *' : ''}
        {f.type === 'state' ? <select value={fields[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}><option value="">—</option>{STATE_OPTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
          : <input type="text" value={fields[f.key] ?? ''} list={f.type === 'subject' ? 'kb-ff-formations' : undefined}
            placeholder={f.type === 'date' ? 'ГГГГ-ММ-ДД' : f.type === 'subject' ? 'id или название' : f.type === 'list' ? 'пункт — пункт' : ''}
            title={f.type === 'subject' && fields[f.key] ? name(fields[f.key]) : undefined} onChange={(e) => set(f.key, e.target.value)} />}</label>)}
    </div>
    <div className="kb-ff-fields">
      <label className="grow">Источник <input type="text" value={meta.source} placeholder="документ, книга, шифр — без источника факт станет допущением" onChange={(e) => setMeta({ ...meta, source: e.target.value })} /></label>
      <label>Страницы <input type="text" value={meta.pages ?? ''} onChange={(e) => setMeta({ ...meta, pages: e.target.value })} /></label>
      <label>Надёжность <select value={meta.reliability ?? ''} disabled={!meta.source.trim()} onChange={(e) => setMeta({ ...meta, reliability: (e.target.value || undefined) as Reliability | undefined })}>
        {(['A', 'B', 'C'] as Reliability[]).map((r) => <option key={r} value={r}>{r} — {RELIABILITY[r]}</option>)}</select></label>
      <label className="grow">Заметка <input type="text" value={meta.note ?? ''} onChange={(e) => setMeta({ ...meta, note: e.target.value })} /></label>
    </div>
    {'error' in built ? <div className="err">{built.error}</div>
      : checked && <div className="muted small">Будет записано: {checked.value}</div>}
    {warnings.length > 0 && <ul className="kb-ff-warn warn">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    {err && <div className="err">{err}</div>}
    <div className="row">
      <button className="primary" disabled={busy || !checked} onClick={() => void save()}>{busy ? 'Сохранение…' : 'Сохранить'}</button>
      <button onClick={() => onDone()}>Отмена</button>
      {warnings.length > 0 && <span className="muted small">Замечания не мешают сохранить.</span>}
    </div>
  </div>;
}
