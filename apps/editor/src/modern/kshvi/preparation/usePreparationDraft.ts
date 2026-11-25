import { useState, type SetStateAction } from 'react';
import { emptyPreparationDraft, validatePreparationDraft, type PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import { KshviHttpError, type ExerciseCard, type KshviClient } from '../kshvi-api';

type VersionedDraft = Readonly<{ revision: number; draft: PreparationDraft | null }>;
type LocalDraft = VersionedDraft & Readonly<{ draft: PreparationDraft }>;
type DraftState = Readonly<{ card: ExerciseCard; confirmed: VersionedDraft; local: LocalDraft | null }>;

function readDraft(card: ExerciseCard, initialize = false): PreparationDraft | null {
  if (card.payloadAccess !== 'FULL') return null;
  const revision = card.revisions.find(item => item.revision === card.revision);
  if (!revision) return null;
  const { payload } = revision;
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && Object.hasOwn(payload, 'preparation')) {
    return validatePreparationDraft(payload.preparation);
  }
  return initialize ? emptyPreparationDraft(card.updatedAt) : null;
}

function confirmedFromCard(card: ExerciseCard): VersionedDraft {
  return { revision: card.revision, draft: readDraft(card, true) };
}

function stateFromCard(card: ExerciseCard): DraftState {
  return { card, confirmed: confirmedFromCard(card), local: null };
}

export function usePreparationDraft(client: Pick<KshviClient, 'savePreparation'>, card: ExerciseCard) {
  const [state, setState] = useState(() => stateFromCard(card));
  if (state.card.id !== card.id || state.card.payloadAccess !== card.payloadAccess) setState(stateFromCard(card));
  else if (state.confirmed.revision < card.revision || (
    state.confirmed.draft === null && card.payloadAccess === 'FULL' && state.confirmed.revision === card.revision
    && state.card !== card && card.revisions.some(item => item.revision === card.revision)
  )) setState({ ...state, card, confirmed: confirmedFromCard(card) });
  const working = state.local ?? state.confirmed;

  function setDraft(edit: SetStateAction<PreparationDraft>): void {
    setState(previous => {
      if (previous.card.id !== state.card.id) return previous;
      const current = previous.local ?? previous.confirmed;
      if (!current.draft) return previous;
      const draft = typeof edit === 'function' ? edit(current.draft) : edit;
      return draft === current.draft ? previous : { ...previous, local: { revision: current.revision, draft } };
    });
  }

  function resolveConflict(draft: PreparationDraft): void {
    setState(previous => {
      if (previous.card.id !== state.card.id || previous.confirmed.revision !== state.confirmed.revision || !previous.confirmed.draft) return previous;
      const local = draft === previous.confirmed.draft ? null : { revision: previous.confirmed.revision, draft };
      return { ...previous, local };
    });
  }

  async function save(draft = working.draft): Promise<ExerciseCard> {
    if (!state.confirmed.draft || !draft) throw new KshviHttpError(403, 'Нет доступа к полному черновику подготовки');
    const savedCard = await client.savePreparation(state.card.id, { expectedRevision: working.revision, draft });
    const confirmed = { revision: savedCard.revision, draft: readDraft(savedCard) };
    setState(previous => {
      if (previous.card.id !== savedCard.id || !previous.confirmed.draft || previous.confirmed.revision > confirmed.revision) return previous;
      let local = previous.local;
      if (!confirmed.draft || local === state.local) local = null;
      else if (local?.revision === working.revision) local = { ...local, revision: confirmed.revision };
      return { ...previous, confirmed, local };
    });
    return savedCard;
  }

  return { ...working, confirmed: state.confirmed, setDraft, save, resolveConflict };
}
