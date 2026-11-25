import type { JsonValue } from '@def-ops/kshvi';
import type { ParticipantContext } from '../auth/authorize';
import type { ExerciseActor, ExerciseCard, ExercisePayloadAccess, ExerciseRevision } from './exercise-store';

const TRUTH_ROLES = new Set(['DIRECTOR', 'LEADER']);
const EDITOR_ROLES = new Set(['AUTHOR', 'APPROVER']);

export function hasTruthAccess(actor: ExerciseActor): boolean {
  return typeof actor.activeRole === 'string' && TRUTH_ROLES.has(actor.activeRole) && actor.authorities?.includes('TRUTH_READ') === true;
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
  const fullPayload = exercisePayloadAccess(actor) === 'FULL';
  const readTruth = hasTruthAccess(actor);
  const { revisions, archiveHiddenAt, archiveHiddenBy, archiveHiddenReason, ...summary } = card;
  const current = revisions.find(revision => revision.revision === card.revision);
  const payloadAccess = fullPayload && (readTruth || !current?.truthOnlyPayload) ? 'FULL' : 'PROJECTED';
  return {
    ...structuredClone(summary), payloadAccess,
    ...(archiveHiddenAt && actor.authorities.includes('kshvi:admin') ? { archiveHiddenAt, archiveHiddenBy, archiveHiddenReason } : {}),
    revisions: revisions.map((revision): ExerciseRevision => {
      const { sealedArtifact, truthOnlyPayload, payload, ...metadata } = revision;
      if (truthOnlyPayload && !readTruth) return { ...metadata, payload: {} };
      return structuredClone({
        ...metadata,
        ...(readTruth && sealedArtifact ? { sealedArtifact } : {}),
        payload: fullPayload ? payload : projectExercisePayload(payload, actor.sideId),
      });
    }),
  };
}
