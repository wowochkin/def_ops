import { scheduleOperationalRange, type ScheduleRangeInput } from '../../../../packages/kshvi-events/src/scheduler/interval-scheduler';
import { runAutonomyWorker, type AutonomyQueueCommand, type AutonomyWorkerJournalState } from '../../src/runtime/autonomy-worker';
import { blueNorthTarget, makeProfile, makeScheduleInput, makeTemplate } from '../../../../packages/kshvi-events/tests/fixtures/autonomy';
import { CommandService } from '../../src/instances/command-service';
import { RevisionTrackingCommandPort } from '../../src/instances/typed-command-port';
import { AutonomyCommandQueueAdapter } from '../../src/runtime/autonomy-command-queue';

class OfficialQueue {
  readonly commands: AutonomyQueueCommand[] = [];
  readonly service = new CommandService({ organizationId: 'org-ac19' });
  private readonly tracked = new RevisionTrackingCommandPort(this.service);
  private readonly adapter = new AutonomyCommandQueueAdapter({
    organizationId: 'org-ac19', actorUserId: 'autonomy-worker', commands: this.tracked,
    revision: (instanceId, branchId) => this.tracked.revision(instanceId, branchId),
  });
  async enqueue(command: AutonomyQueueCommand): Promise<{ idempotent: boolean }> {
    const result = await this.adapter.enqueue(command);
    this.commands.push(structuredClone(command));
    return result;
  }
  async history() { return this.service.history('instance-ac19', 'branch-main'); }
}
class MemoryJournal {
  state: AutonomyWorkerJournalState = { version: 1, intervals: {}, processedIntervalKeys: [] };
  async load(): Promise<AutonomyWorkerJournalState> { return structuredClone(this.state); }
  async save(state: AutonomyWorkerJournalState): Promise<void> { this.state = structuredClone(state); }
}

const reverse = process.argv.includes('--reverse');
const planned = [
  { eventId: 'planned-ac19', kind: 'PLANNED' as const, operationalSecond: 30, payload: { basis: 'plan-v1' } },
  { eventId: 'reactive-ac19', kind: 'REACTIVE' as const, operationalSecond: 40, payload: { causeEventIds: ['planned-ac19'] } },
];
const orderedPlanned = reverse ? [...planned].reverse() : planned;
const logistics = makeTemplate();
const reconnaissance = makeTemplate({ templateId: 'recon-ac19', category: 'reconnaissance' });
const templates = reverse ? [reconnaissance, logistics] : [logistics, reconnaissance];
const highProfile = makeProfile('CUSTOM', {
  attemptsPerOperationalHour: 12, maxEventsPerInterval: 6, maxEventsPerStage: 100,
  severityBudgetPerStage: 1000, maxCascadeDepth: 2, maxCascadeEvents: 4, manualApprovalShare: 0,
});
const base = makeScheduleInput({
  profile: highProfile, templates, plannedReactiveEvents: orderedPlanned,
});
const range: ScheduleRangeInput = { ...base, fromSecond: 0, toSecond: 7200, instanceState: 'ACTIVE' };
const high = scheduleOperationalRange(range);
const firstHalf = scheduleOperationalRange({ ...range, toSecond: 3600 });
const secondHalf = scheduleOperationalRange({
  ...range, fromSecond: 3600, state: firstHalf.state, journal: firstHalf.results,
  plannedReactiveEvents: [...orderedPlanned].reverse(),
});
const jumpReplay = scheduleOperationalRange({
  ...range, journal: [...high.results].reverse(), plannedReactiveEvents: [...orderedPlanned].reverse(),
});
const zero = scheduleOperationalRange({
  ...range,
  profile: makeProfile('CUSTOM', {
    attemptsPerOperationalHour: 12, maxEventsPerInterval: 6, maxEventsPerStage: 100,
    severityBudgetPerStage: 1000, maxCascadeDepth: 2, maxCascadeEvents: 4, manualApprovalShare: 0,
  }, { categories: { logistics: 0, reconnaissance: 0 } }),
});
const paused = scheduleOperationalRange({ ...range, instanceState: 'PAUSED' });

