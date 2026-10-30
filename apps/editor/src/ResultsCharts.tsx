/**
 * Графики вкладки «Итоги». LossChart — убыль людей по суткам: столбцы — своя сторона, линия — противник; ось — тысячи
 * человек и даты через сутки. DistanceChart — удаление советских фронтов от Берлина по суткам: игра — сплошная,
 * без вмешательства — штрих, история — точки. Оформление — как у графика состязания (классы cm-chart).
 */
import type { LossSeries, OperationSummary } from '@def-ops/sim';
import { fmtCount } from './num-format';
import { COLORS, niceStep } from './RivalryChart';

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

const short = (n: string) => n.replace(/\s*фронт$/, '').replace('Белорусский', 'Бел.').replace('Украинский', 'Укр.');

/** Удаление советских фронтов от Берлина, км, по суткам; side — чья игра (подпись «ваша игра» / «расчёт» не меняется). */
export function DistanceChart({ s, baseline, side }: { s: OperationSummary; baseline: OperationSummary | null; side: 'su' | 'de' }) {
  void side;
  const rows = s.distance?.rows ?? [];
  if (!rows.length) return null;
  const days = s.distance.days;
  const base = new Map((baseline?.distance?.rows ?? []).map((r) => [r.hq, r.game]));
  const W = 360, H = 140, L = 30, R = 6, T = 8, B = 18;
  const all = rows.flatMap((r) => [...r.game, ...r.history, ...(base.get(r.hq) ?? [])]).filter((v): v is number => v != null);
  const max = Math.max(10, ...all);
  const step = niceStep(max), top = Math.ceil(max / step) * step;
  const n = Math.max(2, days.length);
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => H - B - (v / top) * (H - T - B);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const every = Math.max(2, Math.ceil(days.length / 8));
  // отрезки без пропусков (null рвёт линию)
  const paths = (v: (number | null)[]) => v.reduce<string[][]>((acc, p, i) => { if (p == null) acc.push([]); else acc[acc.length - 1].push(`${x(i)},${y(p)}`); return acc; }, [[]]).filter((a) => a.length > 1);
  return (
    <div className="cm-chart rs-chart">
      <div className="cm-legend">
        {rows.map((r, i) => <span key={r.hq}><i style={{ background: COLORS[i % COLORS.length] }} />{short(r.name)}</span>)}
        <span className="rs-leg-kind">— игра · ┄ без вмешательства · • история</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        {ticks.map((k) => <g key={k}><line className="grid" x1={L} x2={W - R} y1={y(k)} y2={y(k)} /><text className="ax" x={L - 4} y={y(k) + 3} textAnchor="end">{fmtCount(k)}</text></g>)}
        {rows.map((r, i) => {
          const c = COLORS[i % COLORS.length], b = base.get(r.hq);
          return <g key={r.hq}>
            {paths(r.game).map((p, j) => <polyline key={`g${j}`} fill="none" stroke={c} strokeWidth={1.6} points={p.join(' ')} />)}
            {b && paths(b).map((p, j) => <polyline key={`b${j}`} fill="none" stroke={c} strokeWidth={1.2} strokeDasharray="4 3" opacity={0.8} points={p.join(' ')} />)}
            {r.history.map((v, k) => v != null && <circle key={`h${k}`} cx={x(k)} cy={y(v)} r={2.2} fill={c}><title>{`${dm(days[k])}: ${r.name} по истории — ${fmtCount(v)} км`}</title></circle>)}
          </g>;
        })}
        {days.map((d, i) => i % every === 0 && <text key={d} className="ax" x={x(i)} y={H - 5} textAnchor="middle">{dm(d)}</text>)}
      </svg>
      <div className="cm-chart-f">Удаление фронтов от центра Берлина, км (центр дивизий фронта в строю; история — среднее положений армий).</div>
    </div>
  );
}
