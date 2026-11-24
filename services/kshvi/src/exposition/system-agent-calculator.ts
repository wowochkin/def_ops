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
  ExpositionCheckpoint,
  ExpositionJournalEntry,
} from '../../../../packages/kshvi/src/exposition/exposition-session';
import {
  calculateAutonomousEvent,
  restoreExpositionRng,
} from '../../../../packages/kshvi/src/exposition/exposition-session';
import { cloneWorld } from '../../../../packages/kshvi/src/model/world';

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

function decisionOf(kind: string, agentId: string): ExpositionAgentDecision {
  switch (kind) {
    case 'ADVANCE': return { consumptionFactor: 1.25, supplyFactor: 1.1 };
    case 'WITHDRAW': return { consumptionFactor: 0.9, supplyFactor: 0.8 };
    case 'HOLD': return { consumptionFactor: 0.75, supplyFactor: 0.95 };
    case 'DEFEND': return { consumptionFactor: 0.85, supplyFactor: 1.05 };
    case 'REQUEST_SUPPORT': return { consumptionFactor: 0.9, supplyFactor: 1.5 };
    case 'CONTINUE_ORDER': return { consumptionFactor: 1.05, supplyFactor: 0.95 };
    case 'ESCALATE': throw new Error(`Системный агент ${agentId} требует эскалации; автономный показ остановлен`);
    default: throw new Error(`Системный агент ${agentId} вернул неизвестное решение ${kind}`);
  }
}

/** Последовательный full-simulation: мир обновляется после каждого события до решений следующего. */
export class SystemAgentExpositionCalculator implements AsyncAutonomousCalculator {
  constructor(private readonly options: Readonly<{
    engine: AgentEnginePort;
    profileFor(side: SystemSide): ModernAgentProfile;
  }>) {}

  async calculate(input: AutonomousCalculationInput): Promise<AutonomousCalculationResult> {
    if (!Number.isSafeInteger(input.seed) || input.seed < 0) throw new Error('Зерно показа должно быть неотрицательным целым');
    const startCursor = input.fromCheckpoint?.scenarioCursor ?? input.fromCheckpoint?.journalCursor ?? 0;
    let world = cloneWorld(input.fromCheckpoint?.world ?? input.scenario.initialWorld);
    let rng = restoreExpositionRng(input);
    let sequence = input.fromCheckpoint?.journalCursor ?? 0;
    let randomOutcomesCreated = 0;
    const journal: ExpositionJournalEntry[] = [];
    const checkpoints: ExpositionCheckpoint[] = [];

    for (const [offset, event] of input.scenario.events.slice(startCursor).entries()) {
      if (!Number.isFinite(event.atMs) || event.atMs < (input.fromCheckpoint?.atMs ?? 0)) {
        throw new Error('Демонстрационные события должны следовать после контрольной точки');
      }
      const fuel = world.resources.fuel;
      const supplyFraction = fuel && fuel.onHand + fuel.consumed > 0
        ? Math.max(0, Math.min(1, fuel.onHand / (fuel.onHand + fuel.consumed)))
        : null;
      const agentDecisions: Record<string, ExpositionAgentDecision> = {};
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
        if (!evaluation?.selected) throw new Error(`Отсутствует решение системного агента ${side.agentId} для события ${event.eventId}`);
        agentDecisions[`${event.eventId}:${side.agentId}`] = decisionOf(evaluation.selected.kind, side.agentId);
      }
      const result = calculateAutonomousEvent({
        scenario: input.scenario,
        event,
        world,
        rng,
        sequence,
        scenarioCursor: startCursor + offset + 1,
        agentDecisions,
      });
      world = result.world;
      rng = result.rng;
      sequence = result.entry.sequence;
      randomOutcomesCreated += result.randomOutcomesCreated;
      journal.push(result.entry);
      if (result.checkpoint) checkpoints.push(result.checkpoint);
    }
    return { world, journal, checkpoints, rng, randomOutcomesCreated };
  }
}
