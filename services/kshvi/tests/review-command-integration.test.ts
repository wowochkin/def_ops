import { expect, it } from 'vitest';
import { createService, Router } from '@def-ops/service-kit';
import { AutonomyCommandQueueAdapter } from '../src/runtime/autonomy-command-queue';
import { CommandService } from '../src/instances/command-service';
import { RevisionTrackingCommandPort, type TypedInstanceCommand } from '../src/instances/typed-command-port';
import { registerAgentRoutes } from '../src/http/agent-routes';
import type { AgentCommand } from '../../../packages/kshvi-agents/src/intermediary/act';

it('C5: autonomy queue использует типизированный CommandService-порт и серверного актора', async () => {
  const executed: TypedInstanceCommand[] = [];
  const queue = new AutonomyCommandQueueAdapter({
    organizationId: 'org-server', actorUserId: 'autonomy-worker',
    commands: { execute: async command => { executed.push(command); return { eventId: 'event', revision: command.expectedRevision + 1, idempotent: false }; } },
    revision: async () => 7,
  });
  await queue.enqueue({
    commandId: 'operation', idempotencyKey: 'operation-key', kind: 'applyWorldEffects', instanceId: 'i1', branchId: 'main', operationalSecond: 1,
    priority: 1, sequence: 1, payload: { eventId: 'event-source', effects: [] },
  });
  expect(executed).toHaveLength(1);
  expect(executed[0]).toMatchObject({
    type: 'autonomy.worldEffects.apply.v1', expectedRevision: 7, idempotencyKey: 'operation-key',
    actor: { userId: 'autonomy-worker', organizationId: 'org-server' }, payload: { eventId: 'event-source' },
  });
  await expect(queue.enqueue({
    commandId: 'bad', idempotencyKey: 'bad', kind: 'arbitraryOutcome' as never, instanceId: 'i1', branchId: 'main', operationalSecond: 1,
    priority: 1, sequence: 2, payload: {},
  })).rejects.toThrow('операц');
});

it('AC-19: настоящий CommandService журналирует системную автономную операцию один раз', async () => {
  const commands = new CommandService({ organizationId: 'org-server' });
  const tracked = new RevisionTrackingCommandPort(commands);
  const queue = new AutonomyCommandQueueAdapter({
    organizationId: 'org-server', actorUserId: 'autonomy-worker', commands: tracked,
    revision: (instanceId, branchId) => tracked.revision(instanceId, branchId),
  });
  const operation = {
    commandId: 'autonomous-operation', idempotencyKey: 'autonomous-operation-key', kind: 'applyWorldEffects' as const,
    instanceId: 'autonomous-instance', branchId: 'main', operationalSecond: 60,
    operationalAt: '2030-01-01T00:01:00.000Z', priority: 100, sequence: 0,
    payload: {
      eventId: 'autonomous-event', templateId: 'logistics.fuel-shortage', templateVersion: 1,
      effects: [
        { type: 'resource.adjust', resourceId: 'fuel', ownerSideId: 'blue', unit: 'L', operation: 'RESTORE', amount: 100 },
        { type: 'resource.adjust', resourceId: 'fuel', ownerSideId: 'blue', unit: 'L', operation: 'CONSUME', amount: 10 },
      ],
      parameters: {}, causeEventIds: [], stageId: 'stage-main', target: { sideId: 'blue', areaId: 'area-north' },
    },
  };
  expect(await queue.enqueue(operation)).toEqual({ idempotent: false });
  expect(await queue.enqueue(operation)).toEqual({ idempotent: true });
  const history = await commands.history('autonomous-instance', 'main');
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    type: 'autonomy.worldEffects.apply.v1', actor: { id: 'autonomy-worker', kind: 'SYSTEM' },
    operationalAt: { originalAt: '2030-01-01T00:01:00.000Z' },
    payload: { commandId: 'autonomous-operation-key', commandType: 'autonomy.worldEffects.apply.v1', causedBy: 'autonomous-event' },
  });
  expect(commands.state('autonomous-instance', 'main').world.resources['blue/fuel']).toMatchObject({ onHand: 90, consumed: 10, supplied: 100, deficit: 0 });
});

function agentCommand(kind: string): AgentCommand {
  return {
    commandId: `command-${kind}`, idempotencyKey: `key-${kind}`, kind, assignmentId: 'agent-1', exerciseId: 'exercise', instanceId: 'i1',
    actor: { kind: 'system', id: 'spoofed', assignmentId: 'agent-1' }, expectedProjectionRevision: 7, issuedAt: '2030-01-01T00:00:00Z', payload: { actionId: 'action' },
  };
}

it('C5: /agents/commands регистрирует только известные операции с серверной делегацией', async () => {
  const executed: TypedInstanceCommand[] = [];
  const router = new Router();
  registerAgentRoutes(router, {
    commands: { execute: async command => { executed.push(command); return { eventId: `event-${executed.length}`, revision: 8, idempotent: false }; } },
    resolveDelegation: async () => ({
      actor: { userId: 'server-agent', role: 'LEADER', organizationId: 'org-server' }, branchId: 'main', expectedRevision: 7,
      allowedActions: ['issueDocument'],
    }),
  });
  const service = createService({ name: 'agent-routes', port: 0, router });
  const port = await service.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/agents/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer agent-session' }, body: JSON.stringify(agentCommand('issueDocument')),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ accepted: true, status: 'APPLIED', effectApplied: true, serverRevision: 8 });
    expect(executed[0]).toMatchObject({
      type: 'document.issue.v1', branchId: 'main', expectedRevision: 7,
      actor: { userId: 'server-agent', organizationId: 'org-server' },
    });
    expect(executed[0].actor.userId).not.toBe('spoofed');
    const forbidden = await fetch(`http://127.0.0.1:${port}/agents/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer agent-session' }, body: JSON.stringify(agentCommand('changeScenarioConcept')),
    });
    expect(forbidden.status).toBe(403);
    expect(executed).toHaveLength(1);
  } finally {
    await service.close();
  }
});
