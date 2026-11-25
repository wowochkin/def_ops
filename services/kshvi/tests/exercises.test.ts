import { createPool, dropSchema } from '@def-ops/db';
import type { JsonValue } from '@def-ops/kshvi';
import { Router, createService } from '@def-ops/service-kit';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { registerExerciseRoutes } from '../src/http/exercise-routes';
import {
  InMemoryExerciseStore,
  PgExerciseStore,
  type CreateExerciseInput,
  type ExerciseActor,
  type ExerciseSealActor,
} from '../src/store/exercise-store';
import { KshviEventStore } from '../src/store/event-store';
import { linkedExercisePayload, sealApprovedExercise, serverExerciseEvidence } from './helpers/full-seal';

const actor: ExerciseActor = { organizationId: 'org1', userId: 'author-1' };
const director: ExerciseSealActor = { ...actor, activeRole: 'DIRECTOR', authorities: ['scenario.seal'] };
const input: CreateExerciseInput = {
  title: 'Учение «Рубеж»',
  purpose: 'planned',
  scale: 'operational',
  startsAt: '2026-12-01T06:00:00.000Z',
  endsAt: '2026-12-03T18:00:00.000Z',
};

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
});

function linkedPayload(): JsonValue {
  return linkedExercisePayload();
}

describe('библиотека учений', () => {
  it('создаёт карточку, ищет по фильтрам и сохраняет неизменяемые редакции', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const created = await store.create(actor, input);
    expect(created).toMatchObject({
      title: input.title,
      ownerId: actor.userId,
      revision: 1,
      state: 'DRAFT',
      validation: 'NOT_RUN',
      readiness: 0,
      lastSessionId: null,
    });
    expect(created.revisions).toHaveLength(1);
    expect(created.revisions[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    await store.create(actor, { ...input, title: 'Другой замысел', scale: 'tactical', purpose: 'research' });
    await expect(store.list(actor.organizationId, { query: 'рубеж', scale: 'operational', purpose: 'planned' }))
      .resolves.toEqual([expect.objectContaining({ id: created.id })]);
    await expect(store.list(actor.organizationId, { scale: 'strategic' })).resolves.toEqual([]);
    await expect(store.list('org2', {})).resolves.toEqual([]);

    const revised = await store.createRevision(actor, created.id, {
      expectedRevision: 1,
      title: 'Учение «Рубеж» — уточнено',
      payload: { intent: 'Проверить управление', requiredUnknown: null },
    });
    expect(revised).toMatchObject({ revision: 2, state: 'DRAFT', readiness: 0, validation: 'NOT_RUN' });
    expect(revised.revisions.map(revision => revision.revision)).toEqual([1, 2]);
    expect(revised.revisions[0].payload).toEqual({});
    await expect(store.createRevision(actor, created.id, {
      expectedRevision: 1,
      payload: { intent: 'Устаревшая редакция' },
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(store.get('org2', created.id)).resolves.toBeNull();
  });

  it('отклоняет неполные команды русской ошибкой валидации вместо внутренней ошибки', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    await expect(store.create(actor, null as unknown as CreateExerciseInput))
      .rejects.toMatchObject({ code: 'VALIDATION', message: 'Проверьте данные учения' });
    await expect(store.create(actor, { ...input, title: 42 } as unknown as CreateExerciseInput))
      .rejects.toMatchObject({ code: 'VALIDATION' });
    const created = await store.create(actor, input);
    await expect(store.archive(actor, created.id, undefined as unknown as number))
      .rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.copy(actor, created.id, 42 as unknown as string))
      .rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.createSession(actor, created.id, { revision: 0 }))
      .rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('копирует проект дважды с новыми согласованными UUID и архивирует исходник', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const scenarioId = randomUUID();
    const nodeId = randomUUID();
    const source = await store.create(actor, {
      ...input,
      payload: { scenarioId, root: { id: nodeId, parentId: nodeId } },
    });
    const first = await store.copy(actor, source.id);
    const second = await store.copy(actor, source.id, 'Повторное использование');

    expect(first.id).not.toBe(source.id);
    expect(second.id).not.toBe(source.id);
    expect(first.id).not.toBe(second.id);
    expect(first.revisions[0].id).not.toBe(source.revisions[0].id);
    expect(first.revisions[0].id).not.toBe(second.revisions[0].id);
    const copiedPayload = first.revisions[0].payload as {
      scenarioId: string;
      root: { id: string; parentId: string };
    };
    expect(copiedPayload.scenarioId).not.toBe(scenarioId);
    expect(copiedPayload.root.id).not.toBe(nodeId);
    expect(copiedPayload.root.parentId).toBe(copiedPayload.root.id);
    expect(first.sessions).toEqual([]);
    expect(first.lastSessionId).toBeNull();
    expect(second.title).toBe('Повторное использование');
    expect((await store.get(actor.organizationId, source.id))?.revisions[0].payload).toEqual({
      scenarioId,
      root: { id: nodeId, parentId: nodeId },
    });

    const archived = await store.archive(actor, source.id, 1);
    expect(archived.state).toBe('ARCHIVED');
    await expect(store.list(actor.organizationId, {})).resolves.toHaveLength(2);
    await expect(store.list(actor.organizationId, { state: 'ARCHIVED' }))
      .resolves.toEqual([expect.objectContaining({ id: source.id })]);
    await expect(store.createRevision(actor, source.id, { expectedRevision: 1, payload: {} }))
      .rejects.toMatchObject({ code: 'ARCHIVED' });
  });

  it('запечатывает только текущую редакцию после серверной проверки полного комплекта', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const exercise = await store.create(actor, input);
    const revised = await store.createRevision(actor, exercise.id, { expectedRevision: 1, payload: linkedPayload() });
    const sealed = await sealApprovedExercise(store, director, revised, 2);

    expect(sealed).toMatchObject({ revision: 2, state: 'SEALED', readiness: 100, validation: 'OK' });
    expect(sealed.revisions.map(revision => revision.state)).toEqual(['DRAFT', 'SEALED']);
  });

  it('не позволяет запечатать без роли DIRECTOR и полномочия scenario.seal', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const exercise = await store.create(actor, { ...input, payload: linkedPayload() });

    await expect(store.seal({ ...director, activeRole: 'LEADER' }, exercise.id, { expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.seal({ ...director, authorities: [] }, exercise.id, { expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await store.get(actor.organizationId, exercise.id))?.state).toBe('DRAFT');
  });

  it('отклоняет запечатывание устаревшей редакции', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const exercise = await store.create(actor, { ...input, payload: linkedPayload() });

    await expect(store.seal(director, exercise.id, { expectedRevision: 2 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect((await store.get(actor.organizationId, exercise.id))?.state).toBe('DRAFT');
  });

  it('отклоняет запечатывание неполного комплекта', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const exercise = await store.create(actor, input);

    await expect(store.seal(director, exercise.id, { expectedRevision: 1 })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await store.get(actor.organizationId, exercise.id))?.state).toBe('DRAFT');
  });

  it('создаёт только серверные сеансы и изолирует их по организации', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const exercise = await store.create(actor, { ...input, payload: linkedPayload() });
    await sealApprovedExercise(store, director, exercise);
    const sessionInput = {
      revision: 1,
      optimisticWorld: { resources: { fuel: 999 } },
    };
    const session = await store.createSession(actor, exercise.id, sessionInput);
    expect(session).toMatchObject({
      exerciseId: exercise.id,
      revision: 1,
      authority: 'SERVER',
      confirmedRevision: 0,
      state: 'ACTIVE',
    });
    expect(session).not.toHaveProperty('optimisticWorld');
    expect(JSON.stringify(session)).not.toContain('"fuel":999');
    expect(await store.get(actor.organizationId, exercise.id)).toMatchObject({ lastSessionId: session.id, lastSessionState: 'ACTIVE' });
    await store.transitionSession(actor, exercise.id, session.id, { command: 'COMPLETE', expectedRevision: 0, idempotencyKey: 'library-complete' });
    expect(await store.list(actor.organizationId, {})).toEqual([expect.objectContaining({ lastSessionId: session.id, lastSessionState: 'COMPLETED' })]);
    await expect(store.getSession(actor.organizationId, exercise.id, session.id)).resolves.toMatchObject({ id: session.id });
    await expect(store.getSession('org2', exercise.id, session.id)).resolves.toBeNull();
    await expect(store.listSessions('org2', exercise.id)).resolves.toEqual([]);
    await expect(store.createSession(actor, exercise.id, { revision: 99 }))
      .rejects.toMatchObject({ code: 'REVISION_NOT_FOUND' });
  });

  it('не принимает от клиента состояние, готовность и результат проверки', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const exercise = await store.create(actor, input);
    await expect(store.createRevision(actor, exercise.id, {
      expectedRevision: 1,
      state: 'SEALED',
      readiness: 100,
      validation: 'OK',
      payload: linkedPayload(),
    })).rejects.toMatchObject({ code: 'SERVER_ASSESSMENT_REQUIRED' });
    await expect(store.createSession(actor, exercise.id, { revision: 1 }))
      .rejects.toMatchObject({ code: 'SEALED_REQUIRED' });
  });

  it('рассчитывает готовность и проверку по связанному комплекту на сервере', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const exercise = await store.create(actor, input);
    const revised = await store.createRevision(actor, exercise.id, {
      expectedRevision: 1,
      payload: {
        kit: {
          items: [{ item: 'CONCEPT', present: true }],
          usesLogistics: false,
          omissions: [],
        },
      },
    });
    expect(revised.state).toBe('DRAFT');
    expect(revised.readiness).toBe(5);
    expect(revised.validation).toBe('ERROR');
    expect(revised.revisions.at(-1)?.state).toBe('DRAFT');
  });

  it('рассчитывает оценку уже при создании серверной редакции', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const created = await store.create(actor, { ...input, payload: linkedPayload() });
    expect(created).toMatchObject({ state: 'DRAFT', readiness: 100, validation: 'OK' });
  });
});

