import { emptyPreparationDraft, validatePreparationDraft, type PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { JsonValue } from '../../../../packages/kshvi/src/model/types';
import { ExerciseStoreError, type ExerciseActor, type ExerciseCard, type ExerciseStore } from '../store/exercise-store';

export async function readPreparation(store: ExerciseStore, organizationId: string, exerciseId: string): Promise<Readonly<{ card: ExerciseCard; draft: PreparationDraft }>> {
  const card = await store.get(organizationId, exerciseId);
  if (!card) throw new ExerciseStoreError('NOT_FOUND', 'Учение не найдено');
  const payload = card.revisions.find(item => item.revision === card.revision)?.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && Object.hasOwn(payload, 'preparation')) {
    return { card, draft: validatePreparationDraft(payload.preparation) };
  }
  return { card, draft: emptyPreparationDraft(card.updatedAt) };
}

export function savePreparation(store: ExerciseStore, actor: ExerciseActor, exerciseId: string, expectedRevision: number, draft: PreparationDraft): Promise<ExerciseCard> {
  return store.savePreparation(actor, exerciseId, { expectedRevision, draft: draft as unknown as JsonValue }, 'FULL');
}
