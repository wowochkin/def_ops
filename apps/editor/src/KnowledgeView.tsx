/**
 * Раздел «Знания»: база знаний по операциям — для обучения и для модели. Каркас категорий (операции,
 * сражения, формирования, командование, доктрина, техника, театр, хронология, источники), карточки
 * записей с фактами и источниками, вопросы и рассказы по материалам базы (модель отвечает только по ним,
 * со ссылками), загрузка документов: модель извлекает сведения с цитатами, человек принимает предложения.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { category, inOperation, RELATION_RU, RELIABILITY, rubric, rubricPath, rubricsOf, RUBRICS, STATUS_RU, within, type Entry, type KbDocument, type KbOperation, type Proposal, type Reliability, type Rubric, type Source, type Hit } from '@def-ops/knowledge';
import { kbOperations, onDataChange } from './sim/userdata';
import * as kb from './kb/kb';
import { QWEN_EMBED } from './kb/vectors';
import type { Llm } from './shared';
import { ModelPicker } from './ModelPicker';
import { mdToHtml } from './markdown';
import { download } from './ReplayView';

type Tab = 'browse' | 'docs';
interface QA { id: number; mode: 'ask' | 'lecture'; q: string; text: string; thinking: string; model?: string; seconds?: number; search?: string; stage?: 'search' | 'model'; sources: Source[]; done: boolean; error?: string }

export function KnowledgeView({ llm }: { llm: Llm }) {
  const [s, setS] = useState<kb.KbState>(kb.current());
  const [tab, setTab] = useState<Tab>('browse');
  const [sel, setSel] = useState<string | null>('op:berlin');
  const [hist, setHist] = useState<string[]>([]);
  useEffect(() => { void kb.load(); return kb.subscribe(setS); }, []);
  // операция: '' — все материалы, 'general' — общие (без операции), иначе id операции
  const [ops, setOps] = useState<KbOperation[]>([]);
  const [op, setOp] = useState<string>(() => { try { return localStorage.getItem('def_ops.kbOp') ?? ''; } catch { return ''; } });
  useEffect(() => { const f = () => void kbOperations().then(setOps); f(); return onDataChange(f); }, []);
  useEffect(() => { try { localStorage.setItem('def_ops.kbOp', op); } catch { /* */ } }, [op]);
  const scoped = useMemo(() => scope(s, op, ops), [s, op, ops]);
  const open = (id: string) => { setTab('browse'); setSel((cur) => { if (cur && cur !== id) setHist((h) => [...h.slice(-20), cur]); return id; }); };
  const pending = scoped.proposals.filter((p) => p.status === 'pending').length;
  return (
    <div className="kb">
      <div className="kb-top">
        <h2>Знания</h2>
        <nav className="kb-tabs">
          <button className={tab === 'browse' ? 'on' : ''} onClick={() => setTab('browse')}>Материалы</button>
          <button className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>Документы{pending ? <i className="kb-badge">{pending}</i> : null}</button>
        </nav>
        <label className="kb-op" title="Материалы операции: записи из разбора её документов и относящиеся к ней по периоду и рубрикам">Операция
          <select value={op} onChange={(e) => setOp(e.target.value)}><option value="">все материалы</option><option value="general">общие (без операции)</option>
            {ops.map((o) => <option key={o.id} value={o.id}>{o.title.split(':')[0]}</option>)}</select></label>
        <span className="muted">{s.ready ? `${scoped.entries.length} записей, ${scoped.documents.length} документов` : 'загрузка…'}</span>
      </div>
      {!s.ready ? <div className="kb-wait"><span className="spinner" /> загрузка базы…</div>
        : tab === 'browse' ? <Browse s={scoped} sel={sel} open={open} back={hist.length ? () => { setSel(hist[hist.length - 1]); setHist((h) => h.slice(0, -1)); } : null} llm={llm} />
        : <Docs s={scoped} llm={llm} open={open} op={op && op !== 'general' ? ops.find((o) => o.id === op) ?? null : null} ops={ops} />}
    </div>
  );
}