describe('HTTP API библиотеки', () => {
  it('подтверждает изменения сервером, применяет полномочия и не доверяет организации из тела', async () => {
    const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    await sessions.createAccount({
      userId: actor.userId,
      username: 'author',
      password: 'secret123',
      organizationId: actor.organizationId,
      roles: [{
        id: 'author-role',
        role: 'DIRECTOR',
        sideId: null,
        authorities: ['exercise:read', 'exercise:create', 'exercise:copy', 'exercise:archive', 'exercise:revise', 'exercise:conduct', 'scenario.seal'],
      }, {
        id: 'author-lifecycle-role', role: 'AUTHOR', sideId: null, authorities: ['exercise:revise'],
      }, {
        id: 'approver-role', role: 'APPROVER', sideId: null, authorities: ['exercise:revise'],
      }],
    });
    await sessions.createAccount({
      userId: 'outsider',
      username: 'outsider',
      password: 'secret123',
      organizationId: 'org2',
      roles: [{ id: 'reader-role', role: 'TRAINEE', sideId: null, authorities: ['exercise:read'] }],
    });
    await sessions.createAccount({
      userId: 'leader-1',
      username: 'leader',
      password: 'secret123',
      organizationId: actor.organizationId,
      roles: [{ id: 'leader-role', role: 'LEADER', sideId: null, authorities: ['scenario.seal'] }],
    });
    const login = await sessions.login('author', 'secret123');
    const outsider = await sessions.login('outsider', 'secret123');
    const leader = await sessions.login('leader', 'secret123');
    await sessions.selectRole(login.token, 'author-role');
    await sessions.selectRole(outsider.token, 'reader-role');
    await sessions.selectRole(leader.token, 'leader-role');
    const router = new Router();
    registerExerciseRoutes(router, { store, sessions });
    const service = createService({ name: 'kshvi-exercises-test', version: '0', port: 0, router });
    const port = await service.listen();
    closers.push(service.close);
    const base = `http://127.0.0.1:${port}/kshvi/exercises`;
    const call = async (path: string, init: RequestInit = {}, token = login) => {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token.token}`,
          'X-CSRF-Token': token.csrfToken,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      });
      const body = response.status === 204 ? null : await response.json();
      return { response, body };
    };

    const created = await call('', {
      method: 'POST',
      body: JSON.stringify({ ...input, organizationId: 'org2', ownerId: 'outsider' }),
    });
    expect(created.response.status).toBe(201);
    expect(created.body).toMatchObject({ ownerId: actor.userId, title: input.title });
    await expect(store.list('org2', {})).resolves.toEqual([]);

    const listed = await call(`?query=${encodeURIComponent('рубеж')}&scale=operational`);
    expect(listed.response.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0].id).toBe(created.body.id);

    const copied = await call(`/${created.body.id}/copies`, { method: 'POST', body: '{}' });
    expect(copied.response.status).toBe(201);
    expect(copied.body.id).not.toBe(created.body.id);

    const revised = await call(`/${created.body.id}/revisions`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: 1, payload: linkedPayload() }),
    });
    expect(revised.response.status).toBe(201);
    expect(revised.body.revision).toBe(2);

    const sealBody = { expectedRevision: 2 };
    const clientSeal = await call(`/${created.body.id}/revisions`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: 2, state: 'SEALED', readiness: 100, validation: 'OK', payload: linkedPayload() }),
    });
    expect(clientSeal.response.status).toBe(422);
    const injectedSeal = await call(`/${created.body.id}/seal`, {
      method: 'POST',
      body: JSON.stringify({ ...sealBody, state: 'SEALED', readiness: 100, validation: 'OK', unknown: true }),
    });
    expect(injectedSeal.response.status).toBe(422);
    expect(injectedSeal.body.error.message).toMatch(/недопустимые поля/);
    const forbiddenSeal = await call(`/${created.body.id}/seal`, {
      method: 'POST', body: JSON.stringify(sealBody),
    }, leader);
    expect(forbiddenSeal.response.status).toBe(403);
    const invalidCsrf = await call(`/${created.body.id}/seal`, {
      method: 'POST', body: JSON.stringify(sealBody), headers: { 'X-CSRF-Token': 'invalid' },
    });
    expect(invalidCsrf.response.status).toBe(403);

    await sessions.selectRole(login.token, 'author-lifecycle-role');
    const submitted = await call(`/${created.body.id}/transitions`, {
      method: 'POST', body: JSON.stringify({ expectedRevision: 2, command: 'SUBMIT' }),
    });
    expect(submitted.response.status).toBe(200);
    expect(submitted.body.state).toBe('IN_REVIEW');
    await sessions.selectRole(login.token, 'approver-role');
    const approved = await call(`/${created.body.id}/transitions`, {
      method: 'POST', body: JSON.stringify({ expectedRevision: 2, command: 'APPROVE' }),
    });
    expect(approved.response.status).toBe(200);
    expect(approved.body.state).toBe('APPROVED');
    await sessions.selectRole(login.token, 'author-role');
    const sealed = await call(`/${created.body.id}/seal`, {
      method: 'POST', body: JSON.stringify(sealBody),
    });
    expect(sealed.response.status).toBe(200);
    expect(sealed.body).toMatchObject({ revision: 2, state: 'SEALED', readiness: 100, validation: 'OK' });
    expect(sealed.body.revisions.map((revision: { state: string }) => revision.state)).toEqual(['DRAFT', 'SEALED']);

    const session = await call(`/${created.body.id}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ revision: 2, optimisticWorld: { fuel: 999 } }),
    });
    expect(session.response.status).toBe(201);
    expect(session.body).toMatchObject({ authority: 'SERVER', confirmedRevision: 0 });
    expect(JSON.stringify(session.body)).not.toContain('"fuel":999');

    const foreign = await call(`/${created.body.id}`, {}, outsider);
    expect(foreign.response.status).toBe(404);
    expect(foreign.body.error.message).not.toContain(created.body.id);
    const forbidden = await call('', { method: 'POST', body: JSON.stringify(input) }, outsider);
    expect(forbidden.response.status).toBe(403);

    const archived = await call(`/${created.body.id}/archive`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision: 2 }),
    });
    expect(archived.response.status).toBe(200);
    expect(archived.body.state).toBe('ARCHIVED');
    const archivedSeal = await call(`/${created.body.id}/seal`, {
      method: 'POST', body: JSON.stringify(sealBody),
    });
    expect(archivedSeal.response.status).toBe(409);
    const hideEntry = { method: 'DELETE', body: JSON.stringify({ expectedRevision: 2, title: archived.body.title, reason: 'Повторная карточка' }) };
    const route = `/${created.body.id}/archive-entry`;
    expect((await call(route, hideEntry, outsider)).response.status).toBe(403);
    expect((await call(route, { ...hideEntry, headers: { 'x-csrf-token': 'invalid' } })).response.status).toBe(403);
    const hidden = await call(route, hideEntry);
    expect(hidden.response.status).toBe(200);
    expect(hidden.body).not.toHaveProperty('archiveHiddenReason');
    expect((await call('?state=ARCHIVED')).body.items).toEqual([]);
    expect((await call(`/${created.body.id}`)).body.revisions).toHaveLength(2);
  });
});