const queue = new OfficialQueue();
const journal = new MemoryJournal();
const workerInput = {
  instanceId: 'instance-ac19', instanceState: 'ACTIVE' as const,
  operationalStartAt: '2030-01-01T00:00:00.000Z',
  profile: highProfile, templates, state: base.state, targets: [blueNorthTarget],
  seed: base.seed, branchId: base.branchId, snapshotHash: base.snapshotHash, templateSetVersion: base.templateSetVersion,
  fromSecond: 0, toSecond: 7200, plannedReactiveEvents: orderedPlanned, queue, journal,
};
const worker = await runAutonomyWorker(workerInput);
const commandCount = queue.commands.length;
const repeatedWorker = await runAutonomyWorker({ ...workerInput, plannedReactiveEvents: [...orderedPlanned].reverse() });
const repeatedCommandCount = queue.commands.length;

const childA = makeTemplate({ templateId: 'cascade-child-a' });
const childB = makeTemplate({ templateId: 'cascade-child-b' });
const parent = makeTemplate({ templateId: 'cascade-parent', cascade: { allowedTemplateIds: ['cascade-child-a', 'cascade-child-b'], maxDepth: 1, maxEvents: 1 } });
const cascade = scheduleOperationalRange({
  ...makeScheduleInput({
    profile: makeProfile('CUSTOM', {
      attemptsPerOperationalHour: 24, maxEventsPerInterval: 8, maxEventsPerStage: 100,
      severityBudgetPerStage: 1000, maxCascadeDepth: 1, maxCascadeEvents: 1, manualApprovalShare: 0,
    }),
    templates: [parent, childA, childB],
  }),
  fromSecond: 0, toSecond: 3600,
});

let sealedRejection = '';
try {
  const { updateAutonomyProfile } = await import('../../../../packages/kshvi-events/src/profile/autonomy-profile');
  updateAutonomyProfile(highProfile, { intensity: { categories: { logistics: 0 } } }, 'SEALED');
} catch (error) {
  sealedRejection = error instanceof Error ? error.message : String(error);
}

console.log(JSON.stringify({
  schemaVersion: 1,
  high: {
    controlHash: high.controlHash, results: high.results, createdEvents: high.createdEvents,
    plannedReactiveEvents: high.plannedReactiveEvents, state: high.state,
  },
  segmented: {
    controlHash: [firstHalf, secondHalf].map(part => part.controlHash),
    results: [...firstHalf.results, ...secondHalf.results],
    createdEvents: [...firstHalf.createdEvents, ...secondHalf.createdEvents],
    selectionKeys: [...firstHalf.results, ...secondHalf.results].flatMap(result => result.traces.map(trace => trace.selectionKey)),
  },
  jumpReplay: { controlHash: jumpReplay.controlHash, results: jumpReplay.results, createdEvents: jumpReplay.createdEvents },
  zero: { attempts: zero.attempts, createdEvents: zero.createdEvents, plannedReactiveEvents: zero.plannedReactiveEvents, results: zero.results },
  paused: { attempts: paused.attempts, createdEvents: paused.createdEvents, plannedReactiveEvents: paused.plannedReactiveEvents, results: paused.results },
  worker: {
    controlHash: worker.controlHash, results: worker.results, createdEvents: worker.createdEvents,
    plannedReactiveEvents: worker.plannedReactiveEvents, commands: queue.commands.slice(0, commandCount),
    events: await queue.history(), enqueuedOperations: worker.enqueuedOperations,
  },
  repeatedWorker: {
    controlHash: repeatedWorker.controlHash, enqueuedOperations: repeatedWorker.enqueuedOperations,
    skippedIntervals: repeatedWorker.skippedIntervals, commandCountBefore: commandCount, commandCountAfter: repeatedCommandCount,
    replayed: repeatedWorker.results.every(result => result.replayed === true),
  },
  cascade: {
    controlHash: cascade.controlHash,
    events: cascade.createdEvents.map(event => ({ eventId: event.eventId, templateId: event.templateId, depth: event.cascadeDepth, causeEventIds: event.causeEventIds })),
    rejections: cascade.results.flatMap(result => result.trace.rejections),
    candidateRejections: [...new Set(cascade.results.flatMap(result => result.traces.flatMap(trace => trace.candidates.flatMap(candidate => candidate.rejectionReasons))))],
    maxDepth: Math.max(0, ...cascade.createdEvents.map(event => event.cascadeDepth)),
    stageEventCount: cascade.state.stageEventCount,
    intervalEventCounts: cascade.results.map(result => result.state.intervalEventCount),
  },
  sealedRejection,
}));
