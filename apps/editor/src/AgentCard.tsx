/**
 * Агент агентной модели в «Переигровке» (настольное приложение): карточка дивизии на выбранный час — состояние,
 * приказ, переменные во времени, машина состояний, исходные данные с источниками, положения по документам, журнал —
 * и разговор с агентом через языковую модель (LM Studio). Два голоса: «Командир» знает только своё на этот час,
 * «Разбор» видит ещё исходные данные и документы. Ответ — на выданных записях со ссылками [S1], [J3]…
 */
import { useEffect, useRef, useState } from 'react';
import type { LngLat } from '@def-ops/core';
import type { AgentHistory, AgentTrace } from '@def-ops/sim';
import { LlmClient } from '@def-ops/staff-service/llm';
import type { LlmSettings } from './sim/game-protocol';
import type { MapEngine } from './engine/types';
import { agentGroup } from './formation-card';
import { fmtCount, fmtFrac, fmtKm } from './num-format';

export interface AgentRun { trace: AgentTrace; history: AgentHistory }
type Row = [number, number, string, number, number, number, number, number, number, number, number];

/** Час прогона для отметки времени («1945-04-17T20:00»). */
export const hourOf = (start: string, time: string) => (Date.parse(`${time.slice(0, 16)}:00Z`) - Date.parse(`${start.slice(0, 16)}:00Z`)) / 3600000;
const label = (start: string, h: number) => {
  const t = new Date(Date.parse(`${start}:00Z`) + Math.round(h) * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}.${p(t.getUTCMonth() + 1)} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
};
export function km(a: LngLat, b: LngLat): number {
  const kx = 111.32 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110.57);
}
const clampH = (t: AgentTrace, h: number) => Math.max(0, Math.min(t.frames.length - 1, Math.round(h)));
export const rowAt = (t: AgentTrace, i: number, h: number) => t.frames[clampH(t, h)][i] as Row;
export const posAt = (t: AgentTrace, i: number, h: number): LngLat => { const r = rowAt(t, i, h); return [r[0], r[1]]; };

/** Ближайшая к точке дивизия на карте в этот час (не введённые и выбывшие не выбираются). */
export function divisionNear(t: AgentTrace, h: number, project: (p: LngLat) => [number, number], at: [number, number], px = 16): string | null {
  let best: string | null = null, bd = px;
  t.divisions.forEach((d, i) => {
    const g = group(rowAt(t, i, h)[2]);
    if (g === 'pending' || g === 'destroyed') return;
    const q = project(posAt(t, i, h));
    const dd = Math.hypot(q[0] - at[0], q[1] - at[1]);
    if (dd < bd) { bd = dd; best = d.id; }
  });
  return best;
}

/** Кольцо вокруг выбранной дивизии на карте: следует за видом карты и за временем. */
export function AgentMark({ engine, at }: { engine: MapEngine; at: LngLat }) {
  const [, redraw] = useState(0);
  useEffect(() => engine.on('view', () => redraw((n) => n + 1)), [engine]);
  const host = engine.getContainer().getBoundingClientRect();
  const p = engine.project(at);
  return <div className="ag-mark" style={{ left: host.left + p[0], top: host.top + p[1] }} />;
}

const group = agentGroup;

const VARS: { idx: number; label: string; fmt: (v: number) => string }[] = [
  { idx: 3, label: 'Люди', fmt: fmtCount },
  { idx: 4, label: 'Танки и САУ', fmt: (v) => String(Math.round(v)) },
  { idx: 5, label: 'Орудия и миномёты', fmt: (v) => String(Math.round(v)) },
  { idx: 6, label: 'Боекомплекты', fmt: fmtFrac },
  { idx: 7, label: 'Заправки', fmt: fmtFrac },
  { idx: 8, label: 'Усталость', fmt: fmtFrac },
  { idx: 9, label: 'Организованность', fmt: fmtFrac },
];

