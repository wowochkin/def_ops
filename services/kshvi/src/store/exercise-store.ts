import { atlasCoversBounds } from '../../../../packages/kshvi/src/environment/provider';
import { hasTruthAccess } from './exercise-projection';
import { createHash, randomUUID } from 'node:crypto';
import { createPool, migrate, tx, type Client, type Migration, type Pool } from '@def-ops/db';
import {
  canonicalJson, READINESS_AREAS, REQUIRED_SCENARIO_ITEMS, sealScenario, transitionLifecycle, validateKit, validatePreparationDraft,
  type JsonValue, type ScenarioKit, type SealScenarioInput, type SealedScenario,
} from '@def-ops/kshvi';
import { validateScenario, type ScenarioValidationInput } from '../../../../packages/kshvi/src/scenario/validation';
import type { ApprovedInitialMap } from '../../../../packages/kshvi/src/scenario/initial-map';
import type { ReadinessConfirmation } from '../../../../packages/kshvi/src/scenario/sealing';
import { bindEnvironmentToDraft, checkedEnvironmentBounds, environmentChangeSource, inspectEnvironmentChange, revisionEnvironmentId,
  type EnvironmentImpact, type EnvironmentImpactInput, type ReplaceEnvironmentInput } from './environment-revision';
import type { ExerciseEnvironmentLoader } from './exercise-evidence-service';

export type ExercisePurpose = 'planned' | 'special' | 'inspection' | 'research' | 'exposition' | 'custom';
export type ExerciseScale = 'tactical' | 'operational' | 'strategic' | 'custom';
export type ExerciseState = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SEALED' | 'CANCELLED' | 'ARCHIVED';
export type ExerciseValidation = 'NOT_RUN' | 'OK' | 'WARNING' | 'ERROR';
export type ExerciseActor = Readonly<{
  organizationId: string; userId: string; activeRole?: string | null; authorities?: readonly string[];
}>;
export type ExerciseSealActor = ExerciseActor & Readonly<{ activeRole: string | null; authorities: readonly string[] }>;
export type ExercisePayloadAccess = 'FULL' | 'PROJECTED';

export type ExerciseSummary = Readonly<{
  id: string;
  title: string;
  purpose: ExercisePurpose;
  scale: ExerciseScale;
  state: ExerciseState;
  revision: number;
  ownerId: string;
  startsAt: string | null;
  endsAt: string | null;
  readiness: number;
  validation: ExerciseValidation;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  lastSessionId: string | null;
  lastSessionState?: ExerciseSession['state'] | null;
}>;

export type ExerciseRevision = Readonly<{
  id: string;
  exerciseId: string;
  revision: number;
  payload: JsonValue;
  sha256: string;
  state: Exclude<ExerciseState, 'ARCHIVED'>;
  sealedArtifact?: SealedScenario;
  truthOnlyPayload?: true;
  createdBy: string;
  createdAt: string;
  supersedesId: string | null;
}>;

export type ExerciseSession = Readonly<{
  id: string;
  exerciseId: string;
  scenarioRevisionId: string;
  revision: number;
  state: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABORTED' | 'ARCHIVED';
  mode: 'NETWORK';
  authority: 'SERVER';
  confirmedRevision: number;
  createdBy: string;
  createdAt: string;
}>;

export type ExerciseCard = ExerciseSummary & Readonly<{
  revisions: readonly ExerciseRevision[];
  sessions: readonly ExerciseSession[];
}>;

export type CreateExerciseInput = Readonly<{
  title: string;
  purpose: ExercisePurpose;
  scale: ExerciseScale;
  startsAt?: string | null;
  endsAt?: string | null;
  payload?: JsonValue;
}>;

export type CreateRevisionInput = Readonly<{
  expectedRevision: number;
  title?: string;
  purpose?: ExercisePurpose;
  scale?: ExerciseScale;
  startsAt?: string | null;
  endsAt?: string | null;
  state?: Exclude<ExerciseState, 'ARCHIVED'>;
  readiness?: number;
  validation?: ExerciseValidation;
  payload?: JsonValue;
}>;

export type SavePreparationInput = Readonly<{ expectedRevision: number; draft: JsonValue }>;

export type ServerExerciseEvidence = Omit<SealScenarioInput,
  'id' | 'revision' | 'state' | 'scenario' | 'issues' | 'requiredConfirmations' | 'sealedAt'
> & Readonly<{ validation: ScenarioValidationInput }>;
export type ExerciseSealInput = Readonly<{ expectedRevision: number }>;
export type ExerciseEvidenceContext = Readonly<{
  actor: ExerciseActor;
  exerciseId: string;
  revision: ExerciseRevision;
}>;
export interface ExerciseEvidenceProvider {
  /** Внутренний серверный порт: HTTP-клиент не может подставить готовые доказательства. */
  forRevision(context: ExerciseEvidenceContext): Promise<ServerExerciseEvidence>;
  confirmations?(revision: ExerciseRevision, db?: Client): Promise<readonly ReadinessConfirmation[]>;
  approvedMap?(revision: ExerciseRevision, db?: Client): Promise<ApprovedInitialMap | null>;
  hasEnvironmentEvidence?(revision: ExerciseRevision, db?: Client): Promise<boolean>;
}
export type ExerciseStoreOptions = Readonly<{
  now?: () => Date;
  evidence?: ExerciseEvidenceProvider;
  environment?: ExerciseEnvironmentLoader;
}>;
export type ExerciseLifecycleInput = Readonly<{ expectedRevision: number; command: 'SUBMIT' | 'APPROVE' }>;

export type ExerciseFilters = Readonly<{
  query?: string;
  state?: ExerciseState;
  scale?: ExerciseScale;
  purpose?: ExercisePurpose;
  includeArchived?: boolean;
}>;

export type CreateSessionInput = Readonly<{
  revision: number;
  /** Черновик клиента принимается только как транспортный шум и никогда не становится официальным миром. */
  optimisticWorld?: unknown;
}>;

export type SessionCommand = 'PAUSE' | 'RESUME' | 'PRIVATE_STOP' | 'GENERAL_STOP' | 'JUMP' | 'COMPLETE' | 'ABORT';
export type TransitionSessionInput = Readonly<{
  expectedRevision: number;
  command: SessionCommand;
  idempotencyKey: string;
}>;
export type SessionCommandRecord = Readonly<{
  sessionId: string;
  command: SessionCommand;
  idempotencyKey: string;
  confirmedRevision: number;
  state: ExerciseSession['state'];
  createdAt: string;
}>;

export interface ExerciseStore {
  create(actor: ExerciseActor, input: CreateExerciseInput, access?: ExercisePayloadAccess): Promise<ExerciseCard>;
  list(organizationId: string, filters: ExerciseFilters): Promise<readonly ExerciseSummary[]>;
  get(organizationId: string, exerciseId: string): Promise<ExerciseCard | null>;
  copy(actor: ExerciseActor, exerciseId: string, title?: string): Promise<ExerciseCard>;
  archive(actor: ExerciseActor, exerciseId: string, expectedRevision: number): Promise<ExerciseCard>;
  createRevision(actor: ExerciseActor, exerciseId: string, input: CreateRevisionInput, access?: ExercisePayloadAccess): Promise<ExerciseCard>;
  savePreparation(actor: ExerciseActor, exerciseId: string, input: SavePreparationInput, access?: ExercisePayloadAccess): Promise<ExerciseCard>;
  replaceEnvironment(actor: ExerciseActor, exerciseId: string, input: ReplaceEnvironmentInput, access?: ExercisePayloadAccess): Promise<ExerciseCard>;
  environmentImpact(actor: ExerciseActor, exerciseId: string, input: EnvironmentImpactInput, access?: ExercisePayloadAccess): Promise<EnvironmentImpact>;
  transition(actor: ExerciseSealActor, exerciseId: string, input: ExerciseLifecycleInput): Promise<ExerciseCard>;
  seal(actor: ExerciseSealActor, exerciseId: string, input: ExerciseSealInput): Promise<ExerciseCard>;
  createSession(actor: ExerciseActor, exerciseId: string, input: CreateSessionInput): Promise<ExerciseSession>;
  transitionSession(actor: ExerciseActor, exerciseId: string, sessionId: string, input: TransitionSessionInput): Promise<ExerciseSession>;
  listSessionCommands(organizationId: string, exerciseId: string, sessionId: string): Promise<readonly SessionCommandRecord[]>;
  getSession(organizationId: string, exerciseId: string, sessionId: string): Promise<ExerciseSession | null>;
  listSessions(organizationId: string, exerciseId: string): Promise<readonly ExerciseSession[]>;
}

