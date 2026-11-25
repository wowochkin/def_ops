import { randomUUID } from 'node:crypto';
import { createPool, dropSchema } from '@def-ops/db';
import { expect, it } from 'vitest';
import { InMemoryExerciseStore, PgExerciseStore, type ExerciseStore } from '../src/store/exercise-store';

async function checkArchive(store: ExerciseStore) {
  const actor = { organizationId: 'org-a', userId: 'archivist' };
  const external = randomUUID();
  const internal = randomUUID();
  const payload = { sourceId: external, authorId: external, root: { id: internal, parentId: internal } };
  const card = await store.create(actor, { title: 'Материалы', purpose: 'research', scale: 'custom', payload });
  const input = { title: card.title, expectedRevision: 1, reason: 'Дублирующая запись' };
  await expect(store.hideArchiveEntry(actor, card.id, input)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  await store.archive(actor, card.id, 1);
  for (const wrong of [{ title: 'Другое' }, { expectedRevision: 2 }, { reason: '  ' }]) {
    await expect(store.hideArchiveEntry(actor, card.id, { ...input, ...wrong })).rejects.toThrow();
  }
  expect(await store.list(actor.organizationId, { state: 'ARCHIVED' })).toHaveLength(1);
  const hidden = await store.hideArchiveEntry(actor, card.id, input);
  expect(hidden).toMatchObject({ archiveHiddenReason: input.reason, archiveHiddenBy: actor.userId });
  expect(hidden.revisions).toEqual(card.revisions);
  expect(await store.hideArchiveEntry({ ...actor, userId: 'another' }, card.id, input)).toEqual(hidden);
  await expect(store.hideArchiveEntry(actor, card.id, { ...input, reason: 'Другая причина' })).rejects.toThrow();
  expect(await store.list(actor.organizationId, { includeArchived: true })).toEqual([]);
  expect(await store.get(actor.organizationId, card.id)).toEqual(hidden);
  expect(await store.get('another-org', card.id)).toBeNull();
  const copy = await store.copy(actor, card.id);
  expect(copy.archiveHiddenAt).toBeUndefined();
  expect(copy.state).toBe('DRAFT');
  expect(copy.revisions[0].payload).toMatchObject({ sourceId: external, authorId: external, root: { id: expect.not.stringMatching(internal) } });
}
it('скрывает запись с сохранением редакций и неизменяемого основания', () => checkArchive(new InMemoryExerciseStore()));
it.skipIf(!process.env.TEST_DATABASE_URL)('сохраняет видимость и аудит в PostgreSQL', async () => {
  const pool = createPool(process.env.TEST_DATABASE_URL!, 1);
  const schema = 'test_arch_' + randomUUID().replaceAll('-', '');
  try {
    const store = new PgExerciseStore({ pool, schema });
    await store.init();
    await checkArchive(store);
  } finally { await dropSchema(pool, schema); await pool.end(); }
});
