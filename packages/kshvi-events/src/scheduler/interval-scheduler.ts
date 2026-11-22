import { type EventCategory, type EventTemplate } from '../model/event-template';
import { attemptsPerOperationalHour, type AutonomyProfile } from '../profile/autonomy-profile';
import { selectCandidate } from './candidate-selector';
import {
  SCHEDULER_ALGORITHM_VERSION,
  finalizeIntervalTrace,
  replayIntervalResult,
  type CreatedAutonomyEvent,
  type EventCandidateTrace,
  type NonProbabilisticEvent,
  type OperationalInterval,
  type ScheduleIntervalResult,
  type SchedulerIntervalTrace,
  type SchedulerRuntimeState,
  type SchedulerTarget,
  type TraceRejection,
} from './candidate-trace';
import { canonicalHash, drawPoisson } from './weighted-choice';

export type ScheduleIntervalInput = Readonly<{
  startSecond: number;
  endSecond: number;
  intervalIndex: number;
  profile: AutonomyProfile;
  templates: readonly EventTemplate[];
  state: SchedulerRuntimeState;
  targets: readonly SchedulerTarget[];
  categories?: readonly EventCategory[];
  seed: string;
  branchId: string;
  snapshotHash: string;
  templateSetVersion: string;
  algorithmVersion?: number;
  plannedReactiveEvents?: readonly NonProbabilisticEvent[];
  replay?: ScheduleIntervalResult;
}>;

export type ScheduleRangeInput = Readonly<Omit<ScheduleIntervalInput, 'startSecond' | 'endSecond' | 'intervalIndex' | 'replay'> & {
  fromSecond: number;
  toSecond: number;
  journal?: readonly ScheduleIntervalResult[];
  instanceState?: 'ACTIVE' | 'PAUSED';
}>;

export type ScheduleRangeResult = Readonly<{
  results: readonly ScheduleIntervalResult[];
  attempts: number;
  createdEvents: readonly ScheduleIntervalResult['createdEvents'][number][];
  plannedReactiveEvents: readonly NonProbabilisticEvent[];
  state: SchedulerRuntimeState;
  controlHash: string;
}>;

export function fixedOperationalIntervals(fromSecond: number, toSecond: number, intervalMinutes: number): OperationalInterval[] {
  if (!Number.isSafeInteger(fromSecond) || !Number.isSafeInteger(toSecond) || fromSecond < 0 || toSecond < fromSecond) {
    throw new Error('Оперативный диапазон должен быть неотрицательным и не может идти назад');
  }
  if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes < 1) throw new Error('Интервал профиля должен быть положительным целым числом минут');
  if (fromSecond === toSecond) return [];
  const size = intervalMinutes * 60;
  // Закрытый интервал обрабатывается даже при невыровненном fromSecond: журнал
  // worker дедуплицирует его при последующих диапазонах, а ceil безвозвратно его терял.
  const firstStart = Math.floor(fromSecond / size) * size;
  const intervals: OperationalInterval[] = [];
  for (let start = firstStart; start + size <= toSecond; start += size) {
    intervals.push({ index: start / size, startSecond: start, endSecond: start + size });
  }
  return intervals;
}

export function autonomyIntervalKey(branchId: string, interval: OperationalInterval): string {
  return `${branchId}:${interval.index}:${interval.startSecond}:${interval.endSecond}`;
}

function plannedInside(
  events: readonly NonProbabilisticEvent[],
  interval: OperationalInterval,
): NonProbabilisticEvent[] {
  return events
    .filter(event => event.operationalSecond >= interval.startSecond && event.operationalSecond < interval.endSecond)
    .sort((left, right) => left.operationalSecond - right.operationalSecond || left.eventId.localeCompare(right.eventId));
}