const databaseIntegration = process.env.TEST_DATABASE_URL ? it : it.skip;
databaseIntegration('PostgreSQL сохраняет редакции, копии и изоляцию сеансов', async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const pool = createPool(url, 2);
  const schema = `kshvi_exercise_test_${randomUUID().replaceAll('-', '')}`;
  const eventStore = new KshviEventStore({ pool, schema });
  try {
    await eventStore.init();
    const store = new PgExerciseStore({ pool, schema, evidence: serverExerciseEvidence() });
    await store.init();
    const created = await store.create(actor, { ...input, payload: linkedPayload() });
    const copied = await store.copy(actor, created.id);
    expect(copied.id).not.toBe(created.id);
    expect(copied.revisions[0].id).not.toBe(created.revisions[0].id);
    await expect(store.seal({ ...director, activeRole: 'LEADER' }, created.id, { expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.seal(director, created.id, { expectedRevision: 2 })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    const sealed = await sealApprovedExercise(store, director, created);
    expect(sealed).toMatchObject({ state: 'SEALED', readiness: 100, validation: 'OK' });
    expect(sealed.revisions[0].state).toBe('SEALED');
    const session = await store.createSession(actor, created.id, { revision: 1 });
    await expect(store.getSession('org2', created.id, session.id)).resolves.toBeNull();
    expect(await store.list(actor.organizationId, {})).toContainEqual(expect.objectContaining({
      id: created.id, lastSessionId: session.id, lastSessionState: 'ACTIVE',
    }));
    const revised = await store.createRevision(actor, created.id, { expectedRevision: 1, payload: { intent: 'Проверка PostgreSQL' } });
    expect(revised.revisions).toHaveLength(2);
    expect(revised.revisions[0].state).toBe('SEALED');
    expect(revised.revisions[1].state).toBe('DRAFT');
    await expect(store.seal(director, created.id, { expectedRevision: 2 })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await store.archive(actor, created.id, 2)).state).toBe('ARCHIVED');
    await expect(store.seal(director, created.id, { expectedRevision: 2 })).rejects.toMatchObject({ code: 'ARCHIVED' });
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});
