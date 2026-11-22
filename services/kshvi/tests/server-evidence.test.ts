import { createPool, dropSchema } from '@def-ops/db';
import { READINESS_AREAS, REHEARSAL_CHECKS, type InitialSituationMapModel, type JsonValue } from '@def-ops/kshvi';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { EnvironmentSnapshot } from '../../../packages/kshvi/src/environment/provider';
import { InMemoryExerciseEvidenceService, PgExerciseEvidenceService } from '../src/store/exercise-evidence-service';
import { InMemoryExerciseStore, PgExerciseStore, type ExerciseSealActor } from '../src/store/exercise-store';
import { approveExercise, linkedExercisePayload, SEAL_HASH_A, SEAL_HASH_B, validExerciseSealInput } from './helpers/full-seal';
import { rehearsalProfile } from './helpers/rehearsal-profile';

const director: ExerciseSealActor = { organizationId: 'org-evidence', userId: 'director', activeRole: 'DIRECTOR', authorities: ['scenario.seal'] };
const environment = {
  schemaVersion: 1, id: SEAL_HASH_A, manifestSha256: SEAL_HASH_A,
  region: { name: 'Учебная область', bounds: [0, 0, 1, 1] },
  atlases: [{
    meta: { id: 'atlas', bounds: [0, 0, 1, 1], attribution: 'Учебный атлас' }, id: 'atlas', sha256: SEAL_HASH_B,
    attribution: 'Учебный атлас', license: 'Учебная лицензия', exportRights: 'ALLOWED',
    style: { contentRef: { path: `content/${SEAL_HASH_B}.json`, sha256: SEAL_HASH_B, bytes: 2 }, sha256: SEAL_HASH_B },
    export: { contentRef: { path: `content/${SEAL_HASH_B}.mbtiles`, sha256: SEAL_HASH_B, bytes: 2 }, sha256: SEAL_HASH_B },
    elevations: { contentRef: { path: `content/${SEAL_HASH_B}.json`, sha256: SEAL_HASH_B, bytes: 2 }, sha256: SEAL_HASH_B },
  }], resources: [],
  weather: {
    mode: 'scenario', contentRef: { path: `content/${SEAL_HASH_B}.json`, sha256: SEAL_HASH_B, bytes: 2 },
    sourceId: 'scenario', attribution: 'Сценарная погода', license: 'Учебная лицензия',
  },
  elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 }, autonomy: 'COMPLETE', limitations: [],
} as unknown as EnvironmentSnapshot;
const environmentLoader = { load: async (id: string) => {
  if (id !== SEAL_HASH_A) throw new Error('Снимок среды не найден');
  return environment;
} };

it('создаёт доказательства из серверных действий, карты, среды и репетиции', async () => {
  const evidence = new InMemoryExerciseEvidenceService({ environment: environmentLoader, now: () => new Date('2030-01-01T03:00:00Z') });
  const store = new InMemoryExerciseStore({ evidence, now: () => new Date('2030-01-01T03:00:00Z') });
  const created = await store.create(director, { title: 'Серверный контур', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload() });
  const fixture = validExerciseSealInput(created);
  const { sha256: _untrustedHash, ...mapContent } = fixture.initialMap!;
  const rawMap = { ...mapContent, environment: { ...mapContent.environment, snapshotId: SEAL_HASH_A }, state: 'DRAFT' } as InitialSituationMapModel;
  const card = await store.createRevision(director, created.id, {
    expectedRevision: 1,
    payload: linkedExercisePayload({ initialMap: rawMap as unknown as JsonValue, environmentSnapshotId: SEAL_HASH_A, rehearsalProfile: rehearsalProfile() as unknown as JsonValue }),
  });
  await approveExercise(store, director, card, 2);
  await expect(store.seal(director, created.id, { expectedRevision: 2 })).rejects.toThrow('INITIAL_MAP_NOT_APPROVED');

  await evidence.approveMap({ ...director, activeRole: 'APPROVER', authorities: ['initialMap.approve'] }, created.id, card.revisions[1], rawMap);
  await expect(store.seal(director, created.id, { expectedRevision: 2 })).rejects.toThrow('CONFIRMATION_REQUIRED');

  for (const [index, area] of READINESS_AREAS.entries()) {
    const actor = { ...director, userId: `responsible-${index}`, activeRole: 'RESPONSIBLE', authorities: ['readiness.confirm', `readiness.confirm:${area}`] };
    await evidence.confirm(actor, created.id, card.revisions[1], { expectedRevision: 2, area });
  }
  const sealed = await store.seal(director, created.id, { expectedRevision: 2 });
  const artifact = sealed.revisions[1].sealedArtifact!;
  expect(artifact.confirmations.map(item => item.userId)).toEqual(READINESS_AREAS.map((_area, index) => `responsible-${index}`));
  expect(artifact.confirmations[0].subjectHash).not.toBe(SEAL_HASH_A);
  expect(artifact.rehearsal).toMatchObject({ full: true, isolated: true, status: 'PASSED', scenarioSha256: sealed.revisions[1].sha256 });
  expect(artifact.rehearsal.eventLogId).not.toBe(artifact.rehearsal.officialEventLogId);
  const rehearsalJournal = await evidence.rehearsalJournal(artifact.rehearsal.eventLogId);
  expect(rehearsalJournal.map(event => event.check)).toEqual(REHEARSAL_CHECKS);
  expect(rehearsalJournal.every(event => event.payload && typeof event.payload === 'object')).toBe(true);
  expect(artifact.environmentSnapshot.manifestSha256).toBe(environment.manifestSha256);
  await expect(store.createSession(director, created.id, { revision: 2 })).resolves.toMatchObject({ state: 'ACTIVE' });
});