export type ExerciseStoreErrorCode = 'NOT_FOUND' | 'REVISION_NOT_FOUND' | 'REVISION_CONFLICT' | 'ARCHIVED' | 'VALIDATION'
  | 'SERVER_ASSESSMENT_REQUIRED' | 'SEALED_REQUIRED' | 'FORBIDDEN' | 'ENVIRONMENT_TRUTH_REQUIRED';
export class ExerciseStoreError extends Error {
  constructor(readonly code: ExerciseStoreErrorCode, message: string) { super(message); }
}

export const KSHVI_EXERCISE_MIGRATIONS: Migration[] = [{
  id: 3,
  name: 'exercise-library',
  sql: await import('node:fs').then(fs => fs.readFileSync(new URL('./migrations/003-exercises.sql', import.meta.url), 'utf8')),
}, {
  id: 4,
  name: 'exercise-session-commands',
  sql: await import('node:fs').then(fs => fs.readFileSync(new URL('./migrations/004-session-commands.sql', import.meta.url), 'utf8')),
}, {
  id: 5,
  name: 'exercise-sealed-artifacts',
  sql: await import('node:fs').then(fs => fs.readFileSync(new URL('./migrations/005-sealed-artifacts.sql', import.meta.url), 'utf8')),
}, {
  id: 8,
  name: 'exercise-truth-payload',
  sql: await import('node:fs').then(fs => fs.readFileSync(new URL('./migrations/008-exercise-truth-payload.sql', import.meta.url), 'utf8')),
}];

const purposes = new Set<ExercisePurpose>(['planned', 'special', 'inspection', 'research', 'exposition', 'custom']);
const scales = new Set<ExerciseScale>(['tactical', 'operational', 'strategic', 'custom']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(code: ExerciseStoreErrorCode, message: string): never { throw new ExerciseStoreError(code, message); }
function clone<T>(value: T): T { return structuredClone(value); }
function digest(payload: JsonValue): string { return createHash('sha256').update(canonicalJson(payload)).digest('hex'); }
function instant(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function checkDate(value: string | null | undefined, label: string): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('VALIDATION', `Укажите корректную дату: ${label}`);
}
function assessmentOf(payload: JsonValue): { readiness: number; validation: ExerciseValidation } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !('kit' in payload)) {
    return { readiness: 0, validation: 'NOT_RUN' };
  }
  const kit = payload.kit as unknown as ScenarioKit;
  if (!kit || typeof kit !== 'object' || !Array.isArray(kit.items) || !Array.isArray(kit.omissions)) {
    return { readiness: 0, validation: 'ERROR' };
  }
  const present = new Set(kit.items.filter(item => item?.present).map(item => item.item));
  const readiness = Math.floor(100 * REQUIRED_SCENARIO_ITEMS.filter(item => present.has(item)).length / REQUIRED_SCENARIO_ITEMS.length);
  const issues = validateKit(kit);
  return {
    readiness,
    validation: issues.some(issue => issue.severity === 'ERROR') ? 'ERROR' : issues.length ? 'WARNING' : 'OK',
  };
}
function validateRevisionInput(input: CreateRevisionInput): void {
  if (!input || typeof input !== 'object') fail('VALIDATION', 'Проверьте данные учения');
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) fail('VALIDATION', 'Укажите ожидаемую редакцию');
  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim())) fail('VALIDATION', 'Введите название учения');
  if (input.purpose !== undefined && !purposes.has(input.purpose)) fail('VALIDATION', 'Выберите назначение учения');
  if (input.scale !== undefined && !scales.has(input.scale)) fail('VALIDATION', 'Выберите масштаб учения');
  if (input.state !== undefined || input.readiness !== undefined || input.validation !== undefined) {
    fail('SERVER_ASSESSMENT_REQUIRED', 'Состояние, готовность и результат проверки устанавливаются только сервером');
  }
  checkDate(input.startsAt, 'начало');
  checkDate(input.endsAt, 'окончание');
}
function preparationOf(payload: JsonValue | undefined): JsonValue | undefined {
  return payload && typeof payload === 'object' && !Array.isArray(payload) && Object.hasOwn(payload, 'preparation')
    ? payload.preparation
    : undefined;
}
function requirePreparationAccess(access: ExercisePayloadAccess | undefined): void {
  if (access !== 'FULL') fail('FORBIDDEN', 'Изменение черновика требует доступа к полной редакции учения');
}
function requireTruthAccess(actor: ExerciseActor): void {
  if (!hasTruthAccess(actor)) fail('FORBIDDEN', 'Для изменения закрытой редакции нужен доступ к истинной обстановке');
}

