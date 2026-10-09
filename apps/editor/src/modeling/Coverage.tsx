/**
 * «Полнота материалов» операции — по каркасу, не мнение модели. Наглядно, где дефициты:
 *  - плитки разделов (войска и командование, местность, ход операции, стороны, источники);
 *  - карта пробелов: формирования, пункты, мосты, участки боёв — цветом, насколько о них есть сведения;
 *  - группы с полосой полноты, по сторонам; раскрытая группа — какие сведения отсутствуют чаще всего и
 *    матрица «элемент × сведения».
 * Пересчитывается при изменении базы.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { COVERAGE_LEVEL, coverageHints, coverageTodo, levelOf, type Coverage, type CoverageGroup, type CoverageItem, type SearchHint } from '@def-ops/knowledge';
import * as kb from '../kb/kb';
import { coverageOf } from '../kb/coverage';
import { download } from './data';

const pct = (x: number) => `${Math.round(x * 100)} %`;
const css = (x: number) => `${Math.round(x * 100)}%`;
/** Статус: цвет, значок и слово — цвет никогда не один. */
const ST = {
  enough: { c: '#0ca30c', i: '✓', t: 'достаточно' },
  partial: { c: '#fab219', i: '◐', t: 'частично' },
  little: { c: '#d03b3b', i: '✕', t: 'мало' },
} as const;
const st = (x: number) => ST[levelOf(x)];

/** Полнота операции — с пересчётом при изменении базы. */
export function useCoverage(op: string | null): Coverage | null {
  const [c, setC] = useState<Coverage | null>(null);
  useEffect(() => {
    if (!op) { setC(null); return; }
    let alive = true, t: ReturnType<typeof setTimeout> | null = null, lastE: unknown = null, lastD = -1;
    const run = () => void coverageOf(op).then((x) => { if (alive) setC(x); }).catch(() => { if (alive) setC(null); });
    // пересчёт — при изменении записей или документов базы
    const off = kb.subscribe((s) => { if (s.entries === lastE && s.documents.length === lastD) return; lastE = s.entries; lastD = s.documents.length; if (t) clearTimeout(t); t = setTimeout(run, 300); });
    return () => { alive = false; off(); if (t) clearTimeout(t); };
  }, [op]);
  return c;
}

export function CoverageBadge({ c }: { c: Coverage | null }) {
  if (!c) return null;
  return <span className={`cov-badge l-${c.level}`} title={COVERAGE_LEVEL[c.level]}>{ST[c.level].i} материалы {pct(c.score)}</span>;
}

