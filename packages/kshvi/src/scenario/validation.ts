import { initialMapHash, validateInitialMap, type InitialSituationMap } from './initial-map';

export const VALIDATION_AREAS = [
  'STRUCTURE', 'COMMAND_TREE', 'ENVIRONMENT', 'INITIAL_MAP', 'TIME', 'INPUTS', 'FORCES_RESOURCES',
  'EQUIPMENT_MORALE_READINESS', 'LOGISTICS_FORMATION', 'AUTONOMY_AGENTS', 'SYMBOLS', 'COMMUNICATIONS',
  'DOCUMENTS', 'VISIBILITY', 'MODEL', 'RECOVERY',
] as const;
export type ValidationArea = typeof VALIDATION_AREAS[number];
export type ValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';

export type WarningAcceptance = Readonly<{
  authorId: string;
  reason: string;
  expiresAt: string;
  scope: string;
  acceptedAt?: string;
}>;
export type ValidationIssue = Readonly<{
  code: string;
  severity: ValidationSeverity;
  area: ValidationArea;
  message: string;
  waivable: boolean;
  objectId?: string;
  acceptance?: WarningAcceptance;
}>;
export type AcceptedValidationIssue = ValidationIssue & Readonly<{ acceptance: WarningAcceptance }>;
export type ScenarioAreaIssue = Readonly<{
  code: string;
  severity: ValidationSeverity;
  message: string;
  objectId?: string;
}>;
export type ScenarioAreaValidation = Readonly<{
  status: 'VALID' | 'INVALID' | 'UNKNOWN';
  version?: string;
  issues?: readonly ScenarioAreaIssue[];
}>;
export type EnvironmentValidation = Readonly<{
  snapshot: Readonly<{
    manifestSha256: string;
    autonomy: 'COMPLETE' | 'INCOMPLETE';
    weatherContentRef: string | null;
    elevationContentRef: string | null;
  }> | null;
  expectedManifestSha256: string;
  coverageComplete: boolean;
  atlasesAvailable: boolean;
  attributionComplete: boolean;
  elevationComplete: boolean;
  weatherIntervalComplete: boolean;
  weatherQuality: Readonly<{
    status: 'OK' | 'PARTIAL' | 'NO_DATA';
    reason: 'KNOWN' | 'MISSING_CONTENT' | 'OUTSIDE_INTERVAL' | 'OUTSIDE_COVERAGE' | 'MISSING_VALUES';
  }>;
}>;
export type ScenarioValidationInput = {
  areas: Record<string, ScenarioAreaValidation>;
  environment?: EnvironmentValidation | null;
  initialMap?: InitialSituationMap | null;
};
export type ValidationReport = Readonly<{
  schemaVersion: 1;
  checkedAreas: readonly ValidationArea[];
  issues: readonly ValidationIssue[];
  status: 'OK' | 'INFO' | 'WARNING' | 'ERROR';
}>;

export const SCENARIO_VALIDATION_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'kshvi/scenario-validation-v1.schema.json',
  type: 'object',
  required: ['schemaVersion', 'checkedAreas', 'issues', 'status'],
  properties: {
    schemaVersion: { const: 1 },
    checkedAreas: { type: 'array', items: { enum: VALIDATION_AREAS } },
    issues: { type: 'array', items: { type: 'object', required: ['code', 'severity', 'area', 'message', 'waivable'] } },
    status: { enum: ['OK', 'INFO', 'WARNING', 'ERROR'] },
  },
} as const;

const SHA256 = /^[0-9a-f]{64}$/;

function nonWaivable(area: ValidationArea, code: string): boolean {
  return area === 'VISIBILITY' || /(?:VISIBILITY|SECRET|HASH|ENVIRONMENT|SNAPSHOT)/.test(code);
}

function makeIssue(area: ValidationArea, input: ScenarioAreaIssue): ValidationIssue {
  const blocked = nonWaivable(area, input.code);
  const severity = blocked && input.severity === 'WARNING' ? 'ERROR' : input.severity;
  return {
    ...input,
    area,
    severity,
    waivable: severity === 'WARNING' && !blocked,
  };
}

