/**
 * Триггеры обстановки для отбора доктрины штабу: по записям журнала за последний ход и состоянию войск стороны.
 * Порядок — по важности: окружение своих, вклинение противника, давление, свой удар, резервы в тылу.
 */
import type { DoctrineTrigger } from '@def-ops/knowledge';
import { onMap, type GameState, type SimContext } from '@def-ops/sim';

const ORDER: DoctrineTrigger[] = ['encircled', 'penetration', 'pressure', 'attack', 'reserves'];

/**
 * encircled — своё формирование на карте, не уничтожено, отрезано; penetration — бой за ход, где свои среди
 * обороняющихся и прорыв или продвижение от 3 км; pressure — бой за ход, где свои обороняются при соотношении от 3;
 * attack — своё формирование с задачей наступать или контратаковать либо в положении наступления; reserves —
 * своё неуничтоженное формирование в резерве (reserveFrom).
 */
export function situationTriggers(ctx: SimContext, g: GameState, side: string): DoctrineTrigger[] {
  const s = g.state;
  const own = s.formations.filter((f) => f.side === side);
  const ownIds = new Set(own.map((f) => f.id));
  const from = new Date(Date.parse(`${s.time.slice(0, 16)}:00Z`) - ctx.scenario.turnHours * 3600_000).toISOString().slice(0, 16);
  const battles = s.journal.filter((j): j is Extract<typeof j, { kind: 'combat' }> => j.kind === 'combat' && j.time.slice(0, 16) >= from && j.defenders.some((id) => ownIds.has(id)));
  const on = new Set<DoctrineTrigger>();
  if (own.some((f) => onMap(f, s.time) && f.cutOff)) on.add('encircled');
  if (battles.some((b) => b.outcome === 'breakthrough' || b.advanceKm >= 3)) on.add('penetration');
  if (battles.some((b) => b.ratio >= 3)) on.add('pressure');
  if (own.some((f) => !f.destroyed && (f.order?.task === 'attack' || f.order?.task === 'counterattack' || f.posture === 'attack'))) on.add('attack');
  if (own.some((f) => !f.destroyed && f.reserveFrom)) on.add('reserves');
  return ORDER.filter((t) => on.has(t));
}

const QUERY: Record<DoctrineTrigger, string> = {
  encircled: 'окружение прорыв к своим',
  penetration: 'вклинение противника контратака резервы',
  pressure: 'оборона при превосходстве противника отход',
  attack: 'наступление эшелоны ввод подвижной группы темп',
  reserves: 'резервы ввод в бой',
};

/** Запросы справки штабу: по триггеру — свой, последним — местность у пункта-ориентира. */
export const staffQueries = (triggers: DoctrineTrigger[], anchorName: string): string[] =>
  [...triggers.map((t) => QUERY[t]), `оборона и местность у ${anchorName}`];
