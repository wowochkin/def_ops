import type { EventCategory, EventTemplate } from '../model/event-template';
import { createAutonomyProfile, type AutonomyProfile } from '../profile/autonomy-profile';
import { SCHEDULER_ALGORITHM_VERSION, type NonProbabilisticEvent, type SchedulerRuntimeState, type SchedulerTarget } from '../scheduler/candidate-trace';
import { scheduleOperationalRange } from '../scheduler/interval-scheduler';
import { createRehearsalRunReport, type RehearsalReport } from './rehearsal-report';

export type RehearseCatalogInput = Readonly<{
  templates: readonly EventTemplate[];
  profile: AutonomyProfile;
  seeds: readonly string[];
  fromSecond: number;
  toSecond: number;
  state: SchedulerRuntimeState;
  targets: readonly SchedulerTarget[];
  categories?: readonly EventCategory[];
  branchId: string;
  snapshotHash: string;
  templateSetVersion: string;
  plannedReactiveEvents?: readonly NonProbabilisticEvent[];
}>;

export function rehearseCatalog(input: RehearseCatalogInput): RehearsalReport {
  if (input.seeds.length === 0 || new Set(input.seeds).size !== input.seeds.length) {
    throw new Error('Репетиция требует непустой набор уникальных зёрен');
  }
  if (input.profile.settings.attemptsPerOperationalHour <= 0) throw new Error('Высокий профиль репетиции должен иметь положительную интенсивность');
  const zeroProfile = createAutonomyProfile({
    profileId: `${input.profile.profileId}-zero`,
    level: 'OFF',
    intensity: input.profile.intensity,
  });
  const runs = [zeroProfile, input.profile].flatMap(profile => input.seeds.map(seed => {
    const result = scheduleOperationalRange({
      profile,
      templates: input.templates,
      state: structuredClone(input.state),
      targets: input.targets,
      categories: input.categories,
      seed,
      branchId: input.branchId,
      snapshotHash: input.snapshotHash,
      templateSetVersion: input.templateSetVersion,
      plannedReactiveEvents: input.plannedReactiveEvents,
      fromSecond: input.fromSecond,
      toSecond: input.toSecond,
      instanceState: 'ACTIVE',
    });
    return createRehearsalRunReport({ seed, profile, templates: input.templates, result });
  }));
  return {
    reportVersion: 1,
    algorithmVersion: SCHEDULER_ALGORITHM_VERSION,
    catalogVersion: input.templateSetVersion,
    methodicalProfile: input.profile.methodicalProfile,
    runs,
  };
}
