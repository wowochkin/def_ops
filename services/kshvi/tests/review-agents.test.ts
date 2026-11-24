import { expect, it } from 'vitest';
import profile from '../../../packages/kshvi-agents/data/modern-profiles/balanced.json';
import { assertModernAgentProfile } from '../../../packages/kshvi-agents/src/ports/modern-choice';
import { assignmentFixture, projectionFixture } from '../../../packages/kshvi-agents/tests/fixtures';
import { createAgentCommands } from '../../../packages/kshvi-agents/src/intermediary/act';
import { IntermediaryWorker, type AgentWorkJournal } from '../src/agents/intermediary-worker';
import { AgentProcess } from '../src/agents/agent-process';
import type { AgentEvaluation, AgentEvaluationRequest } from '../../../packages/kshvi-agents/src/ports/agent-engine';
import type { IntermediaryCycle } from '../../../packages/kshvi-agents/src/intermediary/cycle';
import type { PendingAgentCommand } from '../src/agents/agent-recovery';

it('C8: action и projection revision дают один ключ независимо от wakeId', () => {
  const assignment = assignmentFixture();
  const projection = projectionFixture();
  const action = projection.requestedActions[0];
  const first = createAgentCommands(assignment, projection, 'wake-1', '2030-01-01T00:00:00Z', [action]);
  const second = createAgentCommands(assignment, projection, 'wake-2', '2030-01-01T00:01:00Z', [action]);
  expect(first[0].commandId).toBe(second[0].commandId);
  expect(first[0].idempotencyKey).toBe(second[0].idempotencyKey);
  expect(first[0].commandId).toContain(String(projection.revision));
});

it('Minor: другая политика с той же версией назначения не перезаписывает текущую', () => {
  const assignment = assignmentFixture();
  const journal: AgentWorkJournal = {
    async isCycleProcessed() { return false; },
    async enqueueCommand(_record: PendingAgentCommand) {},
    async saveCycle(_cycle: IntermediaryCycle) {},
    async completeCommand() {},
    async pendingCommands() { return []; },
  };
  const worker = new IntermediaryWorker({
    assignments: [assignment], journal,
    projectionSource: { loadProjection: async () => projectionFixture() },
    commandClient: { submit: async () => { throw new Error('not used'); } },
  });
  expect(() => worker.updateAssignment({ ...assignment, schedule: { everyMs: 1, timeBudgetMs: 1 } })).toThrow('верси');
});

const evaluation: AgentEvaluation = {
  selected: { id: 'advance', kind: 'ADVANCE', label: 'Наступать', commandType: 'force.advance.v1' },
  options: [{ id: 'advance', utility: 1 }], unknown: [], forkHashes: ['fork'], destroyedForks: 1,
  orders: [{ id: 'order', recipient: 'hq-sub', channel: 'own-command-network', issuedTick: 9, deliveryTick: 10 }], reports: [],
  trace: { choice: 'advance', inputHash: 'projection' },
};
const request: AgentEvaluationRequest = {
  profile: assertModernAgentProfile(profile), seed: 1n,
  projection: {
    instanceId: 'i1', revision: 2, agentId: 'opponent', tick: 9, ownOrders: [], observations: [], reports: [], ownForces: [],
    resources: { supplyFraction: 1 }, terrain: { routeOpen: true }, weather: { movementFactor: 1 },
  },
};

it('I6: официальная команда не подаётся при SCHEDULED доставке приказа', async () => {
  const submitted: unknown[] = [];
  const process = new AgentProcess({
    engine: { evaluateChoices: async () => evaluation },
    official: { submit: async command => { submitted.push(command); return { accepted: true }; } },
    communication: { deliver: async order => ({ ...order, status: 'SCHEDULED' }) },
  });
  const result = await process.runOpponentCycle(request);
  expect(result.status).toBe('AWAITING_DELIVERY');
  expect(submitted).toEqual([]);
});

it('I6: официальная команда подаётся только после DELIVERED всех приказов', async () => {
  const steps: string[] = [];
  const process = new AgentProcess({
    engine: { evaluateChoices: async () => evaluation },
    official: { submit: async () => { steps.push('submit'); return { accepted: true, commandId: 'command' }; } },
    communication: { deliver: async order => { steps.push('deliver'); return { ...order, status: 'DELIVERED' }; } },
  });
  const result = await process.runOpponentCycle(request);
  expect(result.status).toBe('DECIDED');
  expect(steps).toEqual(['deliver', 'submit']);
});