function requireWritableRevision(
  actor: ExerciseActor, card: ExerciseCard, expectedRevision: number, payload: JsonValue | undefined,
  access: ExercisePayloadAccess | undefined, operation?: PreparationOperation,
): ExerciseRevision {
  if (card.state === 'ARCHIVED') fail('ARCHIVED', 'Архивное учение нельзя изменить');
  if (card.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
  const previous = card.revisions.find(revision => revision.revision === card.revision)!;
  if (previous.truthOnlyPayload) requireTruthAccess(actor);
  const hasPreparation = preparationOf(previous.payload) !== undefined || preparationOf(payload) !== undefined;
  if (operation?.kind === 'replace-environment') {
    if (!['DRAFT', 'IN_REVIEW', 'APPROVED', 'SEALED'].includes(card.state)) fail('VALIDATION', 'Рабочую редакцию в этом состоянии создать нельзя');
    requirePreparationAccess(access);
  } else if (card.state === 'SEALED' && (operation || hasPreparation)) {
    fail('FORBIDDEN', 'Черновик подготовки запечатанного учения нельзя сохранить');
  }
  if (payload != null && hasPreparation) requirePreparationAccess(access);
  return previous;
}
function mergePreparation(payload: JsonValue, draft: JsonValue): JsonValue {
  if (draft === undefined) fail('VALIDATION', 'Укажите черновик подготовки');
  if (payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
    fail('VALIDATION', 'Содержимое редакции должно быть объектом для сохранения подготовки');
  }
  return { ...payload, preparation: draft };
}
type PreparationOperation =
  | Readonly<{ kind: 'save'; input: SavePreparationInput }>
  | Readonly<{ kind: 'replace-environment'; input: ReplaceEnvironmentInput }>;

async function environmentSourceFor(actor: ExerciseActor, revision: ExerciseRevision, environment?: ExerciseEnvironmentLoader,
  evidence?: ExerciseEvidenceProvider, db?: Client) {
  const readTruth = hasTruthAccess(actor);
  if (!readTruth) {
    if (revision.truthOnlyPayload) requireTruthAccess(actor);
    const hasClosedEvidence = revision.state === 'SEALED' || revision.sealedArtifact
      || (await evidence?.hasEnvironmentEvidence?.(revision, db) ?? Boolean(evidence?.approvedMap || evidence?.confirmations));
    if (hasClosedEvidence) fail('ENVIRONMENT_TRUTH_REQUIRED', 'Для просмотра последствий и смены среды этой редакции нужен доступ к истинной обстановке');
  }
  const source = await environmentChangeSource(revision, readTruth ? evidence : undefined, db);
  if (source.approvedMap && source.map) {
    const snapshotId = revisionEnvironmentId(revision);
    const mapEnvironment = source.map.environment;
    const snapshot = snapshotId && snapshotId === mapEnvironment.snapshotId ? await environment?.load(snapshotId).catch(() => null) : null;
    if (!snapshot || snapshot.id !== snapshotId || snapshot.manifestSha256 !== mapEnvironment.manifestSha256
      || !atlasCoversBounds(snapshot.region.bounds, mapEnvironment.bounds)) {
      fail('VALIDATION', 'Утверждённая исходная карта не связана со снимком среды текущей редакции');
    }
  }
  return source;
}

async function checkedEnvironmentImpact(actor: ExerciseActor, card: ExerciseCard, input: EnvironmentImpactInput,
  environment?: ExerciseEnvironmentLoader, evidence?: ExerciseEvidenceProvider): Promise<EnvironmentImpact> {
  validateRevisionInput({ expectedRevision: input.expectedRevision });
  const revision = card.revisions.find(item => item.revision === input.expectedRevision);
  if (card.revision !== input.expectedRevision || !revision) fail('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
  try {
    return inspectEnvironmentChange(await environmentSourceFor(actor, revision, environment, evidence), checkedEnvironmentBounds(input.bounds));
  } catch (error) {
    if (error instanceof ExerciseStoreError) throw error;
    fail('VALIDATION', error instanceof Error ? error.message : 'Не удалось проверить смену среды');
  }
}

type RevisionChange = Readonly<{ payload?: JsonValue; truthOnlyPayload?: true }>;

async function changedRevisionPayload(actor: ExerciseActor, previous: ExerciseRevision, payload: JsonValue | undefined,
  operation: PreparationOperation | undefined, environment: ExerciseEnvironmentLoader | undefined, evidence: ExerciseEvidenceProvider | undefined,
  db?: Client): Promise<RevisionChange> {
  const { truthOnlyPayload } = previous;
  if (!operation) return { payload, truthOnlyPayload };
  if (operation.kind === 'save') return { payload: mergePreparation(previous.payload, operation.input.draft), truthOnlyPayload };
  const source = await environmentSourceFor(actor, previous, environment, evidence, db);
  const { snapshotId } = operation.input;
  if (typeof snapshotId !== 'string' || !/^[a-f0-9]{64}$/.test(snapshotId)) fail('VALIDATION', 'Укажите действительный снимок среды');
  if (snapshotId === revisionEnvironmentId(previous)) fail('VALIDATION', 'Снимок среды уже связан с текущей редакцией');
  const snapshot = await environment?.load(snapshotId).catch(() => null);
  if (!snapshot || snapshot.id !== snapshotId) fail('VALIDATION', 'Не найден действительный снимок среды');
  const { missingForceIds, missingInstanceIds } = inspectEnvironmentChange(source, snapshot.region.bounds);
  const unresolved = [
    ...(missingForceIds.length ? [`отсутствуют силы: ${missingForceIds.join(', ')}`] : []),
    ...(missingInstanceIds.length ? [`не найдены экземпляры участников: ${missingInstanceIds.join(', ')}`] : []),
  ];
  if (unresolved.length) fail('VALIDATION', `Для переноса исходной карты ${unresolved.join('. ')}`);
  const merged = mergePreparation(previous.payload, bindEnvironmentToDraft(source.draft, snapshot, source.map) as unknown as JsonValue);
  const { environmentSnapshotId: _legacy, ...nested } = merged as Record<string, JsonValue>;
  return { payload: nested, truthOnlyPayload: truthOnlyPayload || (source.approvedMap ? true : undefined) };
}

async function preparationPayload(payload: JsonValue, environment?: ExerciseEnvironmentLoader, updatedAt?: string): Promise<JsonValue> {
  const preparation = preparationOf(payload);
  if (preparation === undefined) return payload;
  let draft: ReturnType<typeof validatePreparationDraft>;
  try {
    draft = validatePreparationDraft(preparation);
  } catch (error) {
    fail('VALIDATION', error instanceof Error ? error.message : 'Некорректный черновик подготовки');
  }
  if (draft.initialMapStatus === 'APPROVED') fail('SERVER_ASSESSMENT_REQUIRED', 'Исходная карта утверждается серверным действием');
  if (draft.environmentSnapshotId !== null) {
    const snapshot = await environment?.load(draft.environmentSnapshotId).catch(() => null);
    if (!snapshot || snapshot.id !== draft.environmentSnapshotId) fail('VALIDATION', 'Не найден действительный снимок среды');
    const map = draft.initialMap;
    if (map && (map.environment.manifestSha256 !== snapshot.manifestSha256
      || !map.environment.bounds.every((coordinate, index) => coordinate === snapshot.region.bounds[index]))) {
      fail('VALIDATION', 'Хеш или границы исходной карты не совпадают со снимком среды');
    }
  }
  if (updatedAt === undefined) return payload;
  return { ...payload as Record<string, JsonValue>, preparation: { ...preparation as Record<string, JsonValue>, updatedAt } };
}
function validateSealActor(actor: ExerciseSealActor): void {
  if (!actor.organizationId || actor.activeRole !== 'DIRECTOR' || !actor.authorities.includes('scenario.seal')) {
    fail('FORBIDDEN', 'Недостаточно полномочий для запечатывания сценария');
  }
}
function validateSealInput(input: ExerciseSealInput): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'Проверьте данные запечатывания');
  const unknown = Object.keys(input).filter(key => key !== 'expectedRevision');
  if (unknown.length) fail('VALIDATION', `Тело запечатывания содержит недопустимые поля: ${unknown.sort().join(', ')}`);
  validateRevisionInput({ expectedRevision: input.expectedRevision });
}
function revisionForSeal(record: ExerciseCard, expectedRevision: number): ExerciseRevision {
  if (record.state === 'ARCHIVED' || record.archivedAt !== null) fail('ARCHIVED', 'Архивное учение нельзя запечатать');
  if (record.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
  const revision = record.revisions.find(item => item.revision === record.revision);
  if (!revision) fail('REVISION_NOT_FOUND', 'Текущая редакция сценария не найдена');
  const assessment = assessmentOf(revision.payload);
  if (assessment.readiness !== 100 || assessment.validation !== 'OK') {
    fail('VALIDATION', 'Запечатать можно только редакцию с готовностью 100 и результатом проверки OK');
  }
  return revision;
}
async function sealedArtifactFor(
  actor: ExerciseActor,
  exerciseId: string,
  record: ExerciseCard,
  revision: ExerciseRevision,
  evidence: ExerciseEvidenceProvider | undefined,
  sealedAt: string,
): Promise<SealedScenario> {
  if (record.state !== 'APPROVED' || revision.state !== 'APPROVED') {
    fail('SEALED_REQUIRED', 'APPROVED_REQUIRED: запечатать можно только утверждённую текущую редакцию');
  }
  if (preparationOf(revision.payload) !== undefined) {
    fail('VALIDATION', 'Редакцию с черновиком подготовки пока нельзя запечатать: серверная проверка этой схемы недоступна');
  }
  try {
    if (!evidence) throw new Error('SERVER_EVIDENCE_REQUIRED: не настроен внутренний источник доказательств готовности');
    const input = await evidence.forRevision({ actor, exerciseId, revision: clone(revision) });
    const validation = validateScenario(input.validation);
    const sealed = sealScenario({
      id: revision.id,
      revision: revision.revision,
      state: 'APPROVED',
      scenario: revision.payload,
      issues: validation.issues.map(issue => ({ ...issue })),
      requiredConfirmations: [...READINESS_AREAS],
      confirmations: input.confirmations,
      confirmationSubjects: input.confirmationSubjects,
      warningAcceptances: input.warningAcceptances,
      rehearsal: input.rehearsal,
      initialMap: input.initialMap,
      environmentSnapshot: input.environmentSnapshot,
      expectedEnvironmentSha256: input.expectedEnvironmentSha256,
      officialEventLogId: input.officialEventLogId,
      hashes: input.hashes,
      sealedAt,
    });
    if (sealed.scenarioSha256 !== revision.sha256) fail('VALIDATION', 'SCENARIO_HASH_INVALID: хеш не совпадает с текущей серверной редакцией');
    return sealed;
  } catch (error) {
    if (error instanceof ExerciseStoreError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    fail('VALIDATION', `Предусловия запечатывания не выполнены: ${message}`);
  }
}
async function verifiedSealedArtifact(
  actor: ExerciseActor,
  exerciseId: string,
  record: ExerciseCard,
  revision: ExerciseRevision,
  evidence: ExerciseEvidenceProvider | undefined,
): Promise<SealedScenario> {
  const artifact = revision.sealedArtifact;
  if (record.state !== 'SEALED' || record.revision !== revision.revision || revision.state !== 'SEALED') {
    fail('SEALED_REQUIRED', 'Сеанс можно создать только из текущей редакции SEALED');
  }
  if (!artifact) fail('SEALED_REQUIRED', 'SEALED_ARTIFACT_INVALID: серверный артефакт запечатывания отсутствует');
  try {
    const candidateRecord = { ...record, state: 'APPROVED' as const };
    const candidateRevision = { ...revision, state: 'APPROVED' as const, sealedArtifact: undefined };
    const reconstructed = await sealedArtifactFor(actor, exerciseId, candidateRecord, candidateRevision, evidence, artifact.sealedAt);
    if (artifact.id !== revision.id || artifact.revision !== revision.revision || canonicalJson(reconstructed) !== canonicalJson(artifact)) {
      throw new Error('артефакт не совпадает с заново вычисленными серверными доказательствами');
    }
    return artifact;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail('SEALED_REQUIRED', `SEALED_ARTIFACT_INVALID: ${message}`);
  }
}
function lifecycleState(actor: ExerciseSealActor, record: ExerciseCard, input: ExerciseLifecycleInput): Exclude<ExerciseState, 'ARCHIVED'> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VALIDATION', 'Проверьте данные перехода');
  const unknown = Object.keys(input).filter(key => !['expectedRevision', 'command'].includes(key));
  if (unknown.length) fail('VALIDATION', `Тело перехода содержит недопустимые поля: ${unknown.sort().join(', ')}`);
  validateRevisionInput({ expectedRevision: input.expectedRevision });
  if (!actor.authorities.includes('exercise:revise')) fail('FORBIDDEN', 'Недостаточно полномочий для изменения жизненного цикла');
  if (record.state === 'ARCHIVED' || record.archivedAt !== null) fail('ARCHIVED', 'Архивное учение нельзя изменить');
  if (record.revision !== input.expectedRevision) fail('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
  const revision = record.revisions.find(item => item.revision === record.revision);
  if (!revision) fail('REVISION_NOT_FOUND', 'Текущая редакция сценария не найдена');
  if (revision.state !== record.state) fail('REVISION_CONFLICT', 'Состояние карточки и текущей редакции не совпадает');
  try {
    return transitionLifecycle(record.state, input.command, { serverCommand: true, role: actor.activeRole ?? '' }) as Exclude<ExerciseState, 'ARCHIVED'>;
  } catch {
    fail('FORBIDDEN', 'Переход жизненного цикла недоступен для текущего состояния и роли');
  }
}
function validateCreate(input: CreateExerciseInput): void {
  if (!input || typeof input !== 'object') fail('VALIDATION', 'Проверьте данные учения');
  validateRevisionInput({ ...input, expectedRevision: 1 });
  if (typeof input.title !== 'string' || !input.title.trim()) fail('VALIDATION', 'Введите название учения');
  if (!purposes.has(input.purpose)) fail('VALIDATION', 'Выберите назначение учения');
  if (!scales.has(input.scale)) fail('VALIDATION', 'Выберите масштаб учения');
  if (input.startsAt && input.endsAt && Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    fail('VALIDATION', 'Окончание должно следовать за началом');
  }
}
function validateCopyTitle(title: unknown): void {
  if (title !== undefined && typeof title !== 'string') fail('VALIDATION', 'Название копии должно быть строкой');
}
function validateSessionInput(input: CreateSessionInput): void {
  if (!input || typeof input !== 'object') fail('VALIDATION', 'Проверьте данные сеанса');
  validateRevisionInput({ expectedRevision: input.revision });
}
function nextSessionState(current: ExerciseSession['state'], command: SessionCommand): ExerciseSession['state'] {
  if (current === 'COMPLETED' || current === 'ABORTED' || current === 'ARCHIVED') fail('REVISION_CONFLICT', 'Завершённый сеанс нельзя изменить');
  if (command === 'COMPLETE') return 'COMPLETED';
  if (command === 'ABORT') return 'ABORTED';
  if (command === 'JUMP') return current;
  if (command === 'RESUME') {
    if (current !== 'PAUSED') fail('REVISION_CONFLICT', 'Продолжить можно только приостановленный сеанс');
    return 'ACTIVE';
  }
  if (command === 'PAUSE' || command === 'PRIVATE_STOP' || command === 'GENERAL_STOP') {
    if (current !== 'ACTIVE') fail('REVISION_CONFLICT', 'Приостановить можно только активный сеанс');
    return 'PAUSED';
  }
  fail('VALIDATION', 'Неизвестная команда сеанса');
}
function validateTransition(input: TransitionSessionInput): void {
  if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) fail('VALIDATION', 'Укажите ожидаемую ревизию сеанса');
  if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) fail('VALIDATION', 'Укажите идемпотентный ключ команды');
  if (!['PAUSE', 'RESUME', 'PRIVATE_STOP', 'GENERAL_STOP', 'JUMP', 'COMPLETE', 'ABORT'].includes(input.command)) fail('VALIDATION', 'Неизвестная команда сеанса');
}
function copyUuids(value: JsonValue, ids: Map<string, string>): JsonValue {
  if (typeof value === 'string' && uuidPattern.test(value)) {
    const replacement = ids.get(value) ?? randomUUID();
    ids.set(value, replacement);
    return replacement;
  }
  if (Array.isArray(value)) return value.map(item => copyUuids(item, ids));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyUuids(item, ids)]));
  }
  return value;
}
function summaryOf(card: ExerciseCard): ExerciseSummary {
  const { revisions: _revisions, sessions: _sessions, ...summary } = card;
  return clone(summary);
}
function matches(card: ExerciseCard, filters: ExerciseFilters): boolean {
  const query = filters.query?.trim().toLocaleLowerCase('ru');
  return (!query || card.title.toLocaleLowerCase('ru').includes(query) || card.ownerId.toLocaleLowerCase('ru').includes(query))
    && (!filters.state || card.state === filters.state)
    && (!filters.scale || card.scale === filters.scale)
    && (!filters.purpose || card.purpose === filters.purpose)
    && (filters.includeArchived || filters.state === 'ARCHIVED' || card.state !== 'ARCHIVED');
}

