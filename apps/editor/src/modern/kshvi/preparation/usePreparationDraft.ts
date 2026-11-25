import { useState, type SetStateAction } from 'react';
import { emptyPreparationDraft, validatePreparationDraft, type PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { ExerciseCard, KshviClient } from '../kshvi-api';

type VersionedDraft = Readonly<{ revision: number; draft: PreparationDraft }>;
type DraftState = Readonly<{ exerciseId: string; confirmed: VersionedDraft; local: VersionedDraft | null }>;

function readDraft(card: ExerciseCard): PreparationDraft | null {
  const payload = card.revisions.find(item => item.revision === card.revision)?.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && Object.hasOwn(payload, 'preparation')) {
    return validatePreparationDraft(payload.preparation);
  }
  return null;
}

function confirmedFromCard(card: ExerciseCard): VersionedDraft {
  return { revision: card.revision, draft: readDraft(card) ?? emptyPreparationDraft(card.updatedAt) };
}

function stateFromCard(card: ExerciseCard): DraftState {
  return { exerciseId: card.id, confirmed: confirmedFromCard(card), local: null };
}

export function usePreparationDraft(client: Pick<KshviClient, 'savePreparation'>, card: ExerciseCard) {
  const [state, setState] = useState(() => stateFromCard(card));
  if (state.exerciseId !== card.id) setState(stateFromCard(card));
  else if (state.confirmed.revision < card.revision) setState({ ...state, confirmed: confirmedFromCard(card) });
  const working = state.local ?? state.confirmed;

  function setDraft(edit: SetStateAction<PreparationDraft>): void {
    setState(previous => {
      if (previous.exerciseId !== state.exerciseId) return previous;
      const current = previous.local ?? previous.confirmed;
      const draft = typeof edit === 'function' ? edit(current.draft) : edit;
      return draft === current.draft ? previous : { ...previous, local: { revision: current.revision, draft } };
    });
  }

  function resolveConflict(draft: PreparationDraft): void {
    setState(previous => {
      if (previous.exerciseId !== state.exerciseId || previous.confirmed.revision !== state.confirmed.revision) return previous;
      const local = draft === previous.confirmed.draft ? null : { revision: previous.confirmed.revision, draft };
      return { ...previous, local };
    });
  }

  async function save(draft = working.draft): Promise<ExerciseCard> {
    const savedCard = await client.savePreparation(state.exerciseId, { expectedRevision: working.revision, draft });
    const confirmed = {
      revision: savedCard.revision,
      draft: readDraft(savedCard) ?? { ...draft, updatedAt: savedCard.updatedAt },
    };
    setState(previous => {
      if (previous.exerciseId !== savedCard.id || previous.confirmed.revision > confirmed.revision) return previous;
      let local = previous.local;
      if (local === state.local) local = null;
      else if (local?.revision === working.revision) local = { ...local, revision: confirmed.revision };
      return { ...previous, confirmed, local };
    });
    return savedCard;
  }

  return { ...working, confirmed: state.confirmed, setDraft, save, resolveConflict };
}
