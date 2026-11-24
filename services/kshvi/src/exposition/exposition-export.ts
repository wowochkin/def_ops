import { createHash } from 'node:crypto';
import { createAudiencePolicy, type AudiencePolicy } from '../../../../packages/kshvi/src/exposition/audience-policy';
import {
  mapAtExposition,
  worldAtExposition,
  type ExpositionProgram,
  type ExpositionSession,
  type OfficialExpositionArchive,
} from '../../../../packages/kshvi/src/exposition/browser-entry';
import { projectAudienceMap } from './exposition-projection';

export const EXPOSITION_ARCHIVE_SCHEMA_VERSION = '1.0.0' as const;

export type DerivedExpositionArchive = Readonly<{
  schemaVersion: typeof EXPOSITION_ARCHIVE_SCHEMA_VERSION;
  archiveId: string;
  branchId: string;
  manifestHash: string;
  purpose: 'EXPOSITION';
  label: 'Экспозиция';
  source: 'ARCHIVE' | 'AUTONOMOUS';
  program: ExpositionSession['program'];
  explanations: ExpositionSession['program']['explanations'];
  audiencePolicy: AudiencePolicy;
  origin: ExpositionSession['origin'];
  playback: ExpositionSession['playback'];
  journalCursor: number;
  seed: number | null;
  rng: ExpositionSession['rng'];
  journal: ExpositionSession['journal'];
  checkpoints: ExpositionSession['checkpoints'];
  world: ExpositionSession['world'];
  map: ExpositionSession['map'];
  officialAssessmentCreated: false;
  officialAssessments: readonly never[];
}>;

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalized(item)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex');
}

function assignedProgram(session: ExpositionSession, policy: AudiencePolicy): ExpositionProgram {
  const explanations = session.program.explanations.filter(explanation =>
    policy.showExplanations && explanation.audience && policy.publicExplanationIds.includes(explanation.id),
  );
  return {
    ...session.program,
    layers: session.program.layers.filter(layer => policy.allowedLayers.includes(layer)),
    frames: session.program.frames.map(frame => ({
      ...frame,
      decision: frame.decision && policy.publicDecisionIds.includes(frame.decision.id)
        ? { id: frame.decision.id, summary: frame.decision.summary }
        : undefined,
    })),
    captions: session.program.captions.filter(caption => policy.publicCaptionIds.includes(caption.id)),
    explanations: structuredClone(explanations),
    planFact: policy.showPlanFact ? structuredClone(session.program.planFact) : [],
  };
}

function rngAtFrame(session: ExpositionSession, journal: ExpositionSession['journal'], atMs: number): ExpositionSession['rng'] {
  const entryRng = journal.at(-1)?.rng;
  if (entryRng) return structuredClone(entryRng);
  const checkpoint = session.checkpoints.filter(item => item.atMs <= atMs && item.rng).at(-1);
  if (checkpoint?.rng) return structuredClone(checkpoint.rng);
  return structuredClone(session.initialRng);
}

export function exportExpositionArchive(input: Readonly<{
  session: ExpositionSession;
  policy: AudiencePolicy;
  archiveId?: string;
}>): DerivedExpositionArchive {
  const { session } = input;
  if (session.purpose !== 'EXPOSITION' || session.officialAssessmentCreated || session.officialAssessments.length > 0) {
    throw new Error('Производный архив создаётся только для экспозиции без официальных оценок');
  }
  if (session.sourceArchive.manifestHash !== session.origin.manifestHash) {
    throw new Error('Хеш исходного архива изменился; производный архив не создан');
  }
  const archiveId = input.archiveId ?? `exposition-archive-${globalThis.crypto.randomUUID()}`;
  if (!archiveId.trim()) throw new Error('Идентификатор производного архива не может быть пустым');
  if (archiveId === session.sourceArchive.archiveId) {
    throw new Error('Производный архив не может повторять идентификатор официального архива');
  }
  const policy = createAudiencePolicy(input.policy);
  const atMs = session.playback.atMs;
  const journal = structuredClone(session.journal.filter(entry => entry.atMs <= atMs));
  const checkpoints = structuredClone(session.checkpoints.filter(checkpoint => checkpoint.atMs <= atMs));
  const program = assignedProgram(session, policy);
  const frameMap = mapAtExposition(session.sourceArchive.map, journal, atMs);
  const unsigned = {
    schemaVersion: EXPOSITION_ARCHIVE_SCHEMA_VERSION,
    archiveId,
    branchId: session.branchId,
    purpose: 'EXPOSITION' as const,
    label: 'Экспозиция' as const,
    source: session.source,
    program,
    explanations: structuredClone(program.explanations),
    audiencePolicy: policy,
    origin: structuredClone(session.origin),
    playback: structuredClone(session.playback),
    journalCursor: journal.length,
    seed: session.seed,
    rng: rngAtFrame(session, journal, atMs),
    journal,
    checkpoints,
    world: worldAtExposition(session.sourceArchive.demonstration.initialWorld, journal, atMs, session.sourceArchive.demonstration.rules.reducerVersion),
    map: projectAudienceMap(frameMap, program.layers),
    officialAssessmentCreated: false as const,
    officialAssessments: [] as never[],
  };
  return { ...unsigned, manifestHash: digest(unsigned) };
}

export function verifyExpositionDerivative(
  derivative: DerivedExpositionArchive,
  source: OfficialExpositionArchive,
): boolean {
  const { manifestHash, ...unsigned } = derivative;
  const expectedWorld = worldAtExposition(
    source.demonstration.initialWorld,
    derivative.journal,
    derivative.playback.atMs,
    source.demonstration.rules.reducerVersion,
  );
  const expectedRng = rngAtFrame({
    ...({} as ExpositionSession),
    initialRng: derivative.source === 'AUTONOMOUS' && derivative.seed !== null && derivative.journalCursor === 0
      ? { ...derivative.rng!, cursor: 0 }
      : null,
    checkpoints: derivative.checkpoints,
  } as ExpositionSession, derivative.journal, derivative.playback.atMs);
  return derivative.schemaVersion === EXPOSITION_ARCHIVE_SCHEMA_VERSION
    && derivative.archiveId.trim().length > 0
    && derivative.purpose === 'EXPOSITION'
    && derivative.label === 'Экспозиция'
    && derivative.branchId !== source.branchId
    && derivative.archiveId !== source.archiveId
    && derivative.origin.archiveId === source.archiveId
    && derivative.origin.branchId === source.branchId
    && derivative.origin.manifestHash === source.manifestHash
    && derivative.journalCursor === derivative.journal.length
    && derivative.journal.every(entry => entry.atMs <= derivative.playback.atMs)
    && derivative.checkpoints.every(checkpoint => checkpoint.atMs <= derivative.playback.atMs)
    && JSON.stringify(derivative.world) === JSON.stringify(expectedWorld)
    && JSON.stringify(derivative.rng) === JSON.stringify(expectedRng)
    && !derivative.officialAssessmentCreated
    && derivative.officialAssessments.length === 0
    && manifestHash === digest(unsigned);
}
