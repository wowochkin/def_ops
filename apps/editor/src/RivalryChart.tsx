/**
 * График состязания: расстояние каждого фронта до объекта по времени — как видит каждый командующий; сверху вниз —
 * ближе. Вертикали — решения командующих (у немцев — «держать / отходить» 9-й армии и деблокирование 12-й), у каждой
 * номер, расшифровка — списком под графиком; сплошная линия — выбранный час. Ось — километры и даты.
 */
import { useMemo, useState } from 'react';
import type { AgentTrace } from '@def-ops/sim';
import { addHours } from '@def-ops/sim';
import { OBJECTIVE_AT, rivalrySeries } from './commander-view';
import { ActButton, useAction } from './voice/registry';
import { btn } from './voice/highlight';
import { inReplay } from './voice/actions/command';
import { CHART_KEY, readOpen } from './replay-dock';

const COLORS = ['#b3261e', '#d97706', '#0f766e', '#2563eb'];
const dm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;
const first = (n: string) => n.split(' ')[0];
/** Шаг оси километров: 1, 2, 5 × 10^k так, чтобы меток было 3–5. */
export function niceStep(max: number): number {
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

export function RivalryChart({ trace, tick, current }: { trace: AgentTrace; tick: number; current?: string }) {
  const series = useMemo(() => rivalrySeries(trace), [trace]);
  const [open, setOpenState] = useState(() => { try { return readOpen(CHART_KEY, true, localStorage); } catch { return true; } });
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem(CHART_KEY, v ? 'open' : 'closed'); } catch { /* */ } };
  useAction({
    id: 'map.chart', section: 'replay', title: 'График состязания', describe: 'Сворачивает или раскрывает график состязания за объект в левой колонке карты.',
    params: { type: 'object', properties: { open: { type: 'boolean' } } }, say: ['штаб, сверни график', 'штаб, покажи график'],
    available: inReplay, highlight: () => btn('map.chart'),
    run: async (p?: { open?: boolean }) => { const want = typeof p?.open === 'boolean' ? p.open : !open; setOpen(want); return want ? 'График раскрыт.' : 'График свёрнут.'; },
  });
  if (!series.length) return null;
  const objective = trace.commanders?.find((c) => c.side === 'su' && c.objective)?.objective;
  const goal = (objective && OBJECTIVE_AT[objective]?.name) || 'объект';
  const W = 616, H = 130, L = 34, R = 8, T = 10, B = 18;
  const last = Math.max(1, trace.frames.length - 1);
  const max = Math.max(10, ...series.flatMap((s) => s.points.map((p) => p[1])));
  const step = niceStep(max), top = Math.ceil(max / step) * step;
  const x = (t: number) => L + (t / last) * (W - L - R);
  // сверху вниз — ближе: далёкое вверху, у объекта — внизу
  const y = (km: number) => H - B - (km / top) * (H - T - B);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const days = Array.from({ length: Math.floor(last / 96) + 1 }, (_, i) => i * 96);
  const soviet = series.filter((s) => s.points.length);
  // номера отметок — по порядку часа
  const marks = series.flatMap((s, si) => s.marks.map((m) => ({ ...m, s, si }))).sort((a, b) => a.tick - b.tick).map((m, i) => ({ ...m, n: i + 1 }));
  const showNum = marks.length <= 24;
  return (
    <div className={`cm-chart${open ? '' : ' closed'}`}>
      <ActButton className="cm-chart-h" action="map.chart" params={{ open: !open }}><b>Состязание за {goal} — как видит каждый командующий {open ? '▾' : '▸'}</b><span>{dm(trace.start)}–{dm(addHours(trace.start, last))}</span></ActButton>
      {open && <>
      <div className="cm-legend">{soviet.map((s, i) => <span key={s.hq}><i style={{ background: COLORS[i % COLORS.length] }} />{first(s.name)}</span>)}
        {series.some((s) => !s.points.length) && <span><i style={{ background: '#6b7280' }} />решения 9-й армии, деблокирование 12-й</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        {ticks.map((k) => <g key={k}><line className="grid" x1={L} x2={W - R} y1={y(k)} y2={y(k)} /><text className="ax" x={L - 4} y={y(k) + 3} textAnchor="end">{k}</text></g>)}
        {days.map((h) => <g key={h}><line className="grid v" x1={x(h)} x2={x(h)} y1={T} y2={H - B} /><text className="ax" x={x(h)} y={H - 5} textAnchor={h === 0 ? 'start' : x(h) > W - 30 ? 'end' : 'middle'}>{dm(addHours(trace.start, h))}</text></g>)}
        {soviet.map((s, i) => <polyline key={s.hq} className={s.hq === current ? 'cur' : ''} fill="none" stroke={COLORS[i % COLORS.length]} points={s.points.map(([t, km]) => `${x(t)},${y(km)}`).join(' ')} />)}
        {marks.map((m) => {
          const col = m.s.points.length ? COLORS[m.si % COLORS.length] : '#6b7280';
          return <g key={`${m.s.hq}-${m.tick}-${m.label}`}>
            <line className="mark" x1={x(m.tick)} x2={x(m.tick)} y1={T} y2={H - B} stroke={col}><title>{`${dm(addHours(trace.start, m.tick))} ${addHours(trace.start, m.tick).slice(11, 16)} — ${m.s.name}: ${m.label}`}</title></line>
            {showNum && <text className="num" x={x(m.tick)} y={T + 8 + (m.n % 3) * 9} textAnchor="middle" fill={col}>{m.n}</text>}
          </g>;
        })}
        <line className="now" x1={x(Math.min(tick, last))} x2={x(Math.min(tick, last))} y1={T} y2={H - B} />
      </svg>
      <ol className="cm-marks">{marks.map((m) => <li key={`${m.s.hq}-${m.tick}-${m.label}`} className={m.tick <= tick ? '' : 'future'}>
        {showNum && <b style={{ color: m.s.points.length ? COLORS[m.si % COLORS.length] : '#6b7280' }}>{m.n}</b>} {dm(addHours(trace.start, m.tick))} {first(m.s.name)}: {m.label}</li>)}</ol>
      <div className="cm-chart-f">Расстояние до {goal === 'объект' ? 'объекта' : `центра ${goal === 'Берлин' ? 'Берлина' : goal}`}, км (сверху вниз — ближе); вертикали — решения командующих.</div>
      </>}
    </div>
  );
}
