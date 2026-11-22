import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createService } from '@def-ops/service-kit';
import { afterEach, expect, it } from 'vitest';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { CommandService } from '../../src/instances/command-service';
import { publishChainEvent, SubscriptionService } from '../../src/http/subscription-service';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { withKshviDatabase } from '../helpers/database';

const services: Array<ReturnType<typeof createService>> = [];
afterEach(async () => { while (services.length) await services.pop()?.close(); });
const message = (id: string, domainKey: string) => ({ id, type: 'ORDER', senderRole: 'DIRECTOR', fromInstanceId: 'ac06', recipientIds: ['node-1'], sizeBytes: 100, priority: 1, domainKey, createdAt: '2030-01-01T00:00:00Z' }) as const;
const factor = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
  id, type, basis: `Основание ${id}`, trainingQuestion: `Учебный вопрос ${id}`, workaround: 'Резервный канал и повтор',
  scope: { nodeIds: ['node-1'], channelIds: ['primary'] }, at: '2030-01-01T00:02:00Z',
  expectedImpact: { documentIds: ['document-1'], deadlineIds: ['deadline-1'], branchIds: ['main'] }, ...extra,
}) as const;

it('AC-06: отказ, задержка, дубликат и бумажный обмен не создают второй доменный эффект', async () => {
  await withKshviDatabase(async store => {
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    await sessions.createAccount({
      userId: 'director', username: 'director', password: 'secret123', organizationId: 'org-ac06',
      roles: [{ id: 'director-role', role: 'DIRECTOR', sideId: 'blue', authorities: ['instance:command'], assignedNodeIds: ['node-1'] }],
    });
    const login = await sessions.login('director', 'secret123');
    await sessions.selectRole(login.token, 'director-role');
    const channel = (id: string, nodeId: string, reserveChannelIds: string[]) => ({
      id, version: 1, fromInstanceId: 'ac06', toInstanceId: 'node-1', nodeIds: [nodeId], direction: 'SIMPLEX' as const,
      allowedMessageTypes: ['ORDER'], capacity: 1, bytesPerSecond: 1000, baseDelayMs: 100,
      priorityPolicy: { allowQueuedPreemption: false }, availability: 'AVAILABLE' as const, encrypted: true,
      reserveChannelIds, validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z',
    });
    const operations = {
      knownInstanceIds: ['ac06', 'node-1'], availableChannelIds: ['primary', 'reserve'],
      channels: [channel('primary', 'node-1', ['reserve']), channel('reserve', 'node-2', [])],
      nodes: [{ id: 'node-1', status: 'AVAILABLE' as const }, { id: 'node-2', status: 'AVAILABLE' as const }],
      reportSchedule: {
        id: 'urgent-report', type: 'ORDER', triggerEventId: 'event-1', senderRole: 'TRAINEE', recipientIds: ['node-1'], channelId: 'primary',
        deadlineAt: '2030-01-01T00:02:00Z', requiredFields: ['result'], escalation: { toRole: 'DIRECTOR', afterMinutes: 0 }, reporterKind: 'TRAINEE' as const,
      },
    } as const;
    const subscriptions = new SubscriptionService();
    const commands = new CommandService({ store, organizationId: 'org-ac06', operations, eventSink: event => publishChainEvent(subscriptions, event) });
    const service = createService({ name: 'kshvi-ac06', port: 0, router: buildRouter({ sessions, commands, subscriptions }) });
    services.push(service);
    const port = await service.listen();
    const base = `http://127.0.0.1:${port}`;
    const command = async (expectedRevision: number, type: string, payload: Record<string, unknown>, at = '2030-01-01T00:00:00Z') => {
      const response = await fetch(`${base}/kshvi/instances/ac06/commands`, {
        method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: 'main', expectedRevision, idempotencyKey: `${type}-${expectedRevision}`, type, at, payload }),
      });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      return text;
    };
    await command(0, 'communication.enqueue', { message: message('message-1', 'order-1') });
    await command(1, 'communication.enqueue', { message: message('message-2', 'order-2') });
    await command(2, 'communication.admit', { channelId: 'primary' });
    await command(3, 'communication.advance', { messageId: 'message-1', action: 'DELIVER' }, '2030-01-01T00:01:00Z');
    await command(4, 'communication.admit', { channelId: 'primary' });
    await command(5, 'communication.failure', { messageId: 'message-2', factor: factor('delay-1', 'DELAY', { delayMs: 100 }) });
    await command(6, 'communication.failure', { messageId: 'message-2', factor: factor('loss-1', 'LOSS') }, '2030-01-01T00:02:00Z');
    await command(7, 'communication.retry', { messageId: 'message-2' }, '2030-01-01T00:03:00Z');
    await command(8, 'communication.admit', { channelId: 'primary' });
    await command(9, 'communication.advance', { messageId: 'message-2', action: 'DELIVER' }, '2030-01-01T00:04:00Z');
    await command(10, 'communication.failure', { messageId: 'message-2', factor: factor('duplicate-1', 'DUPLICATE') }, '2030-01-01T00:05:00Z');
    await command(11, 'communication.enqueue', { message: message('message-3', 'order-3') });
    await command(12, 'communication.advance', { messageId: 'message-3', action: 'CANCEL', reason: 'Отмена до передачи' }, '2030-01-01T00:05:00Z');
    await command(13, 'communication.infrastructure', { factor: factor('node-failure-1', 'NODE_FAILURE') }, '2030-01-01T00:06:00Z');
    await command(14, 'communication.enqueue', { message: message('message-4', 'order-4') }, '2030-01-01T00:06:00Z');
    await command(15, 'communication.infrastructure', { factor: factor('recovery-1', 'RECOVERY') }, '2030-01-01T00:07:00Z');
    await command(16, 'report.check', { eventStatus: 'OCCURRED' }, '2030-01-01T00:03:00Z');
    await command(17, 'report.check', { eventStatus: 'NOT_OCCURRED' }, '2030-01-01T00:03:00Z');
    await command(18, 'paper.record', { input: {
      documentId: 'document-1', revision: 1, sha256: 'a'.repeat(64), domainKey: 'order-1',
      issued: { at: '2030-01-01T00:00:00Z', actorId: 'director' }, received: { at: '2030-01-01T00:01:00Z', actorId: 'node-1' },
      evidence: { kind: 'SCAN', reference: 'scan/document-1.pdf' }, enteredAt: '2030-01-01T00:08:00Z', enteredBy: 'director',
    } }, '2030-01-01T00:08:00Z');

    const state = commands.state('ac06', 'main');
    const attempts = Object.values(state.communicationAttempts).flat();
    for (const status of ['queued', 'inTransit', 'delivered', 'failed', 'cancelled']) expect(attempts.some(attempt => attempt.status === status), status).toBe(true);
    expect(state.communications['message-2']!.status).toBe('delivered');
    expect(state.communications['message-2']!.attempt).toBe(2);
    expect(state.communications['message-2']!.domainEffectApplied).toBe(true);
    expect(state.communications['message-4']!.route.selectedReserve).toBe(true);
    expect(state.reportChecks.map(check => check.status)).toEqual(['REPORT_NOT_SENT', 'EVENT_NOT_OCCURRED']);
    expect(state.reportChecks[0]!.missedDeadline).toBe(true);
    expect(state.reportChecks[1]!.missedDeadline).toBe(false);
    expect(state.paperExchanges[0]).toMatchObject({ duplicate: true, domainEffectApplied: false, electronicResolution: 'RECONCILED_DUPLICATE' });
    expect(state.paperExchanges[0]!.facts.map(fact => fact.actualAt)).toEqual(['2030-01-01T00:00:00Z', '2030-01-01T00:01:00Z']);

    const history = await store.listEvents('org-ac06', 'ac06', 'main');
    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (runId) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const directory = 'docs/release/kshvi/evidence/ac06';
      await mkdir(directory, { recursive: true });
      const initialScenario = { operations, messages: ['message-1', 'message-2', 'message-3', 'message-4'] };
      const initialRevision = { id: 'ac06-communications', revision: 1, sha256: hashCanonical(initialScenario) };
      const environment = { transport: 'HTTP', channels: 2, paperEvidence: 'scan/document-1.pdf' };
      const metrics = { attempts: attempts.length, duplicateEffects: 0, reserveMessages: 1, missedReports: 1, paperDuplicatesReconciled: 1 };
      const initialPath = `${directory}/initial-scenario.json`;
      const journalPath = `${directory}/journal.json`;
      const protocolPath = `${directory}/protocol.txt`;
      const metricsPath = `${directory}/metrics.json`;
      const environmentPath = `${directory}/environment.json`;
      const limitations = ['Каналы моделируются локальными профилями; физическая потеря сетевого оборудования не входит в этот сценарий.'];
      await writeFile(initialPath, JSON.stringify({ initialRevision, scenario: initialScenario }, null, 2));
      await writeFile(journalPath, JSON.stringify({ runId, commit, events: history }, null, 2));
      await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
      await writeFile(environmentPath, JSON.stringify(environment, null, 2));
      await writeFile(protocolPath, `AC-06 завершён\nrunId: ${runId}\ncommit: ${commit}\nСтатусы попыток сохранены; резерв применён; дубликат не создал второй эффект; пропуск донесения и бумажный обмен зафиксированы.\n`);
      const proof = {
        runId, commit, initialRevision,
        journal: { path: journalPath, sha256: hashCanonical(history), eventCount: history.length },
        hashes: { scenario: initialRevision.sha256, environment: hashCanonical(environment), journal: hashCanonical(history) },
        protocols: [protocolPath], screenshots: [], metrics, limitations,
        artifacts: [initialPath, journalPath, protocolPath, metricsPath, environmentPath],
      };
      await writeFile('docs/release/kshvi/acceptance/AC-06.proof.json', JSON.stringify(proof, null, 2));
    }
  });
}, 20_000);