/** База в разрезе операции: записи, документы и предложения операции (связи и карточки — по всей базе). */
function scope(s: kb.KbState, op: string, ops: KbOperation[]): kb.KbState {
  if (!op) return s;
  const docOk = (d: KbDocument) => (op === 'general' ? !d.operation : d.operation === op);
  const documents = s.documents.filter(docOk);
  const ids = new Set(documents.map((d) => d.id));
  return { ...s, entries: s.entries.filter((e) => inOperation(e, op, ops)), documents, proposals: s.proposals.filter((p) => ids.has(p.doc)), infra: s.infra.filter((p) => ids.has(p.doc)) };
}

/* ───────────── материалы: каркас, карточка, вопросы ───────────── */

function Browse({ s, sel, open, back, llm }: { s: kb.KbState; sel: string | null; open: (id: string) => void; back: (() => void) | null; llm: Llm }) {
  const [q, setQ] = useState('');
  const [node, setNode] = useState<string>('1.2');
  const [cat, setCat] = useState<string | null>(null);
  const [limit, setLimit] = useState(150);
  const bm = useMemo(() => (q.trim() && s.index ? s.index.search(q, { limit: 60 }) : null), [q, s.index]);
  // смысловой поиск (если готовы векторы) — после паузы в наборе
  const [sem, setSem] = useState<{ q: string; hits: Hit[] } | null>(null);
  useEffect(() => {
    if (!q.trim() || s.vec.status !== 'ready') return;
    const t = setTimeout(() => { void kb.search(q, 60).then((hits) => setSem({ q, hits })); }, 350);
    return () => clearTimeout(t);
  }, [q, s.vec.status]);
  const inScope = useMemo(() => new Set([...s.entries.map((e) => e.id), ...s.documents.map((d) => d.id)]), [s.entries, s.documents]);
  const found = (sem && sem.q === q ? sem.hits : bm)?.filter((h) => inScope.has(h.ref)) ?? null;
  const rubs = useMemo(() => new Map(s.entries.map((e) => [e.id, rubricsOf(e)])), [s.entries]);
  // число записей в рубрике — с вложенными, каждая запись один раз
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const codes of rubs.values()) {
      const all = new Set<string>();
      for (const c of codes) { const parts = c.split('.'); for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('.')); }
      for (const c of all) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  }, [rubs]);
  const inNode = useMemo(() => s.entries.filter((e) => (rubs.get(e.id) ?? []).some((c) => within(c, node))), [node, s.entries, rubs]);
  const cats = useMemo(() => { const m = new Map<string, number>(); for (const e of inNode) m.set(e.category, (m.get(e.category) ?? 0) + 1); return m; }, [inNode]);
  const list = useMemo(() => inNode.filter((e) => !cat || e.category === cat)
    // сначала записи, у которых эта рубрика главная, затем по дате и названию
    .sort((a, b) => Number(!within(rubs.get(a.id)?.[0] ?? '', node)) - Number(!within(rubs.get(b.id)?.[0] ?? '', node)) || (a.period?.from ?? '').localeCompare(b.period?.from ?? '') || a.title.localeCompare(b.title, 'ru')), [inNode, cat, node, rubs]);
  useEffect(() => { setLimit(150); setCat(null); }, [node]);
  const goRubric = (code: string) => { setQ(''); setNode(code); };
  const e = sel ? s.byId.get(sel) ?? null : null;
  const path = rubricPath(node);
  return (
    <div className="kb-browse">
      <aside className="kb-tree">
        <input className="kb-search" placeholder="Поиск по базе…" value={q} onChange={(ev) => setQ(ev.target.value)} />
        {found ? <div className="kb-list">
          {found.length ? found.map((h) => <button key={h.id} className={sel === h.ref ? 'on' : ''} onClick={() => h.kind === 'entry' ? open(h.ref) : open(`doc:${h.ref}`)}>
            {h.title}<small>{h.kind === 'entry' ? category(s.byId.get(h.ref)?.category ?? '')?.title : 'документ'}</small></button>) : <span className="muted">Ничего не найдено</span>}
        </div> : <>
          <RubricTree list={RUBRICS} node={node} setNode={setNode} counts={counts} />
          <div className="kb-list">
            <div className="kb-list-h"><b>{node} {path[path.length - 1]?.title}</b>{rubric(node)?.description && <small>{rubric(node)!.description}</small>}</div>
            {cats.size > 1 && <div className="kb-cats"><button className={!cat ? 'on' : ''} onClick={() => setCat(null)}>все</button>
              {[...cats].map(([c, n]) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{category(c)?.title} {n}</button>)}</div>}
            {list.slice(0, limit).map((x) => <button key={x.id} className={sel === x.id ? 'on' : ''} onClick={() => open(x.id)}>{x.title}<small>{category(x.category)?.title}</small>{x.status !== 'checked' && <i className={`kb-st s-${x.status}`} title={STATUS_RU[x.status]} />}</button>)}
            {list.length > limit && <button className="link" onClick={() => setLimit(limit + 300)}>ещё {list.length - limit}…</button>}
            {!list.length && <span className="muted kb-empty">В рубрике пока нет записей — их можно добавить, загрузив документы (вкладка «Документы»).</span>}
          </div>
        </>}
      </aside>
      <main className="kb-main">
        {e ? <EntryCard e={e} s={s} open={open} back={back} goRubric={goRubric} /> : <div className="muted kb-wait">Выберите запись слева.</div>}
      </main>
      <Ask llm={llm} s={s} open={open} topic={e?.title ?? ''} />
    </div>
  );
}

