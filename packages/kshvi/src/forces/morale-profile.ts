import storedProfile from '../../data/profiles/morale-v1.json';
import type {
  MoraleChanges,
  MoraleRecoveryActivity,
  MoraleScale,
  MoraleSource,
} from './morale-model';

export type MoraleRecoveryRule = Readonly<{
  minimumMinutes: number;
  requiredResourceAmount: number;
  resourceUnit: string;
  changes: MoraleChanges;
}>;

/** Все коэффициенты поставляются версионным JSON-профилем и остаются учебными допущениями. */
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

export const MORALE_PROFILE_V1 = Object.freeze(storedProfile) as unknown as MoraleProfile;
