/**
 * Вкладка «Итоги» (переигровка — боковая панель, игра — вкладка командования): части «Разбор хода» (только в игре),
 * «Потери» и «Сравнение». Потери — по ходу агентной модели (сутки, фронты, армии) рядом с историческими из базы
 * знаний; сравнение с историей — среднесуточно, потому что периоды расчёта и истории разные. Переключатель частей —
 * действие results.show (голосом — то же).
 */
import type { ReactNode } from 'react';
import type { HistoricalLoss, LossRow, OperationSummary } from '@def-ops/sim';
import { ActButton } from './voice/registry';
import { LossChart, SIDE_COLOR } from './ResultsCharts';
import { fmtCount } from './num-format';
import { histPerDay, histPeriod, histText, historyOf, lossesNote, PART_TITLE, sideHistory, sidePerDay, type BaselineState, type ResultsPart } from './results-view';

const n = fmtCount;

export function ResultsTab(p: { summary: OperationSummary | null; baseline: BaselineState; side: 'su' | 'de'; part: ResultsPart; parts: ResultsPart[]; turn?: ReactNode; empty?: string }) {
  const part = p.parts.includes(p.part) ? p.part : p.parts[0];
  return (
    <div className="rs">
      {p.parts.length > 1 && <div className="seg rs-parts">
        {p.parts.map((k) => <ActButton key={k} data-hl={`results-${k}`} action="results.show" params={{ part: k }} className={k === part ? 'on' : ''}>{PART_TITLE[k]}</ActButton>)}
      </div>}
      {part === 'turn' ? p.turn ?? <p className="rs-note">Разбор хода — после первого сыгранного хода.</p>
        : !p.summary ? <p className="rs-note">{p.empty ?? 'Итоги и разбор — на агентной модели.'}</p>
        : part === 'losses' ? <LossesPart s={p.summary} side={p.side} />
        : <ComparePart s={p.summary} side={p.side} baseline={p.baseline} />}
    </div>
  );
}

const enemyOf = (side: 'su' | 'de'): 'su' | 'de' => (side === 'su' ? 'de' : 'su');
const scopeName = (s: OperationSummary, id: string) => s.losses.rows.find((r) => r.id === id)?.name ?? id;

function SideCard({ r, s }: { r: LossRow; s: OperationSummary }) {
  const d = sidePerDay(s, r.id);
  return (
    <div className="rs-card" style={{ borderTopColor: SIDE_COLOR[r.side] }}>
      <span className="rs-card-h">{r.name}</span>
      <b>{n(r.total.personnel)}<small> чел.</small></b>
      <span>выбыло{d ? `, в сутки ${n(d.perDay)}` : ''}{s.losses.exact ? `; из них пленных ${n(r.captured)}` : ''}</span>
      <span>танков {n(r.total.tanks)} · орудий {n(r.total.guns)}</span>
      {s.losses.exact && <span>пополнено {n(r.reinforced)} чел.</span>}
    </div>
  );
}

function HistLine({ h }: { h: HistoricalLoss }) {
  return <div className="rs-hist" title={h.kb ? `запись базы знаний: ${h.kb}` : undefined}>
    история {histPeriod(h)}: {histText(h)} — {h.source}, надёжность {h.reliability}{h.note ? `; ${h.note}` : ''}
  </div>;
}

function Row({ r, s, sub }: { r: LossRow; s: OperationSummary; sub?: boolean }) {
  const days = sidePerDay(s, r.side)?.days ?? 1;
  return <>
    <span className={`rs-name${sub ? ' rs-sub' : ''}`}>{r.name}</span>
    <span>{n(r.total.personnel)}</span><span>{n(r.total.tanks)}</span><span>{n(r.total.guns)}</span><span>{n(r.total.personnel / days)}</span>
    {historyOf(s, r.id).map((h, i) => <HistLine key={i} h={h} />)}
  </>;
}

