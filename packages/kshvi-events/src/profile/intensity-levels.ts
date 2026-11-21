export const AUTONOMY_LEVELS = ['OFF', 'LOW', 'MEDIUM', 'HIGH', 'CUSTOM'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export type NamedAutonomyLevel = Exclude<AutonomyLevel, 'CUSTOM'>;

/** Числа именованных уровней принадлежат только версионному методическому профилю. */
export type AutonomyNumericSettings = Readonly<{
  attemptsPerOperationalHour: number;
  intervalMinutes: number;
  maxEventsPerInterval: number;
  maxEventsPerStage: number;
  maxSeverityCost: number;
  severityBudgetPerStage: number;
  maxCascadeDepth: number;
  maxCascadeEvents: number;
  manualApprovalShare: number;
}>;

export type MethodicalAutonomyProfile = Readonly<{
  profileId: string;
  version: number;
  levels: Readonly<Record<NamedAutonomyLevel, AutonomyNumericSettings>>;
}>;

export const METHODICAL_AUTONOMY_PROFILE_V1: MethodicalAutonomyProfile = Object.freeze({
  profileId: 'kshvi-autonomy-methodical',
  version: 1,
  levels: Object.freeze({
    OFF: Object.freeze({
      attemptsPerOperationalHour: 0,
      intervalMinutes: 15,
      maxEventsPerInterval: 0,
      maxEventsPerStage: 0,
      maxSeverityCost: 0,
      severityBudgetPerStage: 0,
      maxCascadeDepth: 0,
      maxCascadeEvents: 0,
      manualApprovalShare: 0,
    }),
    LOW: Object.freeze({
      attemptsPerOperationalHour: 2,
      intervalMinutes: 30,
      maxEventsPerInterval: 2,
      maxEventsPerStage: 40,
      maxSeverityCost: 2,
      severityBudgetPerStage: 80,
      maxCascadeDepth: 1,
      maxCascadeEvents: 2,
      manualApprovalShare: 0.5,
    }),
    MEDIUM: Object.freeze({
      attemptsPerOperationalHour: 8,
      intervalMinutes: 15,
      maxEventsPerInterval: 6,
      maxEventsPerStage: 120,
      maxSeverityCost: 3,
      severityBudgetPerStage: 240,
      maxCascadeDepth: 2,
      maxCascadeEvents: 4,
      manualApprovalShare: 0.2,
    }),
    HIGH: Object.freeze({
      attemptsPerOperationalHour: 24,
      intervalMinutes: 60,
      maxEventsPerInterval: 12,
      maxEventsPerStage: 400,
      maxSeverityCost: 4,
      severityBudgetPerStage: 1000,
      maxCascadeDepth: 3,
      maxCascadeEvents: 8,
      manualApprovalShare: 0,
    }),
  }),
});
