import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import profile from '../../../../packages/kshvi-agents/data/modern-profiles/balanced.json';
import { evaluateChoices, type AgentEvaluationRequest } from '../../../../packages/kshvi-agents/src/ports/agent-engine';
import { assertAgentDataRequest, assertModernAgentProfile, defaultControlAssignments } from '../../../../packages/kshvi-agents/src/ports/modern-choice';
import { verifyEventChain } from '../../../../packages/kshvi/src/events/hash-chain';
import { replayWorld } from '../../../../packages/kshvi/src/events/reducer';
import { emptyWorld } from '../../../../packages/kshvi/src/model/world';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { AgentProcess, type OfficialAgentCommand, type OfficialCommandReceipt } from '../../src/agents/agent-process';
import { RustWorker } from '../../src/agents/rust-worker';
import { CommandService } from '../../src/instances/command-service';
import { RevisionTrackingCommandPort, assertDomainOperationType } from '../../src/instances/typed-command-port';

function request(): AgentEvaluationRequest {
  return {
    profile: assertModernAgentProfile(profile), seed: 41n,
    projection: {
      instanceId: 'instance-modern', revision: 3, agentId: 'red-command', tick: 8,
      ownOrders: [{ id: 'order-current', kind: 'ADVANCE', issuedTick: 2 }],
      observations: [{ id: 'observation-own', observedTick: 7, strength: 0.5, confidence: 0.9, source: 'own-reconnaissance', uncertainty: 0.1 }],
      reports: [{ id: 'report-own', sender: 'hq-sub', recipient: 'hq-red', tick: 7, text: 'Донесение собственного подчинённого штаба' }],
      ownForces: [{ id: 'force-own', hqId: 'hq-red', mps: { confidence: 0.85, stress: 0.1 }, operationalEquipment: 4, totalEquipment: 4 }],
      resources: { supplyFraction: 0.9 }, terrain: { routeOpen: true }, weather: { movementFactor: 0.9 },
    },
  };
}

