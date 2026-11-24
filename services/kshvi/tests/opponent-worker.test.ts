import { expect, it } from 'vitest';
import profile from '../../../packages/kshvi-agents/data/modern-profiles/balanced.json';
import type { AgentEvaluation, AgentEvaluationRequest } from '../../../packages/kshvi-agents/src/ports/agent-engine';
import { assertModernAgentProfile } from '../../../packages/kshvi-agents/src/ports/modern-choice';
import { AgentProcess, type OfficialAgentCommand } from '../src/agents/agent-process';
import { RustWorker } from '../src/agents/rust-worker';

const request: AgentEvaluationRequest = {
  profile: assertModernAgentProfile(profile), seed: 5n, projection: {
    instanceId: 'i1', revision: 2, agentId: 'opponent', tick: 9,
    ownOrders: [{ id: 'o1', kind: 'ADVANCE', issuedTick: 1 }], observations: [], reports: [],
    ownForces: [], resources: { supplyFraction: 0.8 }, terrain: { routeOpen: true }, weather: { movementFactor: 1 },
  },
};

const evaluation: AgentEvaluation = {
  selected: { id: 'advance', kind: 'ADVANCE', label: 'Продолжить наступление', commandType: 'force.advance.v1' },
  options: [{ id: 'advance', utility: 1 }], unknown: [], forkHashes: ['fork-hash'], destroyedForks: 1,
  orders: [{ id: 'modern-order-1', recipient: 'hq-sub', channel: 'own-command-network', issuedTick: 9, deliveryTick: 10 }],
  reports: [], trace: { choice: 'advance', inputHash: 'allowed-projection' },
};

it('Rust worker сохраняет bigint seed в JSON-протоколе и возвращает типизированное решение', async () => {
  const frames: string[] = [];
  const worker = new RustWorker({
    async call(frame) {
      frames.push(frame);
      return JSON.stringify({ ok: true, evaluation });
    },
  });
  const result = await worker.evaluateChoices(request);
  expect(result.selected.id).toBe('advance');
  expect(frames[0]).toContain('"seed":"5n"');
  expect(frames[0]).not.toContain('hiddenTruth');
  await worker.close();
});

it('цикл противника идемпотентно передаёт только выбранную команду серверу и модели связи', async () => {
  const submitted: unknown[] = [];
  const delivered: unknown[] = [];
  const process = new AgentProcess({
    engine: { async evaluateChoices() { return evaluation; } },
    official: {
      async submit(command) { submitted.push(command); return { accepted: true, commandId: 'cmd-1' }; },
    },
    communication: {
      async deliver(order) { delivered.push(order); return { ...order, status: 'DELIVERED' }; },
    },
  });
  const first = await process.runOpponentCycle(request);
  const second = await process.runOpponentCycle(request);
  expect(first).toEqual(second);
  expect(submitted).toHaveLength(1);
  expect(delivered).toHaveLength(1);
  expect(submitted[0]).toMatchObject({
    type: 'force.advance.v1', instanceId: 'i1', expectedRevision: 2,
    idempotencyKey: 'opponent:i1:opponent:9:advance', choiceId: 'advance',
  });
  expect(JSON.stringify(submitted[0])).not.toContain('officialBenchmark');
});

it('при недостатке данных не создаёт новых сил, ресурсов и событий', async () => {
  const submitted: unknown[] = [];
  const process = new AgentProcess({
    engine: { async evaluateChoices() { return {
      ...evaluation,
      selected: { id: 'continue-order', kind: 'CONTINUE_ORDER', label: 'Продолжить действующий приказ', commandType: null },
      unknown: ['observations.strength'], orders: [], trace: { safe: true },
    }; } },
    official: { async submit(command) { submitted.push(command); return { accepted: true, commandId: 'safe' }; } },
    communication: { async deliver(order) { return { ...order, status: 'DELIVERED' }; } },
  });
  const result = await process.runOpponentCycle(request);
  expect(result.status).toBe('SAFE_ORDER');
  expect(result.unknown).toEqual(['observations.strength']);
  expect(submitted).toEqual([]);
});

it('эскалация идёт серверной командой без прямой записи в журнал', async () => {
  const submitted: any[] = [];
  const process = new AgentProcess({
    engine: { async evaluateChoices() { return {
      ...evaluation,
      selected: { id: 'escalate', kind: 'ESCALATE', label: 'Запросить решение руководства', commandType: 'agent.escalation.requested.v1' },
      unknown: ['weather.movementFactor'], orders: [],
    }; } },
    official: { async submit(command) { submitted.push(command); return { accepted: true, commandId: 'escalation-1' }; } },
    communication: { async deliver(order) { return { ...order, status: 'DELIVERED' }; } },
  });
  const result = await process.runOpponentCycle(request);
  expect(result.status).toBe('ESCALATED');
  expect(submitted).toHaveLength(1);
  expect(submitted[0].type).toBe('agent.escalation.requested.v1');
});


it('пересматривает решение при новой ревизии проекции даже в том же такте', async () => {
  let calls = 0;
  const submitted: OfficialAgentCommand[] = [];
  const revisedEvaluation: AgentEvaluation = {
    ...evaluation,
    selected: { id: 'defend', kind: 'DEFEND', label: 'Оборонять', commandType: 'force.defend.v1' },
    orders: evaluation.orders, trace: { choice: 'defend', inputHash: 'new-report' },
  };
  const process = new AgentProcess({
    engine: { async evaluateChoices() { calls += 1; return calls === 1 ? evaluation : revisedEvaluation; } },
    official: { async submit(command) { submitted.push(command); return { accepted: true, commandId: `cmd-${calls}` }; } },
    communication: { async deliver(order) { return { ...order, status: 'DELIVERED' }; } },
  });
  await process.runOpponentCycle(request);
  const revised = await process.runOpponentCycle({
    ...request,
    projection: {
      ...request.projection,
      revision: request.projection.revision + 1,
      reports: [{ id: 'new-report', sender: 'hq-sub', tick: 9, text: 'Новые сведения' }],
    },
  });
  expect(calls).toBe(2);
  expect(revised.evaluation.selected.id).toBe('defend');
  expect(submitted.map(command => command.choiceId)).toEqual(['advance', 'defend']);
});
