export const MORALE_COMPONENT_NAMES = [
  'morale',
  'cohesion',
  'stress',
  'fatigue',
  'commandTrust',
  'recoveryCapacity',
] as const;

export type MoraleComponentName = typeof MORALE_COMPONENT_NAMES[number];
export type MoraleUncertainty = 'EXACT_SCENARIO_VALUE' | 'ESTIMATED';

/** Происхождение каждого числового входа: источник либо явное учебное допущение. */
export type MoraleSource = Readonly<{
  kind: 'APPROVED_REFERENCE' | 'EDUCATIONAL_ASSUMPTION';
  reference: string;
  assumptionId: string;
  approvedBy: string;
  applicability: string;
}>;

export type KnownMoraleComponent = Readonly<{
  status: 'KNOWN';
  value: number;
  uncertainty: MoraleUncertainty;
  observedAt: string;
  source: MoraleSource;
}>;

export type UnknownMoraleComponent = Readonly<{
  status: 'UNKNOWN';
  value?: undefined;
  reason: string;
  observedAt: string;
}>;

export type MoraleComponentValue = KnownMoraleComponent | UnknownMoraleComponent;
export type MoraleComponents = Readonly<Record<MoraleComponentName, MoraleComponentValue>>;
export type MoraleChanges = Readonly<Partial<Record<MoraleComponentName, number>>>;

export type MoraleRangeId = 'CRITICAL' | 'LOW' | 'STABLE' | 'HIGH';
export type MoraleScale = Readonly<{
  id: 'morale-unit-interval';
  version: 1;
  minimum: 0;
  maximum: 1;
  ranges: readonly Readonly<{
    id: MoraleRangeId;
    minimum: number;
    maximum: number;
    semantic: string;
  }>[];
  source: MoraleSource;
}>;

const scaleSource: MoraleSource = Object.freeze({
  kind: 'EDUCATIONAL_ASSUMPTION',
  reference: 'MPS-01/SIM-18: нормированная шкала переходов',
  assumptionId: 'MPS-SCALE-V1',
  approvedBy: 'Методист КШВИ',
  applicability: 'Только моделируемые силы КШВИ; не психологическая диагностика людей',
});

/** Единая шкала не означает, что неизвестная компонента равна середине или норме. */
export const MORALE_SCALE_V1: MoraleScale = Object.freeze({
  id: 'morale-unit-interval',
  version: 1,
  minimum: 0,
  maximum: 1,
  ranges: Object.freeze([
    Object.freeze({ id: 'CRITICAL' as const, minimum: 0, maximum: 0.2, semantic: 'Критический диапазон сценарной способности к управлению и исполнению' }),
    Object.freeze({ id: 'LOW' as const, minimum: 0.2, maximum: 0.45, semantic: 'Сниженный диапазон сценарной способности к управлению и исполнению' }),
    Object.freeze({ id: 'STABLE' as const, minimum: 0.45, maximum: 0.75, semantic: 'Устойчивый диапазон сценарной способности к управлению и исполнению' }),
    Object.freeze({ id: 'HIGH' as const, minimum: 0.75, maximum: 1, semantic: 'Высокий диапазон сценарной способности к управлению и исполнению' }),
  ]),
  source: scaleSource,
});

export type MoraleImpactKind =
  | 'INITIAL_PREPARATION'
  | 'INITIAL_COHESION'
  | 'TASK_SUCCEEDED'
  | 'TASK_FAILED'
  | 'LOSSES'
  | 'ACTION_DURATION'
  | 'ACTION_INTENSITY'
  | 'REST_AND_SLEEP'
  | 'ISOLATION'
  | 'ENCIRCLEMENT'
  | 'FLANK_THREAT'
  | 'COMMAND_QUALITY'
  | 'COMMAND_CONTINUITY'
  | 'PROMISED_SUPPORT'
  | 'SUPPLY'
  | 'COMMUNICATION_LOSS'
  | 'RUMORS'
  | 'CONTRADICTORY_INFORMATION'
  | 'REPLACEMENT'
  | 'COMMAND_CHANGE';

export type MoraleImpact = Readonly<{
  eventId: string;
  kind: MoraleImpactKind;
  occurredAt: string;
  changes: MoraleChanges;
  source: MoraleSource;
}>;

export type MoraleRecoveryActivity =
  | 'REST_AND_SLEEP'
  | 'WITHDRAWAL_FOR_RECOVERY'
  | 'RESUPPLY'
  | 'RESTORE_COMMUNICATION'
  | 'STABILIZE_COMMAND'
  | 'SUCCESSFUL_SUPPORT'
  | 'REPLACEMENT';

export type MoraleRecoveryInput = Readonly<{
  eventId: string;
  activity: MoraleRecoveryActivity;
  durationMinutes: number;
  availableResources: Readonly<{ resourceId: string; amount: number; unit: string }>;
  source: MoraleSource;
}>;

export type MoraleResourceConsumption = Readonly<{
  eventId: string;
  resourceId: string;
  amount: number;
  unit: string;
}>;

export type MoraleContribution = Readonly<{
  eventId: string;
  factor: 'MORALE_IMPACT' | 'RECOVERY';
  kind: string;
  changes: MoraleChanges;
  source: MoraleSource;
}>;

export type MoraleHistoryEntry = Readonly<{
  at: string;
  intervalMinutes: number;
  contributions: readonly MoraleContribution[];
  intervalChanges: MoraleChanges;
  duplicateEventIds: readonly string[];
  recoveryStatus: 'NONE' | 'APPLIED' | 'BLOCKED' | 'DUPLICATE';
}>;

/** Истинное состояние только моделируемой силы, а не реального участника. */
export type MoralePsychState = Readonly<{
  schemaVersion: 1;
  profileVersion: 1;
  subject: Readonly<{ kind: 'SIMULATED_FORCE'; forceId: string }>;
  scale: MoraleScale;
  components: MoraleComponents;
  at: string;
  stateEnteredAt: string;
  appliedEventIds: readonly string[];
  history: readonly MoraleHistoryEntry[];
}>;