/** Машина состояний агента: группы и подсостояния. */
const DIAGRAM: { group: string; title: string; subs: string[] }[] = [
  { group: 'reserve', title: 'Резерв', subs: ['не введена в операцию', 'резерв'] },
  { group: 'march', title: 'Марш', subs: ['марш: по дороге', 'марш: вне дорог', 'марш: привал', 'марш: затор', 'марш: переправа'] },
  { group: 'deploy', title: 'Развёртывание', subs: ['развёртывание'] },
  { group: 'attack', title: 'Наступление', subs: ['наступление: атака', 'наступление: второй эшелон', 'наступление: бой в глубине', 'наступление: закрепление', 'наступление: прорыв из окружения'] },
  { group: 'defense', title: 'Оборона', subs: ['оборона: поспешная', 'оборона: подготовленная'] },
  { group: 'withdraw', title: 'Отход', subs: ['отход', 'отступление', 'остатки: выход из боя'] },
  { group: 'destroyed', title: 'Выбыла', subs: ['небоеспособна', 'сведена в другую дивизию'] },
];

function Spark({ t, i, idx, hour }: { t: AgentTrace; i: number; idx: number; hour: number }) {
  const vs = t.frames.map((f) => (f[i] as Row)[idx] as number);
  const max = Math.max(idx >= 8 ? 1 : 0, ...vs);
  const W = 110, H = 24, n = vs.length - 1;
  const y = (v: number) => (max === 0 ? H / 2 : H - 2 - (v / max) * (H - 4));
  return (
    <svg className="ag-spark" width={W} height={H}>
      <polyline points={vs.map((v, h) => `${(h / n) * W},${y(v)}`).join(' ')} />
      <line x1={(hour / n) * W} x2={(hour / n) * W} y1={0} y2={H} />
    </svg>
  );
}

const shortDiv = (d: AgentTrace['divisions'][number]) => d.name.replace(/гвардейская/, 'гв.').replace(/стрелковая дивизия/, 'сд').replace(/дивизия/, 'д.');

export function AgentPanel({ run, id, hour, onHour, onClose, llm }: { run: AgentRun; id: string; hour: number; onHour: (h: number) => void; onClose: () => void; llm: LlmSettings }) {
  const [tab, setTab] = useState<'card' | 'chat'>('card');
  const t = run.trace;
  const i = t.divisions.findIndex((d) => d.id === id);
  if (i < 0) return null;
  const d = t.divisions[i];
  const hq = t.hqs.find((h) => h.id === d.hq);
  return (
    <div className="ag-panel">
      <div className="ag-head">
        <div><b>{d.name}</b><span>{hq?.name} · {d.side === 'su' ? 'Красная армия' : 'вермахт'} · {label(t.start, hour)} МСК</span></div>
        <button className="x" onClick={onClose} title="Закрыть">×</button>
      </div>
      <div className="ag-tabs">
        <button className={tab === 'card' ? 'on' : ''} onClick={() => setTab('card')}>Карточка</button>
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Разговор</button>
      </div>
      {tab === 'card' ? <Card run={run} i={i} hour={hour} onHour={onHour} /> : <Chat key={id} run={run} i={i} hour={hour} onHour={onHour} llm={llm} />}
    </div>
  );
}