function error(area: ValidationArea, code: string, message: string, waivable = false): ValidationIssue {
  return { area, code, message, severity: 'ERROR', waivable };
}

function environmentIssues(input: EnvironmentValidation | null | undefined): ValidationIssue[] {
  if (!input?.snapshot) return [error('ENVIRONMENT', 'ENVIRONMENT_SNAPSHOT_REQUIRED', 'Обязательный автономный снимок среды отсутствует')];
  const output: ValidationIssue[] = [];
  const snapshot = input.snapshot;
  if (!SHA256.test(snapshot.manifestSha256) || snapshot.manifestSha256 !== input.expectedManifestSha256) {
    output.push(error('ENVIRONMENT', 'ENVIRONMENT_HASH_INVALID', 'Хеш снимка среды не совпадает с зафиксированным'));
  }
  if (snapshot.autonomy !== 'COMPLETE') output.push(error('ENVIRONMENT', 'ENVIRONMENT_SNAPSHOT_INCOMPLETE', 'Снимок среды не автономен'));
  if (!snapshot.weatherContentRef) output.push(error('ENVIRONMENT', 'WEATHER_SNAPSHOT_REQUIRED', 'В снимке отсутствует содержимое погоды'));
  if (!snapshot.elevationContentRef) output.push(error('ENVIRONMENT', 'ELEVATION_SNAPSHOT_REQUIRED', 'В снимке отсутствуют высоты'));
  if (!input.coverageComplete) output.push(error('ENVIRONMENT', 'ENVIRONMENT_COVERAGE_MISSING', 'Среда не покрывает область учения'));
  if (!input.atlasesAvailable) output.push(error('ENVIRONMENT', 'ATLAS_UNAVAILABLE', 'Выбранный атлас недоступен в снимке'));
  if (!input.attributionComplete) output.push(error('ENVIRONMENT', 'ATTRIBUTION_REQUIRED', 'Не заполнена атрибуция среды'));
  if (!input.elevationComplete) output.push(error('ENVIRONMENT', 'ELEVATION_COVERAGE_MISSING', 'Покрытие высот неполно'));
  if (!input.weatherIntervalComplete) output.push(error('ENVIRONMENT', 'WEATHER_INTERVAL_MISSING', 'Погода не покрывает оперативный интервал'));
  if (input.weatherQuality.status === 'NO_DATA') output.push(error('ENVIRONMENT', 'WEATHER_COVERAGE_MISSING', 'Для координаты и времени нет погодных данных; пустой ответ не считается успехом'));
  if (input.weatherQuality.status === 'PARTIAL') output.push(error('ENVIRONMENT', 'WEATHER_DATA_INCOMPLETE', 'Обязательные погодные значения неизвестны'));
  return output;
}

function initialMapIssues(map: InitialSituationMap | null | undefined): ValidationIssue[] {
  if (!map) return [error('INITIAL_MAP', 'INITIAL_MAP_REQUIRED', 'Карта исходной обстановки обязательна')];
  const output = validateInitialMap(map).map(item => makeIssue('INITIAL_MAP', item));
  if (map.state !== 'APPROVED') output.push(error('INITIAL_MAP', 'INITIAL_MAP_NOT_APPROVED', 'Версия исходной карты не утверждена'));
  if (map.sha256 && map.sha256 !== initialMapHash(map)) output.push(error('INITIAL_MAP', 'INITIAL_MAP_HASH_INVALID', 'Хеш исходной карты не соответствует содержимому'));
  return output;
}

