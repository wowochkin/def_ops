import type { EventTemplate } from '../../src/model/event-template';
import { createAutonomyProfile, type AutonomyProfile, type AutonomyLevel, type AutonomyNumericSettings, type IntensityAxes } from '../../src/profile/autonomy-profile';
import { METHODICAL_AUTONOMY_PROFILE_V1 } from '../../src/profile/intensity-levels';
import type { SchedulerRuntimeState, SchedulerTarget } from '../../src/scheduler/candidate-trace';
import type { ScheduleIntervalInput } from '../../src/scheduler/interval-scheduler';
import { validTemplate } from './valid-template';

export const blueNorthTarget: SchedulerTarget = {
  sideId: 'blue',
  areaId: 'area-north',
  latitude: 50.5,
  longitude: 30.5,
};

export function makeTemplate(overrides: Partial<EventTemplate> = {}): EventTemplate {
  const base = structuredClone(validTemplate);
  base.preconditions = [];
  base.limits = {
    cooldownSeconds: 0,
    maxOccurrences: 100,
    maxPerStage: 100,
    mutuallyExclusiveGroupIds: [],
  };
  base.applicability.operationalWindows = [{ startMinute: 0, endMinute: 525_600 }];
  return { ...base, ...structuredClone(overrides) };
}

export function makeProfile(
  level: AutonomyLevel = 'HIGH',
  settings: Partial<AutonomyNumericSettings> = {},
  intensity: Partial<IntensityAxes> = {},
): AutonomyProfile {
  const presetLevel = level === 'CUSTOM' || level === 'OFF' ? 'HIGH' : level;
  const preset = METHODICAL_AUTONOMY_PROFILE_V1.levels[presetLevel];
  const custom = Object.keys(settings).length > 0 || level === 'CUSTOM';
  return createAutonomyProfile({
    profileId: 'autonomy-test',
    level: custom ? 'CUSTOM' : level,
    settings: custom ? { ...preset, ...settings } : undefined,
    intensity: {
      categories: {},
      stages: {},
      sides: {},
      areas: {},
      ...structuredClone(intensity),
    },
  });
}

export function makeState(overrides: Partial<SchedulerRuntimeState> = {}): SchedulerRuntimeState {
  return {
    stageId: 'stage-main',
    scale: 'tactical',
    operationalSecond: 0,
    facts: { 'resources.blue.fuel.status': 'AVAILABLE' },
    resources: [{ resourceId: 'fuel', ownerSideId: 'blue', unit: 'L', onHand: 100_000 }],
    availableObservationSourceIds: ['logistics-unit-blue'],
    availableChannelIds: ['logistics-channel', 'scenario-channel'],
    environmentCoverageAreaIds: ['area-north'],
    occurrences: [],
    intervalEventCount: 0,
    stageEventCount: 0,
    stageSeverityCost: 0,
    ...structuredClone(overrides),
  };
}

export function makeScheduleInput(overrides: Partial<ScheduleIntervalInput> = {}): ScheduleIntervalInput {
  return {
    startSecond: 0,
    endSecond: 3600,
    intervalIndex: 0,
    profile: makeProfile(),
    templates: [makeTemplate()],
    state: makeState(),
    targets: [blueNorthTarget],
    seed: 'ac19-fixed-seed',
    branchId: 'branch-main',
    snapshotHash: 'snapshot-v1',
    templateSetVersion: 'catalog-v1',
    plannedReactiveEvents: [],
    ...structuredClone(overrides),
  };
}
