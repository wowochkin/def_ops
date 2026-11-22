import { expect, it } from 'vitest';
import { SubscriptionService } from '../src/http/subscription-service';

it('проверяет sequence независимо для каждого инстанса', async () => {
  const service = new SubscriptionService();
  const first = await service.publish({ instanceId: 'load-0', organizationId: 'org', sequence: 1, type: 'decision.created.v1', payload: { side: 'blue' } });
  const second = await service.publish({ instanceId: 'load-1', organizationId: 'org', sequence: 1, type: 'decision.created.v1', payload: { side: 'blue' } });
  expect(first.sequence).toBe(1);
  expect(second.sequence).toBe(1);
  expect(service.after('load-0', 0)).toHaveLength(1);
  expect(service.after('load-1', 0)).toHaveLength(1);
  await expect(service.publish({ instanceId: 'load-1', organizationId: 'org', sequence: 1, type: 'decision.created.v1', payload: { side: 'blue' } }))
    .rejects.toThrow('последовательность');
});


it('разделяет последовательности официальной и альтернативной ветвей', async () => {
  const service = new SubscriptionService();
  await service.publish({ instanceId: 'exercise', branchId: 'main', sequence: 4, type: 'official', payload: {} });
  await expect(service.publish({ instanceId: 'exercise', branchId: 'alternative', sequence: 1, type: 'alternative', payload: {} })).resolves.toMatchObject({ sequence: 1 });
  expect(service.after('exercise', 0)).toHaveLength(1);
  expect(service.after('exercise', 0, 'alternative')).toHaveLength(1);
  expect(service.latestSequence('exercise', 'alternative')).toBe(1);
});

it('не раскрывает доменное событие с неизвестной областью видимости', () => {
  const service = new SubscriptionService();
  const event = { eventId: 'private-1', sequence: 1, type: 'decision.created.v1', payload: { commandId: 'secret-command' } };
  const actor = { side: 'red', role: 'TRAINEE', operationalAt: '2030-01-01T00:00:00Z', scope: 'own' as const };
  expect(service.payloadFor(event, actor)).toEqual({ type: 'projection.refresh' });
  expect(service.payloadFor(event, { ...actor, role: 'LEADER', scope: 'truth' as const, authorities: ['TRUTH_READ'] }).type).toBe('decision.created.v1');
});