export function scheduleInterval(input: ScheduleIntervalInput): ScheduleIntervalResult {
  if (input.replay) return replayIntervalResult(input.replay);
  if (!Number.isSafeInteger(input.startSecond) || !Number.isSafeInteger(input.endSecond) || input.startSecond < 0 || input.endSecond <= input.startSecond) {
    throw new Error('Интервал планировщика должен иметь положительную длительность оперативного времени');
  }
  if (!Number.isSafeInteger(input.intervalIndex) || input.intervalIndex < 0) throw new Error('Индекс интервала должен быть неотрицательным целым числом');
  const interval = { index: input.intervalIndex, startSecond: input.startSecond, endSecond: input.endSecond };
  const algorithmVersion = input.algorithmVersion ?? SCHEDULER_ALGORITHM_VERSION;
  const categories = [...new Set(input.categories ?? input.templates.map(template => template.category))].sort();
  const targets = [...input.targets].sort((left, right) => (
    left.sideId.localeCompare(right.sideId) || left.areaId.localeCompare(right.areaId)
  ));
  const deltaHours = (input.endSecond - input.startSecond) / 3600;
  let workingState: SchedulerRuntimeState = {
    ...structuredClone(input.state),
    operationalSecond: input.startSecond,
    intervalEventCount: 0,
  };
  const traces: EventCandidateTrace[] = [];
  const createdEvents: ScheduleIntervalResult['createdEvents'][number][] = [];
  const attemptsByCategory: Partial<Record<EventCategory, number>> = {};
  const rejections: TraceRejection[] = [];
  const randomKeys = { attempts: [] as string[], selection: [] as string[], target: [] as string[], approval: [] as string[] };
  let expectedAttempts = 0;
  let cascadeAttemptOrdinal = 1_000_000;

  const appendCascades = (
    parentEvent: CreatedAutonomyEvent,
    parentTemplate: EventTemplate,
  ): void => {
    if (parentEvent.status !== 'READY') return;
    for (const templateId of parentTemplate.cascade.allowedTemplateIds) {
      const template = input.templates.find(candidate => candidate.templateId === templateId);
      if (!template) continue;
      const cascade = {
        causeEventIds: [...parentEvent.causeEventIds, parentEvent.eventId],
        depth: parentEvent.cascadeDepth + 1,
        events: createdEvents.filter(event => event.cascadeDepth > 0).length,
      };
      const selected = selectCandidate({
        templates: [template],
        category: template.category,
        profile: input.profile,
        state: workingState,
        target: parentEvent.target,
        interval,
        attemptOrdinal: cascadeAttemptOrdinal++,
        seed: input.seed,
        branchId: input.branchId,
        snapshotHash: input.snapshotHash,
        templateSetVersion: input.templateSetVersion,
        algorithmVersion,
        cascade,
        parentTemplate,
      });
      workingState = selected.state;
      traces.push(selected.trace);
      attemptsByCategory[template.category] = (attemptsByCategory[template.category] ?? 0) + 1;
      randomKeys.selection.push(selected.trace.selectionDigest);
      randomKeys.target.push(selected.trace.targetDigest);
      randomKeys.approval.push(selected.trace.approvalDigest);
      if (selected.trace.rejection) {
        rejections.push({
          code: selected.trace.rejection,
          category: template.category,
          targetKey: `${parentEvent.target.sideId}/${parentEvent.target.areaId}`,
          templateId,
        });
      }
      if (selected.event) {
        createdEvents.push(selected.event);
        appendCascades(selected.event, template);
      }
    }
  };

  for (const category of categories) {
    for (const target of targets) {
      const targetKey = `${target.sideId}/${target.areaId}`;
      const lambda = attemptsPerOperationalHour(input.profile, {
        category,
        stageId: workingState.stageId,
        sideId: target.sideId,
        areaId: target.areaId,
      }) * (target.weight ?? 1);
      const expected = lambda * deltaHours;
      expectedAttempts += expected;
      const draw = drawPoisson(expected, {
        algorithmVersion,
        seed: input.seed,
        branchId: input.branchId,
        snapshotHash: input.snapshotHash,
        templateSetVersion: input.templateSetVersion,
        intervalIndex: interval.index,
        category,
        targetKey,
        purpose: 'attempts',
        ordinal: 0,
      });
      randomKeys.attempts.push(...draw.drawKeys);
      attemptsByCategory[category] = (attemptsByCategory[category] ?? 0) + draw.count;
      for (let attemptOrdinal = 0; attemptOrdinal < draw.count; attemptOrdinal += 1) {
        const selected = selectCandidate({
          templates: input.templates,
          category,
          profile: input.profile,
          state: workingState,
          target,
          interval,
          attemptOrdinal,
          seed: input.seed,
          branchId: input.branchId,
          snapshotHash: input.snapshotHash,
          templateSetVersion: input.templateSetVersion,
          algorithmVersion,
          expectedAttemptsPerHour: lambda,
          intervalExpectedAttempts: expected,
        });
        workingState = selected.state;
        traces.push(selected.trace);
        randomKeys.selection.push(selected.trace.selectionDigest);
        randomKeys.target.push(selected.trace.targetDigest);
        randomKeys.approval.push(selected.trace.approvalDigest);
        if (selected.event) {
          createdEvents.push(selected.event);
          const parentTemplate = input.templates.find(template => template.templateId === selected.event!.templateId);
          if (parentTemplate) appendCascades(selected.event, parentTemplate);
        }
        if (selected.trace.rejection) {
          rejections.push({
            code: selected.trace.rejection,
            category,
            targetKey,
            templateId: selected.trace.selectedTemplateId ?? undefined,
          });
        }
      }
    }
  }

  workingState = { ...workingState, operationalSecond: input.endSecond };
  const trace: SchedulerIntervalTrace = finalizeIntervalTrace({
    interval,
    attempts: traces.length,
    attemptsByCategory,
    expectedAttempts,
    randomKeys,
    rejection: expectedAttempts === 0 ? 'ZERO_INTENSITY' : createdEvents.length === 0 && traces.length > 0 ? traces[0].rejection : null,
    rejections,
    attemptTraceHashes: traces.map(item => item.controlHash),
    createdEventIds: createdEvents.map(event => event.eventId),
  });
  return {
    attempts: traces.length,
    createdEvents,
    traces,
    trace,
    state: workingState,
    plannedReactiveEvents: plannedInside(input.plannedReactiveEvents ?? [], interval),
  };
}

