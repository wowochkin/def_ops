import { describe, expect, it } from 'vitest';
import { runAutonomyWorker, type AutonomyQueueCommand, type AutonomyWorkerJournalState } from '../src/runtime/autonomy-worker';
import type { ScheduleIntervalResult } from '../../../packages/kshvi-events/src/scheduler/candidate-trace';
import { makeProfile, makeScheduleInput } from '../../../packages/kshvi-events/tests/fixtures/autonomy';

class MemoryQueue {
  readonly commands: AutonomyQueueCommand[] = [];
  failAfter = Number.POSITIVE_INFINITY;

  async enqueue(command: AutonomyQueueCommand): Promise<{ idempotent: boolean }> {
    const existing = this.commands.find(item => item.idempotencyKey === command.idempotencyKey);
    if (existing) return { idempotent: true };
    if (this.commands.length >= this.failAfter) throw new Error('Симулированный обрыв worker');
    this.commands.push(structuredClone(command));
    return { idempotent: false };
  }
}

class MemoryJournal {
  state: AutonomyWorkerJournalState = { version: 1, intervals: {}, processedIntervalKeys: [] };

  async load(): Promise<AutonomyWorkerJournalState> {
    return structuredClone(this.state);
  }

  async save(state: AutonomyWorkerJournalState): Promise<void> {
    this.state = structuredClone(state);
  }
}

function workerInput(queue: MemoryQueue, journal: MemoryJournal) {
  const schedule = makeScheduleInput({
    profile: makeProfile('CUSTOM', {
      attemptsPerOperationalHour: 12,
      maxEventsPerInterval: 4,
      maxEventsPerStage: 100,
      manualApprovalShare: 0,
    }),
  });
  return {
    instanceId: 'instance-1',
    instanceState: 'ACTIVE' as const,
    profile: schedule.profile,
    templates: schedule.templates,
    state: schedule.state,
    targets: schedule.targets,
    categories: ['logistics' as const],
    seed: schedule.seed,
    branchId: schedule.branchId,
    snapshotHash: schedule.snapshotHash,
    templateSetVersion: schedule.templateSetVersion,
    fromSecond: 0,
    toSecond: 3600,
    queue,
    journal,
  };
}

describe('Серверный autonomy worker', () => {
  it('использует оперативное время и единую идемпотентную командную очередь', async () => {
    const queue = new MemoryQueue();
    const journal = new MemoryJournal();
    const result = await runAutonomyWorker(workerInput(queue, journal));
    expect(result.attempts).toBeGreaterThan(0);
    expect(queue.commands.length).toBeGreaterThan(0);
    expect(new Set(queue.commands.map(command => command.idempotencyKey)).size).toBe(queue.commands.length);
    expect(queue.commands.every(command => command.operationalSecond >= 0)).toBe(true);
    expect(queue.commands.every(command => !JSON.stringify(command).includes('wallClock'))).toBe(true);
    expect(queue.commands.map(command => command.kind)).toEqual(expect.arrayContaining([
      'applyWorldEffects', 'createObservation', 'createDocumentRevision', 'createInput',
    ]));
    expect(journal.state.processedIntervalKeys).toHaveLength(1);
  });

  it('повтор команды скачка не создаёт второй эффект или новый розыгрыш', async () => {
    const queue = new MemoryQueue();
    const journal = new MemoryJournal();
    const first = await runAutonomyWorker(workerInput(queue, journal));
    const commandCount = queue.commands.length;
    const repeated = await runAutonomyWorker(workerInput(queue, journal));
    expect(repeated.enqueuedOperations).toBe(0);
    expect(repeated.skippedIntervals).toBe(1);
    expect(repeated.controlHash).toBe(first.controlHash);
    expect(queue.commands).toHaveLength(commandCount);
  });

  it('восстанавливается по журналу после обрыва и доотправляет сохранённые операции без нового выбора', async () => {
    const brokenQueue = new MemoryQueue();
    const brokenJournal = new MemoryJournal();
    brokenQueue.failAfter = 2;
    await expect(runAutonomyWorker(workerInput(brokenQueue, brokenJournal))).rejects.toThrow(/обрыв/);
    const pending = Object.values(brokenJournal.state.intervals) as ScheduleIntervalResult[];
    expect(pending).toHaveLength(1);
    expect(brokenJournal.state.processedIntervalKeys).toEqual([]);

    brokenQueue.failAfter = Number.POSITIVE_INFINITY;
    const recovered = await runAutonomyWorker(workerInput(brokenQueue, brokenJournal));
    expect(recovered.recoveredIntervals).toBe(1);
    expect(recovered.results[0].replayed).toBe(true);

    const referenceQueue = new MemoryQueue();
    const referenceJournal = new MemoryJournal();
    const reference = await runAutonomyWorker(workerInput(referenceQueue, referenceJournal));
    expect(recovered.controlHash).toBe(reference.controlHash);
    expect(brokenQueue.commands).toEqual(referenceQueue.commands);
    expect(new Set(brokenQueue.commands.map(command => command.idempotencyKey)).size).toBe(brokenQueue.commands.length);
  });

  it('не привязан к браузеру и не работает на оперативной паузе', async () => {
    const queue = new MemoryQueue();
    const journal = new MemoryJournal();
    const input = { ...workerInput(queue, journal), instanceState: 'PAUSED' as const };
    const result = await runAutonomyWorker(input);
    expect(result.attempts).toBe(0);
    expect(result.enqueuedOperations).toBe(0);
    expect(queue.commands).toEqual([]);
    expect(journal.state.intervals).toEqual({});
  });
});