function Card({ run, i, hour, onHour }: { run: AgentRun; i: number; hour: number; onHour: (h: number) => void }) {
  const t = run.trace;
  const d = t.divisions[i];
  const row = rowAt(t, i, hour);
  const cur = row[2];
  const events = t.journal.filter((e) => e.agent === d.id && e.tick <= hour);
  const order = [...events].reverse().find((e) => e.text.startsWith('получен приказ'));
  const docs = run.history.divisions.filter((p) => p.formation === d.id).map((p) => {
    const h = hourOf(t.start, p.time);
    return { ...p, h, dist: km(posAt(t, i, h), p.at) };
  });
  return (
    <div className="ag-body">
      <section>
        <div className={`ag-state ${group(cur)}`}>{cur}</div>
        {(row[10] ?? 0) > 0 && <div className="ag-pocket">В окружении {row[10]} ч: пути к своим нет, подвоза нет</div>}
        {order && <div className="ag-order">Приказ: {order.text.replace(/^получен приказ /, '').replace(/:?\s*\[[^\]]*@[^\]]*\]\s*$/, '')}</div>}
      </section>
      <section>
        <h4>Переменные</h4>
        <table className="ag-vars"><tbody>
          {VARS.map((v) => <tr key={v.idx}><td>{v.label}</td><td className="num">{v.fmt(row[v.idx] as number)}</td><td><Spark t={t} i={i} idx={v.idx} hour={hour} /></td></tr>)}
        </tbody></table>
      </section>
      <section>
        <h4>Машина состояний</h4>
        <div className="ag-diagram">
          {DIAGRAM.map((g) => (
            <div key={g.group} className={`ag-node ${g.group}${group(cur) === g.group || (g.group === 'reserve' && group(cur) === 'pending') ? ' on' : ''}`}>
              <b>{g.title}</b>
              {g.subs.length > 1 && <ul>{g.subs.map((s) => <li key={s} className={s === cur ? 'on' : ''}>{s.split(': ')[1] ?? s}</li>)}</ul>}
            </div>
          ))}
        </div>
      </section>
      <section>
        <h4>Исходные данные</h4>
        <div className="muted">{d.kind} · подвижность: {d.mobility} · качество {d.quality}</div>
        <ul className="ag-notes">{(d.note ?? '').split('; ').filter(Boolean).map((n, k) => <li key={k}>{n}</li>)}</ul>
      </section>
      {docs.length > 0 && <section>
        <h4>По документам</h4>
        <table className="ag-docs"><tbody>
          {docs.map((p, k) => (
            <tr key={k} className={p.h <= hour ? '' : 'future'} onClick={() => onHour(p.h)} title="Показать этот час">
              <td>{label(t.start, p.h)}</td><td>{p.set ?? p.source ?? ''} ({p.reliability ?? '—'})</td><td className="num">{fmtKm(p.dist)}</td>
            </tr>
          ))}
        </tbody></table>
        <div className="muted small">расстояние расчётного положения от положения по документу на то же время</div>
      </section>}
      <section>
        <h4>Журнал</h4>
        <ol className="ag-journal">
          {[...events].reverse().slice(0, 40).map((e, k) => <li key={k} onClick={() => onHour(e.tick)}><span>{label(t.start, e.tick)}</span> {e.text}</li>)}
        </ol>
      </section>
    </div>
  );
}

/* ───────────── разговор ───────────── */

type Voice = 'commander' | 'analyst';
interface Rec { id: string; text: string; tick?: number }
interface Msg { role: 'user' | 'assistant'; text: string; voice: Voice; hour: number; records?: Rec[]; reasoning?: string; secs?: number; note?: string }

