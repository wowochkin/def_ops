/**
 * Режимы боевых действий в одном движке (rules.regimes): к какому режиму относится каждое сравнение положения с
 * историей. Режим берётся из журнала прогона за ход, в котором снято положение: бой — по режиму боя (застройка,
 * укреплённая полоса, открытая местность), движение вне боя — марш или преследование, иначе — стоит на месте.
 * Нужен для калибровки каждого режима по своим записям (sim:calibrate-regimes) и для разбора ошибки по режимам.
 */
import { compareWithHistory, type Deviation, type History, type RunResult } from './history';
import type { SimContext } from './step';
import type { Regime } from './types';

export type RecordRegime = Regime | 'stand';
export type RegimeDeviation = Deviation & { regime: RecordRegime };

export function regimeDeviations(ctx: SimContext, run: RunResult, history: History): RegimeDeviation[] {
  const J = run.final.journal;
  return compareWithHistory(ctx, run, history).map((d) => {
    const k = run.snapshots.findIndex((x) => x.time >= d.time);
    const to = run.snapshots[k].time, from = run.snapshots[k - 1]?.time ?? ctx.scenario.start;
    const inTurn = J.filter((j) => j.time >= from && j.time < to);
    const fight = inTurn.filter((j) => j.kind === 'combat' && (j.attackers.includes(d.formation) || j.defenders.includes(d.formation)));
    const last = fight[fight.length - 1];
    if (last && last.kind === 'combat') return { ...d, regime: last.regime ?? 'open' };
    const mv = inTurn.filter((j) => j.kind === 'move' && j.formation === d.formation && j.regime);
    const m = mv[mv.length - 1];
    return { ...d, regime: m && m.kind === 'move' ? m.regime! : 'stand' };
  });
}
