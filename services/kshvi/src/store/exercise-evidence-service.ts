import { randomUUID } from 'node:crypto';
import { migrate, type Migration, type Pool } from '@def-ops/db';
import {
  approveInitialMap, hashCanonical, READINESS_AREAS, REHEARSAL_CHECKS, runRehearsal, validateKit,
  type ApprovedInitialMap, type RehearsalReport, type ScenarioItem, type ScenarioKit,
} from '@def-ops/kshvi';
import type { InitialSituationMap } from '../../../../packages/kshvi/src/scenario/initial-map';
import { validateScenario, VALIDATION_AREAS, type ScenarioValidationInput, type ValidationArea, type ValidationReport } from '../../../../packages/kshvi/src/scenario/validation';
import type { EnvironmentSnapshot } from '../../../../packages/kshvi/src/environment/provider';
import type {
  ExerciseEvidenceProvider, ExerciseRevision, ExerciseSealActor, ServerExerciseEvidence,
} from './exercise-store';

export type ExerciseEnvironmentLoader = Readonly<{ load(id: string): Promise<EnvironmentSnapshot> }>;
export type ExerciseConfirmationInput = Readonly<{ expectedRevision: number; area: typeof READINESS_AREAS[number] }>;

export interface ExerciseEvidenceService extends ExerciseEvidenceProvider {
  confirm(actor: ExerciseSealActor, exerciseId: string, revision: ExerciseRevision, input: ExerciseConfirmationInput): Promise<void>;
  approveMap(actor: ExerciseSealActor, exerciseId: string, revision: ExerciseRevision, map: InitialSituationMap): Promise<ApprovedInitialMap>;
  confirmations(revision: ExerciseRevision): Promise<readonly import('@def-ops/kshvi').ReadinessConfirmation[]>;
  approvedMap(revision: ExerciseRevision): Promise<ApprovedInitialMap | null>;
}

const AREA_ITEMS: Record<ValidationArea, readonly ScenarioItem[]> = {
  STRUCTURE: ['ORGANIZATION_ORDER', 'CONCEPT'],
  COMMAND_TREE: ['LEADERSHIP_SCHEME', 'OPERATIONAL_ASSIGNMENTS'],
  ENVIRONMENT: ['MAP_SET'],
  INITIAL_MAP: ['MAP_SET'],
  TIME: ['PREPARATION_CALENDAR', 'CONDUCT_CALENDAR'],
  INPUTS: ['ESCALATION_PLAN'],
  FORCES_RESOURCES: ['OPERATIONAL_ASSIGNMENTS', 'EQUIPMENT_STATEMENT'],
  EQUIPMENT_MORALE_READINESS: ['EQUIPMENT_STATEMENT', 'READINESS_PLAN'],
  LOGISTICS_FORMATION: ['LOGISTICS_PLAN', 'FORMATION_PLAN'],
  AUTONOMY_AGENTS: ['AGENT_PROFILES', 'ELECTRONIC_INTERMEDIARIES'],
  SYMBOLS: ['MAP_SET'],
  COMMUNICATIONS: ['COMMUNICATION_PLAN'],
  DOCUMENTS: [],
  VISIBILITY: ['PRIVATE_PLANS'],
  MODEL: ['ASSUMPTION_PASSPORT'],
  RECOVERY: ['READINESS_PLAN'],
};
const CHECK_AREAS: Record<typeof REHEARSAL_CHECKS[number], readonly ValidationArea[]> = {
  RECIPIENTS: ['COMMUNICATIONS'], CHANNELS: ['COMMUNICATIONS'], QUEUE: ['COMMUNICATIONS'], BRANCHES: ['STRUCTURE'],
  VISIBILITY: ['VISIBILITY'], DOCUMENTS: ['DOCUMENTS'], RECOVERY: ['RECOVERY'], PRINT_FALLBACK: ['DOCUMENTS'],
  EVENT_STATISTICS: ['INPUTS'], CASCADE_LIMITS: ['INPUTS'], INTERMEDIARY_CYCLES: ['AUTONOMY_AGENTS'], OPPONENT: ['AUTONOMY_AGENTS'],
  MORALE_IMPACT: ['EQUIPMENT_MORALE_READINESS'], SUPPLY_ROUTES: ['LOGISTICS_FORMATION'],
};
const UNKNOWN_HASH = hashCanonical({ status: 'UNKNOWN', reason: 'Серверный артефакт не предоставлен' });