type MutableExercise = {
  -readonly [K in keyof ExerciseCard]: ExerciseCard[K] extends readonly unknown[] ? ExerciseCard[K] : ExerciseCard[K];
};

function publicCard(record: ExerciseCard): ExerciseCard {
  return clone({
    ...record,
    lastSessionId: record.sessions.at(-1)?.id ?? null,
    lastSessionState: record.sessions.at(-1)?.state ?? null,
    revisions: [...record.revisions].sort((a, b) => a.revision - b.revision),
    sessions: [...record.sessions],
  });
}

function copiedCard(source: ExerciseCard, actor: ExerciseActor, now: string, title?: string): ExerciseCard {
  const exerciseId = randomUUID();
  const ids = new Map<string, string>([[source.id, exerciseId]]);
  const revisionIds = new Map(source.revisions.map(revision => [revision.id, randomUUID()] as const));
  for (const [oldId, newId] of revisionIds) ids.set(oldId, newId);
  const revisions = source.revisions.map(revision => {
    const id = revisionIds.get(revision.id)!;
    const payload = copyUuids(clone(revision.payload), ids);
    const { sealedArtifact: _sealedArtifact, ...revisionWithoutSeal } = clone(revision);
    return {
      ...revisionWithoutSeal,
      id,
      exerciseId,
      payload,
      sha256: digest(payload),
      state: 'DRAFT' as const,
      createdBy: actor.userId,
      createdAt: now,
      supersedesId: revision.supersedesId ? revisionIds.get(revision.supersedesId) ?? null : null,
    };
  });
  const assessment = assessmentOf(revisions.at(-1)?.payload ?? {});
  return {
    ...summaryOf(source),
    id: exerciseId,
    title: title?.trim() || `Копия — ${source.title}`,
    state: 'DRAFT',
    readiness: assessment.readiness,
    validation: assessment.validation,
    ownerId: actor.userId,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    lastSessionId: null, lastSessionState: null,
    revisions,
    sessions: [],
  };
}

export class InMemoryExerciseStore implements ExerciseStore {
  private readonly records = new Map<string, ExerciseCard>();
  private readonly sessionCommands = new Map<string, { request: string; session: ExerciseSession; record: SessionCommandRecord }>();
  private readonly now: () => Date;
  private readonly evidence?: ExerciseEvidenceProvider;
  private readonly environment?: ExerciseEnvironmentLoader;
  constructor(options: ExerciseStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.evidence = options.evidence;
    this.environment = options.environment;
  }
  private key(organizationId: string, exerciseId: string): string { return `${organizationId}/${exerciseId}`; }
  private required(organizationId: string, exerciseId: string): ExerciseCard {
    const record = this.records.get(this.key(organizationId, exerciseId));
    if (!record) fail('NOT_FOUND', 'Учение не найдено');
    return record;
  }

