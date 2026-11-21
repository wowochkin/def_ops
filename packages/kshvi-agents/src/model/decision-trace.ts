import { createHash } from 'node:crypto';
import type { AgentCommand, AgentCommandResponse } from '../intermediary/act';
import type { DecisionConstraint } from '../intermediary/assess';
import type { ActiveOrder, AgentRequestedAction, ServerIntermediaryProjection } from '../intermediary/classify';
import type { EscalationReason } from '../intermediary/escalate';
import type { SystemActor } from './assignment';

export type DecisionUtility = Readonly<{
  score: number;
  reasons: readonly string[];
}>;

export type OptionReplay = Readonly<{
  replayId: string;
  inputHash: string;
  outcomeHash: string;
  officialProjectionHash: string;
  isolated: true;
  writeAccess: false;
  officialWorldChanged: false;
}>;

export type AgentDecisionOption = Readonly<{
  optionId: string;
  title: string;
  actions: readonly AgentRequestedAction[];
  utility: DecisionUtility;
  replay: OptionReplay;
}>;

export type RandomKey = Readonly<{
  seed: string;
  stream: string;
  key: string;
  cursor: number;
}>;

export type TraceVersions = Readonly<{
  profile: string;
  algorithm: string;
  projectionSchema: string;
  timeBudget: number;
}>;

export type AgentDecisionTrace = Readonly<{
  traceId: string;
  cycleId: string;
  assignmentId: string;
  actor: SystemActor;
  projection: ServerIntermediaryProjection;
  projectionHash: string;
  activeOrder?: ActiveOrder;
  options: readonly AgentDecisionOption[];
  constraints: readonly DecisionConstraint[];
  selectedOptionId: string | null;
  versions: TraceVersions;
  rngKeys: readonly RandomKey[];
  commands: readonly AgentCommand[];
  responses: readonly AgentCommandResponse[];
  escalationReason?: EscalationReason;
  unknownData: readonly string[];
  explanation: Readonly<{
    selected: string;
    alternativesRejected: readonly string[];
    unknownData: readonly string[];
  }>;
}>;

function canonicalJson(value: unknown): string {
  const ancestors = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('Хеш проекции требует конечных чисел');
      return Object.is(input, -0) ? 0 : input;
    }
    if (input === undefined) return null;
    if (Array.isArray(input)) return input.map(normalize);
    if (typeof input === 'object') {
      if (ancestors.has(input)) throw new Error('Хеш проекции не поддерживает циклические ссылки');
      ancestors.add(input);
      const result = Object.fromEntries(Object.keys(input).sort().map(key => [key, normalize((input as Record<string, unknown>)[key])]));
      ancestors.delete(input);
      return result;
    }
    throw new Error('Хеш проекции поддерживает только типизированные данные');
  };
  return JSON.stringify(normalize(value));
}

export function hashProjection(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export type DecisionTraceInput = Omit<AgentDecisionTrace, 'traceId' | 'explanation'>;

export function createDecisionTrace(input: DecisionTraceInput): AgentDecisionTrace {
  const selected = input.options.find(option => option.optionId === input.selectedOptionId);
  const alternatives = input.options.filter(option => option.optionId !== input.selectedOptionId);
  return {
    ...input,
    traceId: `trace-${hashProjection({ cycleId: input.cycleId, projectionHash: input.projectionHash }).slice(0, 24)}`,
    explanation: {
      selected: selected
        ? `Выбран вариант «${selected.title}»: ${selected.utility.reasons.join('; ')}`
        : 'Допустимый вариант не выбран; решение передано руководителю',
      alternativesRejected: alternatives.map(option => `«${option.title}» отклонён: ${option.utility.reasons.join('; ')}`),
      unknownData: [...input.unknownData],
    },
  };
}

export function decisionTraceForReplay(trace: AgentDecisionTrace): AgentDecisionTrace {
  return JSON.parse(JSON.stringify(trace)) as AgentDecisionTrace;
}