it('не позволяет подтвердить чужую область без назначенного полномочия', async () => {
  const evidence = new InMemoryExerciseEvidenceService({ environment: environmentLoader });
  const store = new InMemoryExerciseStore({ evidence });
  const created = await store.create(director, { title: 'Полномочия', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload() });
  await expect(evidence.confirm(
    { ...director, activeRole: 'RESPONSIBLE', authorities: ['readiness.confirm', 'readiness.confirm:DOCUMENTS'] },
    created.id, created.revisions[0], { expectedRevision: 1, area: 'ENVIRONMENT_MAP' },
  )).rejects.toThrow('полномоч');
});

const databaseIntegration = process.env.TEST_DATABASE_URL ? it : it.skip;
databaseIntegration('PostgreSQL сохраняет персональные подтверждения и утверждение карты', async () => {
  const pool = createPool(process.env.TEST_DATABASE_URL!, 3);
  const schema = `kshvi_evidence_${randomUUID().replaceAll('-', '')}`;
  const store = new InMemoryExerciseStore();
  const created = await store.create(director, { title: 'Durable evidence', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload() });
  const map = validExerciseSealInput(created).initialMap!;
  try {
    const first = new PgExerciseEvidenceService({ pool, schema, environment: environmentLoader });
    await first.init();
    await first.confirm(
      { ...director, activeRole: 'RESPONSIBLE', authorities: ['readiness.confirm', 'readiness.confirm:DOCUMENTS'] },
      created.id, created.revisions[0], { expectedRevision: 1, area: 'DOCUMENTS' },
    );
    await first.approveMap({ ...director, activeRole: 'APPROVER', authorities: ['initialMap.approve'] }, created.id, created.revisions[0], map);
    const restarted = new PgExerciseEvidenceService({ pool, schema, environment: environmentLoader });
    expect(await restarted.confirmations(created.revisions[0])).toHaveLength(1);
    expect(await restarted.approvedMap(created.revisions[0])).toMatchObject({ state: 'APPROVED', sha256: map.sha256 });
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});


databaseIntegration('PostgreSQL выполняет полный seal и после restart проверяет artifact при запуске', async () => {
  const pool = createPool(process.env.TEST_DATABASE_URL!, 4);
  const schema = `kshvi_evidence_full_${randomUUID().replaceAll('-', '')}`;
  const evidence = new PgExerciseEvidenceService({ pool, schema, environment: environmentLoader });
  const store = new PgExerciseStore({ pool, schema, evidence });
  try {
    await evidence.init();
    await store.init();
    const created = await store.create(director, { title: 'PostgreSQL full evidence', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload() });
    const { sha256: _hash, ...mapContent } = validExerciseSealInput(created).initialMap!;
    const rawMap = { ...mapContent, environment: { ...mapContent.environment, snapshotId: SEAL_HASH_A }, state: 'DRAFT' } as InitialSituationMapModel;
    const card = await store.createRevision(director, created.id, {
      expectedRevision: 1, payload: linkedExercisePayload({ initialMap: rawMap as unknown as JsonValue, environmentSnapshotId: SEAL_HASH_A, rehearsalProfile: rehearsalProfile() as unknown as JsonValue }),
    });
    await evidence.approveMap({ ...director, activeRole: 'APPROVER', authorities: ['initialMap.approve'] }, created.id, card.revisions[1], rawMap);
    await approveExercise(store, director, card, 2);
    for (const [index, area] of READINESS_AREAS.entries()) {
      await evidence.confirm(
        { ...director, userId: `pg-responsible-${index}`, activeRole: 'RESPONSIBLE', authorities: ['readiness.confirm', `readiness.confirm:${area}`] },
        created.id, card.revisions[1], { expectedRevision: 2, area },
      );
    }
    const sealed = await store.seal(director, created.id, { expectedRevision: 2 });
    expect(sealed.revisions[1].sealedArtifact?.confirmations).toHaveLength(13);

    const restartedEvidence = new PgExerciseEvidenceService({ pool, schema, environment: environmentLoader });
    const restartedStore = new PgExerciseStore({ pool, schema, evidence: restartedEvidence });
    await expect(restartedStore.createSession(director, created.id, { revision: 2 })).resolves.toMatchObject({ state: 'ACTIVE', revision: 2 });
    expect(await restartedEvidence.rehearsalJournal(sealed.revisions[1].sealedArtifact!.rehearsal.eventLogId)).toHaveLength(14);
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});
