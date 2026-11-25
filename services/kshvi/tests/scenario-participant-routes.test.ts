import { expect, it } from 'vitest';
import { Router, createService } from '@def-ops/service-kit';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { InMemoryExerciseStore } from '../src/store/exercise-store';
import { registerExerciseRoutes } from '../src/http/exercise-routes';

it('сохраняет серверные назначения в редакции и не позволяет подставить роль или чужую инстанцию', async () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({ userId: 'editor', organizationId: 'org', username: 'editor', password: 'test-password',
    roles: [{ id: 'editor-role', role: 'DIRECTOR', sideId: null, authorities: ['exercise:read', 'exercise:revise', 'TRUTH_READ'] }] });
  await sessions.createAccount({ userId: 'participant', organizationId: 'org', username: 'Участник', password: 'participant-password',
    roles: [{ id: 'actual-role', role: 'TRAINEE', sideId: 'blue', authorities: ['exercise:read'], assignedInstanceIds: ['actual-instance'] }] });
  const store = new InMemoryExerciseStore();
  const created = await store.create({ userId: 'editor', organizationId: 'org' }, { title: 'Состав сценария', purpose: 'research', scale: 'custom' });
  const router = new Router();
  registerExerciseRoutes(router, { store, sessions });
  const service = createService({ name: 'roster-test', version: '0', port: 0, router });
  const port = await service.listen();
  try {
    const login = await sessions.login('editor', 'test-password');
    await sessions.selectRole(login.token, 'editor-role');
    const base = `http://127.0.0.1:${port}/kshvi/exercises/${created.id}/participant-roster`;
    const headers = { Authorization: `Bearer ${login.token}`, 'x-csrf-token': login.csrfToken, 'content-type': 'application/json' };
    const candidatesResponse = await fetch(base, { headers });
    expect(candidatesResponse.status).toBe(200);
    const listing = await candidatesResponse.json();
    expect(listing).toMatchObject({ revision: 1, items: [], candidates: [expect.objectContaining({ userId: 'participant', role: 'TRAINEE', instanceId: 'actual-instance' })] });
    expect(JSON.stringify(listing)).not.toContain('password');
    expect(JSON.stringify(listing)).not.toContain('authorities');
    const reference = { userId: 'participant', roleAssignmentId: 'actual-role', instanceId: 'actual-instance' };
    const post = (participants: unknown, expectedRevision = 1, selectedHeaders = headers) => fetch(base, {
      method: 'POST', headers: selectedHeaders, body: JSON.stringify({ expectedRevision, participants }),
    });
    expect((await post([{ ...reference, role: 'DIRECTOR' }])).status).toBe(422);
    expect((await post([{ ...reference, instanceId: 'invented' }])).status).toBe(422);
    expect((await post([reference], 1, { ...headers, 'x-csrf-token': '' })).status).toBe(403);
    const saved = await post([reference]);
    expect(saved.status).toBe(201);
    const card = await saved.json();
    expect(card.revision).toBe(2);
    expect(card.revisions[1].participantRoster).toEqual([expect.objectContaining(reference)]);
    expect((await post([], 1)).status).toBe(409);
    const participant = await sessions.login('Участник', 'participant-password');
    await sessions.selectRole(participant.token, 'actual-role');
    expect((await fetch(base, { headers: { Authorization: `Bearer ${participant.token}` } })).status).toBe(403);
    const read = await fetch(base.replace('/participant-roster', ''), { headers: { Authorization: `Bearer ${participant.token}` } });
    expect(read.status).toBe(200);
    expect(JSON.stringify(await read.json())).not.toContain('participantRoster');
  } finally { await service.close(); }
});
