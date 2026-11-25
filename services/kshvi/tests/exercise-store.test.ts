import { createPool, dropSchema } from '@def-ops/db';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { addInitialMapMarker, approveInitialMap, createInitialSituationMap, emptyPreparationDraft, type JsonValue } from '@def-ops/kshvi';
import { Router, createService } from '@def-ops/service-kit';
import { ExerciseClient } from '../../../apps/editor/src/modern/kshvi/kshvi-api';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { EnvironmentSnapshotStore } from '../src/environment/snapshot-store';
import { registerExerciseRoutes } from '../src/http/exercise-routes';
import { InMemoryExerciseEvidenceService, PgExerciseEvidenceService } from '../src/store/exercise-evidence-service';
import type { Bounds, EnvironmentSnapshot } from '../../../packages/kshvi/src/environment/provider';
import { InMemoryExerciseStore, PgExerciseStore, type ExerciseActor } from '../src/store/exercise-store';
import { linkedExercisePayload, sealApprovedExercise, serverExerciseEvidence } from './helpers/full-seal';

const actor: ExerciseActor = { organizationId: 'org-1', userId: 'author' };
const input = { title: 'Подготовка', purpose: 'planned', scale: 'operational' } as const;
const draft = {
  schemaVersion: 1, environmentSnapshotId: null, initialMap: null, initialMapStatus: 'DRAFT',
  forces: [], equipment: [], formation: null, logistics: null, autonomy: null, readinessStage: null, readinessStates: [],
  updatedAt: '2030-01-01T06:00:00Z',
};

it('проверяет черновик до создания учения и до записи редакции', async () => {
  const store = new InMemoryExerciseStore();
  const invalid = { preparation: { ...draft, unknown: true } };
  await expect(store.create(actor, { ...input, payload: invalid }, 'FULL')).rejects.toMatchObject({ code: 'VALIDATION' });
  const created = await store.create(actor, input);
  await expect(store.createRevision(actor, created.id, { expectedRevision: 1, payload: invalid }, 'FULL'))
    .rejects.toMatchObject({ code: 'VALIDATION' });
  expect((await store.get(actor.organizationId, created.id))?.revisions).toHaveLength(1);
});

it('не принимает снимок, которого нет в настроенном серверном хранилище', async () => {
  const store = new InMemoryExerciseStore();
  const created = await store.create(actor, input);
  const payload = { preparation: { ...draft, environmentSnapshotId: 'a'.repeat(64) } };
  await expect(store.createRevision(actor, created.id, { expectedRevision: 1, payload }, 'FULL'))
    .rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/снимок/i) });
});

