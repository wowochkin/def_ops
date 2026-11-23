import { expect, it } from 'vitest';
import { ProductionWorkerSupervisor } from '../src/runtime/production-workers';
import type { AutonomyQueueCommand, AutonomyWorkerJournalState } from '../src/runtime/autonomy-worker';
import { makeProfile, makeScheduleInput } from '../../../packages/kshvi-events/tests/fixtures/autonomy';
import { AgentProcess } from '../src/agents/agent-process';
import profile from '../../../packages/kshvi-agents/data/modern-profiles/balanced.json';
import { assertModernAgentProfile } from '../../../packages/kshvi-agents/src/ports/modern-choice';
import type { AgentEvaluation } from '../../../packages/kshvi-agents/src/ports/agent-engine';

it('C5: production supervisor запускает и останавливает autonomy, intermediary и opponent workers', async () => {
  const commands: AutonomyQueueCommand[] = [];
  let journal: AutonomyWorkerJournalState = { version: 1, intervals: {}, processedIntervalKeys: [] };
  const schedule = makeScheduleInput({ profile: makeProfile('CUSTOM', { attemptsPerOperationalHour: 12, manualApprovalShare: 0 }), categories: ['logistics'] });
  let intermediaryStarts = 0;
  let intermediaryStops = 0;
  let officialCommands = 0;
  const evaluation: AgentEvaluation = {
    selected: { id: 'hold', kind: 'HOLD', label: 'Удержание', commandType: null }, options: [], unknown: [], forkHashes: [], destroyedForks: 0,
    orders: [], reports: [], trace: {},
  };
  const opponent = new AgentProcess({
    engine: { evaluateChoices: async () => evaluation },
    official: { submit: async () => { officialCommands += 1; return { accepted: true }; } },
    communication: { deliver: async order => ({ ...order, status: 'DELIVERED' }) },
  });
  const supervisor = new ProductionWorkerSupervisor({
    autonomy: [{
      instanceId: 'i1', instanceState: 'ACTIVE', operationalStartAt: '2030-01-01T00:00:00.000Z', profile: schedule.profile, templates: schedule.templates, state: schedule.state,
      targets: schedule.targets, seed: schedule.seed, branchId: 'main', snapshotHash: 'snapshot', templateSetVersion: 'templates', fromSecond: 0, toSecond: 3600,
      everyMs: 10,
      queue: { enqueue: async command => { commands.push(command); return { idempotent: false }; } },
      journal: { load: async () => journal, save: async state => { journal = state; } },
    }],
    intermediaries: [{ start: async () => { intermediaryStarts += 1; }, stop: () => { intermediaryStops += 1; } }],
    opponents: [{
      process: opponent, everyMs: 10,
      request: {
        profile: assertModernAgentProfile(profile), seed: 1n,
        projection: { instanceId: 'i1', revision: 1, agentId: 'red', tick: 1, ownOrders: [], observations: [], reports: [], ownForces: [], resources: { supplyFraction: null }, terrain: { routeOpen: null }, weather: { movementFactor: null } },
      },
    }],
  });
  await supervisor.start();
  await new Promise(resolve => setTimeout(resolve, 35));
  await supervisor.stop();
  expect(supervisor.errors()).toEqual([]);
  const stoppedCount = commands.length;
  expect(stoppedCount).toBeGreaterThan(0);
  expect(intermediaryStarts).toBe(1);
  expect(intermediaryStops).toBe(1);
  expect(officialCommands).toBe(0);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(commands).toHaveLength(stoppedCount);
});