function LossesPart({ s, side }: { s: OperationSummary; side: 'su' | 'de' }) {
  const rows = s.losses.rows;
  const sides = [side, enemyOf(side)].map((id) => rows.find((r) => r.id === id)!).filter(Boolean);
  const notes = lossesNote(s);
  return (
    <div className="rs-losses">
      <div className="rs-cards">{sides.map((r) => <SideCard key={r.id} r={r} s={s} />)}</div>
      {notes.map((t) => <p key={t} className="rs-note">{t[0].toUpperCase() + t.slice(1)}.</p>)}
      <LossChart s={s.losses} side={side} />
      <h4>По фронтам и армиям</h4>
      {sides.map((sd) => {
        const top = rows.filter((r) => r.parent === sd.id);
        return <div key={sd.id} className="rs-table">
          <div className="rs-grid rs-head"><span>{sd.name}</span><span>люди</span><span>танки</span><span>орудия</span><span>в сутки</span></div>
          {top.map((f) => {
            const kids = rows.filter((r) => r.parent === f.id);
            return kids.length
              ? <details key={f.id}><summary className="rs-grid"><Row r={f} s={s} /></summary><div className="rs-grid">{kids.map((a) => <Row key={a.id} r={a} s={s} sub />)}</div></details>
              : <div key={f.id} className="rs-grid"><Row r={f} s={s} /></div>;
          })}
        </div>;
      })}
      <h4>История операции</h4>
      <HistoryBlock s={s} side={side} />
    </div>
  );
}

/** Исторические потери сторон и фронтов с периодом и источником; сравнение с расчётом — в сутки. */
function HistoryBlock({ s, side }: { s: OperationSummary; side: 'su' | 'de' }) {
  if (!s.history.losses.length) return <p className="rs-note">Исторических потерь этой операции в базе знаний нет.</p>;
  const fronts = new Set(s.losses.rows.filter((r) => r.echelon === 'front' || r.echelon === 'side').map((r) => r.id));
  return <>
    {[side, enemyOf(side)].map((sd) => {
      const calc = sidePerDay(s, sd), h = sideHistory(s, sd), hd = h && histPerDay(h);
      return <p key={sd} className="rs-compare"><b>{scopeName(s, sd)}:</b> расчёт за {String(calc?.days ?? 0).replace('.', ',')} сут — в сутки {n(calc?.perDay ?? 0)}; {hd != null ? `история — в сутки ${n(hd)}${h?.note ? ` (${h.note})` : ''}` : 'истории в базе знаний нет'}.</p>;
    })}
    <ul className="rs-hlist">
      {s.history.losses.filter((h) => fronts.has(h.scope) || h.scope === 'su' || h.scope === 'de').map((h, i) => <li key={i}>
        <b>{scopeName(s, h.scope)}</b>, {histPeriod(h)}: {histText(h)}. <span className="rs-src">{h.source}, надёжность {h.reliability}{h.note ? `; ${h.note}` : ''}</span>
      </li>)}
    </ul>
  </>;
}

/** Сравнение с историей: потери в сутки — расчёт, история, переигровка без вмешательства (когда посчитана). */
function ComparePart({ s, side, baseline }: { s: OperationSummary; side: 'su' | 'de'; baseline: BaselineState }) {
  const base = baseline.state === 'ready' ? baseline.summary : null;
  const cell = (x: number | null | undefined) => (x == null ? '—' : n(x));
  return (
    <div className="rs-cmp">
      <div className="rs-grid rs-cmp-g rs-head"><span>потери людей в сутки</span><span>расчёт</span><span>история</span><span>без вмеш.</span></div>
      {[side, enemyOf(side)].map((sd) => {
        const h = sideHistory(s, sd);
        return <div key={sd} className="rs-grid rs-cmp-g"><span className="rs-name">{scopeName(s, sd)}</span><span>{cell(sidePerDay(s, sd)?.perDay)}</span><span>{cell(h && histPerDay(h))}</span><span>{cell(base && sidePerDay(base, sd)?.perDay)}</span></div>;
      })}
      {baseline.state === 'off' && <p className="rs-note">Переигровка без вмешательства для сравнения не считалась.</p>}
      {baseline.state === 'wait' && <p className="rs-note">Переигровка без вмешательства считается…</p>}
      {baseline.state === 'error' && <p className="rs-note err">Переигровка без вмешательства не посчитана: {baseline.text}</p>}
    </div>
  );
}
