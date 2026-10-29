/**
 * «История как замысел» в интерфейсе: состояние штаба на час по смене статусов хода (AgentTrace.intent) и
 * подпись бейджа. Без React — проверяется в node.
 */
import type { AgentTrace } from '@def-ops/sim';

export type IntentStatus = 'history' | 'shifted' | 'own';
export interface IntentState { status: IntentStatus; reason: string | null; since: number }

/** Состояние штаба на час: последнее изменение не позже часа; хода без `intent` или штаба в нём нет — null. */
export function intentAt(trace: AgentTrace, hq: string, tick: number): IntentState | null {
  const ch = trace.intent?.find((x) => x.hq === hq)?.changes;
  if (!ch) return null;
  let cur: IntentState | null = null;
  for (const c of ch) if (c.tick <= tick && (!cur || c.tick >= cur.since)) cur = { status: c.status, reason: c.reason, since: c.tick };
  return cur;
}

/** Подпись бейджа: «по истории», «по истории со сдвигом[: причина]», «сам[: причина]». */
export function intentBadge(s: IntentState | null): string | null {
  if (!s) return null;
  if (s.status === 'history') return 'по истории';
  const base = s.status === 'shifted' ? 'по истории со сдвигом' : 'сам';
  return s.reason ? `${base}: ${s.reason}` : base;
}

export const NO_INTENT = 'в этом прогоне история как замысел не использовалась';
