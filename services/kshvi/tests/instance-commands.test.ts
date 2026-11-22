import { expect, it } from 'vitest';
import { InstanceService } from '../src/instances/instance-service';
import { CommandService } from '../src/instances/command-service';

it('C3: не принимает самоподтверждённый scenarioState без сохранённого артефакта', async () => {
  const service = new InstanceService();
  const actor = { userId: 'director', organizationId: 'org-1', activeRole: 'DIRECTOR', sideId: null, authorities: ['instance.start'] };
  await expect(service.startInstance({ sealedScenarioId: 'sealed', instanceId: 'i1', idempotencyKey: 'start-1', seed: 'seed' }, actor)).rejects.toThrow('SEALED_SCENARIO_NOT_FOUND');
});

it('запускает Instance через порт сохранённого SEALED и сохраняет идемпотентность', async () => {
  const instances = new Map<string, any>();
  const sealing = {
    async start(_scenarioId: string, command: any, _actor: any) {
      const key = command.idempotencyKey;
      if (!instances.has(key)) instances.set(key, {
        schemaVersion: 1, id: command.instanceId, scenarioId: 'sealed', scenarioRevision: 1, scenarioSha256: 'hash', state: 'ACTIVE',
        seed: command.seed, eventLogId: `events-${command.instanceId}`, events: [], idempotencyKey: key, abnormalTermination: false,
      });
      return instances.get(key);
    },
  };
  const actor = { userId: 'director', organizationId: 'org-1', activeRole: 'DIRECTOR', sideId: null, authorities: ['instance.start'] };
  const service = new InstanceService({ sealing });
  const first = await service.startInstance({ sealedScenarioId: 'sealed', instanceId: 'i1', idempotencyKey: 'start-1', seed: 'seed' }, actor);
  const repeated = await service.startInstance({ sealedScenarioId: 'sealed', instanceId: 'i1', idempotencyKey: 'start-1', seed: 'seed' }, actor);
  const other = await service.startInstance({ sealedScenarioId: 'sealed', instanceId: 'i2', idempotencyKey: 'start-2', seed: 'seed-2' }, actor);
  expect(repeated).toEqual(first);
  expect(other.id).not.toBe(first.id);
  expect(other.branchId).not.toBe(first.branchId);
});

it('фиксирует команду один раз и отклоняет устаревшую ревизию', async () => {
  const service = new CommandService();
  const input = { instanceId: 'i1', branchId: 'b1', expectedRevision: 0, idempotencyKey: 'cmd-1', type: 'instance.paused.v1', actor: { userId: 'u1', role: 'LEADER', organizationId: 'org1' } };
  const first = await service.execute(input);
  const repeated = await service.execute(input);
  expect(repeated.eventId).toBe(first.eventId);
  expect(repeated.revision).toBe(1);
  await expect(service.execute({ ...input, idempotencyKey: 'cmd-2' })).rejects.toThrow('ревизия');
});


it('принимает официальную типизированную команду через существующий серверный адаптер', async () => {
  const service = new CommandService();
  const result = await service.execute({
    instanceId: 'official-http-session', branchId: 'main', expectedRevision: 0, idempotencyKey: 'official-http-decision', type: 'decision.create',
    at: '2030-01-01T01:00:00Z',
    actor: { userId: 'leader', role: 'LEADER', organizationId: 'org', sideId: 'blue', assignedNodeIds: ['node-1'] },
    payload: { decision: {
      id: 'official-http-decision', sideId: 'blue', authorId: 'leader', createdAt: '2030-01-01T01:00:00Z', intent: 'Замысел', goals: [],
      tasks: [{ id: 'task', assigneeId: 'node-1', title: 'Задача' }], resources: [], deadlines: [], coordination: [], reserves: [], transitionConditions: [], assumptions: [],
    } },
  });
  expect(result.revision).toBe(1);
  const history = await service.history('official-http-session', 'main');
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ eventId: result.eventId, type: 'decision.created.v1', payload: { commandType: 'decision.create', causedBy: 'official-http-decision' } });
});