  async create(actor: ExerciseActor, input: CreateExerciseInput, access?: ExercisePayloadAccess): Promise<ExerciseCard> {
    validateCreate(input);
    if (preparationOf(input.payload) !== undefined) requirePreparationAccess(access);
    const now = this.now().toISOString();
    const exerciseId = randomUUID();
    const payload = await preparationPayload(clone(input.payload ?? {}), this.environment, now);
    const assessment = assessmentOf(payload);
    const record: ExerciseCard = {
      id: exerciseId,
      title: input.title.trim(),
      purpose: input.purpose,
      scale: input.scale,
      state: 'DRAFT',
      revision: 1,
      ownerId: actor.userId,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      readiness: assessment.readiness,
      validation: assessment.validation,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      lastSessionId: null, lastSessionState: null,
      revisions: [{
        id: randomUUID(), exerciseId, revision: 1, payload, sha256: digest(payload), state: 'DRAFT',
        createdBy: actor.userId, createdAt: now, supersedesId: null,
      }],
      sessions: [],
    };
    this.records.set(this.key(actor.organizationId, exerciseId), record);
    return publicCard(record);
  }

  async list(organizationId: string, filters: ExerciseFilters): Promise<readonly ExerciseSummary[]> {
    return [...this.records.entries()]
      .filter(([key, record]) => key === this.key(organizationId, record.id))
      .map(([, record]) => publicCard(record))
      .filter(record => matches(record, filters))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
      .map(summaryOf);
  }

  async get(organizationId: string, exerciseId: string): Promise<ExerciseCard | null> {
    const record = this.records.get(this.key(organizationId, exerciseId));
    return record ? publicCard(record) : null;
  }

  async copy(actor: ExerciseActor, exerciseId: string, title?: string): Promise<ExerciseCard> {
    validateCopyTitle(title);
    const source = publicCard(this.required(actor.organizationId, exerciseId));
    const copy = copiedCard(source, actor, this.now().toISOString(), title);
    this.records.set(this.key(actor.organizationId, copy.id), copy);
    return publicCard(copy);
  }

  async archive(actor: ExerciseActor, exerciseId: string, expectedRevision: number): Promise<ExerciseCard> {
    validateRevisionInput({ expectedRevision });
    const record = this.required(actor.organizationId, exerciseId) as MutableExercise;
    if (record.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
    const now = this.now().toISOString();
    record.state = 'ARCHIVED';
    record.archivedAt = now;
    record.updatedAt = now;
    return publicCard(record);
  }

  createRevision(actor: ExerciseActor, exerciseId: string, input: CreateRevisionInput, access?: ExercisePayloadAccess): Promise<ExerciseCard> {
    return this.writeRevision(actor, exerciseId, input, access);
  }

  async savePreparation(actor: ExerciseActor, exerciseId: string, input: SavePreparationInput, access?: ExercisePayloadAccess): Promise<ExerciseCard> {
    requirePreparationAccess(access);
    return this.writeRevision(actor, exerciseId, { expectedRevision: input.expectedRevision }, access, { kind: 'save', input });
  }

  async replaceEnvironment(actor: ExerciseActor, exerciseId: string, input: ReplaceEnvironmentInput, access?: ExercisePayloadAccess): Promise<ExerciseCard> {
    requirePreparationAccess(access);
    return this.writeRevision(actor, exerciseId, { expectedRevision: input.expectedRevision }, access, { kind: 'replace-environment', input });
  }

  async environmentImpact(actor: ExerciseActor, exerciseId: string, input: EnvironmentImpactInput, access?: ExercisePayloadAccess): Promise<EnvironmentImpact> {
    requirePreparationAccess(access);
    const card = await this.get(actor.organizationId, exerciseId);
    if (!card) fail('NOT_FOUND', 'Учение не найдено');
    return checkedEnvironmentImpact(actor, card, input, this.environment, this.evidence);
  }

  private async writeRevision(actor: ExerciseActor, exerciseId: string, input: CreateRevisionInput, access?: ExercisePayloadAccess, operation?: PreparationOperation): Promise<ExerciseCard> {
    validateRevisionInput(input);
    const record = this.required(actor.organizationId, exerciseId) as MutableExercise;
    const previous = requireWritableRevision(actor, record, input.expectedRevision, input.payload, access, operation);
    const previousState = record.state;
    const startsAt = input.startsAt === undefined ? record.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? record.endsAt : input.endsAt;
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) fail('VALIDATION', 'Окончание должно следовать за началом');
    const now = this.now().toISOString();
    const { payload: changedPayload, truthOnlyPayload } = await changedRevisionPayload(actor, previous, input.payload, operation, this.environment, this.evidence);
    const payload = await preparationPayload(clone(changedPayload ?? previous.payload), this.environment, changedPayload == null ? undefined : now);
    requireWritableRevision(actor, record, input.expectedRevision, input.payload, access, operation);
    if (operation?.kind === 'replace-environment' && record.state !== previousState) {
      fail('REVISION_CONFLICT', 'Состояние учения изменилось во время смены среды');
    }
    const assessment = assessmentOf(payload);
    const revision: ExerciseRevision = {
      id: randomUUID(), exerciseId, revision: record.revision + 1, payload, sha256: digest(payload), state: 'DRAFT',
      createdBy: actor.userId, createdAt: now, supersedesId: previous.id,
      ...(truthOnlyPayload ? { truthOnlyPayload } : {}),
    };
    record.title = input.title?.trim() ?? record.title;
    record.purpose = input.purpose ?? record.purpose;
    record.scale = input.scale ?? record.scale;
    record.startsAt = startsAt;
    record.endsAt = endsAt;
    record.state = 'DRAFT';
    record.readiness = assessment.readiness;
    record.validation = assessment.validation;
    record.revision = revision.revision;
    record.updatedAt = now;
    (record.revisions as ExerciseRevision[]).push(revision);
    return publicCard(record);
  }

  async transition(actor: ExerciseSealActor, exerciseId: string, input: ExerciseLifecycleInput): Promise<ExerciseCard> {
    const record = this.required(actor.organizationId, exerciseId) as MutableExercise;
    const state = lifecycleState(actor, record, input);
    const revision = record.revisions.find(item => item.revision === record.revision) as { -readonly [K in keyof ExerciseRevision]: ExerciseRevision[K] };
    record.state = state;
    record.updatedAt = this.now().toISOString();
    revision.state = state;
    return publicCard(record);
  }

  async seal(actor: ExerciseSealActor, exerciseId: string, input: ExerciseSealInput): Promise<ExerciseCard> {
    validateSealActor(actor);
    validateSealInput(input);
    const record = this.required(actor.organizationId, exerciseId) as MutableExercise;
    const revision = revisionForSeal(record, input.expectedRevision) as { -readonly [K in keyof ExerciseRevision]: ExerciseRevision[K] };
    const now = this.now().toISOString();
    const artifact = await sealedArtifactFor(actor, exerciseId, record, revision, this.evidence, now);
    const current = revisionForSeal(record, input.expectedRevision);
    if (current.id !== revision.id || record.state !== 'APPROVED' || revision.state !== 'APPROVED') {
      fail('REVISION_CONFLICT', 'Редакция изменилась во время проверки готовности; запечатывание отменено');
    }
    record.state = 'SEALED';
    record.readiness = 100;
    record.validation = 'OK';
    record.updatedAt = now;
    revision.state = 'SEALED';
    revision.sealedArtifact = artifact;
    return publicCard(record);
  }

