import {
  evaluateChoices,
  type AgentEnginePort,
  type ModernAgentProfile,
} from '../../../../packages/kshvi-agents/src/ports/agent-engine';
import type {
  AutonomousCalculationInput,
  AutonomousCalculationResult,
  DemonstrationScenario,
  ExpositionAgentDecision,
} from '../../../../packages/kshvi/src/exposition/exposition-session';
import { calculatePreparedScenario } from '../../../../packages/kshvi/src/exposition/exposition-session';

export interface AsyncAutonomousCalculator {
  calculate(input: AutonomousCalculationInput): Promise<AutonomousCalculationResult>;
}

type SystemSide = DemonstrationScenario['systemSides'][number];

function hash32(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash ^ (hash >>> 16)) >>> 0;
}

function decisionOf(kind: string): ExpositionAgentDecision {
  switch (kind) {
    case 'ADVANCE': return { consumptionFactor: 1.25, supplyFactor: 1.1 };
    case 'WITHDRAW': return { consumptionFactor: 0.9, supplyFactor: 0.8 };
    case 'HOLD': return { consumptionFactor: 0.75, supplyFactor: 1 };
    case 'DEFEND': return { consumptionFactor: 0.85, supplyFactor: 1.05 };
    case 'REQUEST_SUPPORT': return { consumptionFactor: 0.9, supplyFactor: 1.5 };
    default: return { consumptionFactor: 1, supplyFactor: 1 };
  }
}

/** Асинхронный full-simulation: решения принимает только AgentEnginePort, официальный command port отсутствует. */
export class SystemAgentExpositionCalculator implements AsyncAutonomousCalculator {
  constructor(private readonly options: Readonly<{
    engine: AgentEnginePort;
    profileFor(side: SystemSide): ModernAgentProfile;
  }>) {}

  async calculate(input: AutonomousCalculationInput): Promise<AutonomousCalculationResult> {
    const startCursor = input.fromCheckpoint?.scenarioCursor ?? input.fromCheckpoint?.journalCursor ?? 0;
    const world = input.fromCheckpoint?.world ?? input.scenario.initialWorld;
    const fuel = world.resources.fuel;
    const supplyFraction = fuel && fuel.onHand + fuel.consumed > 0
      ? Math.max(0, Math.min(1, fuel.onHand / (fuel.onHand + fuel.consumed)))
      : null;
    const agentDecisions: Record<string, ExpositionAgentDecision> = {};
    for (const [offset, event] of input.scenario.events.slice(startCursor).entries()) {
      for (const side of input.scenario.systemSides) {
        const seed = BigInt(hash32(`exposition-agent-v1|${input.seed}|${input.branchId}|${event.eventId}|${side.agentId}`));
        const evaluation = await evaluateChoices(this.options.engine, {
          profile: this.options.profileFor(side),
          seed,
          projection: {
            instanceId: input.branchId,
            revision: startCursor + offset + 1,
            agentId: side.agentId,
            tick: Math.max(0, Math.floor(event.atMs)),
            ownOrders: [], observations: [], reports: [], ownForces: [],
            resources: { supplyFraction },
            terrain: { routeOpen: null },
            weather: { movementFactor: null },
          },
        });
        agentDecisions[`${event.eventId}:${side.agentId}`] = decisionOf(evaluation.selected.kind);
      }
    }
    return calculatePreparedScenario({ ...input, agentDecisions });
  }
}
