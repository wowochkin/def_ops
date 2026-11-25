import type { JsonValue } from '@def-ops/kshvi';
import type { ParticipantContext } from '../auth/authorize';
import type { ExerciseCard, ExercisePayloadAccess, ExerciseRevision } from './exercise-store';

const TRUTH_ROLES = new Set(['DIRECTOR', 'LEADER']);
const EDITOR_ROLES = new Set(['AUTHOR', 'APPROVER']);

function hasTruthAccess(actor: ParticipantContext): boolean {
  return actor.activeRole !== null && TRUTH_ROLES.has(actor.activeRole) && actor.authorities.includes('TRUTH_READ');
}

/** Область полной записи определяется той же политикой, что и чтение payload. */
export function exercisePayloadAccess(actor: ParticipantContext): ExercisePayloadAccess {
  const editor = actor.activeRole !== null && EDITOR_ROLES.has(actor.activeRole) && actor.authorities.includes('exercise:revise');
  return hasTruthAccess(actor) || editor ? 'FULL' : 'PROJECTED';
}

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

export function projectExerciseCard(card: ExerciseCard, actor: ParticipantContext): ExerciseCard & Readonly<{ payloadAccess: ExercisePayloadAccess }> {
  const projected = { ...structuredClone(card), payloadAccess: exercisePayloadAccess(actor) };
  if (hasTruthAccess(actor)) return projected;
  return {
    ...projected,
    revisions: projected.revisions.map((revision): ExerciseRevision => {
      const { sealedArtifact: _sealedArtifact, ...serverRevision } = revision;
      return {
        ...serverRevision,
        payload: projected.payloadAccess === 'FULL' ? revision.payload : projectExercisePayload(revision.payload, actor.sideId),
      };
    }),
  };
}