/** Записи для модели: что агент знает на этот час (и, для разбора, исходные данные и документы). */
export function agentRecords(run: AgentRun, i: number, hour: number, voice: Voice): Rec[] {
  const t = run.trace;
  const d = t.divisions[i];
  const r = rowAt(t, i, hour);
  const recs: Rec[] = [{ id: 'S1', text: `Время ${label(t.start, hour)} МСК. Состояние: ${r[2]}. Люди ${Math.round(r[3])}, танки ${Math.round(r[4])}, орудия ${Math.round(r[5])}, боекомплектов ${r[6]}, заправок ${r[7]}, усталость ${r[8]}, организованность ${r[9]}.` }];
  const ev = t.journal.filter((e) => e.agent === d.id && e.tick <= hour);
  (voice === 'commander' ? ev.slice(-25) : ev).forEach((e, k) => recs.push({ id: `J${k + 1}`, text: `${label(t.start, e.tick)}: ${e.text}`, tick: e.tick }));
  // противник в 15 км — то, что видит штаб дивизии
  const me = posAt(t, i, hour);
  let k = 0;
  t.divisions.forEach((o, j) => {
    if (o.side === d.side) return;
    const g = group(rowAt(t, j, hour)[2]);
    if (g === 'pending' || g === 'destroyed') return;
    const dist = km(me, posAt(t, j, hour));
    if (dist <= 15) recs.push({ id: `E${++k}`, text: `Противник: ${shortDiv(o)} в ${dist.toFixed(1)} км, ${rowAt(t, j, hour)[2]}.` });
  });
  if (voice === 'analyst') {
    (d.note ?? '').split('; ').filter(Boolean).forEach((n, m) => recs.push({ id: `P${m + 1}`, text: `Исходные данные: ${n}.` }));
    run.history.divisions.filter((p) => p.formation === d.id).forEach((p, m) => {
      const h = Math.max(0, Math.min(t.frames.length - 1, hourOf(t.start, p.time)));
      recs.push({ id: `H${m + 1}`, text: `По документам (${p.set ?? p.source ?? '—'}, достоверность ${p.reliability ?? '—'}): ${p.time} — ${p.at[1].toFixed(3)}° с. ш., ${p.at[0].toFixed(3)}° в. д.; расчётное положение на это время — в ${km(posAt(t, i, h), p.at).toFixed(1)} км.`, tick: Math.round(h) });
    });
  }
  return recs;
}

function systemPrompt(name: string, voice: Voice): string {
  const who = voice === 'commander'
    ? `Ты — командир (начальник штаба) соединения «${name}» в Берлинской операции 1945 года. Отвечай от первого лица, коротко, по-военному. Ты знаешь только то, что в записях ниже: своё состояние, свои приказы и события, противника рядом. Будущего и того, как всё было на самом деле, ты не знаешь.`
    : `Ты — аналитик переигровки. Разбираешь, почему агент-соединение «${name}» в расчёте вело себя так, и сравниваешь расчёт с документами. Ты видишь записи ниже: состояние, журнал модели с причинами, исходные данные с источниками, положения по документам.`;
  return `${who}\nПравила: отвечай по-русски. Опирайся только на записи и ссылайся на них в квадратных скобках, например [J3] или [S1]. Если ответа в записях нет, прямо скажи «в записях этого нет» и, если отвечаешь всё же, пометь это как «мнение модели». Не придумывай цифр.`;
}

