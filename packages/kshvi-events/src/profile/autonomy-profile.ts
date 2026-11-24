import { EVENT_CATEGORIES, type EventCategory } from '../model/event-template';
import {
  AUTONOMY_LEVELS,
  METHODICAL_AUTONOMY_PROFILE_V1,
  type AutonomyLevel,
  type AutonomyNumericSettings,
  type MethodicalAutonomyProfile,
} from './intensity-levels';

export type { AutonomyLevel, AutonomyNumericSettings, MethodicalAutonomyProfile } from './intensity-levels';

export type ScenarioLifecycleState = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SEALED' | 'CANCELLED' | 'ARCHIVED';
export type IntensityMap = Readonly<Record<string, number>>;
export type IntensityAxes = Readonly<{
  categories: Readonly<Partial<Record<EventCategory, number>>>;
  stages: IntensityMap;
  sides: IntensityMap;
  areas: IntensityMap;
}>;
export type IntensityAxesInput = Partial<{
  categories: Partial<Record<EventCategory, number>>;
  stages: Record<string, number>;
  sides: Record<string, number>;
  areas: Record<string, number>;
}>;

export type AutonomyProfile = Readonly<{
  schemaVersion: 1;
  profileId: string;
  level: AutonomyLevel;
  methodicalProfile: Readonly<{ profileId: string; version: number }>;
  settings: AutonomyNumericSettings;
  distribution: 'POISSON';
  intensity: IntensityAxes;
}>;

export type AutonomyScope = Readonly<{
  category: EventCategory;
  stageId: string;
  sideId: string;
  areaId: string;
}>;

export type CreateAutonomyProfileInput = Readonly<{
  profileId: string;
  level: AutonomyLevel;
  methodicalProfile?: MethodicalAutonomyProfile;
  settings?: AutonomyNumericSettings;
  intensity?: IntensityAxesInput;
}>;

export type AutonomyProfileChanges = Readonly<{
  level?: AutonomyLevel;
  settings?: Partial<AutonomyNumericSettings>;
  intensity?: IntensityAxesInput;
}>;

function finiteNonNegative(value: number, title: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${title} должна быть конечным неотрицательным числом`);
}

function nonNegativeInteger(value: number, title: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${title} должна быть неотрицательным целым числом`);
}

function validateSettings(settings: AutonomyNumericSettings): void {
  finiteNonNegative(settings.attemptsPerOperationalHour, 'Базовая интенсивность');
  if (!Number.isSafeInteger(settings.intervalMinutes) || settings.intervalMinutes < 1) {
    throw new Error('Длительность интервала должна быть положительным целым числом минут');
  }
  nonNegativeInteger(settings.maxEventsPerInterval, 'Лимит событий интервала');
  nonNegativeInteger(settings.maxEventsPerStage, 'Лимит событий этапа');
  finiteNonNegative(settings.maxSeverityCost, 'Допустимая тяжесть');
  finiteNonNegative(settings.severityBudgetPerStage, 'Бюджет тяжести этапа');
  nonNegativeInteger(settings.maxCascadeDepth, 'Глубина каскада');
  nonNegativeInteger(settings.maxCascadeEvents, 'Бюджет каскадных событий');
  if (!Number.isFinite(settings.manualApprovalShare) || settings.manualApprovalShare < 0 || settings.manualApprovalShare > 1) {
    throw new Error('Доля ручного утверждения должна находиться в диапазоне от 0 до 1');
  }
}

function validateIntensity(axes: IntensityAxes): void {
  for (const category of Object.keys(axes.categories)) {
    if (!EVENT_CATEGORIES.includes(category as EventCategory)) throw new Error(`Неизвестная категория интенсивности: ${category}`);
  }
  for (const axis of Object.values(axes)) {
    for (const value of Object.values(axis)) {
      if (value !== undefined) finiteNonNegative(value, 'Интенсивность области');
    }
  }
}

function normalizeIntensity(input: IntensityAxesInput | undefined): IntensityAxes {
  const axes: IntensityAxes = {
    categories: structuredClone(input?.categories ?? {}),
    stages: structuredClone(input?.stages ?? {}),
    sides: structuredClone(input?.sides ?? {}),
    areas: structuredClone(input?.areas ?? {}),
  };
  validateIntensity(axes);
  return axes;
}