it('сохраняет нанесённую карту только со сверенным серверным снимком и не принимает клиентское утверждение', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kshvi-preparation-'));
  try {
    const environment = new EnvironmentSnapshotStore(directory);
    const snapshot = await environment.create({
      schemaVersion: 1, region: { name: 'Учебная область', bounds: [0, 0, 1, 1] }, atlases: [], resources: [],
      weather: { mode: 'scenario', contentRef: null, sourceId: 'weather', attribution: 'Источник', license: 'Учебная' },
      elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 },
      autonomy: 'INCOMPLETE', limitations: ['Пробный снимок'],
    }, []);
    const initialMap = addInitialMapMarker(createInitialSituationMap({
      id: 'map', revision: 1, environment: { snapshotId: snapshot.id, manifestSha256: snapshot.manifestSha256, bounds: snapshot.region.bounds },
      initialOperationalAt: draft.updatedAt, timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
      symbolSet: { id: 'symbols', revision: 1, sha256: 'a'.repeat(64) }, attribution: ['Источник'],
    }), {
      id: 'marker', revision: 1, kind: 'TASK', layerId: 'EVENTS', truth: 'TRUTH', geometry: { type: 'Point', coordinates: [0.5, 0.5] },
      sourceId: 'source', authorId: 'author', eventId: 'event', validFrom: draft.updatedAt, validUntil: '2030-01-02T06:00:00Z',
      state: 'PLANNED', confidence: 1, uncertainty: { radiusM: 0, note: '' }, visibility: { staffOnly: true }, links: { taskId: 'task' },
      sideId: 'side', symbol: { id: 'task', version: 'v1', sideId: 'side', status: 'APPROVED', sourceDocument: 'source', sourcePage: 1 },
    });
    const payload = (map: typeof initialMap, status = 'MAPPED'): JsonValue => JSON.parse(JSON.stringify({
      preparation: { ...draft, environmentSnapshotId: snapshot.id, initialMapStatus: status, initialMap: map },
    }));
    const now = new Date('2030-01-01T09:00:00Z');
    const store = new InMemoryExerciseStore({ environment, now: () => now });
    const created = await store.create(actor, input);
    const mismatched = { ...initialMap, environment: { ...initialMap.environment, manifestSha256: 'b'.repeat(64) } };
    await expect(store.createRevision(actor, created.id, { expectedRevision: 1, payload: payload(mismatched) }, 'FULL'))
      .rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.createRevision(actor, created.id, { expectedRevision: 1, payload: payload(approveInitialMap(initialMap), 'APPROVED') }, 'FULL'))
      .rejects.toMatchObject({ code: 'SERVER_ASSESSMENT_REQUIRED' });
    const saved = await store.createRevision(actor, created.id, { expectedRevision: 1, payload: payload(initialMap) }, 'FULL');
    expect(saved.revisions.at(-1)?.payload).toMatchObject({
      preparation: { initialMapStatus: 'MAPPED', environmentSnapshotId: snapshot.id, updatedAt: now.toISOString() },
    });
    expect(saved.revision).toBe(2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('запрещает обычное сохранение подготовки после запечатывания', async () => {
  const store = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
  const created = await store.create(actor, { ...input, payload: linkedExercisePayload() });
  await sealApprovedExercise(store, { ...actor, activeRole: 'DIRECTOR', authorities: ['scenario.seal'] }, created);
  await expect(store.createRevision(actor, created.id, { expectedRevision: 1, payload: linkedExercisePayload({ preparation: draft }) }, 'FULL'))
    .rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await store.get(actor.organizationId, created.id))?.state).toBe('SEALED');
});

const initialPayload = {
  title: 'Подготовка', intent: 'Закрытый замысел', operationalAssignments: [{ id: 'assignment', sideId: 'side' }],
};
const populatedDraft = {
  ...emptyPreparationDraft(draft.updatedAt),
  logistics: {
    id: 'logistics-baseline', actionPlanVersion: 1, linkedActionPlanVersion: 1, requests: [],
    actionTasks: [], routes: [], reserves: { fuel: 8 }, reportingSchedule: [], approved: false,
  },
};

async function preparationApi(store = new InMemoryExerciseStore()) {
  const created = await store.create(actor, { ...input, payload: initialPayload });
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({
    ...actor, username: 'author', password: 'secret123', roles: [
      { id: 'director', role: 'DIRECTOR', sideId: null, authorities: ['exercise:read', 'exercise:revise', 'exercise:create'] },
      { id: 'director-truth', role: 'DIRECTOR', sideId: null, authorities: ['exercise:read', 'exercise:revise', 'exercise:copy', 'TRUTH_READ'] },
      { id: 'author', role: 'AUTHOR', sideId: null, authorities: ['exercise:read', 'exercise:revise', 'exercise:copy'] },
      { id: 'author-with-capability', role: 'AUTHOR', sideId: null, authorities: ['exercise:read', 'exercise:revise', 'TRUTH_READ'] },
      { id: 'approver', role: 'APPROVER', sideId: null, authorities: ['exercise:read', 'exercise:revise'] },
      { id: 'reader', role: 'TRAINEE', sideId: null, authorities: ['exercise:read'] },
    ],
  });
  const login = await sessions.login('author', 'secret123');
  const router = new Router();
  registerExerciseRoutes(router, { store, sessions });
  const service = createService({ name: 'kshvi-preparation-test', version: '0', port: 0, router });
  const port = await service.listen();
  const baseUrl = `http://127.0.0.1:${port}/kshvi`;
  const headers = { Authorization: `Bearer ${login.token}` };
  const client = new ExerciseClient({ baseUrl, headers: () => headers, csrfToken: () => login.csrfToken });
  return {
    client, baseUrl, headers, created, csrfToken: login.csrfToken, close: service.close,
    selectRole: (role: string) => sessions.selectRole(login.token, role),
  };
}

