/**
 * «Полнота материалов» операции: по каркасу базы знаний — сколько нужных сведений уже есть (войска, командование,
 * пункты и районы, рубежи, реки, сама операция, ход событий), что не хватает и по какому элементу. Не мнение
 * модели: считается по ключам фактов записей. Пересчитывается при изменении базы.
 */
import { useEffect, useState } from 'react';
import { COVERAGE_LEVEL, coverageFieldTitle, coverageTodo, type Coverage, type CoverageGroup } from '@def-ops/knowledge';
import * as kb from '../kb/kb';
import { coverageOf } from '../kb/coverage';
import { download } from './data';

const CAT: Record<string, string> = { formations: 'formations', commanders: 'commanders', places: 'terrain', lines: 'terrain', rivers: 'terrain', operation: 'operations', events: 'chronology' };
const pct = (x: number) => `${Math.round(x * 100)} %`;

/** Полнота операции — с пересчётом при изменении базы. */
export function useCoverage(op: string | null): Coverage | null {
  const [c, setC] = useState<Coverage | null>(null);
  useEffect(() => {
    if (!op) { setC(null); return; }
    let alive = true, t: ReturnType<typeof setTimeout> | null = null, last: unknown = null;
    const run = () => void coverageOf(op).then((x) => { if (alive) setC(x); }).catch(() => { if (alive) setC(null); });
    const off = kb.subscribe((s) => { if (s.entries === last) return; last = s.entries; if (t) clearTimeout(t); t = setTimeout(run, 300); });
    return () => { alive = false; off(); if (t) clearTimeout(t); };
  }, [op]);
  return c;
}

export function CoverageBadge({ c }: { c: Coverage | null }) {
  if (!c) return null;
  return <span className={`cov-badge l-${c.level}`} title={COVERAGE_LEVEL[c.level]}>материалы {pct(c.score)}</span>;
}

export function CoveragePanel({ op, title }: { op: string; title: string }) {
  const c = useCoverage(op);
  const [open, setOpen] = useState<string | null>(null);
  if (!c) return <section className="mdl-card cov"><h4>Полнота материалов</h4><p className="muted">Считается…</p></section>;
  return (
    <section className="mdl-card cov">
      <div className="cov-h">
        <h4>Полнота материалов</h4>
        <b className={`cov-total l-${c.level}`}>{pct(c.score)}</b><span className={`cov-lvl l-${c.level}`}>{COVERAGE_LEVEL[c.level]}</span>
        <span className="grow" />
        <button onClick={() => download(`${op}-что-собрать.md`, coverageTodo(c, title), 'text/markdown')} title="Недостающие сведения списком — задание на поиск материалов">Что собрать (.md)</button>
      </div>
      <p className="muted small">Не оценка модели, а проверка по каркасу базы знаний: для каждого элемента операции — какие сведения должны быть и какие уже есть (по фактам записей). Пополняется документами («Материалы операции») и правкой записей в «Знаниях».
        Фактов в найденных записях {c.quality.facts}: с источником или цитатой {c.quality.facts ? pct(c.quality.sourced / c.quality.facts) : '—'}, достоверность A/B {c.quality.facts ? pct(c.quality.reliable / c.quality.facts) : '—'}.</p>
      <div className="cov-groups">
        {c.groups.filter((g) => g.items.length).map((g) => <Group key={g.id} g={g} open={open === g.id} toggle={() => setOpen(open === g.id ? null : g.id)} />)}
      </div>
    </section>
  );
}

function Group({ g, open, toggle }: { g: CoverageGroup; open: boolean; toggle: () => void }) {
  const [limit, setLimit] = useState(40);
  const none = g.items.filter((i) => !i.entries.length).length;
  const full = g.items.filter((i) => i.score >= 1).length;
  const items = [...g.items].sort((a, b) => a.score - b.score || a.title.localeCompare(b.title, 'ru'));
  return (
    <div className={`cov-g${open ? ' open' : ''}`}>
      <button className="cov-row" onClick={toggle} title={g.what}>
        <span className="cov-t">{g.title}</span>
        <span className="cov-bar"><i style={{ width: `${Math.round(g.score * 100)}%` }} className={g.score >= 0.75 ? 'l-enough' : g.score >= 0.45 ? 'l-partial' : 'l-little'} /></span>
        <span className="cov-n">{pct(g.score)}</span>
        <small className="muted">{g.items.length} эл.: полностью {full}{none ? `, без записи ${none}` : ''}</small>
      </button>
      {open && <div className="cov-items">
        <p className="muted small">{g.what}</p>
        {items.slice(0, limit).map((i) => <div key={i.id} className="cov-i">
          <span className="cov-it">{i.title}{i.note && <small className="muted"> · {i.note}</small>}</span>
          <span className="cov-keys">{i.need.map((k) => <i key={k} className={i.filled.includes(k) ? 'ok' : ''}>{k === 'event' ? 'запись о событии' : coverageFieldTitle(CAT[g.id], k)}</i>)}</span>
          {!i.entries.length && <small className="warn">записи нет</small>}
        </div>)}
        {items.length > limit && <button className="link" onClick={() => setLimit(limit + 200)}>ещё {items.length - limit}…</button>}
      </div>}
    </div>
  );
}