export function CoveragePanel({ op, title }: { op: string; title: string }) {
  const c = useCoverage(op);
  const [open, setOpen] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);
  if (!c) return <section className="mdl-card cov"><h4>Полнота материалов</h4><p className="muted">Считается…</p></section>;
  const allHints = coverageHints(c);
  const goGroup = (g: string) => { setOpen(g); setTimeout(() => document.getElementById(`cov-${op}-${g}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); };
  return (
    <section className="mdl-card cov">
      <div className="cov-h">
        <h4>Полнота материалов</h4>
        <b className={`cov-total l-${c.level}`}>{pct(c.score)}</b><span className={`cov-lvl l-${c.level}`}>{ST[c.level].i} {COVERAGE_LEVEL[c.level]}</span>
        <span className="grow" />
        <button onClick={() => setShowMap(!showMap)}>{showMap ? 'Скрыть карту' : 'Карта пробелов'}</button>
        <button onClick={() => download(`${op}-что-собрать.md`, coverageTodo(c, title), 'text/markdown')} title="Недостающие сведения списком — задание на поиск материалов">Что собрать (.md)</button>
      </div>
      <p className="muted small">Проверка по каркасу базы знаний, не оценка модели: для каждого элемента операции — какие сведения должны быть и какие уже есть. Пополняется документами («Материалы операции») и записями в «Знаниях».</p>
      <div className="cov-tiles">{c.sections.map((s) => { const x = st(s.score); return (
        <div key={s.id} className="cov-tile"><span className="cov-tile-t">{s.title}</span><b>{pct(s.score)}</b>
          <span className="cov-tile-bar"><i style={{ width: css(s.score), background: x.c }} /></span><small className="muted">{x.i} {x.t}</small></div>); })}</div>
      <Hints hints={allHints} onPick={goGroup} />
      {showMap && <GapMap c={c} onPick={goGroup} />}
      {c.sections.map((s) => <div key={s.id} className="cov-sec">
        <div className="cov-sec-h">{s.title}</div>
        {c.groups.filter((g) => g.section === s.id && g.items.length).map((g) => <Group key={g.id} id={`cov-${op}-${g.id}`} g={g} sides={c.sides} hints={allHints} open={open === g.id} toggle={() => setOpen(open === g.id ? null : g.id)} />)}
      </div>)}
    </section>
  );
}

function Group({ id, g, sides, hints, open, toggle }: { id: string; g: CoverageGroup; sides: Coverage['sides']; hints: SearchHint[]; open: boolean; toggle: () => void }) {
  const x = st(g.score);
  const none = g.items.filter((i) => !i.entries.length && !['days', 'state', 'have', 'event', 'weather'].includes(i.need[0])).length;
  const full = g.items.filter((i) => i.score >= 1).length;
  return (
    <div id={id} className={`cov-g${open ? ' open' : ''}`}>
      <button className="cov-row" onClick={toggle} title={g.what}>
        <span className="cov-t">{g.title}</span>
        <span className="cov-bar"><i style={{ width: css(g.score), background: x.c }} /></span>
        <span className="cov-n">{pct(g.score)}</span>
        <small className="cov-meta">{x.i} {g.items.length} эл.: полностью {full}{none ? `, без записи ${none}` : ''}
          {g.bySide && <span className="cov-sides">{Object.entries(g.bySide).map(([s, v]) => <span key={s}>{sides.find((y) => y.id === s)?.name ?? s} {pct(v)}</span>)}</span>}</small>
      </button>
      {open && <GroupDetail g={g} sides={sides} hints={hints.filter((h) => h.group === g.id)} />}
    </div>
  );
}

/** Раскрытая группа: каких сведений не хватает чаще всего — и матрица по элементам. */
function GroupDetail({ g, sides, hints }: { g: CoverageGroup; sides: Coverage['sides']; hints: SearchHint[] }) {
  const [side, setSide] = useState<string>('');
  const [limit, setLimit] = useState(60);
  const keys = useMemo(() => { const used = new Set(g.items.flatMap((i) => i.need)); return [...Object.keys(g.labels).filter((k) => used.has(k)), ...[...used].filter((k) => !(k in g.labels))]; }, [g]);
  const items = g.items.filter((i) => !side || i.side === side).sort((a, b) => a.score - b.score || a.title.localeCompare(b.title, 'ru'));
  const single = keys.length === 1;
  return (
    <div className="cov-items">
      <p className="muted small">{g.what}</p>
      {hints.length > 0 && <details className="cov-ghints"><summary>Что искать по группе: {hints.length}</summary>{hints.map((h) => <HintCard key={h.id} h={h} />)}</details>}
      {!single && <div className="cov-keystats">{keys.map((k) => {
        const need = items.filter((i) => i.need.includes(k)), have = need.filter((i) => i.filled.includes(k)).length, r = need.length ? have / need.length : 1;
        return <div key={k} className="cov-ks" title={`${g.labels[k] ?? k}: есть у ${have} из ${need.length}`}><span>{g.labels[k] ?? k}</span><span className="cov-tile-bar"><i style={{ width: css(r), background: st(r).c }} /></span><small>{have}/{need.length}</small></div>;
      })}</div>}
      {g.bySide && <div className="cov-filter">{[{ id: '', name: 'все' }, ...sides.filter((s) => g.items.some((i) => i.side === s.id))].map((s) => <button key={s.id} className={side === s.id ? 'on' : ''} onClick={() => setSide(s.id)}>{s.name}</button>)}</div>}
      <div className="cov-mx-wrap"><table className="cov-mx">
        <thead><tr><th>Элемент</th>{single ? <th>{g.labels[keys[0]] ?? keys[0]}</th> : keys.map((k) => <th key={k} title={g.labels[k] ?? k}><span>{g.labels[k] ?? k}</span></th>)}<th>Полнота</th></tr></thead>
        <tbody>{items.slice(0, limit).map((i) => <tr key={i.id}>
          <td className="cov-mx-t">{i.title}{i.note && <small className="muted"> · {i.note}</small>}{!i.entries.length && !['days', 'state', 'have', 'event', 'weather'].includes(i.need[0]) && <small className="warn"> · записи нет</small>}</td>
          {single ? <td className="cov-mx-one">{i.need[0] === 'days' ? <span className="cov-tile-bar"><i style={{ width: css(i.score), background: st(i.score).c }} /></span> : i.filled.length ? <span className="ok">✓ есть</span> : <span className="miss">✕ нет</span>}</td>
            : keys.map((k) => <td key={k} className={`cov-c ${!i.need.includes(k) ? 'na' : i.filled.includes(k) ? 'ok' : 'miss'}`} title={`${g.labels[k] ?? k}: ${!i.need.includes(k) ? 'не требуется' : i.filled.includes(k) ? 'есть' : 'нет'}`}>{!i.need.includes(k) ? '' : i.filled.includes(k) ? '●' : '○'}</td>)}
          <td className="cov-mx-n">{pct(i.score)}</td>
        </tr>)}</tbody>
      </table></div>
      {items.length > limit && <button className="link" onClick={() => setLimit(limit + 300)}>ещё {items.length - limit}…</button>}
    </div>
  );
}

/* ───────────── что искать ───────────── */

function copy(t: string) { void navigator.clipboard?.writeText(t); }

/** Что искать в первую очередь: подсказки по пользе для модели. */
function Hints({ hints, onPick }: { hints: SearchHint[]; onPick: (g: string) => void }) {
  const [all, setAll] = useState(false);
  if (!hints.length) return <p className="ok">Дефицитов нет — материалов достаточно по всем группам каркаса.</p>;
  return (
    <div className="cov-hints">
      <div className="cov-hints-h"><b>Что искать в первую очередь</b><small className="muted">по пользе для модели: вес группы × важность сведения для расчёта × сколько не хватает</small></div>
      {(all ? hints : hints.slice(0, 5)).map((h, i) => <HintCard key={h.id} h={h} n={i + 1} onPick={() => onPick(h.group)} />)}
      {hints.length > 5 && <button className="link" onClick={() => setAll(!all)}>{all ? 'свернуть' : `все подсказки (${hints.length})`}</button>}
    </div>
  );
}

function HintCard({ h, n, onPick }: { h: SearchHint; n?: number; onPick?: () => void }) {
  const [more, setMore] = useState(false);
  const share = h.missing / Math.max(1, h.total);
  return (
    <div className="cov-hint">
      <div className="cov-hint-h">{n != null && <i className="cov-hint-n">{n}</i>}<b>{h.title}</b>
        <span className="cov-tile-bar cov-hint-bar" title={`нет у ${h.missing} из ${h.total}`}><i style={{ width: css(1 - share), background: st(1 - share).c }} /></span>
        {onPick && <button className="link" onClick={onPick}>к группе ↓</button>}</div>
      <div className="small"><span className="muted">Зачем модели: </span>{h.why}</div>
      {h.where.length > 0 && <div className="small"><span className="muted">Где искать: </span>{h.where.slice(0, more ? 9 : 2).join(' · ')}{h.where.length > 2 && !more && <button className="link" onClick={() => setMore(true)}> ещё…</button>}</div>}
      {h.queries.length > 0 && <div className="cov-q">{h.queries.map((q) => <button key={q} className="cov-qb" title="Скопировать запрос" onClick={() => copy(q)}>⧉ {q}</button>)}</div>}
      <div className="small muted">Нет у: {h.items.slice(0, more ? 40 : 5).join('; ')}{h.items.length > 5 && !more ? <button className="link" onClick={() => setMore(true)}> и ещё {h.items.length - 5}</button> : null}</div>
    </div>
  );
}

/* ───────────── карта пробелов ───────────── */

type Mark = { g: string; it: CoverageItem; shape: 'circle' | 'square' | 'diamond' | 'up' | 'down' };
const SHAPES: { g: string; title: string; shape: Mark['shape'] }[] = [
  { g: 'formations', title: 'формирования (▲ СССР, ▼ Германия)', shape: 'up' }, { g: 'places', title: 'пункты и районы', shape: 'circle' },
  { g: 'bridges', title: 'мосты и переправы', shape: 'square' }, { g: 'battles', title: 'участки (бои)', shape: 'diamond' }, { g: 'events', title: 'события', shape: 'circle' },
];

function GapMap({ c, onPick }: { c: Coverage; onPick: (g: string) => void }) {
  const [on, setOn] = useState<Record<string, boolean>>({ formations: true, places: true, bridges: true, battles: true, events: false });
  const [tip, setTip] = useState<{ x: number; y: number; m: Mark } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const g = (id: string) => c.groups.find((x) => x.id === id);
  const marks: Mark[] = SHAPES.flatMap((s) => (g(s.g)?.items ?? []).filter((i) => i.at).map((it) => ({ g: s.g, it, shape: s.g === 'formations' ? (it.side === 'de' ? 'down' : 'up') : s.shape } as Mark)));
  const lines = [...(g('rivers')?.items ?? []).flatMap((i) => (i.lines ?? []).map((l, j) => ({ k: 'river', id: `${i.id}:${j}`, l }))), ...(g('lines')?.items ?? []).filter((i) => i.line).map((i) => ({ k: 'line', id: i.id, l: i.line! }))];
  const pts = marks.map((m) => m.it.at!);
  if (!pts.length) return null;
  const pad = 0.08;
  let [w, s, e, n] = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const dw = (e - w) * pad || 0.05, dh = (n - s) * pad || 0.05;
  w -= dw; e += dw; s -= dh; n += dh;
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180);
  const W = 1000, H = Math.max(260, Math.min(560, Math.round((W * (n - s)) / ((e - w) * k))));
  const X = (p: [number, number]) => [((p[0] - w) / (e - w)) * W, ((n - p[1]) / (n - s)) * H] as const;
  const path = (l: [number, number][]) => l.map((p, i) => `${i ? 'L' : 'M'}${X(p)[0].toFixed(1)},${X(p)[1].toFixed(1)}`).join('');
  const shape = (m: Mark, x: number, y: number) => {
    const col = st(m.it.score).c, r = m.shape === 'circle' ? 6 : 6.5;
    const p = { fill: col, stroke: '#fcfcfb', strokeWidth: 2 };
    if (m.shape === 'circle') return <circle cx={x} cy={y} r={r} {...p} />;
    if (m.shape === 'square') return <rect x={x - 4.5} y={y - 4.5} width={9} height={9} rx={1.5} {...p} />;
    if (m.shape === 'diamond') return <path d={`M${x},${y - 8}L${x + 8},${y}L${x},${y + 8}L${x - 8},${y}Z`} {...p} />;
    return <path d={m.shape === 'up' ? `M${x},${y - 7}L${x + 6.5},${y + 5}L${x - 6.5},${y + 5}Z` : `M${x},${y + 7}L${x + 6.5},${y - 5}L${x - 6.5},${y - 5}Z`} {...p} />;
  };
  const shown = marks.filter((m) => on[m.g]);
  // худшие — поверх
  shown.sort((a, b) => b.it.score - a.it.score);
  return (
    <div className="cov-map" ref={box}>
      <div className="cov-map-ctl">{SHAPES.filter((x) => g(x.g)?.items.some((i) => i.at)).map((x) => <label key={x.g}><input type="checkbox" checked={!!on[x.g]} onChange={(ev) => setOn({ ...on, [x.g]: ev.target.checked })} />{x.title}</label>)}
        <span className="grow" />{(['enough', 'partial', 'little'] as const).map((l) => <span key={l} className="cov-leg"><i style={{ background: ST[l].c }} />{ST[l].i} {l === 'enough' ? 'от 75 %' : l === 'partial' ? '45–75 %' : 'меньше 45 %'}</span>)}</div>
      <div className="cov-svg-box">
      <svg viewBox={`0 0 ${W} ${H}`} className="cov-svg" onMouseLeave={() => setTip(null)}>
        <rect width={W} height={H} fill="#fcfcfb" />
        {lines.map(({ k: kind, id: lid, l }) => <path key={`${kind}${lid}`} d={path(l)} fill="none" stroke={kind === 'river' ? '#8db4dc' : '#9a8f7a'} strokeWidth={kind === 'river' ? 2 : 1.5} strokeDasharray={kind === 'line' ? '6 4' : undefined} />)}
        {on.places && (g('places')?.items ?? []).filter((i) => i.at).map((i) => { const [x, y] = X(i.at!); return <text key={`t${i.id}`} x={x + 9} y={y + 4} className="cov-lbl">{i.title.replace(/^Берлин, /, '').replace(/ \(.*$/, '')}</text>; })}
        {shown.map((m) => { const [x, y] = X(m.it.at!); return (
          <g key={`${m.g}${m.it.id}`} className="cov-mk" onMouseEnter={() => setTip({ x, y, m })} onClick={() => onPick(m.g)}>
            <circle cx={x} cy={y} r={12} fill="transparent" />{shape(m, x, y)}</g>); })}
      </svg>
      {tip && <div className="cov-tip" style={{ left: `${(tip.x / W) * 100}%`, top: `${(tip.y / H) * 100}%` }}>
        <b>{tip.m.it.title}</b><span>{SHAPES.find((x) => x.g === tip.m.g)?.title.split(' (')[0]} · {st(tip.m.it.score).i} {pct(tip.m.it.score)}</span>
        {tip.m.it.score < 1 && <span className="muted">нет: {tip.m.it.need.filter((k2) => !tip.m.it.filled.includes(k2)).map((k2) => c.groups.find((x) => x.id === tip.m.g)?.labels[k2] ?? k2).join(', ')}</span>}
        {tip.m.it.note && <span className="muted">{tip.m.it.note}</span>}</div>}
      </div>
      <p className="muted small">Щелчок по знаку — раскрыть группу ниже. Реки — синим, рубежи — пунктиром.</p>
    </div>
  );
}