it('AC-27: реальный Rust worker ведёт противника по разрешённой проекции, а официальный мир повторяется и не читает скрытые данные', { timeout: 120_000 }, async () => {
  const worker = new RustWorker();
  try {
    const baseline = request();
    const firstEvaluation = await evaluateChoices(worker, baseline);
    const repeatedEvaluation = await evaluateChoices(worker, request());
    expect(repeatedEvaluation).toEqual(firstEvaluation);
    expect(firstEvaluation.selected).toMatchObject({ id: 'advance', commandType: 'force.advance.v1' });
    expect(firstEvaluation.destroyedForks).toBe(firstEvaluation.options.length);
    expect(firstEvaluation.destroyedForks).toBeGreaterThan(0);
    expect(firstEvaluation.trace).toMatchObject({ profileVersion: 'modern-opponent-1' });

    const hiddenRequest = {
      ...request(),
      projection: {
        ...request().projection,
        hiddenTruth: { enemyStrength: 1000 },
        traineeDrafts: ['секретный черновик'],
        futureInputs: ['будущая вводная'],
        officialBenchmark: { answer: 42 },
      },
    };
    const hiddenEvaluation = await evaluateChoices(worker, hiddenRequest);
    expect(hiddenEvaluation).toEqual(firstEvaluation);
    expect(JSON.stringify(hiddenEvaluation)).not.toContain('секретный черновик');
    for (const kind of ['TRAINEE_DRAFTS', 'FUTURE_INPUTS', 'OFFICIAL_BENCHMARK', 'HIDDEN_TRUTH'] as const) {
      expect(() => assertAgentDataRequest({ kind, requesterId: 'red-command' })).toThrow('недоступ');
    }

    const observedRequest = request();
    observedRequest.projection = {
      ...observedRequest.projection, revision: 4,
      observations: [{ ...observedRequest.projection.observations[0], strength: 4, confidence: 1 }],
    };
    const observedEvaluation = await evaluateChoices(worker, observedRequest);
    expect(observedEvaluation.selected).toMatchObject({ id: 'continue-order', commandType: 'order.continue.v1' });
    expect(observedEvaluation.trace).not.toEqual(firstEvaluation.trace);

    expect(defaultControlAssignments({ trainedLevels: 1, opponentId: 'red-command', supportingIds: ['red-support'] })).toEqual([
      { instanceId: 'red-command', role: 'OPPONENT', source: 'AGENT' },
      { instanceId: 'red-support', role: 'SUPPORTING', source: 'AGENT' },
    ]);

    const commands = new CommandService({ organizationId: 'org-ac27' });
    const tracked = new RevisionTrackingCommandPort(commands);
    const receipts: { idempotencyKey: string; idempotent: boolean }[] = [];
    const deliveries: string[] = [];
    const official = {
      submit: async (command: OfficialAgentCommand): Promise<OfficialCommandReceipt> => {
        assertDomainOperationType(command.type);
        const result = await tracked.execute({
          instanceId: command.instanceId, branchId: 'main', expectedRevision: await tracked.revision(command.instanceId, 'main'),
          idempotencyKey: command.idempotencyKey, type: command.type,
          actor: { userId: 'red-command', role: 'SYSTEM', organizationId: 'org-ac27' },
          payload: {
            choiceId: command.choiceId, profileVersion: command.profileVersion, orderIds: [...command.orderIds],
            issuedAt: '2030-01-01T00:00:08.000Z',
          },
        });
        receipts.push({ idempotencyKey: command.idempotencyKey, idempotent: result.idempotent });
        return { accepted: true, commandId: result.eventId };
      },
    };
    const communication = { deliver: async (order: import('../../../../packages/kshvi-agents/src/ports/agent-engine').ModernOrder) => {
      deliveries.push(order.id);
      return { ...order, status: 'DELIVERED' as const };
    } };
    const agentProcess = new AgentProcess({ engine: worker, official, communication });
    const firstCycle = await agentProcess.runOpponentCycle(request());
    expect(firstCycle.status).toBe('DECIDED');
    expect(firstCycle.command).toMatchObject({ type: 'force.advance.v1', choiceId: 'advance', profileVersion: 'modern-opponent-1' });
    expect(firstCycle.deliveries?.every(order => order.status === 'DELIVERED' && order.deliveryTick >= order.issuedTick)).toBe(true);
    const firstEvents = await commands.history('instance-modern', 'main');
    expect(firstEvents).toHaveLength(1);
    expect(firstEvents[0]).toMatchObject({ type: 'force.advance.v1', actor: { kind: 'SYSTEM', id: 'red-command' } });

    const repeatedCycle = await agentProcess.runOpponentCycle(request());
    expect(repeatedCycle).toEqual(firstCycle);
    expect(await commands.history('instance-modern', 'main')).toHaveLength(1);
    const restartedProcess = new AgentProcess({ engine: worker, official, communication });
    const afterRestart = await restartedProcess.runOpponentCycle(request());
    expect(afterRestart.evaluation).toEqual(firstCycle.evaluation);
    expect(receipts.at(-1)?.idempotent).toBe(true);
    expect(await commands.history('instance-modern', 'main')).toHaveLength(1);

    const revisedCycle = await restartedProcess.runOpponentCycle(observedRequest);
    expect(revisedCycle.status).toBe('SAFE_ORDER');
    expect(revisedCycle.evaluation.selected.id).toBe('continue-order');
    expect(await commands.history('instance-modern', 'main')).toHaveLength(1);
    const events = await commands.history('instance-modern', 'main');
    expect(verifyEventChain(events)).toEqual([]);
    expect(replayWorld(emptyWorld('instance-modern'), events, { reducerVersion: 1 })).toEqual(commands.state('instance-modern', 'main').world);

    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (!runId) return;
    const directory = 'docs/release/kshvi/evidence/ac27';
    await mkdir(directory, { recursive: true });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const initialRevision = { id: 'modern-opponent-ac27', revision: 1, sha256: hashCanonical({ profile, seed: '41' }) };
    const journalPath = `${directory}/journal.json`;
    const tracesPath = `${directory}/decision-traces.json`;
    const protocolPath = `${directory}/protocol.txt`;
    const metricsPath = `${directory}/metrics.json`;
    const journal = JSON.parse(JSON.stringify({
      runId, commit, firstEvaluation, repeatedEvaluation, hiddenEvaluation, observedEvaluation,
      firstCycle, repeatedCycle, afterRestart, revisedCycle, receipts, deliveries, events,
    }, (_key, value) => typeof value === 'bigint' ? `${value}n` : value));
    const journalSha256 = hashCanonical(journal);
    const metrics = {
      realRustEvaluations: 4, sameSeedTraceMatches: 1, hiddenTruthTraceMatches: 1,
      observationChangedChoice: 1, systemCommands: events.length, duplicateOfficialEffects: 0,
      isolatedForksDestroyed: firstEvaluation.destroyedForks, replayMatches: 1,
    };
    await writeFile(journalPath, JSON.stringify(journal, null, 2));
    await writeFile(tracesPath, JSON.stringify([firstEvaluation, hiddenEvaluation, observedEvaluation], null, 2));
    await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
    await writeFile(protocolPath, `AC-27 завершён\nrunId: ${runId}\ncommit: ${commit}\nRust worker выбрал advance по исходной проекции и continue-order после изменения наблюдения; скрытые данные не изменили след; приказ доставлен до официальной команды; повторы не создали событий; реплей совпал.\n`);
    await writeFile('docs/release/kshvi/acceptance/AC-27.proof.json', JSON.stringify({
      runId, commit, initialRevision,
      journal: { path: journalPath, sha256: journalSha256, eventCount: events.length },
      hashes: { scenario: initialRevision.sha256, environment: hashCanonical(firstEvaluation.trace), journal: journalSha256 },
      protocols: [protocolPath], screenshots: [], metrics,
      limitations: ['Rust worker, доставка и общий CommandService проверены на локальном стенде; распределённая сетевая нагрузка и физическая изоляция узлов проверяются отдельно.'],
      artifacts: [journalPath, tracesPath, protocolPath, metricsPath],
    }, null, 2));
  } finally {
    await worker.close();
  }
});