it('даёт редакторам сохранять и заново открывать черновик, а участнику с ограниченной проекцией запрещает замену', async () => {
  const api = await preparationApi();
  const { client, created } = api;
  try {
    await api.selectRole('author');
    const saved = await client.savePreparation(created.id, { expectedRevision: 1, draft: populatedDraft });
    expect(saved.revision).toBe(2);

    await api.selectRole('director');
    const projected = await client.getCard(created.id);
    expect(projected.revisions[1].payload).toEqual({ title: 'Подготовка', operationalAssignments: [] });
    const attempt = { expectedRevision: 2, draft: emptyPreparationDraft(draft.updatedAt) };
    await expect(client.savePreparation(created.id, attempt)).rejects.toMatchObject({ status: 403 });
    expect(projected.payloadAccess).toBe('PROJECTED');

    await api.selectRole('reader');
    await expect(client.savePreparation(created.id, attempt)).rejects.toMatchObject({ status: 403 });

    await api.selectRole('approver');
    const reopened = await client.getCard(created.id);
    expect(reopened).toMatchObject({ revision: 2, payloadAccess: 'FULL' });
    expect(reopened.revisions[1].payload).toEqual({
      ...initialPayload, preparation: { ...populatedDraft, updatedAt: saved.updatedAt },
    });
    const edited = await client.savePreparation(created.id, {
      expectedRevision: 2, draft: { ...populatedDraft, updatedAt: reopened.updatedAt },
    });
    expect(edited).toMatchObject({ revision: 3, payloadAccess: 'FULL' });

    await api.selectRole('director-truth');
    const truthSaved = await client.savePreparation(created.id, { expectedRevision: 3, draft: populatedDraft });
    expect(truthSaved).toMatchObject({ revision: 4, payloadAccess: 'FULL' });
    const nextAttempt = { ...attempt, expectedRevision: 4 };
    await expect(new ExerciseClient({ baseUrl: api.baseUrl, headers: () => api.headers }).savePreparation(created.id, nextAttempt))
      .rejects.toMatchObject({ status: 403 });
    const invalid = await fetch(`${api.baseUrl}/exercises/${created.id}/preparation`, {
      method: 'POST', headers: { ...api.headers, 'X-CSRF-Token': api.csrfToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...nextAttempt, payload: { intent: 'Подмена' } }),
    });
    expect(invalid.status).toBe(422);
  } finally {
    await api.close();
  }
});

it.each<{ action: string; prepared: boolean; payload: JsonValue }>([
  { action: 'добавить', prepared: false, payload: { preparation: draft } },
  { action: 'удалить', prepared: true, payload: { title: 'Карточка без черновика' } },
  { action: 'заменить', prepared: true, payload: { preparation: draft } },
])('ограниченная проекция не позволяет $action черновик через редакции', async ({ prepared, payload }) => {
  const api = await preparationApi();
  const { client, created } = api;
  try {
    const expectedRevision = prepared ? 2 : 1;
    if (prepared) {
      await api.selectRole('author');
      await client.savePreparation(created.id, { expectedRevision: 1, draft: populatedDraft });
    }
    await api.selectRole('director');
    const forged = { expectedRevision, payload, payloadAccess: 'FULL' };
    await expect(client.createRevision(created.id, forged)).rejects.toMatchObject({ status: 403 });
    const updated = await client.createRevision(created.id, { expectedRevision, title: 'Уточнённое название' });
    expect(updated).toMatchObject({ revision: expectedRevision + 1, title: 'Уточнённое название' });

    await api.selectRole('author');
    const reopened = await client.getCard(created.id);
    if (prepared) expect(reopened.revisions.at(-1)?.payload).toMatchObject({ ...initialPayload, preparation: { ...populatedDraft, updatedAt: expect.any(String) } });
    else expect(reopened.revisions.at(-1)?.payload).toEqual(initialPayload);
  } finally {
    await api.close();
  }
});

