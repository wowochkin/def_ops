/**
 * Вкладка «Командующий» в карточке штаба: характер (с пределами калибровки и источником), мотивы (на начало и
 * сейчас), состояние (уверенность и напряжение по времени), картина обстановки (что он знает и как было на самом деле —
 * серым, это для зрителя), лента решений, таблица вариантов выбранного решения с разбивкой по мотивам, обоснование и
 * правило, разговор. Час — общий с ползунком времени.
 */
import { useEffect, useRef, useState } from 'react';
import type { AgentCommander, AgentTrace } from '@def-ops/sim';
import { addHours } from '@def-ops/sim';
import { intentAt, intentBadge } from './intent-view';
import { fmtCount, fmtFrac, fmtHours, fmtKm, fmtPct } from './num-format';
import { act, register } from './voice/registry';
import { commanderAction, releaseCommander } from './voice/actions/staff';
import {
  answer, chosenOf, decisionRibbon, MOTIVE_COLOR, MOTIVE_RU, moodWords, SUGGESTIONS, TRAIT_RU, viewAt, type Decision, type Snapshot,
} from './commander-view';

const sign = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(Math.abs(x) < 10 ? 1 : 0).replace('.', ',')}`;
const dm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;
const when = (t: string) => `${dm(t)} ${t.slice(11, 16)}`;

const CONF_RU: Record<string, string> = { assumption: 'допущение без опоры', low: 'опора слабая', medium: 'опора средняя', high: 'опора надёжная' };

/** Полоса значения 0–1 с пунктиром пределов калибровки. */
function Bar({ v, range, color, title }: { v: number; range?: [number, number]; color: string; title?: string }) {
  return (
    <span className="cm-bar" title={title}>
      <i style={{ width: `${Math.min(100, v * 100)}%`, background: color }} />
      {range && <b style={{ left: `${range[0] * 100}%`, width: `${(range[1] - range[0]) * 100}%` }} />}
    </span>
  );
}

function Traits({ c }: { c: AgentCommander }) {
  return (
    <section>
      <h4>Характер (допущения по биографиям; пунктир — пределы калибровки)</h4>
      <div className="cm-rows">
        {TRAIT_RU.map(([k, label]) => {
          const t = c.traits[k];
          return <div key={k} className="cm-row" title={`${t.source} — ${CONF_RU[t.confidence] ?? t.confidence}; пределы ${fmtFrac(t.range[0])}–${fmtFrac(t.range[1])}`}>
            <span>{label}</span><Bar v={t.value} range={t.range} color="var(--accent, #8c2a22)" /><em>{fmtFrac(t.value)}</em></div>;
        })}
      </div>
    </section>
  );
}

function Motives({ c, s }: { c: AgentCommander; s: Snapshot | null }) {
  const keys = Object.keys(MOTIVE_RU).filter((k) => (c.baseMotives[k] ?? 0) > 0 || (s?.motives[k] ?? 0) > 0);
  const max = Math.max(1, ...keys.map((k) => Math.max(c.baseMotives[k] ?? 0, s?.motives[k] ?? 0)));
  return (
    <section>
      <h4>Мотивы: на начало → сейчас (чёрная метка)</h4>
      <div className="cm-rows">
        {keys.map((k) => {
          const b = c.baseMotives[k] ?? 0, now = s?.motives[k];
          return <div key={k} className="cm-row"><span>{MOTIVE_RU[k]}</span>
            <span className="cm-bar" title={`на начало ${fmtFrac(b)}${now != null ? `, сейчас ${fmtFrac(now)}` : ''}`}>
              <i style={{ width: `${(b / max) * 100}%`, background: MOTIVE_COLOR[k] }} />
              {now != null && <u style={{ left: `${(now / max) * 100}%` }} />}
            </span><em>{b === now || now == null ? fmtFrac(b) : `${fmtFrac(b)} → ${fmtFrac(now)}`}</em></div>;
        })}
      </div>
    </section>
  );
}

/** Уверенность и напряжение по времени; линия — выбранный час. */
function Mood({ c, tick }: { c: AgentCommander; tick: number }) {
  const W = 330, H = 46, last = Math.max(1, ...c.snapshots.map((s) => s.tick));
  const line = (f: (s: Snapshot) => number) => c.snapshots.map((s) => `${(s.tick / last) * W},${H - 3 - f(s) * (H - 6)}`).join(' ');
  return (
    <section>
      <h4>Состояние по времени</h4>
      <svg className="cm-mood" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <polyline points={line((s) => s.mood.confidence)} className="conf" />
        <polyline points={line((s) => s.mood.stress)} className="stress" />
        <line x1={(Math.min(tick, last) / last) * W} x2={(Math.min(tick, last) / last) * W} y1={0} y2={H} />
      </svg>
      <div className="cm-legend"><span><i style={{ background: '#0f766e' }} />уверенность</span><span><i style={{ background: '#b3261e' }} />напряжение</span></div>
    </section>
  );
}

function Picture({ s, tick, names }: { s: Snapshot | null; tick: number; names: Record<string, string> }) {
  if (!s) return null;
  const nm = (id: string) => names[id] ?? id;
  const p = s.picture;
  return (
    <section>
      <h4>Картина обстановки — что он знает (серым — как было на самом деле)</h4>
      <table className="ag-vars cm-pic"><colgroup><col style={{ width: '38%' }} /><col style={{ width: '70px' }} /><col style={{ width: '56px' }} /><col /></colgroup><thead><tr><th>армия</th><th className="num" title="пройдено от исходного положения">прошла</th><th className="num" title="боевая сила армии в долях исходной">своих</th><th title="оценка разведки командующего, усл. ед. боевой силы">противник перед ней, усл. ед.</th></tr></thead><tbody>
        {p.armies.map((a) => {
          const none = a.enemyEst < 0.5;
          const off = none ? a.enemyTrue >= 0.5 : Math.abs(a.enemyEst - a.enemyTrue) > Math.max(1, 0.15 * a.enemyTrue);
          return <tr key={a.hq}><td>{nm(a.hq)}{a.brokeThrough ? <small title="прорвала главную полосу"> ⚑</small> : null}</td>
            <td className="num">{fmtKm(a.advanceKm)}</td><td className="num">{fmtPct(a.strength)}</td>
            <td>{none ? 'противника нет' : `≈ ${fmtCount(a.enemyEst)} усл. ед.`}{off ? <small className="muted"> (на деле {fmtCount(a.enemyTrue)})</small> : <small className="muted"> (верно)</small>}</td></tr>;
        })}
        {p.rival && <tr><td>соперник</td><td colSpan={3}>{nm(p.rival.hq)}: до объекта ≈ {fmtKm(p.rival.toObjectiveKm)} <small className="muted">(сводка Ставки, задержка {fmtHours(tick - p.rival.asOf)})</small></td></tr>}
      </tbody></table>
      <div className="muted small">«Своих» — боевая сила армии от исходной; «прошла» — продвижение от исходного положения. {p.openFlanks.length ? `Открытые фланги: ${p.openFlanks.map(nm).join(', ')}. ` : ''}{p.pockets.length ? `Окружённых группировок: ${p.pockets.length}. ` : ''}{p.enemyReserves.length ? `Резервов противника в глубине: ${p.enemyReserves.length}.` : ''}</div>
    </section>
  );
}

function Options({ d }: { d: Decision }) {
  const sums = d.options.map((o) => Object.values(o.parts).reduce((x, y) => x + Math.abs(y), 0));
  const max = Math.max(0.01, ...sums);
  const mindH = d.options.find((o) => o.mind)?.mind?.hours;
  return (
    <>
      <table className="ag-vars cm-opts"><thead><tr><th>вариант</th><th>оценка по мотивам</th><th className="num">итог</th><th className="num">«в уме»{mindH ? ` ${mindH} ч` : ''}</th></tr></thead><tbody>
        {d.options.map((o, i) => (
          <tr key={i} className={i === d.chosen ? 'chosen' : ''} title={o.rule}>
            <td>{i === d.chosen && <b className="ok">✓ </b>}{o.label}</td>
            <td><span className="cm-stack">{Object.entries(o.parts).filter(([, v]) => v !== 0).map(([k, v]) =>
              <i key={k} className={v < 0 ? 'neg' : ''} style={{ width: `${(Math.abs(v) / max) * 100}%`, background: MOTIVE_COLOR[k] }} title={`${MOTIVE_RU[k] ?? k}: ${v < 0 ? '−' : ''}${fmtFrac(Math.abs(v))}`} />)}</span></td>
            <td className="num">{fmtFrac(o.total)}</td>
            <td className="num">{o.mind ? `${sign(o.mind.advanceKm)} км` : '—'}</td>
          </tr>
        ))}
      </tbody></table>
      <div className="cm-legend">{Object.entries(MOTIVE_RU).filter(([k]) => d.options.some((o) => o.parts[k])).map(([k, v]) => <span key={k}><i style={{ background: MOTIVE_COLOR[k] }} />{v}</span>)}<span className="muted">бледные — вычеты</span></div>
    </>
  );
}

/** Разговор: вопрос, подсказки; ответ — из разбора на выбранный час (answer). */
function Chat({ c, tick, names, start, trace }: { c: AgentCommander; tick: number; names: Record<string, string>; start: string; trace: AgentTrace }) {
  const [msgs, setMsgs] = useState<{ q: string; a: string; tick: number }[]>([]);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const now = useRef({ c, tick, names, trace });
  now.current = { c, tick, names, trace };
  // голос: «спроси командующего …» и то же, что кнопки подсказок (act → действие реестра)
  useEffect(() => {
    const get = () => ({
      name: now.current.c.name,
      ask: (q: string) => {
        const { c: cc, tick: tt, names: nn, trace: tr } = now.current;
        const a = answer(cc, tt, q, nn, tr);
        setMsgs((m) => [...m, { q, a, tick: tt }]);
        return a;
      },
    });
    const off = register(commanderAction(get));
    return () => { off(); releaseCommander(get); };
  }, []);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [msgs.length]);
  const ask = (q: string) => { if (q.trim()) void act('commander.ask', { question: q.trim() }); };
  return (
    <section className="cm-chat" data-hl="commander-chat">
      <h4>Разговор с командующим — {c.name} (на выбранный час)</h4>
      {msgs.length > 0 && <div className="ag-msgs">
        {msgs.map((m, i) => <div key={i} className="cm-qa"><div className="ag-msg user">{m.q}</div><div className="ag-msg"><div className="meta">{c.name}, {when(addHours(start, m.tick))} МСК</div>{m.a}</div></div>)}
        <div ref={end} />
      </div>}
      <div className="cm-sugg">{SUGGESTIONS.map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}</div>
      <form className="ag-ask" onSubmit={(e) => { e.preventDefault(); ask(text); setText(''); }}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Вопрос командующему…" />
        <button type="submit" disabled={!text.trim()}>Спросить</button>
      </form>
    </section>
  );
}

export function CommanderPanel({ trace, c, tick, onTick, names }: { trace: AgentTrace; c: AgentCommander; tick: number; onTick: (h: number) => void; names: Record<string, string> }) {
  const v = viewAt(c, tick);
  const ribbon = decisionRibbon(c, tick);
  const d = v.decision;
  const o = d ? chosenOf(d) : null;
  return (
    <div className="ag-body cm-tab">
      <section className="cm-head"><b>{c.name}</b> <span className="muted">{names[c.hq] ?? c.hq} · {when(addHours(trace.start, tick))} МСК</span></section>
      {trace.intent && <section className="cm-now"><b>История как замысел:</b> {intentBadge(intentAt(trace, c.hq, tick)) ?? 'нет данных на этот час'}</section>}
      <Traits c={c} />
      <Motives c={c} s={v.snapshot} />
      {v.snapshot && <section className="cm-now"><b>Настроение:</b> {moodWords(v.snapshot.mood)} <span className="muted">(уверенность {fmtFrac(v.snapshot.mood.confidence)}, напряжение {fmtFrac(v.snapshot.mood.stress)})</span></section>}
      <Mood c={c} tick={tick} />
      <Picture s={v.snapshot} tick={tick} names={names} />
      <section>
        <h4>Решения</h4>
        {ribbon.length ? <div className="cm-ribbon">
          {ribbon.map((r) => <button key={`${r.tick}-${r.label}`} className={`${r.current ? 'on' : ''}${r.future ? ' future' : ''}`} onClick={() => onTick(r.tick)} title="Перейти к этому часу">{when(addHours(trace.start, r.tick))} {r.label}</button>)}
        </div> : <div className="muted">К этому часу решений ещё не было.</div>}
        {d && <Options d={d} />}
      </section>
      {d && o && <section className="cm-why"><b>Почему:</b> {d.why} <span className="muted">Правило: {o.rule}. Повод: {d.trigger}.</span></section>}
      <Chat c={c} tick={tick} names={names} start={trace.start} trace={trace} />
    </div>
  );
}