/** Дерево рубрик: раскрыты предки выбранной рубрики и её дети. */
function RubricTree({ list, node, setNode, counts, depth = 0 }: { list: Rubric[]; node: string; setNode: (c: string) => void; counts: Map<string, number>; depth?: number }) {
  return <>{list.map((r) => {
    const open = within(node, r.code) && !!r.children;
    const n = counts.get(r.code) ?? 0;
    return (
      <div key={r.code} className="kb-cat">
        <button className={`${depth ? 'kb-grp' : 'kb-cat-h'}${node === r.code ? ' on' : ''}${n ? '' : ' empty'}`} style={depth ? { paddingLeft: 8 + depth * 12 } : undefined} onClick={() => setNode(r.code)} title={r.description}>
          <span><i className="kb-code">{r.code}</i>{r.title}</span><small>{n || '—'}</small></button>
        {open && <RubricTree list={r.children!} node={node} setNode={setNode} counts={counts} depth={depth + 1} />}
      </div>
    );
  })}</>;
}

/** Источник в таблице фактов: «Википедия (de): «Статья»» → «de.wiki: Статья», книги — до 26 знаков. */
const shortSrc = (t: string) => { const w = /^Википедия \((\w+)\): «(.+)»$/.exec(t); const x = w ? `${w[1]}.wiki: ${w[2]}` : t; return x.length > 26 ? `${x.slice(0, 25)}…` : x; };
const relBadge = (r?: Reliability) => r ? <i className={`kb-rel r${r}`} title={RELIABILITY[r]}>{r}</i> : null;

