import { createPool, dropSchema } from '@def-ops/db';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InMemoryExerciseStore,
  PgExerciseStore,
  type CreateExerciseInput,
  type ExerciseSealActor,
  type ExerciseStore,
} from '../src/store/exercise-store';
import { KshviEventStore } from '../src/store/event-store';
import { approveExercise, linkedExercisePayload, sealApprovedExercise, validExerciseSealInput } from './helpers/full-seal';

const actor: ExerciseSealActor = { organizationId: 'org-seal', userId: 'director-1', activeRole: 'DIRECTOR', authorities: ['scenario.seal'] };
const input: CreateExerciseInput = { title: 'Полное запечатывание', purpose: 'planned', scale: 'operational' };
const databaseIntegration = process.env.TEST_DATABASE_URL ? it : it.skip;

async function approved(store: ExerciseStore, payload = linkedExercisePayload()) {
  const created = await store.create(actor, { ...input, payload });
  return approveExercise(store, actor, created);
}

const rejectedEvidence = [
  ['требует полную валидацию всех контуров', (value: any) => { delete value.validation.areas.COMMUNICATIONS; }, 'VALIDATION_AREA_REQUIRED'],
  ['требует каждое персональное подтверждение', (value: any) => { value.confirmations = value.confirmations.filter((item: any) => item.area !== 'DOCUMENTS'); }, 'CONFIRMATION_REQUIRED:DOCUMENTS'],
  ['отклоняет неперсональное подтверждение', (value: any) => { value.confirmations[0].userId = ''; }, 'PERSONAL_CONFIRMATION_INVALID'],
  ['требует утверждённую initial map', (value: any) => { value.initialMap = { ...value.initialMap, state: 'DRAFT' }; }, 'INITIAL_MAP_NOT_APPROVED'],
  ['проверяет хеш initial map', (value: any) => { value.initialMap = { ...value.initialMap, sha256: '0'.repeat(64) }; }, 'INITIAL_MAP_HASH_INVALID'],
  ['требует автономный environment snapshot', (value: any) => { value.environmentSnapshot = { ...value.environmentSnapshot, autonomous: false }; }, 'ENVIRONMENT_SNAPSHOT_REQUIRED'],
  ['проверяет хеш environment', (value: any) => { value.expectedEnvironmentSha256 = '0'.repeat(64); }, 'ENVIRONMENT_HASH_INVALID'],
  ['требует полную rehearsal', (value: any) => { value.rehearsal.full = false; }, 'REHEARSAL_REQUIRED'],
  ['требует изолированную rehearsal', (value: any) => { value.rehearsal.isolated = false; }, 'REHEARSAL_REQUIRED'],
  ['привязывает rehearsal к текущему сценарию', (value: any) => { value.rehearsal.scenarioSha256 = '0'.repeat(64); }, 'REHEARSAL_SCENARIO_HASH'],
  ['требует успешные проверки rehearsal', (value: any) => { value.rehearsal.checks.RECOVERY = false; }, 'REHEARSAL_CHECKS'],
  ['требует отдельный rehearsal journal', (value: any) => { value.rehearsal.eventLogId = value.rehearsal.officialEventLogId; }, 'REHEARSAL_ISOLATION_REQUIRED'],
  ['требует полный набор хешей', (value: any) => { delete value.hashes.models; }, 'HASH_REQUIRED:models'],
  ['требует основание для предупреждения', (value: any) => {
    value.validation.areas.DOCUMENTS = { status: 'VALID', issues: [{ code: 'PRINT_REVIEW', severity: 'WARNING', message: 'Проверить печать', waivable: true }] };
  }, 'WARNING_ACCEPTANCE'],
] as const;