export function scheduleOperationalRange(input: ScheduleRangeInput): ScheduleRangeResult {
  if (input.instanceState === 'PAUSED') {
    return {
      results: [], attempts: 0, createdEvents: [], plannedReactiveEvents: [],
      state: input.state, controlHash: canonicalHash([]),
    };
  }
  const intervals = fixedOperationalIntervals(input.fromSecond, input.toSecond, input.profile.settings.intervalMinutes);
  const journal = new Map((input.journal ?? []).map(result => [autonomyIntervalKey(input.branchId, result.trace.interval), result]));
  const results: ScheduleIntervalResult[] = [];
  let state = input.state;
  for (const interval of intervals) {
    const key = autonomyIntervalKey(input.branchId, interval);
    const replay = journal.get(key);
    const result = scheduleInterval({
      startSecond: interval.startSecond,
      endSecond: interval.endSecond,
      intervalIndex: interval.index,
      profile: input.profile,
      templates: input.templates,
      state,
      targets: input.targets,
      categories: input.categories,
      seed: input.seed,
      branchId: input.branchId,
      snapshotHash: input.snapshotHash,
      templateSetVersion: input.templateSetVersion,
      algorithmVersion: input.algorithmVersion,
      plannedReactiveEvents: input.plannedReactiveEvents,
      replay,
    });
    results.push(result);
    state = result.state;
  }
  const plannedReactiveEvents = results.flatMap(result => result.plannedReactiveEvents);
  return {
    results,
    attempts: results.reduce((sum, result) => sum + result.attempts, 0),
    createdEvents: results.flatMap(result => result.createdEvents),
    plannedReactiveEvents,
    state,
    controlHash: canonicalHash(results.map(result => ({
      interval: result.trace.interval,
      traceHash: result.trace.controlHash,
      eventIds: result.createdEvents.map(event => event.eventId),
    }))),
  };
}