function Chat({ run, i, hour, onHour, llm }: { run: AgentRun; i: number; hour: number; onHour: (h: number) => void; llm: LlmSettings }) {
  const [voice, setVoice] = useState<Voice>('commander');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [live, setLive] = useState<{ think: string; text: string; t0: number } | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const d = run.trace.divisions[i];
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs.length, live?.text.length]);

  async function ask() {
    const q = text.trim();
    if (!q || live) return;
    const records = agentRecords(run, i, hour, voice);
    setMsgs((m) => [...m, { role: 'user', text: q, voice, hour }]);
    setText('');
    const acc = { think: '', text: '', t0: performance.now() };
    setLive({ ...acc });
    const ac = new AbortController();
    ctrl.current = ac;
    const past = msgs.filter((m) => m.voice === voice).slice(-6).map((m) => ({ role: m.role, content: m.text }));
    const client = new LlmClient({ url: /^https?:/.test(llm.url) ? llm.url : new URL(llm.url, location.origin).href.replace(/\/+$/, ''), model: llm.model, thinking: llm.thinking, timeoutMs: 10 * 60_000, maxTokens: 4000 }, fetch.bind(globalThis));
    try {
      const r = await client.chat({
        messages: [{ role: 'system', content: `${systemPrompt(d.name, voice)}\n\nЗаписи:\n${records.map((x) => `[${x.id}] ${x.text}`).join('\n')}` }, ...past, { role: 'user', content: q }],
        onDelta: (kind, s) => { if (kind === 'reasoning') acc.think += s; else acc.text += s; setLive({ ...acc }); },
        signal: ac.signal,
      });
      setMsgs((m) => [...m, { role: 'assistant', text: r.content || '(пустой ответ)', voice, hour, records, reasoning: r.reasoning, secs: r.timings.totalMs / 1000, note: r.finishReason === 'length' ? 'ответ оборван потолком токенов' : undefined }]);
    } catch (e) {
      setMsgs((m) => [...m, ac.signal.aborted
        ? { role: 'assistant', text: acc.text || '—', voice, hour, records, reasoning: acc.think, note: 'остановлено' }
        : { role: 'assistant', text: `Языковая модель недоступна (${(e as Error).message}). Запустите LM Studio с сервером OpenAI и выберите модель в разделе «ИИ».`, voice, hour, records }]);
    } finally { setLive(null); ctrl.current = null; }
  }

  const cite = (m: Msg, s: string) => s.split(/(\[[A-Z]\d+\])/).map((part, k) => {
    const rid = part.match(/^\[([A-Z]\d+)\]$/)?.[1];
    const rec = rid ? m.records?.find((r) => r.id === rid) : undefined;
    return rec ? <span key={k} className="ag-cite" title={rec.text} onClick={() => rec.tick !== undefined && onHour(rec.tick)}>{part}</span> : <span key={k}>{part}</span>;
  });
  const who = (v: Voice) => (v === 'commander' ? 'Командир' : 'Разбор');

  return (
    <div className="ag-chat">
      <div className="ag-voices">
        {(['commander', 'analyst'] as Voice[]).map((v) => <button key={v} className={voice === v ? 'on' : ''} onClick={() => setVoice(v)}>{who(v)}</button>)}
        <span className="muted small">{voice === 'commander' ? 'знает только своё на выбранный час' : 'видит расчёт, источники и документы'}</span>
      </div>
      <div className="ag-msgs">
        {!msgs.length && !live && <div className="muted small">Спросите, например: «Почему остановились?», «Что вам известно о противнике?», «Откуда взята численность?»</div>}
        {msgs.map((m, k) => (
          <div key={k} className={`ag-msg ${m.role}`}>
            <div className="meta">{m.role === 'user' ? 'Вопрос' : who(m.voice)} · {label(run.trace.start, m.hour)}{m.secs !== undefined ? ` · ${m.secs.toFixed(1)} с` : ''}{m.note ? ` · ${m.note}` : ''}</div>
            {m.reasoning && <details><summary>размышления модели</summary><pre>{m.reasoning}</pre></details>}
            <div>{m.role === 'assistant' ? cite(m, m.text) : m.text}</div>
            {m.records && <details><summary>записи, выданные модели ({m.records.length})</summary><ul>{m.records.map((r) => <li key={r.id}>[{r.id}] {r.text}</li>)}</ul></details>}
          </div>
        ))}
        {live && <div className="ag-msg assistant">
          <div className="meta"><span className="spinner" /> {who(voice)} · {live.text ? 'отвечает…' : live.think ? 'размышляет…' : 'ждём модель…'}</div>
          {live.think && !live.text && <pre className="ag-think">{live.think.slice(-600)}</pre>}
          {live.text && <div>{live.text}▍</div>}
        </div>}
        <div ref={end} />
      </div>
      <div className="ag-ask">
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Вопрос агенту…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }} />
        {live ? <button onClick={() => ctrl.current?.abort()}>Стоп</button> : <button className="primary" onClick={() => void ask()}>Спросить</button>}
      </div>
      <div className="muted small">Модель: {llm.model || 'первая загруженная'} · настройка — раздел «ИИ»</div>
    </div>
  );
}
