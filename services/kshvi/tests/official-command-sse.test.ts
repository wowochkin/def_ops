import { createService, Router } from '@def-ops/service-kit';
import { afterEach, expect, it } from 'vitest';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { CommandService } from '../src/instances/command-service';
import { registerInstanceRoutes } from '../src/http/instance-routes';
import { registerSseRoutes } from '../src/http/sse';
import { publishChainEvent, SubscriptionService } from '../src/http/subscription-service';
import { InstanceService } from '../src/instances/instance-service';

const decision = {
  id: 'decision-sse', sideId: 'blue', authorId: 'leader', createdAt: '2030-01-01T01:00:00Z', intent: 'Скрытый замысел blue',
  goals: [{ id: 'goal', rank: 1, title: 'Цель' }], tasks: [{ id: 'task', assigneeId: 'node-1', title: 'Задача' }], resources: [],
  deadlines: [], coordination: [], reserves: [], transitionConditions: [], assumptions: [],
} as const;
const services: Array<ReturnType<typeof createService>> = [];
const streams: ReadableStreamDefaultReader<Uint8Array>[] = [];
afterEach(async () => {
  for (const reader of streams) await reader.cancel().catch(() => undefined);
  streams.length = 0;
  while (services.length) await services.pop()?.close();
});

async function openStream(port: number, token: string) {
  const response = await fetch(`http://127.0.0.1:${port}/kshvi/instances/load-main/events`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  streams.push(reader);
  return { response, reader };
}
async function nextFrame(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const boundary = buffer.indexOf('\n\n');
    if (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (frame.includes('event:')) return frame;
      continue;
    }
    const { done, value } = await reader.read();
    if (done) throw new Error('SSE закрылся до следующего события');
    buffer += decoder.decode(value, { stream: true });
  }
}

it('официальная команда использует actor сессии и доходит до per-role SSE', async () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  for (const [userId, sideId] of [['leader', 'blue'], ['blue-user', 'blue'], ['red-user', 'red']] as const) {
    await sessions.createAccount({
      userId, username: userId, password: 'secret123', organizationId: 'org-sse',
      roles: [{ id: `role-${userId}`, role: userId === 'red-user' ? 'TRAINEE' : 'LEADER', sideId, authorities: ['instance:command', 'projection:read', 'TRUTH_READ'] }],
    });
  }
  const leader = await sessions.login('leader', 'secret123');
  const blue = await sessions.login('blue-user', 'secret123');
  const red = await sessions.login('red-user', 'secret123');
  await sessions.selectRole(leader.token, 'role-leader');
  await sessions.selectRole(blue.token, 'role-blue-user');
  await sessions.selectRole(red.token, 'role-red-user');
  const subscriptions = new SubscriptionService();
  const commands = new CommandService({ eventSink: event => publishChainEvent(subscriptions, event) });
  const resolve = async (token: string) => sessions.authenticate(token);
  const router = new Router();
  registerInstanceRoutes(router, new InstanceService(), commands, async ctx => resolve(String(ctx.req.headers.authorization?.replace(/^Bearer /, '') ?? '')));
  registerSseRoutes(router, subscriptions, async (_ctx, instanceId) => {
    const actor = await resolve(String(_ctx.req.headers.authorization?.replace(/^Bearer /, '') ?? ''));
    return {
      organizationId: actor.organizationId, instanceIds: [instanceId], side: actor.sideId ?? 'UNKNOWN', role: actor.activeRole ?? 'UNKNOWN',
      scope: actor.authorities.includes('TRUTH_READ') ? 'truth' as const : 'own' as const,
      operationalAt: new Date().toISOString(), authorities: actor.authorities, subscriptionRevision: 1,
    };
  });
  const service = createService({ name: 'kshvi-official-sse-test', version: '0', port: 0, router });
  services.push(service);
  const port = await service.listen();
  const blueStream = await openStream(port, blue.token);
  const redStream = await openStream(port, red.token);
  expect(await nextFrame(blueStream.reader)).toContain('ready');
  expect(await nextFrame(redStream.reader)).toContain('ready');

  const response = await fetch(`http://127.0.0.1:${port}/kshvi/instances/load-main/commands`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${leader.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branchId: 'main', expectedRevision: 0, idempotencyKey: 'command-sse-1', type: 'decision.create', at: '2030-01-01T01:00:00Z', decision,
      actor: { userId: 'forged-user', role: 'LEADER', organizationId: 'forged-org', sideId: 'red' },
    }),
  });
  expect(response.status, await response.text()).toBe(200);
  const blueEvent = await nextFrame(blueStream.reader);
  expect(blueEvent).toContain('decision.created.v1');
  expect(blueEvent).toContain('org-sse');
  expect(blueEvent).not.toContain('forged-org');
  const redEvent = await nextFrame(redStream.reader);
  expect(redEvent).toContain('projection.refresh');
  expect(redEvent).not.toContain('Скрытый замысел');
  const second = await fetch(`http://127.0.0.1:${port}/kshvi/instances/load-main/commands`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${leader.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branchId: 'main', expectedRevision: 1, idempotencyKey: 'command-sse-2', type: 'decision.create', at: '2030-01-01T01:00:00Z',
      decision: { ...decision, id: 'decision-sse-2' },
      actor: { userId: 'forged-user', role: 'LEADER', organizationId: 'forged-org', sideId: 'red' },
    }),
  });
  expect(second.status, await second.text()).toBe(200);
  const history = await commands.history('load-main', 'main');
  expect(history).toHaveLength(2);
  expect(history[0].organizationId).toBe('org-sse');
  expect(history[0].actor.id).toBe('leader');
  await blueStream.reader.cancel().catch(() => undefined);
  await redStream.reader.cancel().catch(() => undefined);
});