  async createSession(actor: ExerciseActor, exerciseId: string, input: CreateSessionInput): Promise<ExerciseSession> {
    validateSessionInput(input);
    const record = this.required(actor.organizationId, exerciseId) as MutableExercise;
    if (record.state === 'ARCHIVED') fail('ARCHIVED', 'Для архивного учения нельзя создать сеанс');
    const revision = record.revisions.find(item => item.revision === input.revision);
    if (!revision) fail('REVISION_NOT_FOUND', 'Редакция сценария не найдена');
    await verifiedSealedArtifact(actor, exerciseId, record, revision, this.evidence);
    const current = record.revisions.find(item => item.revision === input.revision);
    if (record.archivedAt !== null) fail('ARCHIVED', 'Для архивного учения нельзя создать сеанс');
    if (record.state !== 'SEALED' || record.revision !== input.revision || current?.id !== revision.id || current.state !== 'SEALED') {
      fail('REVISION_CONFLICT', 'Редакция изменилась во время проверки артефакта; сеанс не создан');
    }
    const session: ExerciseSession = {
      id: randomUUID(), exerciseId, scenarioRevisionId: revision.id, revision: revision.revision,
      state: 'ACTIVE', mode: 'NETWORK', authority: 'SERVER', confirmedRevision: 0,
      createdBy: actor.userId, createdAt: this.now().toISOString(),
    };
    (record.sessions as ExerciseSession[]).push(session);
    record.lastSessionId = session.id;
    record.updatedAt = session.createdAt;
    return clone(session);
  }

  async transitionSession(actor: ExerciseActor, exerciseId: string, sessionId: string, input: TransitionSessionInput): Promise<ExerciseSession> {
    validateTransition(input);
    const commandKey = `${actor.organizationId}/${sessionId}/${input.idempotencyKey}`;
    const request = JSON.stringify({ exerciseId, command: input.command, expectedRevision: input.expectedRevision });
    const previous = this.sessionCommands.get(commandKey);
    if (previous) {
      if (previous.request !== request) fail('REVISION_CONFLICT', 'Ключ команды уже использован с другим содержимым');
      return clone(previous.session);
    }
    const record = this.required(actor.organizationId, exerciseId) as MutableExercise;
    const session = record.sessions.find(item => item.id === sessionId) as ExerciseSession | undefined;
    if (!session) fail('NOT_FOUND', 'Сеанс не найден');
    if (session.confirmedRevision !== input.expectedRevision) fail('REVISION_CONFLICT', 'Сеанс изменился, обновите серверную ревизию');
    const mutable = session as { -readonly [K in keyof ExerciseSession]: ExerciseSession[K] };
    mutable.state = nextSessionState(session.state, input.command);
    mutable.confirmedRevision += 1;
    record.updatedAt = this.now().toISOString();
    this.sessionCommands.set(commandKey, {
      request, session: clone(session),
      record: { sessionId, command: input.command, idempotencyKey: input.idempotencyKey, confirmedRevision: session.confirmedRevision, state: session.state, createdAt: record.updatedAt },
    });
    return clone(session);
  }

  async listSessionCommands(organizationId: string, exerciseId: string, sessionId: string): Promise<readonly SessionCommandRecord[]> {
    const record = this.required(organizationId, exerciseId);
    if (!record.sessions.some(session => session.id === sessionId)) fail('NOT_FOUND', 'Сеанс не найден');
    return [...this.sessionCommands.entries()].filter(([key]) => key.startsWith(`${organizationId}/${sessionId}/`))
      .map(([, value]) => clone(value.record)).sort((left, right) => left.confirmedRevision - right.confirmedRevision);
  }

  async getSession(organizationId: string, exerciseId: string, sessionId: string): Promise<ExerciseSession | null> {
    const session = this.records.get(this.key(organizationId, exerciseId))?.sessions.find(item => item.id === sessionId);
    return session ? clone(session) : null;
  }

  async listSessions(organizationId: string, exerciseId: string): Promise<readonly ExerciseSession[]> {
    return clone(this.records.get(this.key(organizationId, exerciseId))?.sessions ?? []);
  }
}

type Queryable = Pool | Client;
type ExerciseRow = Record<string, any>;

const exerciseColumns = `id, title, purpose, scale, state, revision, owner_id, starts_at, ends_at,
  readiness, validation, created_at, updated_at, archived_at`;
function joinLastSession(schema: string): string {
  return `left join lateral (
    select s.id as last_session_id, s.state as last_session_state from ${schema}.exercise_sessions s
    where s.organization_id=e.organization_id and s.exercise_id=e.id
    order by s.created_at desc, s.id desc limit 1
  ) last_session on true`;
}

function mapSummary(row: ExerciseRow): ExerciseSummary {
  return {
    id: row.id, title: row.title, purpose: row.purpose, scale: row.scale, state: row.state,
    revision: Number(row.revision), ownerId: row.owner_id,
    startsAt: row.starts_at ? instant(row.starts_at) : null, endsAt: row.ends_at ? instant(row.ends_at) : null,
    readiness: Number(row.readiness), validation: row.validation,
    createdAt: instant(row.created_at), updatedAt: instant(row.updated_at),
    archivedAt: row.archived_at ? instant(row.archived_at) : null, lastSessionId: row.last_session_id ?? null,
    lastSessionState: row.last_session_state ?? null,
  };
}
function mapRevision(row: ExerciseRow): ExerciseRevision {
  return {
    id: row.id, exerciseId: row.exercise_id, revision: Number(row.revision), payload: row.payload,
    sha256: row.sha256, state: row.state, createdBy: row.created_by, createdAt: instant(row.created_at),
    ...(row.sealed_artifact ? { sealedArtifact: row.sealed_artifact as SealedScenario } : {}),
    ...(row.truth_payload ? { truthOnlyPayload: true } : {}),
    supersedesId: row.supersedes_id ?? null,
  };
}
function mapSession(row: ExerciseRow): ExerciseSession {
  return {
    id: row.id, exerciseId: row.exercise_id, scenarioRevisionId: row.scenario_revision_id,
    revision: Number(row.revision), state: row.state, mode: row.mode, authority: row.authority,
    confirmedRevision: Number(row.confirmed_revision), createdBy: row.created_by, createdAt: instant(row.created_at),
  };
}
async function lockExercise(db: Queryable, schema: string, organizationId: string, exerciseId: string): Promise<void> {
  await db.query('select pg_advisory_xact_lock(hashtext($1))', [`${organizationId}/${exerciseId}`]);
  const result = await db.query(`select id from ${schema}.exercises where organization_id=$1 and id=$2 for update`, [organizationId, exerciseId]);
  if (!result.rows[0]) fail('NOT_FOUND', 'Учение не найдено');
}
async function readCard(db: Queryable, schema: string, organizationId: string, exerciseId: string): Promise<ExerciseCard | null> {
  const exercise = await db.query(
    `select ${exerciseColumns}, last_session_id, last_session_state
     from ${schema}.exercises e ${joinLastSession(schema)} where organization_id=$1 and id=$2`,
    [organizationId, exerciseId],
  );
  if (!exercise.rows[0]) return null;
  const [revisions, sessions] = await Promise.all([
    db.query(`select * from ${schema}.exercise_revisions where organization_id=$1 and exercise_id=$2 order by revision`, [organizationId, exerciseId]),
    db.query(`select * from ${schema}.exercise_sessions where organization_id=$1 and exercise_id=$2 order by created_at, id`, [organizationId, exerciseId]),
  ]);
  return {
    ...mapSummary(exercise.rows[0]),
    revisions: revisions.rows.map(mapRevision),
    sessions: sessions.rows.map(mapSession),
  };
}
async function requiredCard(db: Queryable, schema: string, organizationId: string, exerciseId: string): Promise<ExerciseCard> {
  const card = await readCard(db, schema, organizationId, exerciseId);
  if (!card) fail('NOT_FOUND', 'Учение не найдено');
  return card;
}
async function insertCard(db: Queryable, schema: string, organizationId: string, card: ExerciseCard): Promise<void> {
  await db.query(
    `insert into ${schema}.exercises (organization_id, id, title, purpose, scale, state, revision, owner_id, starts_at, ends_at,
      readiness, validation, created_at, updated_at, archived_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [organizationId, card.id, card.title, card.purpose, card.scale, card.state, card.revision, card.ownerId, card.startsAt, card.endsAt,
      card.readiness, card.validation, card.createdAt, card.updatedAt, card.archivedAt],
  );
  for (const revision of card.revisions) {
    await db.query(
      `insert into ${schema}.exercise_revisions (organization_id, id, exercise_id, revision, payload, sha256, state, created_by, created_at, supersedes_id, truth_payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [organizationId, revision.id, card.id, revision.revision, revision.payload, revision.sha256, revision.state, revision.createdBy, revision.createdAt, revision.supersedesId, revision.truthOnlyPayload === true],
    );
  }
}

