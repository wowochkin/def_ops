import type { EventCategory, EventTemplate } from '../../../../packages/kshvi-events/src/model/event-template';
import type { AutonomyProfile } from '../../../../packages/kshvi-events/src/profile/autonomy-profile';
import {
  replayIntervalResult,
  type CreatedAutonomyEvent,
  type ScheduleIntervalResult,
  type SchedulerRuntimeState,
  type SchedulerTarget,
} from '../../../../packages/kshvi-events/src/scheduler/candidate-trace';
import {
  autonomyIntervalKey,
  fixedOperationalIntervals,
  scheduleInterval,
} from '../../../../packages/kshvi-events/src/scheduler/interval-scheduler';
import { canonicalHash } from '../../../../packages/kshvi-events/src/scheduler/weighted-choice';

/** Единственный выход worker в домен: общая серверная командная очередь. */
export type AutonomyQueueCommand = Readonly<{
  commandId: string;
  idempotencyKey: string;
  kind: CreatedAutonomyEvent['operations'][number]['kind'];
  instanceId: string;
  branchId: string;
  operationalSecond: number;
  operationalAt?: string;
  priority: number;
  sequence: number;
  payload: Readonly<Record<string, unknown>>;
}>;
export type AutonomyQueueReceipt = Readonly<{ idempotent: boolean }>;
export type AutonomyCommandQueue = Readonly<{
  enqueue(command: AutonomyQueueCommand): Promise<AutonomyQueueReceipt>;
}>;

export type AutonomyWorkerJournalState = Readonly<{
  version: 1;
  intervals: Readonly<Record<string, ScheduleIntervalResult>>;
  processedIntervalKeys: readonly string[];
  schedulerState?: SchedulerRuntimeState;
}>;
export type AutonomyWorkerJournal = Readonly<{
  load(instanceId: string, branchId: string): Promise<AutonomyWorkerJournalState>;
  save(state: AutonomyWorkerJournalState, instanceId: string, branchId: string): Promise<void>;
}>;

export type RunAutonomyWorkerInput = Readonly<{
  instanceId: string;
  instanceState: 'ACTIVE' | 'PAUSED';
  operationalStartAt: string;
  profile: AutonomyProfile;
  templates: readonly EventTemplate[];
  state: SchedulerRuntimeState;
  targets: readonly SchedulerTarget[];
  categories?: readonly EventCategory[];
  seed: string;
  branchId: string;
  snapshotHash: string;
  templateSetVersion: string;
  fromSecond: number;
  toSecond: number;
  plannedReactiveEvents?: ScheduleIntervalResult['plannedReactiveEvents'];
  queue: AutonomyCommandQueue;
  journal: AutonomyWorkerJournal;
}>;

export type AutonomyWorkerResult = Readonly<{
  results: readonly ScheduleIntervalResult[];
  attempts: number;
  createdEvents: readonly CreatedAutonomyEvent[];
  plannedReactiveEvents: ScheduleIntervalResult['plannedReactiveEvents'];
  enqueuedOperations: number;
  recoveredIntervals: number;
  skippedIntervals: number;
  state: SchedulerRuntimeState;
  controlHash: string;
}>;

function controlHash(results: readonly ScheduleIntervalResult[]): string {
  return canonicalHash(results.map(result => ({
    interval: result.trace.interval,
    traceHash: result.trace.controlHash,
    eventIds: result.createdEvents.map(event => event.eventId),
  })));
}

function operationalAt(input: RunAutonomyWorkerInput, operationalSecond: number): string {
  const startedAt = Date.parse(input.operationalStartAt);
  if (!Number.isFinite(startedAt)) throw new Error('Некорректная оперативная привязка autonomy worker');
  return new Date(startedAt + operationalSecond * 1000).toISOString();
}
function commandFor(
  input: RunAutonomyWorkerInput,
  event: CreatedAutonomyEvent,
  operation: CreatedAutonomyEvent['operations'][number],
  intervalIndex: number,
  sequenceInInterval: number,
): AutonomyQueueCommand {
  return {
    commandId: operation.operationId,
    idempotencyKey: operation.idempotencyKey,
    kind: operation.kind,
    instanceId: input.instanceId,
    branchId: input.branchId,
    operationalSecond: event.operationalSecond,
    operationalAt: operationalAt(input, event.operationalSecond),
    priority: 100,
    sequence: intervalIndex * 1_000_000 + sequenceInInterval,
    payload: {
      ...operation.payload,
      autonomyEventId: event.eventId,
      occurrenceKey: event.occurrenceKey,
      templateId: event.templateId,
      cascadeDepth: event.cascadeDepth,
    },
  };
}