function EntryCard({ e, s, open, back, goRubric }: { e: Entry; s: kb.KbState; open: (id: string) => void; back: (() => void) | null; goRubric: (code: string) => void }) {
  const c = category(e.category)!;
  const [editing, setEditing] = useState(false);
  const facts = e.facts ?? [];
  const keys = [...new Set([...c.fields.map((f) => f.key), ...facts.map((f) => f.key)])];
  const relGroups = new Map<string, string[]>();
  for (const r of e.relations ?? []) relGroups.set(r.type, [...(relGroups.get(r.type) ?? []), r.target]);
  const incoming = useMemo(() => s.entries.filter((x) => x.id !== e.id && (x.relations ?? []).some((r) => r.target === e.id) && !(e.relations ?? []).some((r) => r.target === x.id)).slice(0, 40), [e.id, s.entries]); // eslint-disable-line react-hooks/exhaustive-deps
  const doc = e.id.startsWith('doc:') ? s.documents.find((d) => `doc:${d.id}` === e.id) : null;
  return (
    <article className="kb-card">
      <div className="kb-crumbs">{back && <button className="link" onClick={back}>← назад</button>}<span>{c.title}{e.group ? ` › ${c.groups.find((g) => g.id === e.group)?.title ?? e.group}` : ''}</span>
        <i className={`kb-status s-${e.status}`}>{STATUS_RU[e.status]}</i>{e.origin && e.origin !== 'seed' && <i className="kb-status user">{e.origin === 'document' ? 'из документа' : 'изменено'}</i>}</div>
      <h1>{e.title}</h1>
      <div className="kb-rubs">{rubricsOf(e).map((c) => <button key={c} className="kb-rub" onClick={() => goRubric(c)} title="Открыть рубрику">{c} {rubricPath(c).slice(1).map((x) => x.title).join(' › ') || rubric(c)?.title}</button>)}</div>
      {e.aliases?.length ? <div className="muted kb-alias">{e.aliases.filter((a) => !/^[a-z]+_/.test(a)).join(' · ')}</div> : null}
      {e.period?.from && <div className="kb-period">{e.period.from === e.period.to || !e.period.to ? e.period.from : `${e.period.from} — ${e.period.to}`}</div>}
      {editing ? <EditEntry e={e} done={() => setEditing(false)} /> : <p className="kb-summary">{e.summary}</p>}
      <div className="kb-actions">
        {!editing && <button className="link" onClick={() => setEditing(true)}>править</button>}
        {!editing && e.status !== 'checked' && <button className="link" onClick={() => kb.saveEntry({ ...e, status: 'checked' })}>отметить «проверено»</button>}
      </div>
      {keys.some((k) => facts.some((f) => f.key === k)) && <table className="kb-facts"><tbody>
        {keys.flatMap((k) => facts.filter((f) => f.key === k).map((f, i) => (
          <tr key={`${k}${i}`}><th>{i === 0 ? c.fields.find((x) => x.key === k)?.title ?? k : ''}</th>
            <td>{f.value}{f.quote && <div className="kb-quote">«{f.quote}»</div>}</td>
            <td className="kb-src">{relBadge(f.reliability)}{f.source && (s.byId.has(f.source) ? <button className="link" title={s.byId.get(f.source)!.title} onClick={() => open(f.source!)}>{shortSrc(s.byId.get(f.source)!.title)}</button> : <span>{f.source}</span>)}{f.pages && <small> {f.pages}</small>}</td></tr>
        )))}
      </tbody></table>}
      {c.fields.filter((f) => !facts.some((x) => x.key === f.key)).length > 0 && <div className="kb-gaps">Нет сведений: {c.fields.filter((f) => !facts.some((x) => x.key === f.key)).map((f) => f.title.toLowerCase()).join(', ')} — можно дополнить документами.</div>}
      {(e.sections ?? []).map((sec, i) => <section key={i} className="kb-sec"><h3>{sec.title}</h3><div dangerouslySetInnerHTML={{ __html: mdToHtml(sec.text) }} /></section>)}
      {doc && <section className="kb-sec"><h3>Текст документа</h3>{doc.chunks.slice(0, 3).map((ch) => <p key={ch.i} className="kb-chunk">{ch.text.slice(0, 1200)}{ch.text.length > 1200 ? '…' : ''}</p>)}{doc.chunks.length > 3 && <p className="muted">…ещё {doc.chunks.length - 3} частей (ищутся при ответах)</p>}</section>}
      {relGroups.size > 0 && <section className="kb-sec"><h3>Связи</h3>{[...relGroups].map(([t, ids]) => (
        <div key={t} className="kb-rels"><span>{RELATION_RU[t as keyof typeof RELATION_RU] ?? t}:</span>{ids.slice(0, 60).map((id) => <button key={id} className="kb-link" onClick={() => open(id)}>{s.byId.get(id)?.title ?? id}</button>)}{ids.length > 60 && <span className="muted">и ещё {ids.length - 60}</span>}</div>))}</section>}
      {incoming.length > 0 && <section className="kb-sec"><h3>Упоминается в</h3><div className="kb-rels">{incoming.map((x) => <button key={x.id} className="kb-link" onClick={() => open(x.id)}>{x.title}</button>)}</div></section>}
    </article>
  );
}

