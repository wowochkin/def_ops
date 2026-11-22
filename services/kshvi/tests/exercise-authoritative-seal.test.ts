import { expect, it } from 'vitest';
import { InMemoryExerciseStore, type ExerciseCard, type ExerciseRevision } from '../src/store/exercise-store';
import { approveExercise, linkedExercisePayload, validExerciseSealInput } from './helpers/full-seal';

const actor = { organizationId: 'org-authoritative', userId: 'director-1', activeRole: 'DIRECTOR', authorities: ['scenario.seal'] } as const;

function serverEvidence() {
  return {
    async forRevision({ revision }: { revision: ExerciseRevision }) {
      const card = { revision: revision.revision, revisions: [revision] };
      const { expectedRevision: _expectedRevision, ...evidence } = validExerciseSealInput(card);
      return evidence;
    },
  };
}

it('получает доказательства только из внутреннего серверного порта и отклоняет их подмену клиентом', async () => {
  const store = new InMemoryExerciseStore({ evidence: serverEvidence() } as any);
  const created = await store.create(actor, { title: 'Серверные доказательства', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload() });
  const approved = await approveExercise(store, actor, created);

  const sealed = await store.seal(actor, created.id, { expectedRevision: 1 } as any);
  expect(sealed.state).toBe('SEALED');
  expect(sealed.revisions[0].sealedArtifact?.scenarioSha256).toBe(approved.revisions[0].sha256);

  await expect(store.seal(actor, created.id, {
    expectedRevision: 1,
    confirmations: [{ area: 'DOCUMENTS', userId: 'forged' }],
    rehearsal: { status: 'PASSED' },
  } as any)).rejects.toThrow('недопустимые поля');
});

it('не запускает SEALED без связанного sealed artifact текущей серверной редакции', async () => {
  const store = new InMemoryExerciseStore({ evidence: serverEvidence() } as any);
  const created = await store.create(actor, { title: 'Проверка artifact', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload() });
  await approveExercise(store, actor, created);
  const sealed = await store.seal(actor, created.id, { expectedRevision: 1 } as any);
  const records = (store as any).records as Map<string, ExerciseCard>;
  const stored = records.get(`${actor.organizationId}/${created.id}`)!;
  const artifact = sealed.revisions[0].sealedArtifact!;
  const corruptions = [
    { ...artifact, scenarioSha256: '0'.repeat(64) },
    { ...artifact, confirmations: artifact.confirmations.map((item, index) => index === 0 ? { ...item, subjectHash: '0'.repeat(64) } : item) },
    { ...artifact, hashes: { ...artifact.hashes, weather: '0'.repeat(64) } },
  ];
  for (const corrupted of corruptions) {
    (stored.revisions[0] as any).sealedArtifact = structuredClone(corrupted);
    await expect(store.createSession(actor, created.id, { revision: 1 })).rejects.toThrow('SEALED_ARTIFACT');
  }
  expect(sealed.revisions[0].sealedArtifact).toBeDefined();
});

it('не допускает SEALED, если серверный evidence-порт не настроен', async () => {
  const store = new InMemoryExerciseStore();
  const created = await store.create(actor, { title: 'Закрытый контур', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload() });
  await approveExercise(store, actor, created);
  await expect(store.seal(actor, created.id, { expectedRevision: 1 } as any)).rejects.toThrow('SERVER_EVIDENCE_REQUIRED');
});


it('повторно проверяет текущую редакцию после асинхронного evidence и не допускает гонку seal/createRevision', async () => {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const provider = serverEvidence();
  const store = new InMemoryExerciseStore({
    evidence: {
      forRevision: async context => {
        enter();
        await gate;
        return provider.forRevision(context);
      },
    },
  });
  const created = await store.create(actor, { title: 'Гонка seal', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload() });
  await approveExercise(store, actor, created);
  const pending = store.seal(actor, created.id, { expectedRevision: 1 } as any);
  await entered;
  await store.createRevision(actor, created.id, { expectedRevision: 1, payload: linkedExercisePayload() });
  release();

  await expect(pending).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  const restored = await store.get(actor.organizationId, created.id);
  expect(restored).toMatchObject({ state: 'DRAFT', revision: 2 });
  expect(restored?.revisions.map(revision => revision.state)).toEqual(['APPROVED', 'DRAFT']);
});
