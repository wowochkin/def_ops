import { createPool, dropSchema } from '@def-ops/db';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { InMemoryExerciseStore, PgExerciseStore, type ExerciseStore } from '../src/store/exercise-store';
import { projectExerciseCard } from '../src/store/exercise-projection';

const actor = { organizationId: 'org', userId: 'editor', activeRole: 'DIRECTOR', authorities: ['TRUTH_READ', 'exercise:revise'] };
const roster = [{ userId: 'actual-user', roleAssignmentId: 'actual-assignment', instanceId: 'actual-instance', sideId: 'blue', role: 'TRAINEE', label: 'Участник' }];

async function checkStore(store: ExerciseStore) {
  const first = await store.create(actor, { title: 'Состав', purpose: 'research', scale: 'custom' });
  await expect(store.bindParticipants(actor, first.id, { expectedRevision: 1, participants: roster }, 'PROJECTED')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  const bound = await store.bindParticipants(actor, first.id, { expectedRevision: 1, participants: roster }, 'FULL');
  expect(bound.revision).toBe(2);
  expect(bound.revisions[0].participantRoster).toBeUndefined();
  expect(bound.revisions[1].participantRoster).toEqual(roster);
  expect(bound.revisions[1].participantRosterSha256).toMatch(/^[a-f0-9]{64}$/);
  const projected = projectExerciseCard(bound, { userId: 'reader', organizationId: actor.organizationId,
    activeRole: 'TRAINEE', authorities: ['exercise:read'], sideId: 'blue' });
  expect(projected.revisions[1].participantRoster).toBeUndefined();
  expect(projected.revisions[1].participantRosterSha256).toBeUndefined();
  roster[0].label = 'Изменённая внешняя ссылка';
  expect((await store.get(actor.organizationId, first.id))!.revisions[1].participantRoster![0].label).toBe('Участник');
  roster[0].label = 'Участник';
  await expect(store.bindParticipants(actor, first.id, { expectedRevision: 1, participants: [] }, 'FULL')).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  const edited = await store.createRevision(actor, first.id, { expectedRevision: 2, title: 'Состав после правки' }, 'FULL');
  expect(edited.revisions[2].participantRoster).toEqual(roster);
  const copy = await store.copy(actor, first.id);
  expect(copy.revisions[2].participantRoster).toEqual(roster);
  return first.id;
}

it('привязывает состав к редакции, сохраняя подлинные ID в истории и копии', async () => {
  await checkStore(new InMemoryExerciseStore());
});

it.skipIf(!process.env.TEST_DATABASE_URL)('PostgreSQL восстанавливает состав после нового экземпляра store', async () => {
  const schema = `roster_${randomUUID().replaceAll('-', '')}`;
  const pool = createPool(process.env.TEST_DATABASE_URL!, 1);
  try {
    const store = new PgExerciseStore({ pool, schema });
    await store.init();
    const id = await checkStore(store);
    const restored = await new PgExerciseStore({ pool, schema }).get(actor.organizationId, id);
    expect(restored!.revisions[2].participantRoster).toEqual(roster);
  } finally { await dropSchema(pool, schema); await pool.end(); }
});