function EditEntry({ e, done }: { e: Entry; done: () => void }) {
  const [summary, setSummary] = useState(e.summary);
  const [status, setStatus] = useState(e.status);
  return (
    <div className="kb-edit">
      <textarea rows={4} value={summary} onChange={(ev) => setSummary(ev.target.value)} />
      <div className="row"><select value={status} onChange={(ev) => setStatus(ev.target.value as Entry['status'])}>{Object.entries(STATUS_RU).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="primary" onClick={async () => { await kb.saveEntry({ ...e, summary, status }); done(); }}>Сохранить</button><button onClick={done}>Отмена</button></div>
    </div>
  );
}

function Ask({ llm, s, open, topic }: { llm: Llm; s: kb.KbState; open: (id: string) => void; topic: string }) {
  const [msgs, setMsgs] = useState<QA[]>([]);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'ask' | 'lecture'>('ask');
  const end = useRef<HTMLDivElement>(null);
  const id = useRef(0);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);
  const busy = msgs.some((m) => !m.done);
  const ctl = useRef(new AbortController());
  // ушли из раздела — ответ прерывается, модель освобождается
  useEffect(() => () => ctl.current.abort(), []);
  const go = async (q: string, m = mode) => {
    if (!q.trim() || busy) return;
    ctl.current = new AbortController();
    const my = ++id.current;
    setMsgs((l) => [...l, { id: my, mode: m, q, text: '', thinking: '', sources: [], done: false }]);
    setText('');
    try {
      const hist = msgs.filter((x) => x.done && !x.error).slice(-3).map((x) => ({ q: x.q, a: x.text }));
      const r = await kb.ask(m, q, llm.settings, hist, (v) => setMsgs((l) => l.map((x) => (x.id === my ? { ...x, text: v.answer, thinking: v.thinking, stage: v.stage } : x))), ctl.current.signal);
      setMsgs((l) => l.map((x) => (x.id === my ? { ...x, text: r.text, thinking: r.thinking, sources: r.sources, model: r.model, seconds: r.seconds, search: r.search, done: true } : x)));
    } catch (err) {
      setMsgs((l) => l.map((x) => (x.id === my ? { ...x, done: true, error: (err as Error).message } : x)));
    }
  };
  return (
    <aside className="kb-ask">
      <div className="kb-ask-h"><b>Спросить</b><span className="muted">модель отвечает только по материалам базы, со ссылками</span>{msgs.length > 0 && <button className="link" onClick={() => { ctl.current.abort(); setMsgs([]); }}>очистить</button>}</div>
      <ModelPicker llm={llm} who="kb" purpose="ответов и разбора документов" />
      <div className="kb-ask-body">
        {!msgs.length && <div className="muted">Задайте вопрос или попросите рассказать по теме. {topic && <><br /><br /><button className="link" onClick={() => go(topic, 'lecture')}>Рассказать: «{topic}»</button></>}</div>}
        {msgs.map((m) => <QAItem key={m.id} m={m} s={s} open={open} llmOff={kb.kbLlm(llm.settings).thinking === 'off'} />)}
        <div ref={end} />
      </div>
      <div className="seg kb-mode"><button className={mode === 'ask' ? 'on' : ''} onClick={() => setMode('ask')}>Ответить на вопрос</button><button className={mode === 'lecture' ? 'on' : ''} onClick={() => setMode('lecture')}>Рассказать по теме</button></div>
      <div className="adv-in">
        <textarea rows={2} value={text} placeholder={mode === 'ask' ? 'Например: почему прорыв на Зееловских высотах затянулся?' : 'Тема, например: котёл у Хальбе'} onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void go(text); } }} />
        {busy ? <button onClick={() => ctl.current.abort()}>Остановить</button>
          : <button className="primary" disabled={!text.trim()} onClick={() => go(text)}>{mode === 'ask' ? 'Спросить' : 'Рассказать'}</button>}
      </div>
      {llm.check.state === 'fail' && <div className="adv-note err">Модель недоступна: {llm.check.error} — настройки в разделе «ИИ».</div>}
    </aside>
  );
}

