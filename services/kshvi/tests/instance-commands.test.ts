import { expect, it } from 'vitest';
import { InstanceService } from '../src/instances/instance-service';
import { CommandService } from '../src/instances/command-service';

it('запускает только SEALED и не дублирует Instance по ключу', async () => {
  const service = new InstanceService();
  await expect(service.startInstance({ scenarioState: 'DRAFT', scenarioRevisionId: 'r1', idempotencyKey: 'start-1' })).rejects.toThrow('SEALED');
  const first = await service.startInstance({ scenarioState: 'SEALED', scenarioRevisionId: 'r1', idempotencyKey: 'start-1' });
  const repeated = await service.startInstance({ scenarioState: 'SEALED', scenarioRevisionId: 'r1', idempotencyKey: 'start-1' });
  const other = await service.startInstance({ scenarioState: 'SEALED', scenarioRevisionId: 'r1', idempotencyKey: 'start-2' });
  expect(repeated.id).toBe(first.id);
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
