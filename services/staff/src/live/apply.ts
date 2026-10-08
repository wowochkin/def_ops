/**
 * Решение модели → приказы арбитру. Название формирования и пункта модель пишет
 * словами — они сопоставляются со списками обстановки (точно, затем по
 * оригинальному названию и основам слов). Что не удалось сопоставить, не
 * исполняется и попадает в замечания: штаб посредника видит, что и почему
 * отброшено.
 */
import type { Order, Target } from '@def-ops/sim';
import { findName, TASK_RU, type Decision, type Issue, type Order as StaffOrder } from '../decision';
import type { Situation } from './situation';

const MOVE: StaffOrder['task'][] = ['withdraw', 'breakout', 'regroup', 'relieve'];
const STAY: StaffOrder['task'][] = ['defend', 'hold', 'delay', 'reserve'];

export interface AppliedOrder {
  /** Приказ, как его написала модель. */
  given: StaffOrder;
  /** Что ушло арбитру (нет — отброшен). */
  order: Order | null;
  /** Как понято: формирование и цель словами. */
  formation: string | null;
  target: string | null;
  issue?: string;
}

export function decisionToOrders(d: Pick<Decision, 'orders'>, sit: Situation, source: Order['source'] = 'llm'): { orders: Order[]; applied: AppliedOrder[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const applied: AppliedOrder[] = [];
  const fNames = sit.formations.map((f) => f.name);
  const aNames = sit.areas.map((a) => a.title);
  const aIds = sit.areas.map((a) => a.id);
  const eNames = sit.enemies.map((e) => e.name);
  const resolve = (name: string | null | undefined): { target: Target; text: string } | null => {
    if (!name || !name.trim()) return null;
    let i = findName(name, aNames);
    if (i < 0) i = findName(name, aIds);
    if (i >= 0) return { target: sit.areas[i].id, text: sit.areas[i].title };
    const e = findName(name, eNames);
    if (e >= 0) return { target: { formation: sit.enemies[e].id }, text: `против: ${sit.enemies[e].name}` };
    return null;
  };
  const byFormation = new Map<string, Order>();
  for (const [k, o] of (d.orders ?? []).entries()) {
    const fi = findName(o.formation ?? '', fNames);
    if (fi < 0) {
      const issue = `приказ ${k + 1}: «${o.formation}» — нет среди своих сил, не исполнен`;
      issues.push({ level: 'error', text: issue });
      applied.push({ given: o, order: null, formation: null, target: null, issue });
      continue;
    }
    const f = sit.formations[fi];
    const want = MOVE.includes(o.task) ? o.toArea ?? o.area : o.area;
    let t = resolve(want);
    let issue: string | undefined;
    if (!t && want) {
      if (STAY.includes(o.task)) { issue = `${f.name}: пункт «${want}» не опознан — ${TASK_RU[o.task]} на месте`; issues.push({ level: 'warning', text: issue }); }
      else {
        issue = `${f.name}: цель «${want}» не опознана — приказ «${TASK_RU[o.task]}» не исполнен`;
        issues.push({ level: 'error', text: issue });
        applied.push({ given: o, order: null, formation: f.name, target: null, issue });
        continue;
      }
    }
    if (!t && !STAY.includes(o.task)) {
      issue = `${f.name}: для задачи «${TASK_RU[o.task]}» не указана цель — не исполнен`;
      issues.push({ level: 'error', text: issue });
      applied.push({ given: o, order: null, formation: f.name, target: null, issue });
      continue;
    }
    t ??= null;
    const order: Order = {
      id: `${source}@${sit.time}:${f.id}`, formation: f.id, task: o.task, target: t?.target ?? null, issuedAt: sit.time, source,
      note: [o.details, o.deadline ? `срок: ${o.deadline}` : ''].filter(Boolean).join('; '),
    };
    if (byFormation.has(f.id)) issues.push({ level: 'warning', text: `${f.name}: несколько приказов — исполняется последний` });
    byFormation.set(f.id, order);
    applied.push({ given: o, order, formation: f.name, target: t?.text ?? 'на месте', issue });
  }
  return { orders: [...byFormation.values()], applied, issues };
}
