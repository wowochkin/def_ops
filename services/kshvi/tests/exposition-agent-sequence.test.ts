import { describe, expect, it } from 'vitest';
import profile from '../../../packages/kshvi-agents/data/modern-profiles/balanced.json';
import type { AgentEvaluation, AgentEvaluationRequest } from '../../../packages/kshvi-agents/src/ports/agent-engine';
import { assertModernAgentProfile } from '../../../packages/kshvi-agents/src/ports/modern-choice';
import { officialArchive } from '../../../packages/kshvi/tests/fixtures/exposition';
import { SystemAgentExpositionCalculator } from '../src/exposition/system-agent-calculator';

function setup(evaluate: (request: AgentEvaluationRequest) => Promise<AgentEvaluation>) {
  return new SystemAgentExpositionCalculator({
    engine: { evaluateChoices: evaluate },
    profileFor: side => assertModernAgentProfile({ ...profile, id: side.agentId, version: side.profileVersion }),
  });
}

function evaluation(kind: AgentEvaluation['selected']['kind']): AgentEvaluation {
  return {
    selected: { id: kind.toLowerCase(), kind, label: kind, commandType: null },
    options: [], unknown: [], forkHashes: [], destroyedForks: 0, orders: [], reports: [], trace: {},
  };
}

describe('последовательный full-simulation системных агентов', () => {
  it('передаёт следующему решению мир после предыдущего события', async () => {
    const supplyByEvent = new Map<number, number[]>();
    const calculator = setup(async request => {
      const values = supplyByEvent.get(request.projection.tick) ?? [];
      values.push(request.projection.resources.supplyFraction!);
      supplyByEvent.set(request.projection.tick, values);
      return evaluation('ADVANCE');
    });
    const result = await calculator.calculate({
      scenario: officialArchive().demonstration, seed: 42, branchId: 'sequential-world',
    });
    expect(result.journal).toHaveLength(2);
    const first = supplyByEvent.get(1_000)!;
    const second = supplyByEvent.get(2_000)!;
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(second[0]).toBeLessThan(first[0]);
    expect(second[1]).toBe(second[0]);
  });

  it('не заменяет отсутствующее решение или эскалацию нейтральными коэффициентами', async () => {
    const missing = setup(async () => ({ ...evaluation('HOLD'), selected: undefined as never }));
    await expect(missing.calculate({
      scenario: officialArchive().demonstration, seed: 42, branchId: 'missing-decision',
    })).rejects.toThrow('решение системного агента');

    const escalated = setup(async () => evaluation('ESCALATE'));
    await expect(escalated.calculate({
      scenario: officialArchive().demonstration, seed: 42, branchId: 'escalated-decision',
    })).rejects.toThrow('эскалац');
  });
});