describe('полный серверный SEALED', () => {
  it('не допускает DRAFT→SEALED или IN_REVIEW→SEALED и сохраняет полный артефакт текущей редакции', async () => {
    const store = new InMemoryExerciseStore({ now: () => new Date('2030-01-01T06:00:00+03:00') });
    const created = await store.create(actor, { ...input, payload: linkedExercisePayload() });
    const evidence = validExerciseSealInput(created);

    await expect(store.seal(actor, created.id, evidence)).rejects.toThrow('APPROVED_REQUIRED');
    expect((await store.get(actor.organizationId, created.id))?.state).toBe('DRAFT');

    await store.transition({ ...actor, activeRole: 'AUTHOR', authorities: ['exercise:revise'] }, created.id, { expectedRevision: 1, command: 'SUBMIT' });
    await expect(store.seal(actor, created.id, evidence)).rejects.toThrow('APPROVED_REQUIRED');
    expect((await store.get(actor.organizationId, created.id))?.state).toBe('IN_REVIEW');

    const approvedCard = await store.transition({ ...actor, activeRole: 'APPROVER', authorities: ['exercise:revise'] }, created.id, { expectedRevision: 1, command: 'APPROVE' });
    const payloadBefore = JSON.stringify(approvedCard.revisions[0].payload);
    const sealed = await store.seal(actor, created.id, validExerciseSealInput(approvedCard));
    const artifact = sealed.revisions[0].sealedArtifact;

    expect(sealed.state).toBe('SEALED');
    expect(sealed.revisions[0].state).toBe('SEALED');
    expect(JSON.stringify(sealed.revisions[0].payload)).toBe(payloadBefore);
    expect(artifact).toMatchObject({
      id: sealed.revisions[0].id,
      revision: 1,
      scenario: sealed.revisions[0].payload,
      scenarioSha256: sealed.revisions[0].sha256,
      sealedAt: '2030-01-01T03:00:00.000Z',
    });
    expect(artifact?.confirmations).toHaveLength(13);
    expect(artifact?.rehearsal).toMatchObject({ full: true, isolated: true, status: 'PASSED', scenarioSha256: sealed.revisions[0].sha256 });
  });

  it('не меняет прежнюю редакцию и её payload при запечатывании текущей', async () => {
    const store = new InMemoryExerciseStore();
    const created = await store.create(actor, input);
    const revised = await store.createRevision(actor, created.id, { expectedRevision: 1, payload: linkedExercisePayload() });
    const sealed = await sealApprovedExercise(store, actor, revised, 2);

    expect(sealed.revisions.map(revision => revision.state)).toEqual(['DRAFT', 'SEALED']);
    expect(sealed.revisions[0].sealedArtifact).toBeUndefined();
    expect(sealed.revisions[0].payload).toEqual({});
  });

  it.each(rejectedEvidence)('%s', async (_name, mutate, error) => {
    const store = new InMemoryExerciseStore();
    const card = await approved(store);
    const evidence = validExerciseSealInput(card) as any;
    mutate(evidence);

    await expect(store.seal(actor, card.id, evidence)).rejects.toThrow(error);
    expect((await store.get(actor.organizationId, card.id))?.state).toBe('APPROVED');
  });

  it('не принимает клиентские scenario/id/revision/sealedAt или неизвестные поля', async () => {
    const store = new InMemoryExerciseStore();
    const card = await approved(store);
    const evidence = { ...validExerciseSealInput(card), scenario: { forged: true }, id: 'forged', revision: 99, sealedAt: '2030-01-01T00:00:00Z', unknown: true } as any;

    await expect(store.seal(actor, card.id, evidence)).rejects.toThrow('недопустимые поля');
    expect((await store.get(actor.organizationId, card.id))?.state).toBe('APPROVED');
  });
});

databaseIntegration('PostgreSQL применяет все предусловия и сохраняет sealed artifact после пересоздания store', async () => {
  const pool = createPool(process.env.TEST_DATABASE_URL!, 3);
  const schema = `kshvi_full_seal_${randomUUID().replaceAll('-', '')}`;
  const events = new KshviEventStore({ pool, schema });
  try {
    await events.init();
    const store = new PgExerciseStore({ pool, schema });
    await store.init();
    const created = await store.create(actor, { ...input, payload: linkedExercisePayload() });
    await expect(store.seal(actor, created.id, validExerciseSealInput(created))).rejects.toThrow('APPROVED_REQUIRED');
    const card = await approveExercise(store, actor, created);

    for (const [, mutate, error] of rejectedEvidence) {
      const evidence = validExerciseSealInput(card) as any;
      mutate(evidence);
      await expect(store.seal(actor, card.id, evidence)).rejects.toThrow(error);
      expect((await store.get(actor.organizationId, card.id))?.state).toBe('APPROVED');
    }

    const sealed = await store.seal(actor, card.id, validExerciseSealInput(card));
    const restarted = new PgExerciseStore({ pool, schema });
    const restored = await restarted.get(actor.organizationId, card.id);
    expect(restored?.revisions[0].sealedArtifact).toEqual(sealed.revisions[0].sealedArtifact);
    expect(restored?.revisions[0].payload).toEqual(sealed.revisions[0].payload);
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});

databaseIntegration('PostgreSQL откатывает карточку, если обновление редакции не затронуло строку', async () => {
  const pool = createPool(process.env.TEST_DATABASE_URL!, 3);
  const schema = `kshvi_seal_rollback_${randomUUID().replaceAll('-', '')}`;
  const events = new KshviEventStore({ pool, schema });
  try {
    await events.init();
    const store = new PgExerciseStore({ pool, schema });
    await store.init();
    const card = await approved(store);
    await pool.query(`create function ${schema}.skip_revision_update() returns trigger language plpgsql as $$ begin return null; end; $$`);
    await pool.query(`create trigger skip_revision_update before update on ${schema}.exercise_revisions for each row execute function ${schema}.skip_revision_update()`);

    await expect(store.seal(actor, card.id, validExerciseSealInput(card))).rejects.toThrow();
    const restored = await store.get(actor.organizationId, card.id);
    expect(restored?.state).toBe('APPROVED');
    expect(restored?.revisions[0].state).toBe('APPROVED');
    expect(restored?.revisions[0].sealedArtifact).toBeUndefined();
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
});