export function validateScenario(input: ScenarioValidationInput): ValidationReport {
  const issues: ValidationIssue[] = [];
  const checkedAreas: ValidationArea[] = [];
  for (const area of VALIDATION_AREAS) {
    const areaInput = input.areas[area];
    if (!areaInput) {
      issues.push(error(area, 'VALIDATION_AREA_REQUIRED', 'Область не прошла обязательную проверку'));
      continue;
    }
    checkedAreas.push(area);
    if (areaInput.status !== 'VALID') {
      issues.push(error(area, areaInput.status === 'UNKNOWN' ? 'VALIDATION_AREA_UNKNOWN' : 'VALIDATION_AREA_INVALID', 'Область имеет неподтверждённый или ошибочный результат'));
    }
    for (const item of areaInput.issues ?? []) issues.push(makeIssue(area, item));
  }
  issues.push(...environmentIssues(input.environment));
  issues.push(...initialMapIssues(input.initialMap));
  const status = issues.some(item => item.severity === 'ERROR') ? 'ERROR'
    : issues.some(item => item.severity === 'WARNING') ? 'WARNING'
      : issues.some(item => item.severity === 'INFO') ? 'INFO' : 'OK';
  return { schemaVersion: 1, checkedAreas, issues, status };
}

export function acceptValidationWarning(issue: ValidationIssue, acceptance: Readonly<{
  authorId: string;
  reason: string;
  expiresAt: string;
  scope: string;
}>, acceptedAt: string): AcceptedValidationIssue {
  if (issue.severity !== 'WARNING' || !issue.waivable) throw new Error('NOT_WAIVABLE');
  if (!acceptance.authorId.trim() || !acceptance.reason.trim() || !acceptance.scope.trim() || !acceptance.expiresAt.trim()) {
    throw new Error('WARNING_ACCEPTANCE');
  }
  const expires = Date.parse(acceptance.expiresAt);
  const accepted = Date.parse(acceptedAt);
  if (!Number.isFinite(expires) || !Number.isFinite(accepted) || expires <= accepted) throw new Error('WARNING_ACCEPTANCE_EXPIRED');
  return { ...issue, acceptance: { ...acceptance, acceptedAt } };
}

export type TrainingPreparation = Readonly<{
  requiredParticipantIds: readonly string[];
  plans: readonly Readonly<{
    id: string;
    participantIds: readonly string[];
    materialIds: readonly string[];
    roleKnowledgeChecks: readonly Readonly<{ participantId: string; role: string; passed: boolean }>[];
    readiness: readonly Readonly<{ participantId: string; ready: boolean }>[];
  }>[];
  leadershipRehearsal: Readonly<{ isolated: boolean; traineeAccess: boolean }>;
}>;
export type TrainingIssue = Readonly<{ code: string; severity: 'ERROR'; area: 'TRAINING'; message: string; waivable: false }>;

function trainingError(code: string, message: string): TrainingIssue {
  return { code, severity: 'ERROR', area: 'TRAINING', message, waivable: false };
}

export function validateTrainingPreparation(input: TrainingPreparation): TrainingIssue[] {
  const output: TrainingIssue[] = [];
  const participants = new Set(input.plans.flatMap(plan => plan.participantIds));
  for (const participantId of input.requiredParticipantIds) {
    if (!participants.has(participantId)) output.push(trainingError('TRAINING_PARTICIPANT_REQUIRED', `Участник ${participantId} не включён в инструктивное занятие`));
    const knowledge = input.plans.flatMap(plan => plan.roleKnowledgeChecks).find(check => check.participantId === participantId && check.passed);
    if (!knowledge) output.push(trainingError('ROLE_KNOWLEDGE_REQUIRED', `Участник ${participantId} не подтвердил знание роли`));
    const readiness = input.plans.flatMap(plan => plan.readiness).find(item => item.participantId === participantId && item.ready);
    if (!readiness) output.push(trainingError('TRAINING_READINESS_REQUIRED', `Участник ${participantId} не отметил готовность`));
  }
  if (!input.plans.length || input.plans.some(plan => !plan.materialIds.length)) output.push(trainingError('TRAINING_MATERIAL_REQUIRED', 'Для занятия нужны материалы'));
  if (!input.leadershipRehearsal.isolated) output.push(trainingError('STAFF_REHEARSAL_ISOLATION_REQUIRED', 'Тренировочный прогон руководства должен быть изолирован'));
  if (input.leadershipRehearsal.traineeAccess) output.push(trainingError('STAFF_MATERIAL_LEAK', 'Обучаемые не должны видеть служебные материалы руководства'));
  return output;
}
