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
  (stored.revisions[0] as any).sealedArtifact = { ...(stored.revisions[0] as any).sealedArtifact, scenarioSha256: '0'.repeat(64) };

  await expect(store.createSession(actor, created.id, { revision: 1 })).rejects.toThrow('SEALED_ARTIFACT');
  expect(sealed.revisions[0].sealedArtifact).toBeDefined();
});

it('не допускает SEALED, если серверный evidence-порт не настроен', async () => {
  const store = new InMemoryExerciseStore();
  const created = await store.create(actor, { title: 'Закрытый контур', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload() });
  await approveExercise(store, actor, created);
  await expect(store.seal(actor, created.id, { expectedRevision: 1 } as any)).rejects.toThrow('SERVER_EVIDENCE_REQUIRED');
});
