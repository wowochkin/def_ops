import {
  addInitialMapMarker,
  approveInitialMap,
  buildLinkedScenarioKit,
  createInitialSituationMap,
  hashCanonical,
  READINESS_AREAS,
  REHEARSAL_CHECKS,
  REQUIRED_SCENARIO_ITEMS,
  type ApprovedInitialMap,
  type JsonValue,
} from '@def-ops/kshvi';
import { VALIDATION_AREAS } from '../../../../packages/kshvi/src/scenario/validation';
import type {
  ExerciseCard, ExerciseEvidenceProvider, ExerciseSealActor, ExerciseStore, ServerExerciseEvidence,
} from '../../src/store/exercise-store';

export const SEAL_HASH_A = 'a'.repeat(64);
export const SEAL_HASH_B = 'b'.repeat(64);
export const SEAL_HASH_C = 'c'.repeat(64);
const start = '2030-01-01T06:00:00+03:00';
const end = '2030-01-02T06:00:00+03:00';

export function linkedExercisePayload(extra: Record<string, JsonValue> = {}): JsonValue {
  const kit = buildLinkedScenarioKit({
    documents: REQUIRED_SCENARIO_ITEMS.map((item, index) => ({ id: `doc-${index + 1}`, item, revision: 1, content: { item } })),
    usesLogistics: true,
  });
  return { ...extra, kit: kit as unknown as JsonValue };
}

function approvedMap(): ApprovedInitialMap {
  const map = createInitialSituationMap({
    id: 'map-exercise', revision: 1,
    environment: { snapshotId: 'env-exercise', manifestSha256: SEAL_HASH_A, bounds: [0, 0, 1, 1] },
    initialOperationalAt: start, timeZone: 'Europe/Moscow', weatherFrameRef: 'weather-1', terrainStateRef: 'terrain-1',
    symbolSet: { id: 'symbols', revision: 1, sha256: SEAL_HASH_B }, attribution: ['OSM'],
  });
  return approveInitialMap(addInitialMapMarker(map, {
    id: 'force', revision: 1, kind: 'FORCE', layerId: 'TRUE_FORCES', truth: 'TRUTH',
    geometry: { type: 'Point', coordinates: [0.2, 0.2] }, sourceId: 'source', authorId: 'author', eventId: 'event',
    validFrom: start, validUntil: end, state: 'OBSERVED', confidence: 0.8,
    uncertainty: { radiusM: 10, note: '' }, visibility: { sideIds: ['blue'] }, links: { forceId: 'force-1' },
    sideId: 'blue', symbol: { id: 'force', version: 'v1', sideId: 'blue', status: 'APPROVED', sourceDocument: 'source.doc', sourcePage: 1 },
  }));
}

export type ExerciseEvidenceFixture = ServerExerciseEvidence & { expectedRevision: number };

export function validExerciseSealInput(card: Pick<ExerciseCard, 'revision' | 'revisions'>, expectedRevision = card.revision): ExerciseEvidenceFixture {
  const revision = card.revisions.find(item => item.revision === expectedRevision)!;
  const initialMap = approvedMap();
  return {
    expectedRevision,
    validation: {
      areas: Object.fromEntries(VALIDATION_AREAS.map(area => [area, { status: 'VALID' as const }])),
      environment: {
        snapshot: {
          manifestSha256: SEAL_HASH_A, autonomy: 'COMPLETE', weatherContentRef: 'weather/content', elevationContentRef: 'elevation/content',
        },
        expectedManifestSha256: SEAL_HASH_A,
        coverageComplete: true, atlasesAvailable: true, attributionComplete: true, elevationComplete: true, weatherIntervalComplete: true,
        weatherQuality: { status: 'OK', reason: 'KNOWN' },
      },
      initialMap,
    },
    confirmations: READINESS_AREAS.map(area => ({
      id: `confirmation-${area}`, area, userId: `user-${area}`, role: 'RESPONSIBLE', confirmedAt: start, subjectHash: SEAL_HASH_A, dependsOn: [],
    })),
    confirmationSubjects: Object.fromEntries(READINESS_AREAS.map(area => [area, SEAL_HASH_A])),
    rehearsal: {
      schemaVersion: 1, id: `rehearsal-${revision.id}`, scenarioSha256: hashCanonical(revision.payload), full: true, isolated: true,
      status: 'PASSED', eventLogId: `rehearsal-log-${revision.id}`, officialEventLogId: `official-log-${revision.id}`,
      checks: Object.fromEntries(REHEARSAL_CHECKS.map(check => [check, true])),
    },
    initialMap,
    environmentSnapshot: { manifestSha256: SEAL_HASH_A, contentRef: 'environment/hash', autonomous: true },
    expectedEnvironmentSha256: SEAL_HASH_A,
    officialEventLogId: `official-log-${revision.id}`,
    hashes: {
      weather: SEAL_HASH_B, elevation: SEAL_HASH_B, symbols: SEAL_HASH_B, agents: SEAL_HASH_B, eventLibrary: SEAL_HASH_B,
      models: SEAL_HASH_B, roles: SEAL_HASH_B, communications: SEAL_HASH_B, documents: SEAL_HASH_B, rehearsal: SEAL_HASH_C,
    },
  };
}

export async function approveExercise(store: ExerciseStore, actor: ExerciseSealActor, card: ExerciseCard, expectedRevision = card.revision): Promise<ExerciseCard> {
  await store.transition({ ...actor, activeRole: 'AUTHOR', authorities: ['exercise:revise'] }, card.id, { expectedRevision, command: 'SUBMIT' });
  return store.transition({ ...actor, activeRole: 'APPROVER', authorities: ['exercise:revise'] }, card.id, { expectedRevision, command: 'APPROVE' });
}

export function serverExerciseEvidence(mutate?: (evidence: ExerciseEvidenceFixture) => void): ExerciseEvidenceProvider {
  return {
    async forRevision({ revision }) {
      const card = { revision: revision.revision, revisions: [revision] };
      const evidence = validExerciseSealInput(card);
      mutate?.(evidence);
      const { expectedRevision: _expectedRevision, ...serverEvidence } = evidence;
      return structuredClone(serverEvidence);
    },
  };
}

export async function sealApprovedExercise(store: ExerciseStore, actor: ExerciseSealActor, card: ExerciseCard, expectedRevision = card.revision): Promise<ExerciseCard> {
  await approveExercise(store, actor, card, expectedRevision);
  return store.seal(actor, card.id, { expectedRevision });
}