it('ограниченная проекция не позволяет загрузить черновик при создании учения', async () => {
  const api = await preparationApi();
  try {
    await api.selectRole('director');
    await expect(api.client.create({ ...input, payload: { preparation: draft } })).rejects.toMatchObject({ status: 403 });
    await expect(api.client.create(input)).resolves.toMatchObject({ revision: 1, payloadAccess: 'PROJECTED' });
  } finally {
    await api.close();
  }
});

it('запрещает запись подготовки серверному вызывающему коду без явной области доступа', async () => {
  const store = new InMemoryExerciseStore();
  await expect(store.create(actor, { ...input, payload: { preparation: draft } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const created = await store.create(actor, input);
  await expect(store.savePreparation(actor, created.id, { expectedRevision: 1, draft })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(store.createRevision(actor, created.id, { expectedRevision: 1, payload: { preparation: draft } }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' });
  const saved = await store.savePreparation(actor, created.id, { expectedRevision: 1, draft }, 'FULL');
  await expect(store.createRevision(actor, created.id, { expectedRevision: 2, payload: {} }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await store.get(actor.organizationId, created.id))?.revisions.at(-1)).toEqual(saved.revisions.at(-1));
});

const databaseUrl = process.env.TEST_DATABASE_URL;
it.skipIf(!databaseUrl)('восстанавливает PostgreSQL-черновик и отклоняет устаревшую или невалидную редакцию', async () => {
  const pool = createPool(databaseUrl);
  const schema = `test_preparation_${randomUUID().replaceAll('-', '')}`;
  try {
    const store = new PgExerciseStore({ pool, schema });
    await store.init();
    const payload = { intent: 'Замысел', privateData: { field: 'Ограниченного доступа' } };
    const created = await store.create(actor, { ...input, payload });
    const saved = await store.savePreparation(actor, created.id, { expectedRevision: 1, draft }, 'FULL');

    const restarted = new PgExerciseStore({ pool, schema });
    const restored = await restarted.get(actor.organizationId, created.id);
    expect(restored).toMatchObject({ revision: 2 });
    expect(restored?.revisions.at(-1)?.payload).toEqual({ ...payload, preparation: { ...draft, updatedAt: saved.updatedAt } });
    await expect(restarted.savePreparation(actor, created.id, { expectedRevision: 1, draft }, 'FULL'))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(restarted.createRevision(actor, created.id, { expectedRevision: 2, payload: {} }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(restarted.createRevision(actor, created.id, {
      expectedRevision: 2, payload: { preparation: { ...draft, schemaVersion: 2 } },
    }, 'FULL')).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await restarted.get(actor.organizationId, created.id))?.revisions).toHaveLength(2);
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});

function testSnapshot(environment: EnvironmentSnapshotStore, name: string, bounds: Bounds) {
  return environment.create({
    schemaVersion: 1, region: { name, bounds }, atlases: [], resources: [],
    weather: { mode: 'scenario', contentRef: null, sourceId: 'weather', attribution: 'Источник', license: 'Учебная' },
    elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 },
    autonomy: 'INCOMPLETE', limitations: [],
  }, []);
}

const director = { ...actor, activeRole: 'DIRECTOR', authorities: ['scenario.seal', 'exercise:revise', 'TRUTH_READ'] };
const mapApprover = { ...director, authorities: [...director.authorities, 'initialMap.approve', 'readiness.confirm', 'readiness.confirm:ENVIRONMENT_MAP'] };
function boundMap(snapshot: EnvironmentSnapshot, id: string, coords: readonly [number, number], instanceIds?: string[]) {
  const map = createInitialSituationMap({
    id: 'map', revision: 1,
    environment: { snapshotId: snapshot.id, manifestSha256: snapshot.manifestSha256, bounds: snapshot.region.bounds },
    initialOperationalAt: draft.updatedAt, timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: 'symbols', revision: 1, sha256: 'a'.repeat(64) }, attribution: ['Источник'],
  });
  return addInitialMapMarker(map, {
    id, revision: 1, kind: 'TASK', layerId: 'EVENTS', truth: 'TRUTH', geometry: { type: 'Point', coordinates: coords },
    sourceId: 'source', authorId: 'author', eventId: 'event', validFrom: draft.updatedAt, validUntil: '2030-01-02T06:00:00Z',
    state: 'PLANNED', confidence: 1, uncertainty: { radiusM: 0, note: '' }, visibility: { staffOnly: true, ...(instanceIds ? { instanceIds } : {}) },
    links: { taskId: 'task' }, sideId: 'side', symbol: { id: 'task', version: 'v1', sideId: 'side', status: 'APPROVED', sourceDocument: 'source', sourcePage: 1 },
  });
}

function sealedEvidence(snapshot: EnvironmentSnapshot, map: ReturnType<typeof boundMap>) {
  return serverExerciseEvidence(value => {
    Object.assign(value, { initialMap: approveInitialMap(map), environmentSnapshot: { ...value.environmentSnapshot, manifestSha256: snapshot.manifestSha256 },
      expectedEnvironmentSha256: snapshot.manifestSha256 });
  });
}

it('меняет среду отдельной командой и сохраняет подлинник запечатанной редакции', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kshvi-replace-environment-'));
  try {
    const environment = new EnvironmentSnapshotStore(directory);
    const createSnapshot = (name: string, bounds: [number, number, number, number]) => environment.create({
      schemaVersion: 1, region: { name, bounds }, atlases: [], resources: [],
      weather: { mode: 'scenario', contentRef: null, sourceId: 'weather', attribution: 'Источник', license: 'Учебная' },
      elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 },
      autonomy: 'INCOMPLETE', limitations: [],
    }, []);
    const oldSnapshot = await createSnapshot('Исходная область', [0, 0, 1, 1]);
    const newSnapshot = await createSnapshot('Новая область', [2, 2, 3, 3]);
    const evidence = serverExerciseEvidence(value => {
      const { sha256: _sha, ...map } = value.initialMap!;
      const marker = { ...map.markers[0]!, kind: 'TASK' as const, layerId: 'EVENTS' as const, links: { taskId: 'task' } };
      Object.assign(value, { initialMap: approveInitialMap({ ...map, state: 'DRAFT',
        environment: { snapshotId: oldSnapshot.id, manifestSha256: oldSnapshot.manifestSha256, bounds: oldSnapshot.region.bounds },
        markers: [marker] }) });
    });
    const store = new InMemoryExerciseStore({ environment, evidence });
    const created = await store.create(director, { ...input, payload: linkedExercisePayload({ environmentSnapshotId: oldSnapshot.id }) });
    const sealed = await sealApprovedExercise(store, director, created);
    const change = { expectedRevision: sealed.revision, snapshotId: newSnapshot.id };
    await expect(store.replaceEnvironment(director, sealed.id, change, 'PROJECTED')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(store.environmentImpact(director, sealed.id, { expectedRevision: sealed.revision, bounds: newSnapshot.region.bounds }, 'FULL'))
      .resolves.toMatchObject({
        objects: expect.arrayContaining([{ id: 'force', kind: 'Объект исходной карты', outside: true }]),
        confirmations: expect.arrayContaining([{ id: 'confirmation-ENVIRONMENT_MAP', area: 'ENVIRONMENT_MAP' }]),
      });
    const revised = await store.replaceEnvironment(director, sealed.id, change, 'FULL');
    expect(revised).toMatchObject({ id: sealed.id, revision: sealed.revision + 1, state: 'DRAFT' });
    expect(revised.revisions[0]).toEqual(sealed.revisions[0]);
    expect(revised.revisions.at(-1)?.payload).toMatchObject({
      preparation: { environmentSnapshotId: newSnapshot.id, initialMapStatus: 'DRAFT',
        initialMap: { bounds: [2, 2, 3, 3], markers: [{ id: 'force', geometry: { type: 'Point', coordinates: [0.2, 0.2] } }] } },
    });
    expect(await environment.load(oldSnapshot.id)).toEqual(oldSnapshot);
    const nestedLegacy = boundMap(oldSnapshot, 'force', [0.2, 0.2]);
    const legacyMap = { ...nestedLegacy, markers: [{ ...nestedLegacy.markers[0]!, links: { forceId: 'force-1' } }] };
    const legacy = new InMemoryExerciseStore({ environment, evidence: sealedEvidence(oldSnapshot, legacyMap) });
    const legacyCard = await legacy.create(director, { ...input, payload: linkedExercisePayload({ environmentSnapshotId: oldSnapshot.id }) });
    const legacySealed = await sealApprovedExercise(legacy, director, legacyCard);
    await expect(legacy.environmentImpact(director, legacyCard.id, { expectedRevision: legacySealed.revision, bounds: newSnapshot.region.bounds }, 'FULL'))
      .resolves.toMatchObject({ missingForceIds: ['force-1'] });
    await expect(legacy.replaceEnvironment(director, legacyCard.id, { expectedRevision: legacySealed.revision, snapshotId: newSnapshot.id }, 'FULL'))
      .rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('force-1') });
    expect(await legacy.get(director.organizationId, legacyCard.id)).toEqual(legacySealed);
    await expect(store.replaceEnvironment(director, sealed.id, change, 'FULL')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('не раскрывает перенесённую закрытую карту через impact, GET, копирование и следующие редакции', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kshvi-closed-map-'));
  const environment = new EnvironmentSnapshotStore(directory);
  const old = await testSnapshot(environment, 'Исходная область', [0, 0, 1, 1]);
  const next = await testSnapshot(environment, 'Новая область', [2, 2, 3, 3]);
  const secret = 'object-of-sealed-map';
  const store = new InMemoryExerciseStore({ environment, evidence: sealedEvidence(old, boundMap(old, secret, [0.25, 0.25])) });
  const first = await store.create(director, { ...input, payload: linkedExercisePayload({ environmentSnapshotId: old.id }) });
  const sealed = await sealApprovedExercise(store, director, first);
  const api = await preparationApi(store);
  const { client } = api;
  try {
    const choice = { expectedRevision: sealed.revision, snapshotId: next.id };
    const impact = { expectedRevision: sealed.revision, bounds: next.region.bounds };
    for (const role of ['author', 'approver', 'author-with-capability']) {
      await api.selectRole(role);
      expect(await client.getCard(sealed.id)).toMatchObject({ payloadAccess: 'FULL' });
      await expect(client.environmentImpact(sealed.id, impact)).rejects.toMatchObject({ status: 403 });
      await expect(client.replaceEnvironment(sealed.id, choice)).rejects.toMatchObject({ status: 403 });
    }
    await api.selectRole('director-truth');
    expect(JSON.stringify(await client.environmentImpact(sealed.id, impact))).toContain(secret);
    const revised = await client.replaceEnvironment(sealed.id, choice);
    const preflight = await client.getCard(sealed.id);
    expect(preflight).toMatchObject({ payloadAccess: 'FULL', revision: revised.revision });
    expect(JSON.stringify(preflight.revisions.at(-1)?.payload)).toContain(secret);
    await api.selectRole('author');
    await expect(client.environmentImpact(sealed.id, { expectedRevision: revised.revision, bounds: old.region.bounds }))
      .rejects.toMatchObject({ status: 403, code: 'forbidden' });
    const read = await client.getCard(sealed.id);
    expect(read.payloadAccess).toBe('PROJECTED');
    expect(JSON.stringify(read)).not.toContain(secret);
    await expect(client.savePreparation(sealed.id, { expectedRevision: revised.revision, draft: emptyPreparationDraft(draft.updatedAt) }))
      .rejects.toMatchObject({ status: 403 });
    await expect(client.createRevision(sealed.id, { expectedRevision: revised.revision, payload: {} })).rejects.toMatchObject({ status: 403 });
    const copy = await client.copy(sealed.id);
    expect(copy.payloadAccess).toBe('PROJECTED');
    expect(JSON.stringify(copy)).not.toContain(secret);
    expect(JSON.stringify(await client.getCard(copy.id))).not.toContain(secret);
    await api.selectRole('director-truth');
    const rewritten = await client.createRevision(sealed.id, {
      expectedRevision: revised.revision, payload: { scenarioId: { encryptedSource: secret } },
    });
    expect(rewritten.revision).toBe(revised.revision + 1);
    expect(JSON.stringify(await client.getCard(copy.id))).toContain(secret);
    await api.selectRole('author');
    const reopened = await client.getCard(sealed.id);
    expect(reopened.payloadAccess).toBe('PROJECTED');
    expect(reopened.revisions.at(-1)?.payload).toEqual({});
    expect(JSON.stringify(reopened)).not.toContain(secret);
  } finally {
    await api.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('возвращает отдельный код запрета смены среды при сохранённом FULL обычного черновика', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kshvi-environment-action-denial-'));
  const environment = new EnvironmentSnapshotStore(directory);
  const old = await testSnapshot(environment, 'Исходная область', [0, 0, 1, 1]);
  const next = await testSnapshot(environment, 'Новая область', [2, 2, 3, 3]);
  const evidence = new InMemoryExerciseEvidenceService({ environment });
  const store = new InMemoryExerciseStore({ environment, evidence });
  const secret = 'object-of-closed-approved-map';
  const created = await store.create(director, { ...input, payload: { environmentSnapshotId: old.id } });
  await evidence.approveMap(mapApprover, created.id, created.revisions[0]!, boundMap(old, secret, [0.25, 0.25]));
  const api = await preparationApi(store);
  try {
    const { client } = api;
    await api.selectRole('author');
    const denied = { status: 403, code: 'environment_truth_required' };
    for (const action of [
      () => client.environmentImpact(created.id, { expectedRevision: created.revision, bounds: next.region.bounds }),
      () => client.replaceEnvironment(created.id, { expectedRevision: created.revision, snapshotId: next.id }),
    ]) {
      await expect(action()).rejects.toMatchObject(denied);
      const card = await client.getCard(created.id);
      expect(card).toMatchObject({ payloadAccess: 'FULL', revision: created.revision });
      expect(JSON.stringify(card)).not.toContain(secret);
    }
  } finally {
    await api.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('проверяет legacy-видимость по реестру и не теряет неразрешённые экземпляры', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kshvi-unresolved-map-'));
  try {
    const environment = new EnvironmentSnapshotStore(directory);
    const old = await testSnapshot(environment, 'Исходная область', [0, 0, 1, 1]);
    const next = await testSnapshot(environment, 'Новая область', [2, 2, 3, 3]);
    const instanceId = 'unresolved-legacy-instance';
    const store = new InMemoryExerciseStore({ environment, evidence: sealedEvidence(old, boundMap(old, 'object', [0.25, 0.25], [instanceId])) });
    const first = await store.create(director, { ...input, payload: linkedExercisePayload({
      environmentSnapshotId: old.id, operationalAssignments: [{ nodeId: instanceId, sideId: 'side' }],
    }) });
    const sealed = await sealApprovedExercise(store, director, first);
    await expect(store.environmentImpact(director, first.id, { expectedRevision: sealed.revision, bounds: next.region.bounds }, 'FULL'))
      .resolves.toMatchObject({ missingInstanceIds: [instanceId] });
    await expect(store.replaceEnvironment(director, first.id, { expectedRevision: sealed.revision, snapshotId: next.id }, 'FULL'))
      .rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining(instanceId) });
    expect(await store.get(director.organizationId, first.id)).toEqual(sealed);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('использует утверждённую карту текущей редакции и проверяет её ссылку на прежний снимок', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kshvi-approved-map-'));
  try {
    const environment = new EnvironmentSnapshotStore(directory);
    const old = await testSnapshot(environment, 'Исходная область', [0, 0, 1, 1]);
    const next = await testSnapshot(environment, 'Новая область', [0.5, 0.5, 1, 1]);
    const evidence = new InMemoryExerciseEvidenceService({ environment });
    const store = new InMemoryExerciseStore({ environment, evidence });
    const first = await store.create(director, { ...input, payload: { preparation: JSON.parse(JSON.stringify({
      ...draft, environmentSnapshotId: old.id, initialMap: boundMap(old, 'draft-marker', [0.2, 0.2]),
    })) } }, 'FULL');
    const previous = first.revisions[0]!;
    const choice = { expectedRevision: first.revision, snapshotId: next.id };
    await evidence.approveMap(mapApprover, first.id, previous, boundMap(next, 'wrong-snapshot-map', [0.75, 0.75]));
    await expect(store.replaceEnvironment(director, first.id, choice, 'FULL')).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/снимк/i) });
    await expect(store.environmentImpact(director, first.id, { expectedRevision: first.revision, bounds: next.region.bounds }, 'FULL'))
      .rejects.toMatchObject({ code: 'VALIDATION' });
    await evidence.approveMap(mapApprover, first.id, previous, boundMap(old, 'approved-marker', [0.75, 0.75]));
    await expect(store.environmentImpact(actor, first.id, { expectedRevision: first.revision, bounds: next.region.bounds }, 'FULL'))
      .rejects.toMatchObject({ code: 'ENVIRONMENT_TRUTH_REQUIRED' });
    await expect(store.environmentImpact(director, first.id, { expectedRevision: first.revision, bounds: next.region.bounds }, 'FULL'))
      .resolves.toMatchObject({ objects: [
        { id: 'map', kind: 'Исходная карта', outside: false },
        { id: 'approved-marker', kind: 'Объект исходной карты', outside: false },
      ] });
    const result = await store.replaceEnvironment(director, first.id, choice, 'FULL');
    expect(result.revisions.at(-1)?.payload).toMatchObject({
      preparation: { initialMap: { markers: [{ id: 'approved-marker', geometry: { coordinates: [0.75, 0.75] } }] } },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.skipIf(!databaseUrl)('читает реальную PostgreSQL-карту под блокировкой из пула с одним соединением', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kshvi-change-one-connection-'));
  const pool = createPool(databaseUrl, 1);
  pool.options.connectionTimeoutMillis = 600;
  const schema = `test_env_one_${randomUUID().replaceAll('-', '')}`;
  try {
    const environment = new EnvironmentSnapshotStore(directory);
    const old = await testSnapshot(environment, 'Исходная область', [0, 0, 1, 1]);
    const next = await testSnapshot(environment, 'Новая область', [2, 2, 3, 3]);
    const evidence = new PgExerciseEvidenceService({ pool, schema, environment });
    const store = new PgExerciseStore({ pool, schema, evidence, environment });
    await store.init();
    await evidence.init();
    const first = await store.create(director, { ...input, payload: { environmentSnapshotId: old.id } });
    const before = first.revisions[0]!;
    await evidence.approveMap(mapApprover, first.id, before, boundMap(old, 'postgres-approved', [0.25, 0.25]));
    await evidence.confirm(mapApprover, first.id, before, { expectedRevision: first.revision, area: 'ENVIRONMENT_MAP' });
    const card = await store.replaceEnvironment(director, first.id, { expectedRevision: first.revision, snapshotId: next.id }, 'FULL');
    expect(card.revisions.at(-1)?.payload).toMatchObject({
      preparation: { initialMap: { markers: [{ id: 'postgres-approved' }] } },
    });
    const restarted = new PgExerciseStore({ pool, schema, evidence, environment });
    expect(await restarted.get(director.organizationId, first.id)).toEqual(card);
    const apiCopy = await restarted.copy(director, first.id);
    expect(apiCopy.revisions.at(-1)?.payload).toMatchObject({ preparation: { initialMap: { markers: [{ id: 'postgres-approved' }] } } });
    await expect(restarted.environmentImpact(actor, apiCopy.id, { expectedRevision: apiCopy.revision, bounds: old.region.bounds }, 'FULL'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
    await rm(directory, { recursive: true, force: true });
  }
});
