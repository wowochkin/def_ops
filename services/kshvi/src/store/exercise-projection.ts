import type { JsonValue } from '@def-ops/kshvi';
import type { ParticipantContext } from '../auth/authorize';
import type { ExerciseCard, ExerciseRevision } from './exercise-store';

const TRUTH_ROLES = new Set(['DIRECTOR', 'LEADER']);
const EDITOR_ROLES = new Set(['AUTHOR', 'APPROVER']);

type Assignment = Readonly<Record<string, JsonValue>>;

function participantAssignment(value: JsonValue, sideId: string): Assignment | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.sideId !== sideId) return null;
  const { referenceData: _referenceData, fullIntent: _fullIntent, ...assignment } = value;
  return assignment;
}

/** Белый список участниковой проекции: отсутствующая сторона никогда не означает доступ к истине. */
export function projectExercisePayload(payload: JsonValue, sideId: string | null): JsonValue {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const output: { [key: string]: JsonValue } = {};
  for (const key of ['schemaVersion', 'scenarioId', 'title', 'mapScale'] as const) {
    if (key in payload) output[key] = payload[key];
  }
  const assignments = 'operationalAssignments' in payload && Array.isArray(payload.operationalAssignments)
    ? payload.operationalAssignments
    : [];
  output.operationalAssignments = sideId
    ? assignments.map(value => participantAssignment(value, sideId)).filter((value): value is Assignment => value !== null)
    : [];
  return output;
}

export function projectExerciseCard(card: ExerciseCard, actor: ParticipantContext): ExerciseCard {
  const truth = actor.activeRole !== null && TRUTH_ROLES.has(actor.activeRole) && actor.authorities.includes('TRUTH_READ');
  if (truth) return structuredClone(card);
  const editor = actor.activeRole !== null && EDITOR_ROLES.has(actor.activeRole) && actor.authorities.includes('exercise:revise');
  return {
    ...structuredClone(card),
    revisions: card.revisions.map((revision): ExerciseRevision => {
      const { sealedArtifact: _sealedArtifact, ...serverRevision } = structuredClone(revision);
      return {
        ...serverRevision,
        payload: editor ? structuredClone(revision.payload) : projectExercisePayload(revision.payload, actor.sideId),
      };
    }),
  };
}
