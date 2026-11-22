import { createPool, dropSchema } from '@def-ops/db';
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
} from '../src/store/exercise-store';
import { KshviEventStore } from '../src/store/event-store';

const actor: ExerciseActor = { organizationId: 'org1', userId: 'author-1' };
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

describe('библиотека учений', () => {
  it('создаёт карточку, ищет по фильтрам и сохраняет неизменяемые редакции', async () => {
    const store = new InMemoryExerciseStore();
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
      state: 'IN_REVIEW',
      readiness: 35,
      validation: 'WARNING',
      payload: { intent: 'Проверить управление', requiredUnknown: null },
    });
    expect(revised).toMatchObject({ revision: 2, state: 'IN_REVIEW', readiness: 35, validation: 'WARNING' });
    expect(revised.revisions.map(revision => revision.revision)).toEqual([1, 2]);
    expect(revised.revisions[0].payload).toEqual({});
    await expect(store.createRevision(actor, created.id, {
      expectedRevision: 1,
      payload: { intent: 'Устаревшая редакция' },
    })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(store.get('org2', created.id)).resolves.toBeNull();
  });

  it('отклоняет неполные команды русской ошибкой валидации вместо внутренней ошибки', async () => {
    const store = new InMemoryExerciseStore();
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
    const store = new InMemoryExerciseStore();
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

  it('создаёт только серверные сеансы и изолирует их по организации', async () => {
    const store = new InMemoryExerciseStore();
    const exercise = await store.create(actor, input);
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
    expect((await store.get(actor.organizationId, exercise.id))?.lastSessionId).toBe(session.id);
    await expect(store.getSession(actor.organizationId, exercise.id, session.id)).resolves.toMatchObject({ id: session.id });
    await expect(store.getSession('org2', exercise.id, session.id)).resolves.toBeNull();
    await expect(store.listSessions('org2', exercise.id)).resolves.toEqual([]);
    await expect(store.createSession(actor, exercise.id, { revision: 99 }))
      .rejects.toMatchObject({ code: 'REVISION_NOT_FOUND' });
  });
});

describe('HTTP API библиотеки', () => {
  it('подтверждает изменения сервером, применяет полномочия и не доверяет организации из тела', async () => {
    const store = new InMemoryExerciseStore();
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
        authorities: ['exercise:read', 'exercise:create', 'exercise:copy', 'exercise:archive', 'exercise:revise', 'exercise:conduct'],
      }],
    });
    await sessions.createAccount({
      userId: 'outsider',
      username: 'outsider',
      password: 'secret123',
      organizationId: 'org2',
      roles: [{ id: 'reader-role', role: 'TRAINEE', sideId: null, authorities: ['exercise:read'] }],
    });
    const login = await sessions.login('author', 'secret123');
    const outsider = await sessions.login('outsider', 'secret123');
    await sessions.selectRole(login.token, 'author-role');
    await sessions.selectRole(outsider.token, 'reader-role');
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
      body: JSON.stringify({ expectedRevision: 1, payload: { intent: 'Новая редакция' } }),
    });
    expect(revised.response.status).toBe(201);
    expect(revised.body.revision).toBe(2);

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
    const store = new PgExerciseStore({ pool, schema });
    await store.init();
    const created = await store.create(actor, { ...input, payload: { scenarioId: randomUUID() } });
    const copied = await store.copy(actor, created.id);
    expect(copied.id).not.toBe(created.id);
    expect(copied.revisions[0].id).not.toBe(created.revisions[0].id);
    const session = await store.createSession(actor, created.id, { revision: 1 });
    await expect(store.getSession('org2', created.id, session.id)).resolves.toBeNull();
    const revised = await store.createRevision(actor, created.id, { expectedRevision: 1, payload: { intent: 'Проверка PostgreSQL' } });
    expect(revised.revisions).toHaveLength(2);
    expect((await store.archive(actor, created.id, 2)).state).toBe('ARCHIVED');
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});
