import {
  MORALE_COMPONENT_NAMES,
  type MoraleComponents,
  type MoralePsychState,
  type UnknownMoraleComponent,
} from './morale-model';
import { MORALE_PROFILE_V1, type MoraleProfile } from './morale-profile';

export type MoraleViewerRole = 'EXERCISE_CONTROL' | 'SYSTEM_COMMANDER' | 'ELECTRONIC_INTERMEDIARY' | 'TRAINEE';

export type MoraleAssessment = Readonly<{
  kind: 'INSTANCE_ASSESSMENT';
  forceId: string;
  instanceId: string;
  assessedAt: string;
  availableAt: string;
  stateEnteredAt: string;
  components: MoraleComponents;
  source: Readonly<{ kind: 'REPORT'; reportId: string }>;
}>;

export type MoraleProjection = Readonly<{
  kind: 'TRUTH' | 'INSTANCE_ASSESSMENT' | 'UNKNOWN';
  forceId: string;
  instanceId: string;
  at: string;
  assessedAt: string | null;
  stateEnteredAt: string | null;
  stale: boolean;
  components: MoraleComponents;
}>;

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Некорректное время оценки МПС');
  return parsed;
}

function unknownComponents(reason: string, observedAt: string): MoraleComponents {
  return Object.fromEntries(MORALE_COMPONENT_NAMES.map(name => [name, {
    status: 'UNKNOWN',
    reason,
    observedAt,
  } satisfies UnknownMoraleComponent])) as unknown as MoraleComponents;
}

function unknownProjection(
  truth: MoralePsychState,
  instanceId: string,
  at: string,
  reason: string,
): MoraleProjection {
  return {
    kind: 'UNKNOWN',
    forceId: truth.subject.forceId,
    instanceId,
    at,
    assessedAt: null,
    stateEnteredAt: null,
    stale: false,
    components: unknownComponents(reason, at),
  };
}

/**
 * Системный командир и посредник получают только собственную оценку.
 * Истина передаётся исключительно контуру руководства учением.
 */
export function projectMorale(input: {
  truth: MoralePsychState;
  assessment: MoraleAssessment | null;
  viewer: Readonly<{ role: MoraleViewerRole; instanceId: string }>;
  at: string;
}, profile: MoraleProfile = MORALE_PROFILE_V1): MoraleProjection {
  const atMs = instant(input.at);
  const { truth, assessment, viewer } = input;
  if (viewer.role === 'EXERCISE_CONTROL') {
    return {
      kind: 'TRUTH',
      forceId: truth.subject.forceId,
      instanceId: viewer.instanceId,
      at: input.at,
      assessedAt: truth.at,
      stateEnteredAt: truth.stateEnteredAt,
      stale: false,
      components: { ...truth.components },
    };
  }
  if (!assessment || assessment.kind !== 'INSTANCE_ASSESSMENT') {
    return unknownProjection(truth, viewer.instanceId, input.at, 'Оценка инстанции отсутствует');
  }
  if (assessment.forceId !== truth.subject.forceId || assessment.instanceId !== viewer.instanceId) {
    return unknownProjection(truth, viewer.instanceId, input.at, 'Оценка принадлежит другой инстанции или силе');
  }
  if (instant(assessment.availableAt) > atMs) {
    return unknownProjection(truth, viewer.instanceId, input.at, 'Оценка ещё недоступна инстанции');
  }
  const assessedAtMs = instant(assessment.assessedAt);
  return {
    kind: 'INSTANCE_ASSESSMENT',
    forceId: assessment.forceId,
    instanceId: assessment.instanceId,
    at: input.at,
    assessedAt: assessment.assessedAt,
    stateEnteredAt: assessment.stateEnteredAt,
    stale: atMs - assessedAtMs > profile.assessmentStaleAfterMinutes * 60_000,
    components: { ...assessment.components },
  };
}