export async function runAutonomyWorker(input: RunAutonomyWorkerInput): Promise<AutonomyWorkerResult> {
  const loaded = await input.journal.load(input.instanceId, input.branchId);
  if (loaded.version !== 1) throw new Error('Неподдерживаемая версия журнала autonomy worker');
  if (input.instanceState === 'PAUSED') {
    return {
      results: [], attempts: 0, createdEvents: [], plannedReactiveEvents: [], enqueuedOperations: 0,
      recoveredIntervals: 0, skippedIntervals: 0, state: loaded.schedulerState ?? input.state,
      controlHash: canonicalHash([]),
    };
  }

  const stored: Record<string, ScheduleIntervalResult> = { ...loaded.intervals };
  const processed = new Set(loaded.processedIntervalKeys);
  let schedulerState = loaded.schedulerState ?? input.state;
  const results: ScheduleIntervalResult[] = [];
  let enqueuedOperations = 0;
  let recoveredIntervals = 0;
  let skippedIntervals = 0;
  const intervals = fixedOperationalIntervals(
    input.fromSecond,
    input.toSecond,
    input.profile.settings.intervalMinutes,
  );

  const save = async () => {
    await input.journal.save({
      version: 1,
      intervals: stored,
      processedIntervalKeys: [...processed].sort(),
      schedulerState,
    }, input.instanceId, input.branchId);
  };

  for (const interval of intervals) {
    const key = autonomyIntervalKey(input.branchId, interval);
    if (processed.has(key)) {
      const saved = stored[key];
      if (!saved) throw new Error(`Журнал потерял след обработанного интервала ${key}; новый розыгрыш запрещён`);
      const replayed = replayIntervalResult(saved);
      results.push(replayed);
      schedulerState = saved.state;
      skippedIntervals += 1;
      continue;
    }

    const pending = stored[key];
    const result = pending
      ? replayIntervalResult(pending)
      : scheduleInterval({
          startSecond: interval.startSecond,
          endSecond: interval.endSecond,
          intervalIndex: interval.index,
          profile: input.profile,
          templates: input.templates,
          state: schedulerState,
          targets: input.targets,
          categories: input.categories,
          seed: input.seed,
          branchId: input.branchId,
          snapshotHash: input.snapshotHash,
          templateSetVersion: input.templateSetVersion,
          plannedReactiveEvents: input.plannedReactiveEvents,
        });
    if (pending) recoveredIntervals += 1;
    if (!pending) {
      stored[key] = result;
      await save();
    }

    let sequenceInInterval = 0;
    for (const event of result.createdEvents) {
      for (const operation of event.operations) {
        await input.queue.enqueue(commandFor(input, event, operation, interval.index, sequenceInInterval));
        sequenceInInterval += 1;
        enqueuedOperations += 1;
      }
    }
    for (const event of result.plannedReactiveEvents) {
      const operations: CreatedAutonomyEvent['operations'] = event.operations?.length ? event.operations : [{
        operationId: `${event.eventId}-world-effects`,
        kind: 'applyWorldEffects',
        idempotencyKey: `autonomy:${input.branchId}:${event.eventId}:world-effects`,
        payload: event.payload ?? {},
      }];
      for (const operation of operations) {
        await input.queue.enqueue({
          commandId: operation.operationId,
          idempotencyKey: operation.idempotencyKey,
          kind: operation.kind,
          instanceId: input.instanceId,
          branchId: input.branchId,
          operationalSecond: event.operationalSecond,
          operationalAt: operationalAt(input, event.operationalSecond),
          priority: event.kind === 'REACTIVE' ? 90 : 100,
          sequence: interval.index * 1_000_000 + sequenceInInterval,
          payload: { ...event.payload, ...operation.payload, plannedReactiveEventId: event.eventId, plannedReactiveKind: event.kind },
        });
        sequenceInInterval += 1;
        enqueuedOperations += 1;
      }
    }
    schedulerState = result.state;
    processed.add(key);
    stored[key] = pending ?? result;
    await save();
    results.push(result);
  }

  return {
    results,
    attempts: results.reduce((sum, result) => sum + result.attempts, 0),
    createdEvents: results.flatMap(result => result.createdEvents),
    plannedReactiveEvents: results.flatMap(result => result.plannedReactiveEvents),
    enqueuedOperations,
    recoveredIntervals,
    skippedIntervals,
    state: schedulerState,
    controlHash: controlHash(results),
  };
}
