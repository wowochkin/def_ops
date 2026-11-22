import { createHash } from 'node:crypto';
import { createAudiencePolicy, type AudiencePolicy } from '../../../../packages/kshvi/src/exposition/audience-policy';
import type {
  ExpositionSession,
  OfficialExpositionArchive,
} from '../../../../packages/kshvi/src/exposition/exposition-session';

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
  if (archiveId === session.sourceArchive.archiveId) {
    throw new Error('Производный архив не может повторять идентификатор официального архива');
  }
  const unsigned = {
    schemaVersion: EXPOSITION_ARCHIVE_SCHEMA_VERSION,
    archiveId,
    branchId: session.branchId,
    purpose: 'EXPOSITION' as const,
    label: 'Экспозиция' as const,
    source: session.source,
    program: structuredClone(session.program),
    explanations: structuredClone(session.program.explanations),
    audiencePolicy: createAudiencePolicy(input.policy),
    origin: structuredClone(session.origin),
    seed: session.seed,
    rng: structuredClone(session.rng),
    journal: structuredClone(session.journal),
    checkpoints: structuredClone(session.checkpoints),
    world: structuredClone(session.world),
    map: structuredClone(session.map),
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
  return derivative.schemaVersion === EXPOSITION_ARCHIVE_SCHEMA_VERSION
    && derivative.purpose === 'EXPOSITION'
    && derivative.label === 'Экспозиция'
    && derivative.branchId !== source.branchId
    && derivative.archiveId !== source.archiveId
    && derivative.origin.archiveId === source.archiveId
    && derivative.origin.branchId === source.branchId
    && derivative.origin.manifestHash === source.manifestHash
    && !derivative.officialAssessmentCreated
    && derivative.officialAssessments.length === 0
    && manifestHash === digest(unsigned);
}