function requireRevision(revision: ExerciseRevision, expectedRevision: number): void {
  if (revision.revision !== expectedRevision) throw new Error('REVISION_CONFLICT: доказательство относится к другой редакции');
}
function requireAuthority(actor: ExerciseSealActor, authority: string): void {
  if (!actor.activeRole || !actor.authorities.includes(authority)) throw new Error(`Недостаточно полномочий: ${authority}`);
}
function subjectHash(revision: ExerciseRevision, area: typeof READINESS_AREAS[number]): string {
  return hashCanonical({ revisionId: revision.id, scenarioSha256: revision.sha256, area });
}
function kitDocumentHash(kit: ScenarioKit, item: ScenarioItem): string {
  return kit.documents?.find(document => document.item === item)?.sha256 ?? UNKNOWN_HASH;
}
function inside(inner: readonly number[], outer: readonly number[]): boolean {
  return inner.length === 4 && outer.length === 4 && inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

abstract class BaseExerciseEvidenceService implements ExerciseEvidenceService {
  protected abstract readConfirmations(revision: ExerciseRevision): Promise<readonly import('@def-ops/kshvi').ReadinessConfirmation[]>;
  protected abstract writeConfirmation(organizationId: string, exerciseId: string, revision: ExerciseRevision, value: import('@def-ops/kshvi').ReadinessConfirmation): Promise<void>;
  protected abstract readMap(revision: ExerciseRevision): Promise<ApprovedInitialMap | null>;
  protected abstract writeMap(organizationId: string, exerciseId: string, revision: ExerciseRevision, value: ApprovedInitialMap): Promise<void>;
  protected readonly environment: ExerciseEnvironmentLoader;
  protected readonly now: () => Date;

  constructor(options: { environment: ExerciseEnvironmentLoader; now?: () => Date }) {
    this.environment = options.environment;
    this.now = options.now ?? (() => new Date());
  }

  confirmations(revision: ExerciseRevision) { return this.readConfirmations(revision); }
  approvedMap(revision: ExerciseRevision) { return this.readMap(revision); }

  async confirm(actor: ExerciseSealActor, exerciseId: string, revision: ExerciseRevision, input: ExerciseConfirmationInput): Promise<void> {
    requireRevision(revision, input.expectedRevision);
    if (!READINESS_AREAS.includes(input.area)) throw new Error('Неизвестная область готовности');
    requireAuthority(actor, 'readiness.confirm');
    requireAuthority(actor, `readiness.confirm:${input.area}`);
    await this.writeConfirmation(actor.organizationId, exerciseId, revision, {
      id: randomUUID(), area: input.area, userId: actor.userId, role: actor.activeRole!, confirmedAt: this.now().toISOString(),
      subjectHash: subjectHash(revision, input.area), dependsOn: [],
    });
  }

  async approveMap(actor: ExerciseSealActor, exerciseId: string, revision: ExerciseRevision, map: InitialSituationMap): Promise<ApprovedInitialMap> {
    requireAuthority(actor, 'initialMap.approve');
    const approved = approveInitialMap(map);
    await this.writeMap(actor.organizationId, exerciseId, revision, approved);
    return approved;
  }

  private validationInput(kit: ScenarioKit, environment: EnvironmentSnapshot, initialMap: ApprovedInitialMap): ScenarioValidationInput {
    const kitIssues = validateKit(kit);
    const areas = Object.fromEntries(VALIDATION_AREAS.map(area => {
      const issues = kitIssues.filter(issue => area === 'DOCUMENTS' || AREA_ITEMS[area].includes(issue.item));
      return [area, {
        status: issues.some(issue => issue.severity === 'ERROR') ? 'INVALID' as const : 'VALID' as const,
        issues: issues.map(issue => ({ code: issue.code, severity: issue.severity, message: issue.message })),
      }];
    }));
    return {
      areas,
      environment: {
        snapshot: {
          manifestSha256: environment.manifestSha256,
          autonomy: environment.autonomy,
          weatherContentRef: environment.weather.contentRef?.path ?? null,
          elevationContentRef: environment.atlases.find(atlas => atlas.elevations.contentRef)?.elevations.contentRef?.path ?? null,
        },
        expectedManifestSha256: initialMap.environment.manifestSha256,
        coverageComplete: inside(initialMap.environment.bounds, environment.region.bounds),
        atlasesAvailable: environment.atlases.length > 0,
        attributionComplete: environment.atlases.every(atlas => atlas.attribution.trim().length > 0) && environment.weather.attribution.trim().length > 0,
        elevationComplete: environment.atlases.every(atlas => atlas.elevations.contentRef !== null),
        weatherIntervalComplete: environment.weather.contentRef !== null,
        weatherQuality: environment.weather.contentRef
          ? { status: 'OK', reason: 'KNOWN' }
          : { status: 'NO_DATA', reason: 'MISSING_CONTENT' },
      },
      initialMap,
    };
  }

  private async rehearsal(revision: ExerciseRevision, validation: ValidationReport): Promise<{ report: RehearsalReport; officialEventLogId: string }> {
    const officialEventLogId = `official-log-${revision.id}`;
    const rehearsalId = `rehearsal-${revision.id}-${randomUUID()}`;
    const eventLogId = `rehearsal-log-${rehearsalId}`;
    const report = await runRehearsal({
      scenario: revision.payload, officialEventLogId, rehearsalId, eventLogId,
    }, async isolated => {
      if (isolated.mode !== 'REHEARSAL' || isolated.eventLogId !== eventLogId || isolated.scenario === revision.payload) {
        throw new Error('REHEARSAL_ISOLATION_REQUIRED');
      }
      const checks = Object.fromEntries(REHEARSAL_CHECKS.map(check => [check, CHECK_AREAS[check].every(area =>
        !validation.issues.some(issue => issue.area === area && issue.severity === 'ERROR'),
      )]));
      return {
        status: Object.values(checks).every(Boolean) ? 'PASSED' as const : 'FAILED' as const,
        eventLogId,
        checks,
      };
    });
    return { report, officialEventLogId };
  }

  async forRevision({ revision }: Parameters<ExerciseEvidenceProvider['forRevision']>[0]): Promise<ServerExerciseEvidence> {
    const payload = revision.payload && typeof revision.payload === 'object' && !Array.isArray(revision.payload)
      ? revision.payload as Record<string, unknown> : {};
    const initialMap = await this.readMap(revision);
    if (!initialMap) throw new Error('INITIAL_MAP_NOT_APPROVED: карта не утверждена серверным действием');
    if (typeof payload.environmentSnapshotId !== 'string') throw new Error('ENVIRONMENT_SNAPSHOT_REQUIRED');
    const environment = await this.environment.load(payload.environmentSnapshotId);
    if (initialMap.environment.snapshotId !== environment.id || initialMap.environment.manifestSha256 !== environment.manifestSha256) {
      throw new Error('ENVIRONMENT_HASH_INVALID: карта не связана с серверным снимком среды');
    }
    const kit = payload.kit as ScenarioKit;
    const validation = this.validationInput(kit, environment, initialMap);
    const report = validateScenario(validation);
    const rehearsal = await this.rehearsal(revision, report);
    const confirmations = await this.readConfirmations(revision);
    return {
      validation,
      confirmations: [...confirmations],
      confirmationSubjects: Object.fromEntries(READINESS_AREAS.map(area => [area, subjectHash(revision, area)])),
      rehearsal: rehearsal.report,
      initialMap,
      environmentSnapshot: {
        manifestSha256: environment.manifestSha256,
        contentRef: environment.weather.contentRef?.path ?? environment.atlases.find(atlas => atlas.export.contentRef)?.export.contentRef?.path ?? '',
        autonomous: environment.autonomy === 'COMPLETE',
      },
      expectedEnvironmentSha256: environment.manifestSha256,
      officialEventLogId: rehearsal.officialEventLogId,
      hashes: {
        weather: environment.weather.contentRef?.sha256 ?? UNKNOWN_HASH,
        elevation: environment.atlases.find(atlas => atlas.elevations.sha256)?.elevations.sha256 ?? UNKNOWN_HASH,
        symbols: initialMap.symbolSet.sha256,
        agents: kitDocumentHash(kit, 'AGENT_PROFILES'),
        eventLibrary: kitDocumentHash(kit, 'ESCALATION_PLAN'),
        models: kitDocumentHash(kit, 'ASSUMPTION_PASSPORT'),
        roles: kitDocumentHash(kit, 'LEADERSHIP_SCHEME'),
        communications: kitDocumentHash(kit, 'COMMUNICATION_PLAN'),
        documents: hashCanonical(kit.documents ?? []),
        rehearsal: hashCanonical(rehearsal.report),
      },
    };
  }
}

export class InMemoryExerciseEvidenceService extends BaseExerciseEvidenceService {
  private readonly confirmationRecords = new Map<string, import('@def-ops/kshvi').ReadinessConfirmation[]>();
  private readonly mapRecords = new Map<string, ApprovedInitialMap>();
  protected async readConfirmations(revision: ExerciseRevision) { return structuredClone(this.confirmationRecords.get(revision.id) ?? []); }
  protected async writeConfirmation(_organizationId: string, _exerciseId: string, revision: ExerciseRevision, value: import('@def-ops/kshvi').ReadinessConfirmation) {
    const current = this.confirmationRecords.get(revision.id) ?? [];
    this.confirmationRecords.set(revision.id, [...current.filter(item => item.area !== value.area), structuredClone(value)]);
  }
  protected async readMap(revision: ExerciseRevision) { return structuredClone(this.mapRecords.get(revision.id) ?? null); }
  protected async writeMap(_organizationId: string, _exerciseId: string, revision: ExerciseRevision, value: ApprovedInitialMap) {
    this.mapRecords.set(revision.id, structuredClone(value));
  }
}

export const KSHVI_EVIDENCE_MIGRATIONS: Migration[] = [{
  id: 6,
  name: 'exercise-server-evidence',
  sql: await import('node:fs').then(fs => fs.readFileSync(new URL('./migrations/006-exercise-evidence.sql', import.meta.url), 'utf8')),
}];

export class PgExerciseEvidenceService extends BaseExerciseEvidenceService {
  constructor(private readonly options: { pool: Pool; schema: string; environment: ExerciseEnvironmentLoader; now?: () => Date }) {
    super(options);
    if (!/^[a-z_][a-z0-9_]*$/.test(options.schema)) throw new Error('Недопустимое имя схемы КШВИ');
  }
  async init(): Promise<void> { await migrate(this.options.pool, this.options.schema, KSHVI_EVIDENCE_MIGRATIONS); }
  protected async readConfirmations(revision: ExerciseRevision) {
    const result = await this.options.pool.query(
      `select id, area, user_id, role, confirmed_at, subject_hash, depends_on from ${this.options.schema}.exercise_readiness_confirmations where revision_id=$1 order by area`,
      [revision.id],
    );
    return result.rows.map(row => ({
      id: row.id, area: row.area, userId: row.user_id, role: row.role,
      confirmedAt: new Date(row.confirmed_at).toISOString(), subjectHash: row.subject_hash, dependsOn: row.depends_on,
    }));
  }
  protected async writeConfirmation(organizationId: string, exerciseId: string, revision: ExerciseRevision, value: import('@def-ops/kshvi').ReadinessConfirmation) {
    await this.options.pool.query(
      `insert into ${this.options.schema}.exercise_readiness_confirmations
       (organization_id, exercise_id, revision_id, area, id, user_id, role, confirmed_at, subject_hash, depends_on)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (organization_id, revision_id, area) do update set id=excluded.id, user_id=excluded.user_id, role=excluded.role,
       confirmed_at=excluded.confirmed_at, subject_hash=excluded.subject_hash, depends_on=excluded.depends_on`,
      [organizationId, exerciseId, revision.id, value.area, value.id, value.userId, value.role, value.confirmedAt, value.subjectHash, JSON.stringify(value.dependsOn)],
    );
  }
  protected async readMap(revision: ExerciseRevision) {
    const result = await this.options.pool.query(
      `select map from ${this.options.schema}.exercise_approved_maps where revision_id=$1`,
      [revision.id],
    );
    return result.rows[0]?.map ? structuredClone(result.rows[0].map) as ApprovedInitialMap : null;
  }
  protected async writeMap(organizationId: string, exerciseId: string, revision: ExerciseRevision, value: ApprovedInitialMap) {
    await this.options.pool.query(
      `insert into ${this.options.schema}.exercise_approved_maps (organization_id, exercise_id, revision_id, map) values ($1,$2,$3,$4)
       on conflict (organization_id, revision_id) do update set map=excluded.map`,
      [organizationId, exerciseId, revision.id, JSON.stringify(value)],
    );
  }
}
