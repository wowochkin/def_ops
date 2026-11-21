export type Brand<T, B extends string> = T & { readonly __brand: B };
export type UUID = Brand<string, 'UUID'>;
export type Sha256 = Brand<string, 'Sha256'>;
export type ISODateTime = Brand<string, 'ISODateTime'>;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type VersionRef = Readonly<{ id: string; revision: number; sha256: string }>;
export type Quantity = Readonly<{ value: number | null; unit: string; status: 'KNOWN' | 'UNKNOWN' }>;
export type Unknown<T> = Readonly<{ status: 'UNKNOWN'; reason: string } | { status: 'KNOWN'; value: T }>;
export type WallClockAt = Brand<ISODateTime, 'WallClockAt'>;
export type OperationalTime = Readonly<{
  normalizedAt: ISODateTime;
  originalAt: string;
  zone: string;
  offset: string;
}>;
export type TimeRange = Readonly<{ from: OperationalTime; to: OperationalTime }>;
export type ExerciseScale = 'tactical' | 'operational' | 'strategic' | 'custom';
export type ExercisePurpose = 'planned' | 'special' | 'inspection' | 'research' | 'exposition' | 'custom';
export type SimulationMethod = 'full-simulation';
export type InstanceKind = 'CONDUCT' | 'EXPOSITION';
export type ScenarioState = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SEALED' | 'CANCELLED';
export type InstanceState = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'ABORTED' | 'ARCHIVED';
export type DecisionSource = 'HUMAN' | 'SCRIPT' | 'PLAYBOOK' | 'AGENT' | 'HYBRID';
export type SideMode = 'ONE_SIDED' | 'TWO_SIDED';

export type ScaleProfile = Readonly<{
  id: string;
  scale: ExerciseScale;
  title: string;
  requiredAttributes: readonly string[];
  aggregation: 'EPISODE' | 'UNIT' | 'FORMATION' | 'GROUPING' | 'CAMPAIGN';
  planningHorizon: Quantity;
  calculationStep: Quantity;
  documentTypes: readonly string[];
  requiredLayers: readonly string[];
  assessmentCriteria: readonly string[];
  version: VersionRef;
}>;

export type ActionTaxonomy = Readonly<{
  version: number;
  categories: readonly Readonly<{
    id: string;
    title: string;
    allowedStageTransitions: readonly string[];
  }>[];
}>;

export function versionRef(value: { id: string; revision: number | 'current'; sha256?: string }): VersionRef {
  if (value.revision === 'current' || !value.sha256) throw new Error('Нужна неизменяемая версионная ссылка с редакцией и SHA-256');
  if (!value.id.trim()) throw new Error('В версионной ссылке нужен идентификатор');
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error('Редакция версионной ссылки должна быть положительным целым');
  if (!/^[0-9a-f]{64}$/.test(value.sha256)) throw new Error('Версионная ссылка требует корректный SHA-256');
  return Object.freeze({ id: value.id, revision: value.revision, sha256: value.sha256 });
}
