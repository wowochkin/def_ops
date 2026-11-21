import {
  MORALE_SCALE_V1,
  type MoraleChanges,
  type MoraleRecoveryActivity,
  type MoraleScale,
  type MoraleSource,
} from './morale-model';

export type MoraleRecoveryRule = Readonly<{
  minimumMinutes: number;
  requiredResourceAmount: number;
  resourceUnit: string;
  changes: MoraleChanges;
}>;

/**
 * Все численные коэффициенты принадлежат одной явно названной версии.
 * Это учебные допущения, а не утверждённые реальные нормативы.
 */
export type MoraleProfile = Readonly<{
  id: 'morale-profile';
  version: 1;
  scale: MoraleScale;
  source: MoraleSource;
  componentWeights: Readonly<{ morale: number; cohesion: number; stress: number }>;
  commanderEffects: Readonly<{
    lowDemandDirection: number;
    capabilityMidpoint: number;
    baseWeight: number;
    persistenceWeight: number;
    obedienceWeight: number;
    riskWeight: number;
    lossToleranceWeight: number;
  }>;
  maxImpactPerComponentEvent: number;
  maxChangePerInterval: number;
  minimumStateMinutes: number;
  baseOrderProcessingMinutes: number;
  maxAdditionalOrderMinutes: number;
  minOrderProcessingMinutes: number;
  maxOrderProcessingMinutes: number;
  externalFatigueWeight: number;
  executionMultiplierBase: number;
  executionMultiplierMoraleWeight: number;
  minExecutionMultiplier: number;
  maxExecutionMultiplier: number;
  interruptionThreshold: number;
  startThreshold: number;
  baseReportDelayMinutes: number;
  maxAdditionalReportDelayMinutes: number;
  movementFactorBase: number;
  movementFactorMoraleWeight: number;
  assessmentStaleAfterMinutes: number;
  recoveryRules: Readonly<Record<MoraleRecoveryActivity, MoraleRecoveryRule>>;
}>;

const profileSource: MoraleSource = Object.freeze({
  kind: 'EDUCATIONAL_ASSUMPTION',
  reference: 'MPS-01–MPS-08, SIM-18, SIM-24',
  assumptionId: 'MPS-EFFECTS-V1',
  approvedBy: 'Методист КШВИ',
  applicability: 'Синтетические КШВИ и проверка чувствительности; запрещена оценка реальных людей',
});

export const MORALE_PROFILE_V1: MoraleProfile = Object.freeze({
  id: 'morale-profile',
  version: 1,
  scale: MORALE_SCALE_V1,
  source: profileSource,
  componentWeights: { morale: 0.45, cohesion: 0.35, stress: 0.2 },
  commanderEffects: {
    lowDemandDirection: -0.65,
    capabilityMidpoint: 0.5,
    baseWeight: 0.35,
    persistenceWeight: 0.35,
    obedienceWeight: 0.1,
    riskWeight: 0.15,
    lossToleranceWeight: 0.08,
  },
  maxImpactPerComponentEvent: 0.2,
  maxChangePerInterval: 0.35,
  minimumStateMinutes: 15,
  baseOrderProcessingMinutes: 12,
  maxAdditionalOrderMinutes: 45,
  minOrderProcessingMinutes: 8,
  maxOrderProcessingMinutes: 60,
  externalFatigueWeight: 0.3,
  executionMultiplierBase: 0.55,
  executionMultiplierMoraleWeight: 0.6,
  minExecutionMultiplier: 0.45,
  maxExecutionMultiplier: 1.15,
  interruptionThreshold: 0.65,
  startThreshold: 0.45,
  baseReportDelayMinutes: 5,
  maxAdditionalReportDelayMinutes: 30,
  movementFactorBase: 0.6,
  movementFactorMoraleWeight: 0.4,
  assessmentStaleAfterMinutes: 120,
  recoveryRules: {
    REST_AND_SLEEP: {
      minimumMinutes: 60,
      requiredResourceAmount: 1,
      resourceUnit: 'support-unit',
      changes: { morale: 0.12, cohesion: 0.03, stress: -0.15, fatigue: -0.2, recoveryCapacity: 0.08 },
    },
    WITHDRAWAL_FOR_RECOVERY: {
      minimumMinutes: 90,
      requiredResourceAmount: 2,
      resourceUnit: 'support-unit',
      changes: { morale: 0.16, cohesion: 0.04, stress: -0.18, fatigue: -0.2, recoveryCapacity: 0.1 },
    },
    RESUPPLY: {
      minimumMinutes: 30,
      requiredResourceAmount: 1,
      resourceUnit: 'support-unit',
      changes: { morale: 0.06, stress: -0.05, recoveryCapacity: 0.05 },
    },
    RESTORE_COMMUNICATION: {
      minimumMinutes: 15,
      requiredResourceAmount: 1,
      resourceUnit: 'support-unit',
      changes: { cohesion: 0.03, stress: -0.08, commandTrust: 0.08 },
    },
    STABILIZE_COMMAND: {
      minimumMinutes: 45,
      requiredResourceAmount: 1,
      resourceUnit: 'support-unit',
      changes: { stress: -0.05, commandTrust: 0.12, recoveryCapacity: 0.03 },
    },
    SUCCESSFUL_SUPPORT: {
      minimumMinutes: 30,
      requiredResourceAmount: 1,
      resourceUnit: 'support-unit',
      changes: { morale: 0.1, stress: -0.05, commandTrust: 0.1 },
    },
    REPLACEMENT: {
      minimumMinutes: 60,
      requiredResourceAmount: 2,
      resourceUnit: 'support-unit',
      changes: { morale: 0.05, cohesion: 0.02, fatigue: -0.1, recoveryCapacity: 0.1 },
    },
  },
});
