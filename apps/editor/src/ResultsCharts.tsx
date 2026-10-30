/**
 * Графики вкладки «Итоги». LossChart — убыль людей по суткам: столбцы — своя сторона, линия — противник; ось — тысячи
 * человек и даты через сутки. Оформление — как у графика состязания (классы cm-chart).
 */
import type { LossSeries } from '@def-ops/sim';
import { fmtCount } from './num-format';
import { niceStep } from './RivalryChart';

export const SIDE_COLOR: Record<'su' | 'de', string> = { su: '#b3261e', de: '#3b5b8a' };
const SIDE_GEN: Record<'su' | 'de', string> = { su: 'советские', de: 'немецкие' };
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;


export function LossChart({ s, side }: { s: LossSeries; side: 'su' | 'de' }) {
  const enemy = side === 'su' ? 'de' : 'su';
  const own = s.rows.find((r) => r.id === side)?.byDay.map((d) => d.personnel) ?? [];
  const other = s.rows.find((r) => r.id === enemy)?.byDay.map((d) => d.personnel) ?? [];
  const n = s.days.length;
  const W = 360, H = 128, L = 38, R = 6, T = 8, B = 18;
  const max = Math.max(100, ...own, ...other);
  const step = niceStep(max), top = Math.ceil(max / step) * step;
  const bw = (W - L - R) / Math.max(1, n);
  const x = (i: number) => L + i * bw;
  const y = (v: number) => H - B - (v / top) * (H - T - B);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const ax = (v: number) => (top >= 10000 ? `${fmtCount(v / 1000)} т` : fmtCount(v));
  // даты — через сутки (при длинном ходе — реже, чтобы не налезали)
  const every = Math.max(2, Math.ceil(n / 8));
  return (
    <div className="cm-chart rs-chart">
      <div className="cm-legend">
        <span><i style={{ background: SIDE_COLOR[side] }} />{SIDE_GEN[side]} — столбцы</span>
        <span><i style={{ background: SIDE_COLOR[enemy] }} />{SIDE_GEN[enemy]} — линия</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        {ticks.map((k) => <g key={k}><line className="grid" x1={L} x2={W - R} y1={y(k)} y2={y(k)} /><text className="ax" x={L - 4} y={y(k) + 3} textAnchor="end">{ax(k)}</text></g>)}
        {own.map((v, i) => <rect key={i} x={x(i) + bw * 0.15} y={y(v)} width={bw * 0.7} height={Math.max(0, H - B - y(v))} fill={SIDE_COLOR[side]} opacity={0.8}>
          <title>{`${dm(s.days[i])}: ${SIDE_GEN[side]} — ${fmtCount(v)} чел.; ${SIDE_GEN[enemy]} — ${fmtCount(other[i] ?? 0)} чел.`}</title></rect>)}
        {other.length > 0 && <polyline fill="none" stroke={SIDE_COLOR[enemy]} points={other.map((v, i) => `${x(i) + bw / 2},${y(v)}`).join(' ')} />}
        {other.map((v, i) => <circle key={i} cx={x(i) + bw / 2} cy={y(v)} r={2} fill={SIDE_COLOR[enemy]} />)}
        {s.days.map((d, i) => i % every === 0 && <text key={d} className="ax" x={x(i) + bw / 2} y={H - 5} textAnchor="middle">{dm(d)}</text>)}
      </svg>
      <div className="cm-chart-f">Выбыло людей за сутки{s.exact ? '' : ' (оценка по убыли численности)'}.</div>
    </div>
  );
}
