import type { AssumptionSource } from '../model/assumptions';

export type MovementClass = 'FOOT' | 'WHEELED' | 'TRACKED' | 'UNIT' | 'COLUMN';
export type TerrainKind = 'FOREST' | 'MARSH' | 'ROAD' | 'RIVER' | 'BRIDGE' | 'FORD' | 'FERRY' | 'PONTOON' | 'ICE_CROSSING';
export type TerrainStatus = 'OPEN' | 'DEGRADED' | 'CLOSED' | 'UNKNOWN';
export type TerrainGeometry = Readonly<{ type: string; coordinates: unknown }>;

export type TerrainObject = Readonly<{
  id: string;
  kind: TerrainKind;
  geometry: TerrainGeometry;
  status: TerrainStatus;
  dataAt: string;
  source: string;
  uncertainty: string;
  speedKph?: Readonly<Partial<Record<MovementClass, number | null>>>;
  capacityTonnes?: number | null;
  capacityPerHour?: number | null;
  simultaneousCapacity?: number;
  crossingMinutes?: number | null;
  widthM?: number | null;
  heightM?: number | null;
  density?: number | null;
  species?: string | null;
  leafiness?: 'LEAFLESS' | 'LEAFY' | 'UNKNOWN';
  blockage?: boolean;
  fire?: boolean;
  damage?: string;
  moisture?: number | null;
  frozen?: boolean;
  surface?: 'PAVED' | 'UNPAVED' | 'UNKNOWN';
  mud?: 'NONE' | 'MODERATE' | 'HEAVY' | 'UNKNOWN';
  flooded?: boolean;
  depthM?: number | null;
  currentMps?: number | null;
  waterLevelM?: number | null;
  ice?: 'NONE' | 'FORMING' | 'FROZEN' | 'THAWING' | 'UNKNOWN';
  bottom?: 'FIRM' | 'SOFT' | 'UNKNOWN';
  workingMinutesPerCycle?: number | null;
  deployed?: boolean;
  equipmentStatus?: 'SERVICEABLE' | 'DEGRADED' | 'DAMAGED' | 'UNKNOWN';
  iceThicknessM?: number | null;
}>;

export type TerrainPatch = Readonly<Partial<Omit<TerrainObject, 'id' | 'kind'>>>;
export type TerrainVisibility = 'PUBLIC' | 'HIDDEN';

export type TerrainEventInput = Readonly<{
  id: string;
  type: string;
  objectId: string;
  operationalAt: string;
  geometry: TerrainGeometry;
  reason: string;
  causeIds: readonly string[];
  visibility: TerrainVisibility;
  patch: TerrainPatch;
}>;

export type TerrainHistoryEvent = TerrainEventInput & Readonly<{
  before: TerrainObject;
  after: TerrainObject;
}>;

export type CrossingReservation = Readonly<{
  id: string;
  crossingId: string;
  columnId: string;
  movementClass: MovementClass;
  loadTonnes: number;
  arrivalAt: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
}>;

export type CrossingQueue = Readonly<{
  crossingId: string;
  reservations: readonly CrossingReservation[];
}>;

export type TerrainState = Readonly<{
  schemaVersion: 1;
  operationalAt: string;
  revision: number;
  status: 'READY' | 'REQUIRES_REVIEW';
  unknown: readonly string[];
  objects: Readonly<Record<string, TerrainObject>>;
  initialObjects: Readonly<Record<string, TerrainObject>>;
  history: readonly TerrainHistoryEvent[];
  queues: Readonly<Record<string, CrossingQueue>>;
  algorithmVersions: Readonly<{ H_v: number; G_v: number }>;
  profileId: string;
  profileVersion: number;
  weatherEffectProfileVersion: number;
}>;

export type TerrainHydrologyRule = Readonly<{
  id: string;
  kind: TerrainKind;
  input: string;
  unit: string;
  range: readonly [number, number];
  condition: Readonly<{ min: number; max: number }>;
  reason: string;
  set: TerrainPatch;
  movementClasses: readonly MovementClass[];
  outside: 'REQUIRES_REVIEW';
  source: AssumptionSource;
}>;

export type TerrainHydrologyProfile = Readonly<{
  id: string;
  version: number;
  hydrologyVersion: number;
  graphVersion: number;
  weatherEffectProfileVersion: number;
  status: 'APPROVED' | 'DRAFT';
  approvedBy: string;
  requiredWeather: readonly string[];
  rules: readonly TerrainHydrologyRule[];
}>;

export type TerrainAdvanceInput = Readonly<{
  operationalAt: string;
  weather?: Readonly<{ eventId: string; state: Readonly<Record<string, number | null | undefined>> }>;
  events?: readonly TerrainEventInput[];
  profile: TerrainHydrologyProfile;
}>;
