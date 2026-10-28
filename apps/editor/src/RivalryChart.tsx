/**
 * График состязания: расстояние каждого фронта до объекта (Берлина) по времени — как видит каждый командующий; сверху
 * вниз — ближе. Вертикали — решения командующих (у немцев — «держать / отходить» 9-й армии и деблокирование 12-й);
 * сплошная линия — выбранный час.
 */
import type { AgentTrace } from '@def-ops/sim';
import { addHours } from '@def-ops/sim';
import { rivalrySeries } from './commander-view';

const COLORS = ['#b3261e', '#d97706', '#0f766e', '#2563eb'];
const dm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;

export function RivalryChart({ trace, tick, current }: { trace: AgentTrace; tick: number; current?: string }) {
  const series = rivalrySeries(trace);
  if (!series.length) return null;
  const W = 616, H = 150, L = 8, R = 8, T = 46, B = 10;
  const last = Math.max(1, trace.frames.length - 1);
  const all = series.flatMap((s) => s.points);
  const max = Math.max(10, ...all.map((p) => p[1]));
  const x = (t: number) => L + (t / last) * (W - L - R);
  // сверху вниз — ближе: далёкое вверху, у объекта — внизу
  const y = (km: number) => H - B - (km / max) * (H - T - B);
  const soviet = series.filter((s) => s.points.length), german = series.filter((s) => !s.points.length);
  return (
    <div className="cm-chart">
      <div className="cm-chart-h"><b>Состязание за Берлин — как видит каждый командующий</b><span>{dm(trace.start)}–{dm(addHours(trace.start, last))}</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        <line className="base" x1={L} x2={W - R} y1={H - B} y2={H - B} />
        {soviet.map((s, i) => <polyline key={s.hq} className={s.hq === current ? 'cur' : ''} fill="none" stroke={COLORS[i % COLORS.length]} points={s.points.map(([t, km]) => `${x(t)},${y(km)}`).join(' ')} />)}
        {series.flatMap((s, i) => s.marks.map((m) => <line key={`${s.hq}-${m.tick}-${m.label}`} className={`mark${s.points.length ? '' : ' de'}`} x1={x(m.tick)} x2={x(m.tick)} y1={T - 4} y2={H - B} stroke={s.points.length ? COLORS[i % COLORS.length] : '#6b7280'}><title>{`${dm(addHours(trace.start, m.tick))} ${addHours(trace.start, m.tick).slice(11, 16)} — ${s.name}: ${m.label}`}</title></line>))}
        {series.map((s, i) => {
          // подпись — у последнего решения до выбранного часа
          const m = [...s.marks].filter((q) => q.tick <= tick).pop();
          return m ? <text key={s.hq} className="lbl" x={Math.min(x(m.tick) + 3, W - 150)} y={9 + i * 10} fill={s.points.length ? COLORS[i % COLORS.length] : '#4b5563'}>{`${s.name.split(' ')[0]}: ${m.label}`.slice(0, 44)}</text> : null;
        })}
        {soviet.map((s, i) => { const p = s.points[s.points.length - 1]; return p ? <text key={s.hq} className="end" x={x(p[0]) - 4} y={y(p[1]) - 4} textAnchor="end" fill={COLORS[i % COLORS.length]}>{s.name.split(' ')[0]}</text> : null; })}
        <line className="now" x1={x(Math.min(tick, last))} x2={x(Math.min(tick, last))} y1={T - 4} y2={H - B} />
      </svg>
      <div className="cm-chart-f">Расстояние до центра Берлина (сверху вниз — ближе); вертикали — решения командующих{german.length ? ', серые — 9-й и 12-й армий' : ''}.</div>
    </div>
  );
}