export class PgExerciseStore implements ExerciseStore {
  readonly pool: Pool;
  readonly schema: string;
  private readonly evidence?: ExerciseEvidenceProvider;
  private readonly environment?: ExerciseEnvironmentLoader;
  constructor(options: { pool?: Pool; url?: string; schema?: string; evidence?: ExerciseEvidenceProvider; environment?: ExerciseEnvironmentLoader } = {}) {
    this.pool = options.pool ?? createPool(options.url);
    this.schema = options.schema ?? 'kshvi';
    this.evidence = options.evidence;
    this.environment = options.environment;
    if (!/^[a-z_][a-z0-9_]*$/.test(this.schema)) throw new Error('Недопустимое имя схемы КШВИ');
  }
  async init(): Promise<void> { await migrate(this.pool, this.schema, KSHVI_EXERCISE_MIGRATIONS); }

  async create(actor: ExerciseActor, input: CreateExerciseInput, access?: ExercisePayloadAccess): Promise<ExerciseCard> {
    validateCreate(input);
    if (preparationOf(input.payload) !== undefined) requirePreparationAccess(access);
    return tx(this.pool, async db => {
      const now = new Date().toISOString();
      const exerciseId = randomUUID();
      const payload = await preparationPayload(clone(input.payload ?? {}), this.environment, now);
      const assessment = assessmentOf(payload);
      const card: ExerciseCard = {
        id: exerciseId, title: input.title.trim(), purpose: input.purpose, scale: input.scale,
        state: 'DRAFT', revision: 1, ownerId: actor.userId, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null,
        readiness: assessment.readiness, validation: assessment.validation, createdAt: now, updatedAt: now, archivedAt: null, lastSessionId: null, lastSessionState: null,
        revisions: [{ id: randomUUID(), exerciseId, revision: 1, payload, sha256: digest(payload), state: 'DRAFT', createdBy: actor.userId, createdAt: now, supersedesId: null }],
        sessions: [],
      };
      await insertCard(db, this.schema, actor.organizationId, card);
      return card;
    });
  }

  async list(organizationId: string, filters: ExerciseFilters): Promise<readonly ExerciseSummary[]> {
    const values: unknown[] = [organizationId];
    const where = ['e.organization_id=$1'];
    if (!filters.includeArchived && filters.state !== 'ARCHIVED') where.push(`e.state<>'ARCHIVED'`);
    if (filters.query?.trim()) {
      values.push(`%${filters.query.trim()}%`);
      where.push(`(e.title ilike $${values.length} or e.owner_id ilike $${values.length})`);
    }
    if (filters.state) { values.push(filters.state); where.push(`e.state=$${values.length}`); }
    if (filters.scale) { values.push(filters.scale); where.push(`e.scale=$${values.length}`); }
    if (filters.purpose) { values.push(filters.purpose); where.push(`e.purpose=$${values.length}`); }
    const result = await this.pool.query(
      `select ${exerciseColumns}, last_session_id, last_session_state
       from ${this.schema}.exercises e ${joinLastSession(this.schema)} where ${where.join(' and ')} order by e.updated_at desc, e.id`,
      values,
    );
    return result.rows.map(mapSummary);
  }

  async get(organizationId: string, exerciseId: string): Promise<ExerciseCard | null> {
    return readCard(this.pool, this.schema, organizationId, exerciseId);
  }

  async copy(actor: ExerciseActor, exerciseId: string, title?: string): Promise<ExerciseCard> {
    validateCopyTitle(title);
    return tx(this.pool, async db => {
      await lockExercise(db, this.schema, actor.organizationId, exerciseId);
      const source = await requiredCard(db, this.schema, actor.organizationId, exerciseId);
      const copy = copiedCard(source, actor, new Date().toISOString(), title);
      await insertCard(db, this.schema, actor.organizationId, copy);
      return copy;
    });
  }

  async archive(actor: ExerciseActor, exerciseId: string, expectedRevision: number): Promise<ExerciseCard> {
    validateRevisionInput({ expectedRevision });
    return tx(this.pool, async db => {
      await lockExercise(db, this.schema, actor.organizationId, exerciseId);
      const current = await requiredCard(db, this.schema, actor.organizationId, exerciseId);
      if (current.revision !== expectedRevision) fail('REVISION_CONFLICT', 'Данные изменились, обновите редакцию');
      const now = new Date().toISOString();
      await db.query(`update ${this.schema}.exercises set state='ARCHIVED', archived_at=$3, updated_at=$3 where organization_id=$1 and id=$2`, [actor.organizationId, exerciseId, now]);
      return requiredCard(db, this.schema, actor.organizationId, exerciseId);
    });
  }

  createRevision(actor: ExerciseActor, exerciseId: string, input: CreateRevisionInput, access?: ExercisePayloadAccess): Promise<ExerciseCard> {
    return this.writeRevision(actor, exerciseId, input, access);
  }

  async savePreparation(actor: ExerciseActor, exerciseId: string, input: SavePreparationInput, access?: ExercisePayloadAccess): Promise<ExerciseCard> {
    requirePreparationAccess(access);
    return this.writeRevision(actor, exerciseId, { expectedRevision: input.expectedRevision }, access, { kind: 'save', input });
  }

  async replaceEnvironment(actor: ExerciseActor, exerciseId: string, input: ReplaceEnvironmentInput, access?: ExercisePayloadAccess): Promise<ExerciseCard> {
    requirePreparationAccess(access);
    return this.writeRevision(actor, exerciseId, { expectedRevision: input.expectedRevision }, access, { kind: 'replace-environment', input });
  }

  async environmentImpact(actor: ExerciseActor, exerciseId: string, input: EnvironmentImpactInput, access?: ExercisePayloadAccess): Promise<EnvironmentImpact> {
    requirePreparationAccess(access);
    const card = await this.get(actor.organizationId, exerciseId);
    if (!card) fail('NOT_FOUND', 'Учение не найдено');
    return checkedEnvironmentImpact(actor, card, input, this.environment, this.evidence);
  }

