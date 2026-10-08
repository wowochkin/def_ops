/**
 * Панель «Переигровка»: расчёт исторического прогона сценария прямо в браузере
 * (фоновый поток), результат — карта в редакторе (знаки по ходам, фронт, бои,
 * отметки) и отчёт о сравнении с историей.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapDocument } from '@def-ops/core';
import catalogFile from '../../../packages/sim/data/scenarios/catalog.json';
import type { CatalogEntry, SimRequest, SimResponse, SimResult } from './sim/protocol';
import { ask } from './dialogs';

const CATALOG = (catalogFile as { scenarios: CatalogEntry[] }).scenarios;

const fmtDays = (d: number | null) => (d == null ? '—' : d > 0 ? `+${d}` : String(d));
const dayClass = (d: number | null) => (d == null ? 'miss' : Math.abs(d) <= 1 ? 'ok' : Math.abs(d) <= 2 ? 'near' : 'off');
const pct = (x: number) => `${Math.round(x * 100)} %`;

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function SimPanel({ doc, onLoad, notify }: { doc: MapDocument; onLoad: (d: MapDocument) => void; notify: (s: string) => void }) {
  const [open, setOpen] = useState(() => localStorage.getItem('def_ops.simOpen') !== '0');
  const [scenario, setScenario] = useState(CATALOG[0].id);
  const entry = useMemo(() => CATALOG.find((c) => c.id === scenario) ?? CATALOG[0], [scenario]);
  const [rules, setRules] = useState(entry.rules[0].id);
  const [seed, setSeed] = useState(1);
  const [runs, setRuns] = useState(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const worker = useRef<Worker | null>(null);

  useEffect(() => { setRules(entry.rules[0].id); }, [entry]);
  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => { try { localStorage.setItem('def_ops.simOpen', open ? '1' : '0'); } catch { /* */ } }, [open]);

  const run = () => {
    if (doc.features.length && !doc.name?.startsWith('Переигровка') && !ask('Результат откроется вместо текущей карты. Несохранённые изменения пропадут. Продолжить?')) return;
    worker.current?.terminate();
    const w = new Worker(new URL('./sim/worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setBusy('запуск…'); setError(null);
    w.onmessage = (e: MessageEvent<SimResponse>) => {
      const m = e.data;
      if (m.kind === 'progress') setBusy(m.text);
      else if (m.kind === 'error') { setBusy(null); setError(m.message); w.terminate(); }
      else {
        setBusy(null); setResult(m.result); w.terminate();
        onLoad(m.result.doc);
        notify(`Переигровка рассчитана: ${CATALOG.find((c) => c.id === m.result.scenario)?.title ?? m.result.scenario}`);
      }
    };
    w.onerror = (e) => { setBusy(null); setError(e.message || 'ошибка расчёта'); };
    const q: SimRequest = { scenario, rules, seed, runs, toleranceKm: entry.toleranceKm };
    w.postMessage(q);
  };
  const stop = () => { worker.current?.terminate(); worker.current = null; setBusy(null); };

  return (
    <div className="sim">
      <div className="sec-h" onClick={() => setOpen(!open)} style={{ cursor: 'pointer' }}>
        <b>{open ? '▾' : '▸'} Переигровка</b> <span className="muted">исторические задачи, расчёт арбитра</span>
      </div>
      {open && <div className="pad">
        <label className="row">Сценарий
          <select value={scenario} onChange={(e) => { setScenario(e.target.value); setResult(null); }} disabled={!!busy}>
            {CATALOG.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
        <div className="muted small">{entry.detail}</div>
        <label className="row">Правила
          <select value={rules} onChange={(e) => setRules(e.target.value)} disabled={!!busy}>
            {entry.rules.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
        </label>
        <div className="row">
          <label title="Номер случайного прогона: один и тот же seed — один и тот же расчёт">seed <input type="number" min={1} value={seed} onChange={(e) => setSeed(Math.max(1, +e.target.value || 1))} disabled={!!busy} /></label>
          <label title="Прогонов с разными seed: разброс исходов. Карта — по первому">прогонов
            <select value={runs} onChange={(e) => setRuns(+e.target.value)} disabled={!!busy}>{[1, 3, 5, 10].map((n) => <option key={n}>{n}</option>)}</select>
          </label>
          {busy ? <button onClick={stop}>Остановить</button> : <button className="primary" onClick={run}>Рассчитать</button>}
        </div>
        {busy && <div className="busy"><span className="spinner" /> {busy}</div>}
        {error && <div className="err">Ошибка: {error}</div>}
        {result && !busy && <SimSummary r={result} tol={CATALOG.find((c) => c.id === result.scenario)?.toleranceKm ?? 10} onReport={() => setShowReport(true)} />}
      </div>}
      {showReport && result && <ReportModal md={result.report} onClose={() => setShowReport(false)}
        onDownload={() => download(`${result.scenario}-seed${result.seed}-report.md`, result.report, 'text/markdown')} />}
    </div>
  );
}

function SimSummary({ r, tol, onReport }: { r: SimResult; tol: number; onReport: () => void }) {
  const lo = Math.min(...r.spread), hi = Math.max(...r.spread);
  return (
    <div className="sim-res">
      <div className="kpis">
        <div><b>{r.runs > 1 && lo !== hi ? `${pct(lo)}–${pct(hi)}` : pct(r.within)}</b><span>положений в допуске ±{tol} км ({r.n})</span></div>
        <div><b>{r.eventsHit} из {r.eventsTotal}</b><span>событий ±2 сут{r.runs > 1 ? ` (${r.runs} прогонов)` : ''}</span></div>
      </div>
      <table className="events">
        <thead><tr><th>событие</th><th>ист.</th><th>расч.</th><th title="расхождение, сут, по прогонам">±сут</th></tr></thead>
        <tbody>{r.events.map((e) => (
          <tr key={e.title}>
            <td title={e.title}>{e.title.split(':')[0]}</td>
            <td>{e.historical.slice(8, 10)}.{e.historical.slice(5, 7)}</td>
            <td>{e.simulated ? `${e.simulated.slice(8, 10)}.${e.simulated.slice(5, 7)}` : '—'}</td>
            <td className="days">{e.days.map((d, i) => <span key={i} className={dayClass(d)}>{fmtDays(d)}</span>)}</td>
          </tr>))}
        </tbody>
      </table>
      <div className="row-btns">
        <button onClick={onReport}>Отчёт…</button>
        <span className="muted small">первый прогон — на карте; ползунок времени внизу</span>
      </div>
    </div>
  );
}

/** Отчёт: минимальный разбор Markdown (заголовки, абзацы, списки, таблицы, полужирный, код). */
function ReportModal({ md, onClose, onDownload }: { md: string; onClose: () => void; onDownload: () => void }) {
  const html = useMemo(() => mdToHtml(md), [md]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal report" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><b>Отчёт о сравнении с историей</b><span style={{ flex: 1 }} /><button onClick={onDownload}>Скачать .md</button><button onClick={onClose}>Закрыть</button></div>
        <div className="modal-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');

export function mdToHtml(md: string): string {
  const out: string[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,3} /.test(l)) { const n = l.indexOf(' '); out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`); continue; }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim())); i++; }
      i--;
      const [head, , ...body] = rows;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (l.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) { items.push(`<li>${inline(lines[i].slice(2))}</li>`); i++; }
      i--;
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join('\n');
}
