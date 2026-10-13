/**
 * Решение модели → приказы арбитру. Название формирования и пункта модель пишет
 * словами — они сопоставляются со списками обстановки (точно, затем по
 * оригинальному названию и основам слов). Что не удалось сопоставить, не
 * исполняется и попадает в замечания: штаб посредника видит, что и почему
 * отброшено.
 */
import { checkAction, type GameState, type Order, type SimContext, type StaffAction, type Target } from '@def-ops/sim';
type LngLat = [number, number];
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

/** Пункт по названию: сначала среди пунктов обстановки (ближних), затем среди всех пунктов театра — по названию и id. */
export function findArea(name: string, sit: Pick<Situation, 'areas' | 'allAreas'>): { id: string; title: string } | null {
  for (const list of [sit.areas, sit.allAreas ?? []]) {
    let i = findName(name, list.map((a) => a.title), true);
    if (i < 0) i = findName(name, list.map((a) => a.id));
    if (i >= 0) return list[i];
  }
  return null;
}

export function decisionToOrders(d: Pick<Decision, 'orders'>, sit: Situation, source: Order['source'] = 'llm'): { orders: Order[]; applied: AppliedOrder[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const applied: AppliedOrder[] = [];
  const fNames = sit.formations.map((f) => f.name);
  const eNames = sit.enemies.map((e) => e.name);
  const resolve = (name: string | null | undefined): { target: Target; text: string } | null => {
    if (!name || !name.trim()) return null;
    const a = findArea(name, sit);
    if (a) return { target: a.id, text: a.title };
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
/** Соединение id входит в объединение hq (по подчинению сценария). */
function under(defs: Map<string, { parent?: string | null }>, id: string, hq: string): boolean {
  for (let x = defs.get(id)?.parent, n = 0; x && n < 8; x = defs.get(x)?.parent, n++) if (x === hq) return true;
  return false;
}

export function actionsToStaff(ctx: SimContext, g: GameState, sit: Situation, given: StaffActionGiven[]): { actions: StaffAction[]; applied: { given: StaffActionGiven; action: StaffAction | null; text: string }[] } {
  const T = ctx.theatre, side = sit.staff?.side ?? '', t = sit.time;
  const applied: { given: StaffActionGiven; action: StaffAction | null; text: string }[] = [];
  const actions: StaffAction[] = [];
  if (!sit.staff) return { actions, applied: given.map((x) => ({ given: x, action: null, text: 'тыл и резервы ведёт вышестоящее командование' })) };
  const place = (name: string | null) => {
    if (!name) return null;
    const f = findArea(name, sit);
    const a = f ? T.area(f.id) : T.area(name);
    return a ? { at: a.center, title: f?.title ?? a.name } : null;
  };
  let bridges = 0;
  for (const x of given ?? []) {
    let a: StaffAction | null = null, why = '';
    if (x.kind === 'base') {
      const bi = findName(x.subject ?? '', sit.staff.bases.map((b) => b.name), true), p = place(x.area);
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
    } else if (x.kind === 'line') {
      // разграничительная линия между двумя своими армиями: армии — по названию, пункты — по списку
      const armies = ctx.scenario.formations.filter((f) => f.side === side && f.echelon === 'army');
      const ids = (x.formations ?? []).map((n) => findName(n, armies.map((f) => f.name))).filter((i) => i >= 0).map((i) => armies[i].id);
      const pts = (x.area ?? '').split(/\s+[—–-]\s+|;|,\s(?=[А-ЯЁA-Z])/).map((n) => n.trim()).filter(Boolean).map(place);
      if (new Set(ids).size !== 2) why = `не опознаны две армии: ${(x.formations ?? []).join(', ')}`;
      else if (pts.length < 2 || pts.some((p) => !p)) why = `пункты линии не опознаны: ${x.area}`;
      else a = { kind: 'boundary', side, a: ids[0], b: ids[1], line: pts.map((p) => p!.at), places: pts.map((p) => p!.title), issuedAt: t };
    } else if (x.kind === 'commit') {
      const ri = findName(x.subject ?? '', sit.staff.reserves.map((r) => r.name)), p = place(x.area);
      // не соединение из резерва — может быть объединение (армия, корпус), чьи соединения в резерве: вводится целиком
      const defs = new Map(ctx.scenario.formations.map((f) => [f.id, f]));
      const heads = ctx.scenario.formations.filter((f) => f.side === side && !f.type && sit.staff!.reserves.some((r) => under(defs, r.id, f.id)));
      const hi = ri < 0 ? findName(x.subject ?? '', heads.map((f) => f.name)) : -1;
      if (ri < 0 && hi < 0) why = `«${x.subject}» нет среди резервов`; else if (!p) why = `пункт «${x.area}» не опознан`;
      else if (ri >= 0) a = { kind: 'commit', side, formation: sit.staff.reserves[ri].id, at: p.at, atName: p.title, issuedAt: t };
      else {
        // соединения объединения — в один район, разнесены в 3–4 км: точки района — сам пункт и круги в 3,5 и 7 км;
        // берутся только точки на своей территории (пункт у линии фронта — часть круга за ней)
        const ms = sit.staff.reserves.filter((r) => under(defs, r.id, heads[hi].id)), kx = 1 / Math.cos((p.at[1] * Math.PI) / 180);
        const ring = (km: number, n: number) => Array.from({ length: n }, (_, k): LngLat => [p.at[0] + (km / 111) * Math.cos((2 * Math.PI * k) / n) * kx, p.at[1] + (km / 111) * Math.sin((2 * Math.PI * k) / n)]);
        const probe = (at: LngLat): StaffAction => ({ kind: 'commit', side, formation: ms[0].id, at, atName: p.title, issuedAt: t });
        const spots = [p.at, ...ring(3.5, 8), ...ring(7, 12)].filter((at) => checkAction(ctx, g.state, probe(at)).ok);
        ms.forEach((m, i) => {
          if (!spots.length) { applied.push({ given: x, action: null, text: `не исполнено (${m.name}): район сосредоточения — не на своей территории` }); return; }
          const c: StaffAction = { kind: 'commit', side, formation: m.id, at: spots[i % spots.length], atName: p.title, issuedAt: t };
          const ok = checkAction(ctx, g.state, c);
          if (!ok.ok) { applied.push({ given: x, action: null, text: `не исполнено (${m.name}): ${ok.text}` }); return; }
          actions.push(c);
          applied.push({ given: x, action: c, text: ok.text });
        });
        continue;
      }
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
