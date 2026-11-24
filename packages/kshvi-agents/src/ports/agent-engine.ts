import {
  createEvaluationRequest,
  type AgentEvaluationRequest,
  type ModernChoice,
  type ModernReport,
} from './modern-choice';

export type { AgentEvaluationRequest } from './modern-choice';
export type { ModernAgentProfile, ModernChoice, AgentProjection } from './modern-choice';

export interface ScoredModernChoice {
  id: string;
  utility: number;
  uncertainty?: number;
  losses?: number;
}

export interface ModernOrder {
  id: string;
  recipient: string;
  channel: 'own-command-network';
  issuedTick: number;
  deliveryTick: number;
  choiceId?: string;
}

export interface AgentEvaluation {
  selected: ModernChoice;
  options: readonly ScoredModernChoice[];
  unknown: readonly string[];
  forkHashes: readonly string[];
  destroyedForks: number;
  orders: readonly ModernOrder[];
  reports: readonly ModernReport[];
  trace: Readonly<Record<string, unknown>>;
}

export interface AgentEnginePort {
  evaluateChoices(request: AgentEvaluationRequest): Promise<AgentEvaluation>;
  close?(): Promise<void>;
}

export async function evaluateChoices(engine: AgentEnginePort, request: AgentEvaluationRequest): Promise<AgentEvaluation> {
  return engine.evaluateChoices(createEvaluationRequest(request));
}
