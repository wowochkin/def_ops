import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import type { ChainEvent } from '../../../../packages/kshvi/src/events/envelope';
import { verifyEventChain } from '../../../../packages/kshvi/src/events/hash-chain';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import type { CreatedAutonomyEvent, NonProbabilisticEvent, ScheduleIntervalResult } from '../../../../packages/kshvi-events/src/scheduler/candidate-trace';
import type { ScheduleRangeResult } from '../../../../packages/kshvi-events/src/scheduler/interval-scheduler';
import { canonicalHash } from '../../../../packages/kshvi-events/src/scheduler/weighted-choice';
import type { AutonomyQueueCommand } from '../../src/runtime/autonomy-worker';
import { AutonomyCommandQueueAdapter } from '../../src/runtime/autonomy-command-queue';
import { CommandService } from '../../src/instances/command-service';
import { RevisionTrackingCommandPort } from '../../src/instances/typed-command-port';
import { withKshviDatabase } from '../helpers/database';

type ProcessReport = {
  high: ScheduleRangeResult;
  segmented: { controlHash: string[]; results: readonly ScheduleIntervalResult[]; createdEvents: readonly CreatedAutonomyEvent[]; selectionKeys: readonly string[] };
  jumpReplay: { controlHash: string; results: readonly ScheduleIntervalResult[]; createdEvents: readonly CreatedAutonomyEvent[] };
  zero: { attempts: number; createdEvents: readonly CreatedAutonomyEvent[]; plannedReactiveEvents: readonly NonProbabilisticEvent[]; results: readonly ScheduleIntervalResult[] };
  paused: { attempts: number; createdEvents: readonly CreatedAutonomyEvent[]; plannedReactiveEvents: readonly NonProbabilisticEvent[]; results: readonly ScheduleIntervalResult[] };
  worker: {
    controlHash: string; results: readonly ScheduleIntervalResult[]; createdEvents: readonly CreatedAutonomyEvent[];
    plannedReactiveEvents: readonly NonProbabilisticEvent[]; commands: readonly AutonomyQueueCommand[]; events: readonly ChainEvent[]; enqueuedOperations: number;
  };
  repeatedWorker: { controlHash: string; enqueuedOperations: number; skippedIntervals: number; commandCountBefore: number; commandCountAfter: number; replayed: boolean };
  cascade: {
    controlHash: string; events: readonly { eventId: string; templateId: string; depth: number; causeEventIds: readonly string[] }[];
    rejections: readonly { code: string }[]; candidateRejections: readonly string[]; maxDepth: number; stageEventCount: number; intervalEventCounts: readonly number[];
  };
  sealedRejection: string;
};

function runProcess(order: 'normal' | 'reverse'): ProcessReport {
  const args = ['--import', 'tsx', 'services/kshvi/tests/helpers/ac19-process.ts', ...(order === 'reverse' ? ['--reverse'] : [])];
  const output = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(output) as ProcessReport;
}
function rangeHash(results: readonly ScheduleIntervalResult[]): string {
  return canonicalHash(results.map(result => ({
    interval: result.trace.interval, traceHash: result.trace.controlHash, eventIds: result.createdEvents.map(event => event.eventId),
  })));
}

