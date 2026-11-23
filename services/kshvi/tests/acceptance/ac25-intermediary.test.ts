import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createService, Router } from '@def-ops/service-kit';
import { expect, it } from 'vitest';
import { interceptAssignment, modifyAgentDecision, resumeAssignment } from '../../../../packages/kshvi-agents/src/intermediary/escalate';
import type { AgentCommandResponse } from '../../../../packages/kshvi-agents/src/intermediary/act';
import type { AgentProjectionQuery, AgentWake, IntermediaryCycle } from '../../../../packages/kshvi-agents/src/intermediary/cycle';
import { assignmentFixture, projectionFixture } from '../../../../packages/kshvi-agents/tests/fixtures';
import { emptyWorld } from '../../../../packages/kshvi/src/model/world';
import { replayWorld } from '../../../../packages/kshvi/src/events/reducer';
import { verifyEventChain } from '../../../../packages/kshvi/src/events/hash-chain';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { AgentCommandClient, createFetchAgentCommandTransport } from '../../src/agents/agent-command-client';
import type { PendingAgentCommand } from '../../src/agents/agent-recovery';
import { IntermediaryWorker, type AgentWorkJournal } from '../../src/agents/intermediary-worker';
import { registerAgentRoutes } from '../../src/http/agent-routes';
import { CommandService } from '../../src/instances/command-service';
import { RevisionTrackingCommandPort } from '../../src/instances/typed-command-port';

class MemoryJournal implements AgentWorkJournal {
  readonly cycles = new Map<string, IntermediaryCycle>();
  readonly pending = new Map<string, PendingAgentCommand>();
  async isCycleProcessed(cycleId: string): Promise<boolean> { return this.cycles.has(cycleId); }
  async enqueueCommand(record: PendingAgentCommand): Promise<void> { if (!this.pending.has(record.command.commandId)) this.pending.set(record.command.commandId, record); }
  async completeCommand(commandId: string, _response: AgentCommandResponse): Promise<void> { this.pending.delete(commandId); }
  async pendingCommands(): Promise<readonly PendingAgentCommand[]> { return [...this.pending.values()]; }
  async saveCycle(cycle: IntermediaryCycle): Promise<void> { this.cycles.set(cycle.cycleId, cycle); }
}
const wake = (wakeId: string): AgentWake => ({ wakeId, kind: 'EVENT', requestedAt: '2030-01-01T00:10:00.000Z' });