function QAItem({ m, s, open, llmOff }: { m: QA; s: kb.KbState; open: (id: string) => void; llmOff: boolean }) {
  // ссылки [1], [1, 2], [1–3] — каждая цифра ведёт к своему материалу
  const html = useMemo(() => mdToHtml(kb.cleanAnswer(m.text || '')).replace(/\[(\d{1,2}(?:\s*[,;–-]\s*\d{1,2})*)\]/g, (all, list: string) => {
    const nums = list.split(/\s*([,;–-])\s*/);
    if (!nums.some((x) => /^\d+$/.test(x) && m.sources.some((s) => s.n === +x))) return all;
    return '[' + nums.map((x) => (/^\d+$/.test(x) && m.sources.some((s) => s.n === +x) ? `<a class="kb-cite" data-n="${x}">${x}</a>` : x === ',' || x === ';' ? `${x} ` : x)).join('') + ']';
  }), [m.text, m.sources]);
  const click = (ev: React.MouseEvent) => {
    const n = (ev.target as HTMLElement).dataset.n;
    const src = n ? m.sources.find((x) => x.n === +n) : null;
    if (src) open(src.kind === 'entry' ? src.ref : `doc:${src.ref}`);
  };
  return (
    <div className="adv-msg">
      <div className="adv-q"><small>{m.mode === 'ask' ? 'вопрос' : 'рассказ'}</small>{m.q}</div>
      <div className="adv-a kb-answer">
        {!m.done && !m.text && <div className="kb-wait-line"><span className="spinner" /> {m.stage === 'search' ? 'поиск по базе…' : m.thinking ? `модель размышляет…${llmOff ? ' (эта модель размышляет и при выключенном размышлении)' : ''}` : 'модель читает материалы…'}</div>}
        {m.thinking && (m.done ? <details className="kb-think"><summary>размышление модели</summary><div>{m.thinking}</div></details>
          : !m.text && <div className="kb-think live">{m.thinking.slice(-600)}</div>)}
        {m.error ? <span className="err">{/abort/i.test(m.error) ? 'Остановлено.' : `Нет ответа: ${m.error}`}</span> : m.text && <div onClick={click} dangerouslySetInnerHTML={{ __html: html }} />}
        {!m.done && m.text && <span className="kb-caret" />}
        {m.done && m.sources.length > 0 && <div className="kb-srcs"><small className="muted">Материалы:</small>{m.sources.map((x) => <button key={x.n} className="kb-link" onClick={() => open(x.kind === 'entry' ? x.ref : `doc:${x.ref}`)}>[{x.n}] {x.title}</button>)}</div>}
        {m.done && !m.sources.length && !m.error && <small className="muted">в базе по запросу ничего не найдено</small>}
        {m.done && m.model && <small className="muted kb-meta">{m.model} · {m.seconds} с{m.search ? ` · ${m.search}` : ''}</small>}
      </div>
      {void s}
    </div>
  );
}

/* ───────────── документы ───────────── */

function Docs({ s, llm, open, op, ops }: { s: kb.KbState; llm: Llm; open: (id: string) => void; op: KbOperation | null; ops: KbOperation[] }) {
  const [rel, setRel] = useState<Reliability>('B');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const pending = s.proposals.filter((p) => p.status === 'pending' && (!filter || p.doc === filter));
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr(null);
    for (const f of [...files]) {
      setBusy(`чтение «${f.name}»…`);
      try { await kb.addFile(f, rel, note, op?.id); } catch (e) { setErr(`${f.name}: ${(e as Error).message}`); }
    }
    setBusy(null); setNote('');
  };
  return (
    <div className="kb-docs">
      <VecCard s={s} llm={llm} />
      <section className="card kb-upload">
        <h3>Загрузить документы</h3>
        <p className="muted">PDF (с текстовым слоем), Word (.docx), HTML, txt, md. Документ разбивается на части; модель выписывает из каждой сведения по каркасу — только сказанное в тексте и с дословной цитатой; факты без найденной цитаты отбрасываются. Получаются предложения: новая запись или дополнение существующей — вы принимаете или отклоняете. Текст документа сразу участвует в поиске и ответах. Хранится в этом браузере; обмен — выгрузкой.</p>
        <p className={op ? 'ok' : 'muted'}>{op ? <>Документы будут отнесены к операции <b>{op.title.split(':')[0]}</b>: записи — в её разделе базы, а разбор ищет ещё и сведения об инфраструктуре (мосты, переправы, дороги) — их видно и принимают в «Моделирование» → «Операции».</> : 'Общие документы (без операции). Чтобы отнести документ к операции, выберите её вверху.'}</p>
        <div className="row">
          <label>Достоверность <select value={rel} onChange={(e) => setRel(e.target.value as Reliability)}>{(['A', 'B', 'C'] as Reliability[]).map((r) => <option key={r} value={r}>{r} — {RELIABILITY[r]}</option>)}</select></label>
          <input className="grow" placeholder="Что за документ (автор, издание, о чём) — необязательно" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <label className="kb-drop"><input type="file" multiple accept=".pdf,.docx,.txt,.md,.html,.htm" onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />{busy ?? 'Выбрать файлы…'}</label>
        {err && <div className="err">{err}</div>}
        <div className="row"><button onClick={async () => download(`база-знаний-${new Date().toISOString().slice(0, 10)}.json`, await kb.exportUser(), 'application/json')}>Выгрузить мои материалы</button>
          <label className="btnlike">Загрузить выгрузку<input type="file" accept=".json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { await kb.importUser(await f.text()); } catch (x) { setErr((x as Error).message); } } e.target.value = ''; }} /></label></div>
      </section>
      <section className="card">
        <h3>Документы</h3>
        {!s.documents.length && <p className="muted">Пока нет загруженных документов.</p>}
        {s.documents.map((d) => <DocRow key={d.id} d={d} s={s} llm={llm} open={open} opTitle={ops.find((o) => o.id === d.operation)?.title} onFilter={() => setFilter(filter === d.id ? null : d.id)} filtered={filter === d.id} />)}
      </section>
      <section className="card">
        <div className="row"><h3>Предложения на проверку {pending.length ? `· ${pending.length}` : ''}</h3>{filter && <button className="link" onClick={() => setFilter(null)}>все документы</button>}<span className="grow" />
          {pending.length > 0 && <><button onClick={() => kb.decide(pending.map((p) => p.id), true)}>Принять все</button><button onClick={() => kb.decide(pending.map((p) => p.id), false)}>Отклонить все</button></>}</div>
        {!pending.length && <p className="muted">Нет предложений. Обработайте документ моделью.</p>}
        {pending.slice(0, 100).map((p) => <ProposalCard key={p.id} p={p} s={s} open={open} />)}
      </section>
    </div>
  );
}

