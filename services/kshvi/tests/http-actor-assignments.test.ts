import { createService } from '@def-ops/service-kit';
import { afterEach, expect, it } from 'vitest';
import { buildRouter } from '../src/app';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { CommandService } from '../src/instances/command-service';

const services: Array<ReturnType<typeof createService>> = [];
afterEach(async () => { while (services.length) await services.pop()?.close(); });

function decision(id: string, assigneeId: string) {
  return {
    id, sideId: 'blue', authorId: 'leader', createdAt: '2030-01-01T01:00:00Z', intent: 'Замысел',
    goals: [], tasks: [{ id: `task-${id}`, assigneeId, title: 'Задача' }], resources: [], deadlines: [], coordination: [], reserves: [], transitionConditions: [], assumptions: [],
  } as const;
}

it('берёт assignedNodeIds из назначения роли, а не из тела команды', async () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  const role = Object.assign(
    { id: 'role-trainee', role: 'TRAINEE', sideId: 'blue', authorities: ['instance:command'] },
    { assignedNodeIds: ['node-server'] },
  );
  await sessions.createAccount({ userId: 'trainee', username: 'trainee', password: 'secret123', organizationId: 'org', roles: [role] });
  const login = await sessions.login('trainee', 'secret123');
  await sessions.selectRole(login.token, 'role-trainee');
  const commands = new CommandService();
  const service = createService({ name: 'kshvi-actor-assignments', port: 0, router: buildRouter({ sessions, commands }) });
  services.push(service);
  const port = await service.listen();
  const execute = (id: string, assigneeId: string, forgedNodes: string[]) => fetch(`http://127.0.0.1:${port}/kshvi/instances/session/commands`, {
    method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branchId: 'main', expectedRevision: 0, idempotencyKey: id, type: 'decision.create', at: '2030-01-01T01:00:00Z',
      payload: { decision: decision(id, assigneeId) }, actor: { assignedNodeIds: forgedNodes },
    }),
  });

  const forged = await execute('forged', 'node-client', ['node-client']);
  expect(forged.status).not.toBe(200);
  expect(await commands.history('session', 'main')).toHaveLength(0);

  const valid = await execute('valid', 'node-server', []);
  expect(valid.status, await valid.text()).toBe(200);
  expect(await commands.history('session', 'main')).toHaveLength(1);
});