it('AC-25: электронный посредник ведёт три инстанции через настоящий HTTP API, эскалирует запрет и не откатывает мир', { timeout: 120_000 }, async () => {
  const assignment = assignmentFixture({ mode: 'DELEGATED' });
  const journal = new MemoryJournal();
  const commands = new CommandService({ organizationId: 'org-ac25' });
  const tracked = new RevisionTrackingCommandPort(commands);
  let projection = projectionFixture();
  const queries: AgentProjectionQuery[] = [];
  const router = new Router();
  registerAgentRoutes(router, {
    commands: tracked,
    resolveDelegation: async (ctx, command) => {
      if (ctx.req.headers.authorization !== 'Bearer ac25-system' || command.actor.kind !== 'system' || command.assignmentId !== assignment.assignmentId) {
        throw new Error('403: вне серверной делегации');
      }
      return {
        actor: { userId: 'agent-1', role: 'SYSTEM', organizationId: 'org-ac25' }, branchId: 'main',
        expectedRevision: await tracked.revision(command.instanceId, 'main'), allowedActions: assignment.allowedActions,
      };
    },
  });
  const service = createService({ name: 'kshvi-ac25', port: 0, router });
  const port = await service.listen();
  try {
    const client = new AgentCommandClient({
      transport: createFetchAgentCommandTransport({ baseUrl: `http://127.0.0.1:${port}`, accessToken: 'ac25-system' }),
      maxAttempts: 2, sleep: async () => {},
    });
    const worker = new IntermediaryWorker({
      assignments: [assignment],
      projectionSource: {
        loadProjection: async query => {
          queries.push(query);
          if (query.actor.kind !== 'system' || query.projection.projectionId !== assignment.projection.projectionId) throw new Error('Назначенная проекция не соблюдена');
          return projection;
        },
      },
      commandClient: client, journal,
    });

    const first = await worker.runAssignment(assignment.assignmentId, wake('wake-ac25-1'));
    expect(first?.status).toBe('COMPLETED');
    expect(assignment.bindings.map(binding => binding.instanceId)).toEqual(['higher', 'neighbour', 'support']);
    expect(first?.trace.actor.kind).toBe('system');
    expect(first?.commands.length).toBeGreaterThanOrEqual(16);
    expect(first?.trace.responses.every(response => response.status === 'APPLIED')).toBe(true);
    expect(queries.every(query => query.actor.kind === 'system')).toBe(true);

    projection = projectionFixture({
      revision: 8, sequence: 43,
      observations: [{ ...projectionFixture().observations[0], observationId: 'observation-ac25-new', summary: 'Новые сведения' }],
      requestedActions: [
        ...projectionFixture().requestedActions.filter(action => ['issueDocument', 'assignTask', 'requestCalculation', 'executeOrder'].includes(action.kind)),
        { actionId: 'forbidden-ac25', kind: 'changeScenarioConcept', instanceId: 'higher', sectorId: 'north', payload: {} },
      ],
    });
    const second = await worker.runAssignment(assignment.assignmentId, wake('wake-ac25-2'));
    expect(second?.status).toBe('ESCALATED');
    expect(second?.escalation?.reason).toBe('OUTSIDE_DELEGATION');
    expect(second?.appliedForbiddenEffects).toEqual([]);
    expect(second?.trace.options.length).toBeGreaterThanOrEqual(2);
    expect(second?.trace.responses.length).toBe(second?.trace.commands.length);

    const beforeForbidden = await commands.history('higher', 'main');
    const forbidden = await client.submit({
      ...second!.commands[0], commandId: 'forbidden-network-ac25', idempotencyKey: 'forbidden-network-ac25', kind: 'changeScenarioConcept',
    });
    expect(forbidden).toMatchObject({ accepted: false, effectApplied: false, status: 'REJECTED', reason: 'OUTSIDE_DELEGATION' });
    expect(await commands.history('higher', 'main')).toHaveLength(beforeForbidden.length);

    const interception = interceptAssignment(second!.assignment, { kind: 'human', id: 'leader-ac25' }, second!.projection.sequence);
    const override = modifyAgentDecision(second!.trace, { kind: 'human', id: 'leader-ac25' }, {
      actionId: 'human-action-ac25', kind: 'issueDocument', instanceId: 'higher', sectorId: 'north', payload: { reference: 'human-version-ac25' },
    });
    expect(interception.record).toMatchObject({ worldSequence: 43, rollback: false, worldContinues: true });
    expect(override.author).toEqual({ kind: 'human', id: 'leader-ac25' });
    worker.updateAssignment(resumeAssignment(interception.assignment, { kind: 'human', id: 'leader-ac25' }));

    projection = projectionFixture({ revision: 9, sequence: 44, requestedActions: [override.action] });
    const third = await worker.runAssignment(assignment.assignmentId, wake('wake-ac25-3'));
    expect(third?.status).toBe('COMPLETED');
    const eventsBeforeReplay = await commands.history('higher', 'main');
    expect(await worker.runAssignment(assignment.assignmentId, wake('wake-ac25-3'))).toBeUndefined();
    expect(await commands.history('higher', 'main')).toHaveLength(eventsBeforeReplay.length);

    const repeated = await client.submit(first!.commands[0]);
    expect(repeated).toMatchObject({ idempotent: true, effectApplied: false, status: 'DUPLICATE' });
    const events = await commands.history('higher', 'main');
    expect(events).toHaveLength(eventsBeforeReplay.length);
    expect(verifyEventChain(events)).toEqual([]);
    expect(events.every(event => event.actor.kind === 'SYSTEM')).toBe(true);
    const replayed = replayWorld(emptyWorld('higher'), events, { reducerVersion: 1 });
    expect(replayed).toEqual(commands.state('higher', 'main').world);
    expect(journal.cycles.size).toBe(3);
    expect(journal.pending.size).toBe(0);

    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (!runId) return;
    const directory = 'docs/release/kshvi/evidence/ac25';
    await mkdir(directory, { recursive: true });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const initialRevision = { id: assignment.assignmentId, revision: assignment.version, sha256: hashCanonical(assignment) };
    const journalPath = `${directory}/journal.json`;
    const tracesPath = `${directory}/agent-decision-traces.json`;
    const protocolPath = `${directory}/protocol.txt`;
    const metricsPath = `${directory}/metrics.json`;
    const evidence = JSON.parse(JSON.stringify({ runId, commit, first, second, third, interception, override, forbidden, events, replayedState: replayed.state }));
    const journalSha256 = hashCanonical(evidence);
    const metrics = {
      delegatedInstances: assignment.bindings.length, completedCycles: 2, escalatedCycles: 1,
      systemEvents: events.length, forbiddenEffects: 0, duplicateEffects: 0, humanOverrides: 1,
      replayHashMatches: 1,
    };
    await writeFile(journalPath, JSON.stringify(evidence, null, 2));
    await writeFile(tracesPath, JSON.stringify([first?.trace, second?.trace, third?.trace], null, 2));
    await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
    await writeFile(protocolPath, `AC-25 завершён\nrunId: ${runId}\ncommit: ${commit}\nТри инстанции велись без человека через HTTP; запрет не применён; перехват сохранил мир; человеческая правка отличается автором; повтор команды не создал событие; мир совпал с реплеем.\n`);
    await writeFile('docs/release/kshvi/acceptance/AC-25.proof.json', JSON.stringify({
      runId, commit, initialRevision,
      journal: { path: journalPath, sha256: journalSha256, eventCount: events.length },
      hashes: { scenario: initialRevision.sha256, environment: hashCanonical(replayed.state), journal: journalSha256 },
      protocols: [protocolPath], screenshots: [], metrics,
      limitations: ['Настоящий HTTP и командный журнал проверены в одном процессе; физическое разнесение агентов и восстановление всего узла входят в отдельный стендовый контур.'],
      artifacts: [journalPath, tracesPath, protocolPath, metricsPath],
    }, null, 2));
  } finally {
    await service.close();
  }
});