const VEC_RU: Record<kb.KbState['vec']['status'], string> = { none: 'нет модели эмбеддингов', off: 'выключен', testing: 'самопроверка модели…', indexing: 'расчёт векторов…', ready: 'готов', error: 'ошибка' };

/** Смысловой поиск: модель эмбеддингов (Qwen3-Embedding в LM Studio), состояние векторов. */
function VecCard({ s, llm }: { s: kb.KbState; llm: Llm }) {
  const v = s.vec;
  const avail = llm.check.state === 'ok' ? llm.check.embedModels : [];
  return (
    <section className="card">
      <h3>Смысловой поиск</h3>
      <p className="muted">Кроме поиска по словам база ищет по смыслу: модель эмбеддингов переводит записи и вопрос в векторы, выдачи сливаются.
        Нужна модель <b>Qwen3-Embedding</b> на сервере моделей (LM Studio и т. п.) рядом с основной (поиск «qwen3 embedding», GGUF; 0.6B — быстро, ~0,6 ГБ; 4B — точнее).
        Без неё работает поиск по словам.</p>
      <div className="row">
        <label>Модель <select value={llm.settings.embedModel ?? ''} onChange={(e) => llm.set({ embedModel: e.target.value })}>
          <option value="">авто{avail.some((m) => QWEN_EMBED.test(m)) ? ` (${avail.find((m) => QWEN_EMBED.test(m))})` : ' — Qwen3-Embedding не найдена'}</option>
          {avail.map((m) => <option key={m} value={m}>{m}</option>)}
          <option value="off">выключить</option>
        </select></label>
        <button className="link" onClick={llm.recheck} title="Перечитать список моделей на сервере">обновить список</button>
        <label>Длина вектора <select value={llm.settings.embedDims ?? 1024} onChange={(e) => llm.set({ embedDims: +e.target.value })}>
          {[256, 512, 1024, 2560, 4096].map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        <span className={`kb-vec ${v.status}`}>{VEC_RU[v.status]}{v.status === 'indexing' || v.status === 'ready' ? ` · ${v.done}/${v.total}` : ''}{v.gap !== undefined ? ` · самопроверка ${v.gap}${v.eos ? ', с <|endoftext|>' : ''}` : ''}</span>
        {v.model && v.status !== 'off' && <button className="link" onClick={() => void kb.rebuildVectors()}>пересчитать</button>}
      </div>
      {v.status === 'indexing' && <div className="kb-prog"><i style={{ width: `${(v.done / Math.max(1, v.total)) * 100}%` }} /><span>{v.model}: {v.done} из {v.total}</span></div>}
      {v.error && <div className="err">{v.error}</div>}
    </section>
  );
}

export function DocRow({ d, s, llm, open, onFilter, filtered, opTitle }: { d: KbDocument; s: kb.KbState; llm: Llm; open: (id: string) => void; onFilter?: () => void; filtered?: boolean; opTitle?: string }) {
  const job = s.job?.doc === d.id ? s.job : null;
  const props = s.proposals.filter((p) => p.doc === d.id);
  const done = d.processed ?? 0;
  return (
    <div className="kb-doc">
      <div className="kb-doc-h"><button className="link" onClick={() => open(`doc:${d.id}`)}><b>{d.name}</b></button><i className={`kb-rel r${d.reliability}`}>{d.reliability}</i>
        <span className="muted">{d.chunks.length} частей · {Math.round(d.size / 1024)} КБ · обработано {done}/{d.chunks.length}</span>
        {d.operation && opTitle && <span className="kb-opbadge" title="Материал операции">{opTitle.split(':')[0]}</span>}</div>
      {d.extracted && <div className="kb-extracted">Извлечено: новых записей <b>{d.extracted.entries}</b>, дополнений <b>{d.extracted.updates}</b>{d.operation ? <>, сведений об инфраструктуре <b>{d.extracted.infra}</b></> : null}{d.extracted.dropped ? <span className="muted"> · отброшено без цитаты {d.extracted.dropped}</span> : null}</div>}
      {job ? <div className="kb-prog"><i style={{ width: `${(job.at / job.total) * 100}%` }} /><span>{job.text}</span><button onClick={kb.stop}>Остановить</button></div>
        : <div className="row">
          {done < d.chunks.length && <button className="primary" disabled={!!s.job || llm.check.state !== 'ok'} title={llm.check.state !== 'ok' ? 'Модель недоступна — раздел «ИИ»' : ''} onClick={() => kb.process(d.id, llm.settings)}>{done ? 'Продолжить обработку' : 'Обработать моделью'}</button>}
          {props.length > 0 && onFilter && <button className={filtered ? 'on' : ''} onClick={onFilter}>предложения: {props.filter((p) => p.status === 'pending').length} ждут, {props.filter((p) => p.status === 'accepted').length} принято</button>}
          <button className="link danger" onClick={() => { if (confirm(`Удалить «${d.name}» из базы?`)) void kb.removeDocument(d.id); }}>удалить</button>
          {d.error && <span className="err">{d.error}</span>}
        </div>}
    </div>
  );
}

export function ProposalCard({ p, s, open }: { p: Proposal; s: kb.KbState; open: (id: string) => void }) {
  const c = category(p.entry.category);
  const doc = s.documents.find((d) => d.id === p.doc);
  return (
    <div className={`kb-prop ${p.kind}`}>
      <div className="kb-prop-h"><i>{p.kind === 'new' ? 'новая запись' : 'дополнение'}</i><b>{p.kind === 'update' ? <button className="link" onClick={() => open(p.target!)}>{s.byId.get(p.target!)?.title ?? p.entry.title}</button> : p.entry.title}</b>
        <span className="muted">{c?.title} · {doc?.name}, часть {p.chunk + 1}</span></div>
      {p.kind === 'new' && p.entry.summary && <p>{p.entry.summary}</p>}
      {(p.kind === 'new' ? rubricsOf(p.entry) : p.rubrics ?? []).length > 0 && <div className="kb-rubs">{(p.kind === 'new' ? rubricsOf(p.entry) : p.rubrics!).map((c) => <span key={c} className="kb-rub">{p.kind === 'update' ? '+ ' : ''}{c} {rubric(c)?.title}</span>)}</div>}
      <ul>{p.facts.map((f, i) => <li key={i}><b>{c?.fields.find((x) => x.key === f.key)?.title ?? f.key}:</b> {f.value}{f.quote && <div className="kb-quote">«{f.quote}»</div>}</li>)}
        {p.relations.filter((r) => r.type !== 'source').map((r, i) => <li key={`r${i}`}><b>{RELATION_RU[r.type]}:</b> {s.byId.get(r.target)?.title ?? r.target}</li>)}</ul>
      <div className="row"><button className="primary" onClick={() => kb.decide([p.id], true)}>Принять</button><button onClick={() => kb.decide([p.id], false)}>Отклонить</button></div>
    </div>
  );
}