function validateProfile(profile: AutonomyProfile): void {
  if (!profile.profileId.trim()) throw new Error('Для профиля автономности нужен идентификатор');
  if (!AUTONOMY_LEVELS.includes(profile.level)) throw new Error('Неизвестный уровень автономности');
  if (!profile.methodicalProfile.profileId.trim() || !Number.isSafeInteger(profile.methodicalProfile.version) || profile.methodicalProfile.version < 1) {
    throw new Error('Профиль автономности требует версионную методическую ссылку');
  }
  validateSettings(profile.settings);
  validateIntensity(profile.intensity);
}

export function createAutonomyProfile(input: CreateAutonomyProfileInput): AutonomyProfile {
  const methodical = input.methodicalProfile ?? METHODICAL_AUTONOMY_PROFILE_V1;
  if (!methodical.profileId.trim() || !Number.isSafeInteger(methodical.version) || methodical.version < 1) {
    throw new Error('Нужен корректный версионный методический профиль');
  }
  if (input.level === 'CUSTOM' && !input.settings) throw new Error('Уровень CUSTOM требует явные числовые настройки');
  if (input.level !== 'CUSTOM' && input.settings) throw new Error('Числа именованного уровня задаются только методическим профилем');
  const settings = input.level === 'CUSTOM'
    ? structuredClone(input.settings as AutonomyNumericSettings)
    : structuredClone(methodical.levels[input.level]);
  const profile: AutonomyProfile = {
    schemaVersion: 1,
    profileId: input.profileId,
    level: input.level,
    methodicalProfile: { profileId: methodical.profileId, version: methodical.version },
    settings,
    distribution: 'POISSON',
    intensity: normalizeIntensity(input.intensity),
  };
  validateProfile(profile);
  return profile;
}

export function intensityFor(profile: AutonomyProfile, scope: AutonomyScope): number {
  const category = profile.intensity.categories[scope.category] ?? 1;
  const stage = profile.intensity.stages[scope.stageId] ?? 1;
  const side = profile.intensity.sides[scope.sideId] ?? 1;
  const area = profile.intensity.areas[scope.areaId] ?? 1;
  const result = category * stage * side * area;
  return result === 0 ? 0 : result;
}

export function attemptsPerOperationalHour(profile: AutonomyProfile, scope: AutonomyScope): number {
  return profile.settings.attemptsPerOperationalHour * intensityFor(profile, scope);
}

export function updateAutonomyProfile(
  profile: AutonomyProfile,
  changes: AutonomyProfileChanges,
  scenarioState: ScenarioLifecycleState,
): AutonomyProfile {
  if (!['DRAFT', 'IN_REVIEW', 'APPROVED'].includes(scenarioState)) {
    throw new Error(`Изменение AutonomyProfile после SEALED или в состоянии ${scenarioState} запрещено обычной командой`);
  }
  const level = changes.level ?? profile.level;
  if (changes.settings && level !== 'CUSTOM') throw new Error('Числа именованного уровня задаются только методическим профилем');
  const methodicalReference = profile.methodicalProfile;
  const methodical = methodicalReference.profileId === METHODICAL_AUTONOMY_PROFILE_V1.profileId
    && methodicalReference.version === METHODICAL_AUTONOMY_PROFILE_V1.version
    ? METHODICAL_AUTONOMY_PROFILE_V1
    : undefined;
  if (level !== 'CUSTOM' && !methodical) throw new Error('Для смены уровня нужен исходный версионный методический профиль');
  const settings = level === 'CUSTOM'
    ? { ...profile.settings, ...structuredClone(changes.settings ?? {}) }
    : structuredClone((methodical as MethodicalAutonomyProfile).levels[level]);
  const next: AutonomyProfile = {
    ...profile,
    level,
    settings,
    intensity: normalizeIntensity({
      categories: { ...profile.intensity.categories, ...changes.intensity?.categories },
      stages: { ...profile.intensity.stages, ...changes.intensity?.stages },
      sides: { ...profile.intensity.sides, ...changes.intensity?.sides },
      areas: { ...profile.intensity.areas, ...changes.intensity?.areas },
    }),
  };
  validateProfile(next);
  return next;
}
