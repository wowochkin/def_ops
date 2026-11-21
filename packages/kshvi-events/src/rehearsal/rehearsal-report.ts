import type { EventCategory, EventTemplate } from '../model/event-template';
import type { AutonomyLevel, AutonomyProfile } from '../profile/autonomy-profile';
import type { ScheduleRangeResult } from '../scheduler/interval-scheduler';
import type { SchedulerRejectionCode } from '../scheduler/candidate-trace';

export type OverloadWarning = Readonly<{
  code: 'ATTEMPT_OVERLOAD' | 'EVENT_INTERVAL_LIMIT' | 'EVENT_STAGE_LIMIT' | 'SEVERITY_BUDGET_EXCEEDED';
  message: string;
  intervalIndex?: number;
}>;

export type RehearsalRunReport = Readonly<{
  seed: string;
  profileLevel: AutonomyLevel;
  profileId: string;
  methodicalProfileVersion: number;
  attemptCount: number;
  eventCount: number;
  emptyIntervals: number;
  frequenciesByCategory: Readonly<Partial<Record<EventCategory, number>>>;
  rejectionReasons: Readonly<Partial<Record<SchedulerRejectionCode, number>>>;
  maxCascadeDepth: number;
  maxCascadeEvents: number;
  learningQuestions: readonly string[];
  overloadWarnings: readonly OverloadWarning[];
  controlHash: string;
}>;

export type RehearsalReport = Readonly<{
  reportVersion: 1;
  algorithmVersion: number;
  catalogVersion: string;
  methodicalProfile: Readonly<{ profileId: string; version: number }>;
  runs: readonly RehearsalRunReport[];
}>;

export function createRehearsalRunReport(input: {
  seed: string;
  profile: AutonomyProfile;
  templates: readonly EventTemplate[];
  result: ScheduleRangeResult;
}): RehearsalRunReport {
  const frequencies: Partial<Record<EventCategory, number>> = {};
  const rejectionReasons: Partial<Record<SchedulerRejectionCode, number>> = {};
  const learningQuestions = new Set<string>();
  const warnings: OverloadWarning[] = [];
  const byId = new Map(input.templates.map(template => [template.templateId, template]));
  let maxCascadeDepth = 0;
  const cascadeChildren = new Map<string, number>();

  for (const event of input.result.createdEvents) {
    frequencies[event.category] = (frequencies[event.category] ?? 0) + 1;
    maxCascadeDepth = Math.max(maxCascadeDepth, event.cascadeDepth);
    const question = byId.get(event.templateId)?.learningQuestion;
    if (question) learningQuestions.add(question);
    if (event.cascadeDepth > 0 && event.causeEventIds[0]) {
      cascadeChildren.set(event.causeEventIds[0], (cascadeChildren.get(event.causeEventIds[0]) ?? 0) + 1);
    }
  }
  for (const interval of input.result.results) {
    const codes = new Set<SchedulerRejectionCode>();
    for (const trace of interval.traces) {
      if (trace.rejection) codes.add(trace.rejection);
      if (!trace.rejection || trace.candidates.length === 0) {
        if (trace.rejection) rejectionReasons[trace.rejection] = (rejectionReasons[trace.rejection] ?? 0) + 1;
      }
      for (const candidate of trace.candidates) {
        for (const reason of candidate.rejectionReasons) {
          rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
          codes.add(reason);
        }
      }
    }
    if (interval.attempts > Math.max(20, input.profile.settings.maxEventsPerInterval * 8)) {
      warnings.push({
        code: 'ATTEMPT_OVERLOAD',
        intervalIndex: interval.trace.interval.index,
        message: `Число попыток ${interval.attempts} заметно превышает лимит событий интервала ${input.profile.settings.maxEventsPerInterval}.`,
      });
    }
    for (const code of ['EVENT_INTERVAL_LIMIT', 'EVENT_STAGE_LIMIT', 'SEVERITY_BUDGET_EXCEEDED'] as const) {
      if (codes.has(code)) {
        warnings.push({
          code,
          intervalIndex: interval.trace.interval.index,
          message: `В интервале ${interval.trace.interval.index} сработало ограничение ${code}; повторные попытки не выполнялись сверх заранее полученного числа.`,
        });
      }
    }
  }

  return {
    seed: input.seed,
    profileLevel: input.profile.level,
    profileId: input.profile.profileId,
    methodicalProfileVersion: input.profile.methodicalProfile.version,
    attemptCount: input.result.attempts,
    eventCount: input.result.createdEvents.length,
    emptyIntervals: input.result.results.filter(interval => interval.createdEvents.length === 0).length,
    frequenciesByCategory: frequencies,
    rejectionReasons,
    maxCascadeDepth,
    maxCascadeEvents: Math.max(0, ...cascadeChildren.values()),
    learningQuestions: [...learningQuestions].sort(),
    overloadWarnings: warnings,
    controlHash: input.result.controlHash,
  };
}

export function serializeRehearsalReport(report: RehearsalReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