  private async writeRevision(actor: ExerciseActor, exerciseId: string, input: CreateRevisionInput, access?: ExercisePayloadAccess, operation?: PreparationOperation): Promise<ExerciseCard> {
    validateRevisionInput(input);
    return tx(this.pool, async db => {
      await lockExercise(db, this.schema, actor.organizationId, exerciseId);
      const current = await requiredCard(db, this.schema, actor.organizationId, exerciseId);
      const previous = requireWritableRevision(actor, current, input.expectedRevision, input.payload, access, operation);
      const startsAt = input.startsAt === undefined ? current.startsAt : input.startsAt;
      const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt;
      if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) fail('VALIDATION', 'Окончание должно следовать за началом');
      const now = new Date().toISOString();
      const { payload: changedPayload, truthOnlyPayload } = await changedRevisionPayload(actor, previous, input.payload, operation, this.environment, this.evidence, db);
      const payload = await preparationPayload(clone(changedPayload ?? previous.payload), this.environment, changedPayload == null ? undefined : now);
      const assessment = assessmentOf(payload);
      const revision: ExerciseRevision = {
        id: randomUUID(), exerciseId, revision: current.revision + 1, payload, sha256: digest(payload),
        state: 'DRAFT', createdBy: actor.userId, createdAt: now, supersedesId: previous.id,
        ...(truthOnlyPayload ? { truthOnlyPayload } : {}),
      };
      await db.query(
        `insert into ${this.schema}.exercise_revisions (organization_id, id, exercise_id, revision, payload, sha256, state, created_by, created_at, supersedes_id, truth_payload)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [actor.organizationId, revision.id, exerciseId, revision.revision, payload, revision.sha256, revision.state, revision.createdBy, now, previous.id, revision.truthOnlyPayload === true],
      );
      await db.query(
        `update ${this.schema}.exercises set title=$3, purpose=$4, scale=$5, starts_at=$6, ends_at=$7, state=$8,
         readiness=$9, validation=$10, revision=$11, updated_at=$12 where organization_id=$1 and id=$2`,
        [actor.organizationId, exerciseId, input.title?.trim() ?? current.title, input.purpose ?? current.purpose, input.scale ?? current.scale,
          startsAt, endsAt, revision.state, assessment.readiness, assessment.validation, revision.revision, now],
      );
      return requiredCard(db, this.schema, actor.organizationId, exerciseId);
    });
  }

  async transition(actor: ExerciseSealActor, exerciseId: string, input: ExerciseLifecycleInput): Promise<ExerciseCard> {
    return tx(this.pool, async db => {
      await lockExercise(db, this.schema, actor.organizationId, exerciseId);
      const current = await requiredCard(db, this.schema, actor.organizationId, exerciseId);
      const state = lifecycleState(actor, current, input);
      const revision = current.revisions.find(item => item.revision === current.revision)!;
      const now = new Date().toISOString();
      const cardUpdate = await db.query(`update ${this.schema}.exercises set state=$3, updated_at=$4 where organization_id=$1 and id=$2 and revision=$5`, [actor.organizationId, exerciseId, state, now, current.revision]);
      if (cardUpdate.rowCount !== 1) fail('REVISION_CONFLICT', 'Не удалось обновить карточку при переходе; изменения отменены');
      const revisionUpdate = await db.query(`update ${this.schema}.exercise_revisions set state=$4 where organization_id=$1 and exercise_id=$2 and id=$3 and revision=$5`, [actor.organizationId, exerciseId, revision.id, state, current.revision]);
      if (revisionUpdate.rowCount !== 1) fail('REVISION_CONFLICT', 'Не удалось обновить редакцию при переходе; изменения отменены');
      return requiredCard(db, this.schema, actor.organizationId, exerciseId);
    });
  }

  async seal(actor: ExerciseSealActor, exerciseId: string, input: ExerciseSealInput): Promise<ExerciseCard> {
    validateSealActor(actor);
    validateSealInput(input);
    return tx(this.pool, async db => {
      await lockExercise(db, this.schema, actor.organizationId, exerciseId);
      const current = await requiredCard(db, this.schema, actor.organizationId, exerciseId);
      const revision = revisionForSeal(current, input.expectedRevision);
      const now = new Date().toISOString();
      const artifact = await sealedArtifactFor(actor, exerciseId, current, revision, this.evidence, now);
      const cardUpdate = await db.query(
        `update ${this.schema}.exercises set state='SEALED', readiness=100, validation='OK', updated_at=$3
         where organization_id=$1 and id=$2 and revision=$4`,
        [actor.organizationId, exerciseId, now, input.expectedRevision],
      );
      if (cardUpdate.rowCount !== 1) fail('REVISION_CONFLICT', 'Не удалось обновить карточку при запечатывании; изменения отменены');
      const revisionUpdate = await db.query(
        `update ${this.schema}.exercise_revisions set state='SEALED', sealed_artifact=$5
         where organization_id=$1 and exercise_id=$2 and id=$3 and revision=$4`,
        [actor.organizationId, exerciseId, revision.id, input.expectedRevision, JSON.stringify(artifact)],
      );
      if (revisionUpdate.rowCount !== 1) fail('REVISION_CONFLICT', 'Не удалось обновить редакцию при запечатывании; изменения отменены');
      return requiredCard(db, this.schema, actor.organizationId, exerciseId);
    });
  }

  async createSession(actor: ExerciseActor, exerciseId: string, input: CreateSessionInput): Promise<ExerciseSession> {
    validateSessionInput(input);
    return tx(this.pool, async db => {
      await lockExercise(db, this.schema, actor.organizationId, exerciseId);
      const current = await requiredCard(db, this.schema, actor.organizationId, exerciseId);
      if (current.state === 'ARCHIVED') fail('ARCHIVED', 'Для архивного учения нельзя создать сеанс');
      const revision = current.revisions.find(item => item.revision === input.revision);
      if (!revision) fail('REVISION_NOT_FOUND', 'Редакция сценария не найдена');
      await verifiedSealedArtifact(actor, exerciseId, current, revision, this.evidence);
      const session: ExerciseSession = {
        id: randomUUID(), exerciseId, scenarioRevisionId: revision.id, revision: revision.revision,
        state: 'ACTIVE', mode: 'NETWORK', authority: 'SERVER', confirmedRevision: 0,
        createdBy: actor.userId, createdAt: new Date().toISOString(),
      };
      await db.query(
        `insert into ${this.schema}.exercise_sessions (organization_id, id, exercise_id, scenario_revision_id, revision, state, mode, authority, confirmed_revision, created_by, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [actor.organizationId, session.id, exerciseId, revision.id, revision.revision, session.state, session.mode, session.authority, 0, actor.userId, session.createdAt],
      );
      await db.query(`update ${this.schema}.exercises set updated_at=$3 where organization_id=$1 and id=$2`, [actor.organizationId, exerciseId, session.createdAt]);
      return session;
    });
  }

  async transitionSession(actor: ExerciseActor, exerciseId: string, sessionId: string, input: TransitionSessionInput): Promise<ExerciseSession> {
    validateTransition(input);
    return tx(this.pool, async db => {
      await lockExercise(db, this.schema, actor.organizationId, exerciseId);
      const previous = await db.query(`select exercise_id, command, expected_revision, result from ${this.schema}.exercise_session_commands
        where organization_id=$1 and session_id=$2 and idempotency_key=$3`, [actor.organizationId, sessionId, input.idempotencyKey]);
      if (previous.rows[0]) {
        const row = previous.rows[0];
        if (row.exercise_id !== exerciseId || row.command !== input.command || Number(row.expected_revision) !== input.expectedRevision) {
          fail('REVISION_CONFLICT', 'Ключ команды уже использован с другим содержимым');
        }
        return clone(row.result as ExerciseSession);
      }
      const result = await db.query(`select * from ${this.schema}.exercise_sessions where organization_id=$1 and exercise_id=$2 and id=$3 for update`, [actor.organizationId, exerciseId, sessionId]);
      if (!result.rows[0]) fail('NOT_FOUND', 'Сеанс не найден');
      const current = mapSession(result.rows[0]);
      if (current.confirmedRevision !== input.expectedRevision) fail('REVISION_CONFLICT', 'Сеанс изменился, обновите серверную ревизию');
      const state = nextSessionState(current.state, input.command);
      const updated = await db.query(`update ${this.schema}.exercise_sessions set state=$4, confirmed_revision=confirmed_revision+1
        where organization_id=$1 and exercise_id=$2 and id=$3 and confirmed_revision=$5 returning *`,
      [actor.organizationId, exerciseId, sessionId, state, input.expectedRevision]);
      if (!updated.rows[0]) fail('REVISION_CONFLICT', 'Сеанс изменился, обновите серверную ревизию');
      const stored = mapSession(updated.rows[0]);
      const now = new Date().toISOString();
      await db.query(`insert into ${this.schema}.exercise_session_commands
        (organization_id, exercise_id, session_id, idempotency_key, command, expected_revision, confirmed_revision, result, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [actor.organizationId, exerciseId, sessionId, input.idempotencyKey, input.command, input.expectedRevision, stored.confirmedRevision, JSON.stringify(stored), now]);
      await db.query(`update ${this.schema}.exercises set updated_at=$3 where organization_id=$1 and id=$2`, [actor.organizationId, exerciseId, now]);
      return stored;
    });
  }

  async listSessionCommands(organizationId: string, exerciseId: string, sessionId: string): Promise<readonly SessionCommandRecord[]> {
    const result = await this.pool.query(`select command, idempotency_key, confirmed_revision, result, created_at from ${this.schema}.exercise_session_commands
      where organization_id=$1 and exercise_id=$2 and session_id=$3 order by confirmed_revision`, [organizationId, exerciseId, sessionId]);
    return result.rows.map(row => ({ sessionId, command: row.command, idempotencyKey: row.idempotency_key, confirmedRevision: Number(row.confirmed_revision), state: row.result.state, createdAt: instant(row.created_at) }));
  }

  async getSession(organizationId: string, exerciseId: string, sessionId: string): Promise<ExerciseSession | null> {
    const result = await this.pool.query(`select * from ${this.schema}.exercise_sessions where organization_id=$1 and exercise_id=$2 and id=$3`, [organizationId, exerciseId, sessionId]);
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async listSessions(organizationId: string, exerciseId: string): Promise<readonly ExerciseSession[]> {
    const result = await this.pool.query(`select * from ${this.schema}.exercise_sessions where organization_id=$1 and exercise_id=$2 order by created_at, id`, [organizationId, exerciseId]);
    return result.rows.map(mapSession);
  }
}
