/**
 * Решение модели → приказы арбитру. Название формирования и пункта модель пишет
 * словами — они сопоставляются со списками обстановки (точно, затем по
 * оригинальному названию и основам слов). Что не удалось сопоставить, не
 * исполняется и попадает в замечания: штаб посредника видит, что и почему
 * отброшено.
 */
import { checkAction, type GameState, type Order, type SimContext, type StaffAction, type Target } from '@def-ops/sim';
import { findName, TASK_RU, type Decision, type Issue, type Order as StaffOrder, type StaffActionGiven } from '../decision';
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

/**
 * Распоряжения штаба модели (тыл, переправы, резервы) → распоряжения арбитру. Названия баз, резервов,
 * пунктов сопоставляются с обстановкой; исполнимость проверяется теми же правилами, что и у человека
 * (checkAction): неисполнимое не уходит арбитру и остаётся в замечаниях с причиной.
 */
export function actionsToStaff(ctx: SimContext, g: GameState, sit: Situation, given: StaffActionGiven[]): { actions: StaffAction[]; applied: { given: StaffActionGiven; action: StaffAction | null; text: string }[] } {
  const T = ctx.theatre, side = sit.staff?.side ?? '', t = sit.time;
  const applied: { given: StaffActionGiven; action: StaffAction | null; text: string }[] = [];
  const actions: StaffAction[] = [];
  if (!sit.staff) return { actions, applied: given.map((x) => ({ given: x, action: null, text: 'тыл и резервы ведёт вышестоящее командование' })) };
  const place = (name: string | null) => {
    if (!name) return null;
    let i = findName(name, sit.areas.map((a) => a.title));
    if (i < 0) i = findName(name, sit.areas.map((a) => a.id));
    const a = i >= 0 ? T.area(sit.areas[i].id) : T.area(name);
    return a ? { at: a.center, title: sit.areas[i]?.title ?? a.name } : null;
  };
  let bridges = 0;
  for (const x of given ?? []) {
    let a: StaffAction | null = null, why = '';
    if (x.kind === 'base') {
      const bi = findName(x.subject ?? '', sit.staff.bases.map((b) => b.name)), p = place(x.area);
      if (bi < 0) why = `база «${x.subject}» не опознана`; else if (!p) why = `пункт «${x.area}» не опознан`;
      else a = { kind: 'base', side, base: sit.staff.bases[bi].id, to: p.at, toName: p.title, issuedAt: t };
    } else if (x.kind === 'priority') {
      const ids = (x.formations ?? []).map((n) => findName(n, sit.formations.map((f) => f.name))).filter((i) => i >= 0).map((i) => sit.formations[i].id);
      a = { kind: 'priority', side, formations: [...new Set(ids)], issuedAt: t };
    } else if (x.kind === 'bridge') {
      const p = place(x.area), r = p ? T.snapToRiver(p.at, 8) : null;
      if (!p) why = `пункт «${x.area}» не опознан`; else if (!r) why = `у пункта «${p.title}» нет реки`;
      else a = { kind: 'bridge', side, at: r.at, issuedAt: t };
    } else if (x.kind === 'demolish') {
      const p = place(x.area);
      const near = p ? T.data.bridges.filter((b) => (!b.openFrom || b.openFrom <= t) && (!b.destroyedAt || b.destroyedAt > t))
        .map((b) => ({ b, d: Math.hypot(...(T.proj.toXY(b.at).map((v, k) => v - T.proj.toXY(p.at)[k]) as [number, number])) })).filter((q) => q.d <= 8).sort((q, w) => q.d - w.d)[0] : null;
      if (!p) why = `пункт «${x.area}» не опознан`; else if (!near) why = `у пункта «${p.title}» нет действующего моста`;
      else a = { kind: 'demolish', side, at: near.b.at, issuedAt: t };
    } else if (x.kind === 'commit') {
      const ri = findName(x.subject ?? '', sit.staff.reserves.map((r) => r.name)), p = place(x.area);
      if (ri < 0) why = `«${x.subject}» нет среди резервов`; else if (!p) why = `пункт «${x.area}» не опознан`;
      else a = { kind: 'commit', side, formation: sit.staff.reserves[ri].id, at: p.at, atName: p.title, issuedAt: t };
    }
    if (a) {
      const c = checkAction(ctx, g.state, a, a.kind === 'bridge' ? bridges : 0);
      if (!c.ok) { applied.push({ given: x, action: null, text: `не исполнено: ${c.text}` }); continue; }
      if (a.kind === 'bridge') bridges++;
      actions.push(a);
      applied.push({ given: x, action: a, text: c.text });
    } else applied.push({ given: x, action: null, text: `не исполнено: ${why}` });
  }
  return { actions, applied };
}
