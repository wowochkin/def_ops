import { useState, type SetStateAction } from 'react';
import { emptyPreparationDraft, validatePreparationDraft, type PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { ExerciseCard, KshviClient } from '../kshvi-api';

function readDraft(card: ExerciseCard): PreparationDraft {
  const payload = card.revisions.find(item => item.revision === card.revision)?.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && Object.hasOwn(payload, 'preparation')) {
    return validatePreparationDraft(payload.preparation);
  }
  return emptyPreparationDraft(card.updatedAt);
}

function stateFromCard(card: ExerciseCard) {
  return { exerciseId: card.id, revision: card.revision, draft: readDraft(card) };
}

export function usePreparationDraft(client: Pick<KshviClient, 'savePreparation'>, card: ExerciseCard) {
  const [state, setState] = useState(() => stateFromCard(card));
  if (state.exerciseId !== card.id || state.revision < card.revision) setState(stateFromCard(card));

  function setDraft(edit: SetStateAction<PreparationDraft>): void {
    setState(previous => previous.exerciseId === state.exerciseId && previous.revision === state.revision
      ? { ...previous, draft: typeof edit === 'function' ? edit(previous.draft) : edit }
      : previous);
  }

  async function save(draft = state.draft): Promise<ExerciseCard> {
    const savedCard = await client.savePreparation(state.exerciseId, { expectedRevision: state.revision, draft });
    const savedState = stateFromCard(savedCard);
    setState(previous => previous.exerciseId === savedState.exerciseId && previous.revision < savedState.revision ? savedState : previous);
    return savedCard;
  }

  return { draft: state.draft, revision: state.revision, setDraft, save };
}
