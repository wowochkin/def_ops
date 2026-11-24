import { expect, it } from 'vitest';
import { createService, HttpError, Router } from '@def-ops/service-kit';
import { SubscriptionService } from '../src/http/subscription-service';
import { registerSseRoutes } from '../src/http/sse';

const actor = {
  organizationId: 'org-1', instanceIds: ['i1'], side: 'blue', role: 'LEADER', scope: 'own' as const,
  authorities: [], operationalAt: '2030-01-01T00:00:00Z', subscriptionRevision: 1,
};

it('C4: LEADER без TRUTH_READ получает только обобщённое обновление для чужой стороны', () => {
  const service = new SubscriptionService();
  const event = { eventId: 'secret', sequence: 1, type: 'force.updated', payload: { side: 'red', id: 'red-force', position: [1, 2] } };
  expect(service.payloadFor(event, actor)).toEqual({ type: 'projection.refresh' });
  const truth = service.payloadFor(event, { ...actor, scope: 'truth', authorities: ['TRUTH_READ'] });
  expect(truth).toMatchObject({ eventId: 'secret', payload: { id: 'red-force' } });
});

it('C4: SSE досылает Last-Event-ID и не закрывает поток после ready', async () => {
  const subscriptions = new SubscriptionService();
  await subscriptions.publish({ instanceId: 'i1', organizationId: 'org-1', type: 'force.updated', payload: { side: 'blue', id: 'first' } });
  await subscriptions.publish({ instanceId: 'i1', organizationId: 'org-1', type: 'force.updated', payload: { side: 'blue', id: 'second' } });
  const router = new Router();
  registerSseRoutes(router, subscriptions, async () => actor);
  const service = createService({ name: 'sse-resume', port: 0, router });
  const port = await service.listen();
  const controller = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/kshvi/instances/i1/events`, {
      headers: { authorization: 'Bearer session', 'Last-Event-ID': '1' }, signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 1500;
    while (!text.includes('second') && Date.now() < deadline) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    controller.abort();
    expect(text).toContain('id: 2');
    expect(text).toContain('second');
    expect(text).not.toContain('first');
  } finally {
    controller.abort();
    await service.close();
  }
});

it('C4: отзыв прав завершает активный поток до следующего скрытого payload', async () => {
  const subscriptions = new SubscriptionService();
  let revoked = false;
  const router = new Router();
  registerSseRoutes(router, subscriptions, async () => {
    if (revoked) throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
    return actor;
  });
  const service = createService({ name: 'sse-revoke', port: 0, router });
  const port = await service.listen();
  const controller = new AbortController();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/kshvi/instances/i1/events`, {
      headers: { authorization: 'Bearer session' }, signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value, { stream: true });
    revoked = true;
    await subscriptions.publish({ instanceId: 'i1', organizationId: 'org-1', type: 'force.updated', payload: { side: 'red', id: 'must-not-leak' } });
    const deadline = Date.now() + 1500;
    let done = false;
    while (!done && Date.now() < deadline) {
      const chunk = await reader.read();
      done = chunk.done;
      text += decoder.decode(chunk.value, { stream: true });
    }
    controller.abort();
    expect(done).toBe(true);
    expect(text).toContain('revoked');
    expect(text).not.toContain('must-not-leak');
  } finally {
    controller.abort();
    await service.close();
  }
});


it('C4: разрыв перед первым доступным событием требует snapshot, а не пропуск последовательности', async () => {
  const subscriptions = new SubscriptionService();
  await subscriptions.publish({ instanceId: 'i1', organizationId: 'org-1', sequence: 5, eventId: 'late', type: 'force.updated', payload: { side: 'blue', id: 'late' } });
  const router = new Router();
  registerSseRoutes(router, subscriptions, async () => actor);
  const service = createService({ name: 'sse-gap', port: 0, router });
  const port = await service.listen();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/kshvi/instances/i1/events`, { headers: { authorization: 'Bearer session' } });
    const text = await response.text();
    expect(text).toContain('snapshot.required');
    expect(text).toContain('SEQUENCE_GAP');
    expect(text).not.toContain('force.updated');
  } finally {
    await service.close();
  }
});
