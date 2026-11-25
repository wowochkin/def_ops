import { createPool, dropSchema } from '@def-ops/db';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { addInitialMapMarker, approveInitialMap, createInitialSituationMap, type JsonValue } from '@def-ops/kshvi';
import { EnvironmentSnapshotStore } from '../src/environment/snapshot-store';
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
  await expect(store.create(actor, { ...input, payload: invalid })).rejects.toMatchObject({ code: 'VALIDATION' });
  const created = await store.create(actor, input);
  await expect(store.createRevision(actor, created.id, { expectedRevision: 1, payload: invalid }))
    .rejects.toMatchObject({ code: 'VALIDATION' });
  expect((await store.get(actor.organizationId, created.id))?.revisions).toHaveLength(1);
});

it('не принимает снимок, которого нет в настроенном серверном хранилище', async () => {
  const store = new InMemoryExerciseStore();
  const created = await store.create(actor, input);
  const payload = { preparation: { ...draft, environmentSnapshotId: 'a'.repeat(64) } };
  await expect(store.createRevision(actor, created.id, { expectedRevision: 1, payload }))
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
    await expect(store.createRevision(actor, created.id, { expectedRevision: 1, payload: payload(mismatched) }))
      .rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(store.createRevision(actor, created.id, { expectedRevision: 1, payload: payload(approveInitialMap(initialMap), 'APPROVED') }))
      .rejects.toMatchObject({ code: 'SERVER_ASSESSMENT_REQUIRED' });
    const saved = await store.createRevision(actor, created.id, { expectedRevision: 1, payload: payload(initialMap) });
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
  await expect(store.createRevision(actor, created.id, { expectedRevision: 1, payload: linkedExercisePayload({ preparation: draft }) }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await store.get(actor.organizationId, created.id))?.state).toBe('SEALED');
});

const databaseUrl = process.env.TEST_DATABASE_URL;
it.skipIf(!databaseUrl)('восстанавливает PostgreSQL-черновик и отклоняет устаревшую или невалидную редакцию', async () => {
  const pool = createPool(databaseUrl);
  const schema = `test_preparation_${randomUUID().replaceAll('-', '')}`;
  try {
    const store = new PgExerciseStore({ pool, schema });
    await store.init();
    const created = await store.create(actor, input);
    const payload: JsonValue = { intent: 'Замысел', preparation: draft };
    const saved = await store.createRevision(actor, created.id, { expectedRevision: 1, payload });

    const restarted = new PgExerciseStore({ pool, schema });
    const restored = await restarted.get(actor.organizationId, created.id);
    expect(restored).toMatchObject({ revision: 2 });
    expect(restored?.revisions.at(-1)?.payload).toEqual({ ...payload, preparation: { ...draft, updatedAt: saved.updatedAt } });
    await expect(restarted.createRevision(actor, created.id, { expectedRevision: 1, payload }))
      .rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    await expect(restarted.createRevision(actor, created.id, {
      expectedRevision: 2, payload: { preparation: { ...draft, schemaVersion: 2 } },
    })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await restarted.get(actor.organizationId, created.id))?.revisions).toHaveLength(2);
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});
