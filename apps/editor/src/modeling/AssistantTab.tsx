/**
 * «Моделирование» → «Ассистент»: вопросы об устройстве модели. Слева разговор, справа источники ответа
 * (разделы описания, нормативы, код). Отвечает модель роли «база знаний» по выжимке model-index.json.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelFragment } from '@def-ops/knowledge';
import type { Llm } from '../shared';
import { mdToHtml } from '../markdown';
import { cleanAnswer } from '../kb/kb';
import { askModel, type AssistStream } from './assistant';
import { loadHistory, saveHistory, type Turn } from './assistant-history';

const STARTERS = [
  'Как считается исход боя?',
  'Как считается сила стороны в бою?',
  'Как устроен агент дивизии?',
  'Откуда берётся темп наступления?',
  'Как работает калибровка?',
];
const KIND_RU: Record<ModelFragment['kind'], string> = { doc: 'описание', norm: 'норматив', code: 'код' };

type Live = { q: string; stream: AssistStream; t0: number };

export function AssistantTab({ llm }: { llm: Llm }) {
  const [turns, setTurns] = useState<Turn[]>(loadHistory);
  const [live, setLive] = useState<Live | null>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<{ turn: number; n: number | null }>({ turn: -1, n: null });
  const abort = useRef<AbortController | null>(null);
  const feed = useRef<HTMLDivElement>(null);

  const ask = async (question: string) => {
    question = question.trim();
    if (!question || live) return;
    setQ('');
    const ctl = new AbortController();
    abort.current = ctl;
    const t0 = Date.now();
    setLive({ q: question, stream: { stage: 'search', answer: '', thinking: '' }, t0 });
    const history = turns.filter((t) => t.a).map((t) => ({ q: t.q, a: t.a }));
    const r = await askModel(question, llm.settings, history, (s) => setLive({ q: question, stream: s, t0 }), ctl.signal);
    const turn: Turn = { q: question, a: r.text, sources: r.sources, extra: r.extra, ...(r.need ? { need: r.need } : {}), ...(r.error ? { error: r.error } : {}), ...(r.thinking ? { thinking: r.thinking } : {}), seconds: Math.round((Date.now() - t0) / 1000) };
    setTurns((all) => { const next = [...all, turn]; saveHistory(next); setSel({ turn: next.length - 1, n: null }); return next; });
    setLive(null);
    abort.current = null;
    setTimeout(() => feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' }), 0);
  };
  const reset = () => { abort.current?.abort(); setTurns([]); saveHistory([]); setSel({ turn: -1, n: null }); };

  const shown = sel.turn >= 0 && sel.turn < turns.length ? sel.turn : turns.length - 1;
  const cur = turns[shown];
  const frags = cur ? [...cur.sources, ...cur.extra] : [];
  const count = (k: ModelFragment['kind']) => frags.filter((f) => f.kind === k).length;

  return (
    <div className="mdl-page as-page">
      <div className="as-chat">
        <div className="as-head">
          <div><h3>Ассистент модели</h3><span className="muted">вопросы об устройстве модели: как считаются бой, темп, подвоз, как устроены агенты; ответы — по описанию, нормативам и коду, со ссылками</span></div>
          <button onClick={reset} disabled={!turns.length && !live}>Новый разговор</button>
        </div>
        <div className="as-feed" ref={feed}>
          {!turns.length && !live && <div className="as-start">
            <p className="muted">С чего начать:</p>
            {STARTERS.map((s) => <button key={s} className="as-starter" onClick={() => setQ(s)}>{s}</button>)}
          </div>}
          {turns.map((t, i) => <TurnView key={i} t={t} on={i === shown} onPick={(n) => setSel({ turn: i, n })} />)}
          {live && <div className="adv-msg">
            <div className="adv-q"><small>вопрос</small>{live.q}</div>
            <div className="adv-a kb-answer">
              {!live.stream.answer && <div className="kb-wait-line"><span className="spinner" /> {
                live.stream.stage === 'search' ? 'ищу в описании, нормативах и коде…'
                  : live.stream.stage === 'need' ? `дозапрос: ${(live.stream.need ?? []).join(', ')}…`
                  : live.stream.thinking ? 'модель размышляет…' : 'модель читает фрагменты…'}</div>}
              {live.stream.need && live.stream.stage === 'model' && <small className="muted">дозапрос: {live.stream.need.join(', ')}</small>}
              {live.stream.thinking && !live.stream.answer && <div className="kb-think live">{live.stream.thinking.slice(-600)}</div>}
              {live.stream.answer && <div dangerouslySetInnerHTML={{ __html: mdToHtml(cleanAnswer(live.stream.answer)) }} />}
              {live.stream.answer && <span className="kb-caret" />}
            </div>
          </div>}
        </div>
        <form className="as-ask" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
          <textarea value={q} rows={2} placeholder="Например: как считается сила стороны в бою?" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(q); } }} />
          {live ? <button type="button" onClick={() => abort.current?.abort()}>Стоп</button>
            : <button type="submit" className="primary" disabled={!q.trim()}>Спросить</button>}
        </form>
      </div>
      <aside className="as-src">
        <h4>Источники ответа</h4>
        {!cur ? <p className="muted">Здесь появятся разделы описания, нормативы и функции кода, по которым написан ответ.</p> : <>
          <p className="muted">найдено: {count('doc')} разд. описания, {count('norm')} норм., {count('code')} фрагм. кода{cur.extra.length ? ` (дозапрос: ${cur.extra.length})` : ''}</p>
          {frags.map((f, i) => <Fragment key={f.id} n={i + 1} f={f} extra={i >= cur.sources.length} open={sel.turn === shown && sel.n === i + 1} />)}
        </>}
      </aside>
    </div>
  );
}

function TurnView({ t, on, onPick }: { t: Turn; on: boolean; onPick: (n: number) => void }) {
  const total = t.sources.length + t.extra.length;
  // ссылки [1], [1, 2] → кнопки, раскрывающие фрагмент справа
  const html = useMemo(() => mdToHtml(cleanAnswer(t.a || '')).replace(/\[(\d{1,2}(?:\s*[,;–-]\s*\d{1,2})*)\]/g, (all, list: string) => {
    const parts = list.split(/\s*([,;–-])\s*/);
    if (!parts.some((x) => /^\d+$/.test(x) && +x >= 1 && +x <= total)) return all;
    return '[' + parts.map((x) => (/^\d+$/.test(x) && +x >= 1 && +x <= total ? `<a class="kb-cite" data-n="${x}">${x}</a>` : x === ',' || x === ';' ? `${x} ` : x)).join('') + ']';
  }), [t.a, total]);
  return (
    <div className={`adv-msg${on ? ' as-on' : ''}`}>
      <div className="adv-q"><small>вопрос</small>{t.q}</div>
      <div className="adv-a kb-answer" onClick={(e) => { const n = (e.target as HTMLElement).dataset.n; if (n) onPick(+n); }}>
        {t.need && <small className="muted">дозапрос: {t.need.join(', ')}</small>}
        {t.error ? <span className="err">{t.error === 'остановлено' ? 'Остановлено.' : `Нет ответа: ${t.error}. Найденные фрагменты — справа.`}</span>
          : <div dangerouslySetInnerHTML={{ __html: html }} />}
        {t.thinking && <details className="kb-think"><summary>размышление модели</summary><div>{t.thinking}</div></details>}
        {t.seconds != null && <small className="muted kb-meta">{t.seconds} с</small>}
      </div>
    </div>
  );
}

function Fragment({ n, f, extra, open }: { n: number; f: ModelFragment; extra: boolean; open: boolean }) {
  const el = useRef<HTMLDetailsElement>(null);
  // прокрутка к фрагменту — только когда его раскрыли ссылкой, не на каждой перерисовке (ответ идёт потоком)
  useEffect(() => { if (open) el.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [open]);
  return (
    <details className={`as-frag as-${f.kind}`} open={open || undefined} ref={el}>
      <summary><b>[{n}]</b> <span className="as-kind">{KIND_RU[f.kind]}</span> {f.title} <small className="muted">{f.place}</small>{extra && <small className="as-extra">дозапрос</small>}</summary>
      {f.kind === 'code' ? <pre className="as-code">{f.text}</pre> : <div className="as-text">{f.text}</div>}
    </details>
  );
}