it('AC-19: два процесса воспроизводят наращивание, а настоящий CommandService не повторяет эффекты после скачка', { timeout: 120_000 }, async () => {
  const normal = runProcess('normal');
  const reverse = runProcess('reverse');
  expect(reverse.high).toEqual(normal.high);
  expect(reverse.worker).toEqual(normal.worker);
  expect(normal.high.createdEvents.length).toBeGreaterThan(0);
  expect(normal.high.results.some(result => (result.trace.attemptsByCategory.logistics ?? 0) > 0)).toBe(true);
  expect(normal.high.results.some(result => (result.trace.attemptsByCategory.reconnaissance ?? 0) > 0)).toBe(true);
  expect(normal.high.results.flatMap(result => result.traces.flatMap(trace => trace.candidates.flatMap(candidate => candidate.rejectionReasons))).length).toBeGreaterThan(0);

  expect(normal.segmented.createdEvents).toEqual(normal.high.createdEvents);
  expect(normal.segmented.selectionKeys).toEqual(normal.high.results.flatMap(result => result.traces.map(trace => trace.selectionKey)));
  expect(rangeHash(normal.segmented.results)).toBe(normal.high.controlHash);
  expect(normal.jumpReplay.createdEvents).toEqual(normal.high.createdEvents);
  expect(normal.jumpReplay.controlHash).toBe(normal.high.controlHash);
  expect(normal.jumpReplay.results.every(result => result.replayed)).toBe(true);

  expect(normal.zero.attempts).toBe(0);
  expect(normal.zero.createdEvents).toEqual([]);
  expect(normal.zero.plannedReactiveEvents.map(event => event.eventId).sort()).toEqual(['planned-ac19', 'reactive-ac19']);
  expect(normal.zero.results.every(result => result.trace.rejection === 'ZERO_INTENSITY')).toBe(true);
  expect(normal.paused).toMatchObject({ attempts: 0, createdEvents: [], plannedReactiveEvents: [], results: [] });

  expect(normal.worker.commands.length).toBeGreaterThan(0);
  expect(normal.worker.events).toHaveLength(normal.worker.commands.length);
  expect(new Set(normal.worker.commands.map(command => command.idempotencyKey)).size).toBe(normal.worker.commands.length);
  expect(normal.worker.events.every(event => event.actor.kind === 'SYSTEM')).toBe(true);
  expect(normal.worker.events.every(event => Number.isFinite(Date.parse(event.operationalAt.originalAt)))).toBe(true);
  expect(verifyEventChain(normal.worker.events)).toEqual([]);
  expect(normal.repeatedWorker).toMatchObject({
    controlHash: normal.worker.controlHash, enqueuedOperations: 0, skippedIntervals: 2,
    commandCountBefore: normal.worker.commands.length, commandCountAfter: normal.worker.commands.length, replayed: true,
  });

  expect(normal.cascade.maxDepth).toBeLessThanOrEqual(1);
  expect(normal.cascade.stageEventCount).toBeLessThanOrEqual(100);
  expect(normal.cascade.intervalEventCounts.every(count => count <= 8)).toBe(true);
  expect(normal.cascade.candidateRejections).toContain('CASCADE_BUDGET_EXCEEDED');
  expect(normal.sealedRejection).toContain('SEALED');

  let durableEvents = 0;
  let durableJournal: readonly ChainEvent[] = [];
  await withKshviDatabase(async store => {
    const operation = {
      commandId: 'durable-autonomous-operation', idempotencyKey: 'durable-autonomous-operation', kind: 'applyWorldEffects' as const,
      instanceId: 'durable-ac19', branchId: 'main', operationalSecond: 60,
      operationalAt: '2030-01-01T00:01:00.000Z', priority: 100, sequence: 0,
      payload: {
        eventId: 'durable-autonomous-event', templateId: 'logistics.fuel-shortage', templateVersion: 1,
        effects: [{ type: 'resource.adjust', resourceId: 'fuel', ownerSideId: 'blue', unit: 'L', operation: 'RESTORE', amount: 100 }],
        parameters: {}, causeEventIds: [], stageId: 'stage-main', target: { sideId: 'blue', areaId: 'area-north' },
      },
    };
    async function enqueueWithNewService() {
      const commands = new CommandService({ store, organizationId: 'org-ac19' });
      const tracked = new RevisionTrackingCommandPort(commands);
      const queue = new AutonomyCommandQueueAdapter({
        organizationId: 'org-ac19', actorUserId: 'autonomy-worker', commands: tracked,
        revision: (instanceId, branchId) => tracked.revision(instanceId, branchId),
      });
      const receipt = await queue.enqueue(operation);
      return { receipt, state: commands.state('durable-ac19', 'main') };
    }
    expect((await enqueueWithNewService()).receipt.idempotent).toBe(false);
    const restarted = await enqueueWithNewService();
    expect(restarted.receipt.idempotent).toBe(true);
    expect(restarted.state.world.resources['blue/fuel']).toMatchObject({ onHand: 100, supplied: 100 });
    const events = await store.listEvents('org-ac19', 'durable-ac19', 'main');
    durableEvents = events.length;
    durableJournal = events;
    expect(events).toHaveLength(1);
    expect(verifyEventChain(events)).toEqual([]);
    expect(await store.outboxCount('org-ac19', 'durable-ac19')).toBe(1);
  });

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const directory = 'docs/release/kshvi/evidence/ac19';
  await mkdir(directory, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const normalPath = `${directory}/process-normal.json`;
  const reversePath = `${directory}/process-reverse.json`;
  const journalPath = `${directory}/journal.json`;
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const initialRevision = {
    id: 'ac19-autonomy', revision: 1,
    sha256: hashCanonical({ seed: 'ac19-fixed-seed', snapshotHash: 'snapshot-v1', templateSetVersion: 'catalog-v1', operationalStartAt: '2030-01-01T00:00:00.000Z' }),
  };
  const journal = { runId, commit, initialRevision, normal, reverse, durableJournal };
  const journalSha256 = hashCanonical(journal);
  const metrics = {
    independentProcesses: 2, probabilisticEvents: normal.high.createdEvents.length, zeroIntensityEvents: normal.zero.createdEvents.length,
    preservedPlannedReactive: normal.zero.plannedReactiveEvents.length, officialOperations: normal.worker.events.length,
    repeatedOperations: normal.repeatedWorker.enqueuedOperations, replayedIntervals: normal.repeatedWorker.skippedIntervals,
    maximumCascadeDepth: normal.cascade.maxDepth, sealedProfileChangesRejected: 1, durableEvents,
  };
  await writeFile(normalPath, JSON.stringify(normal, null, 2));
  await writeFile(reversePath, JSON.stringify(reverse, null, 2));
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-19 завершён\nrunId: ${runId}\ncommit: ${commit}\nДва процесса дали одинаковые ключи, события, команды и хеши; нулевая интенсивность сохранила planned/reactive; пауза и скачок не создали повтор; каскад ограничен; изменение после SEALED отклонено.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-19.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: journalPath, sha256: journalSha256, eventCount: normal.worker.events.length + durableEvents },
    hashes: { scenario: initialRevision.sha256, environment: normal.worker.controlHash, journal: journalSha256 },
    protocols: [protocolPath], screenshots: [], metrics,
    limitations: ['Два независимых Node-процесса используют настоящий CommandService и hash-chain; идемпотентность после создания нового экземпляра сервиса подтверждена в PostgreSQL. Полный физический сетевой стенд подтверждается отдельными AC-00 и AC-14.'],
    artifacts: [normalPath, reversePath, journalPath, protocolPath, metricsPath],
  }, null, 2));
});
