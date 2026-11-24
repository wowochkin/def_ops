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
const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
afterEach(async () => {
  for (const reader of readers.splice(0)) await reader.cancel().catch(() => undefined);
  while (services.length) await services.pop()?.close();
});
async function nextFrame(reader: ReadableStreamDefaultReader<Uint8Array>, buffer: { value: string }) {
  const decoder = new TextDecoder();
  for (;;) {
    const boundary = /\r?\n\r?\n/.exec(buffer.value);
    if (boundary?.index !== undefined) {
      const frame = buffer.value.slice(0, boundary.index);
      buffer.value = buffer.value.slice(boundary.index + boundary[0].length);
      if (frame.includes('event:')) return frame;
      continue;
    }
    const { done, value } = await reader.read();
    if (done) throw new Error('SSE закрылся');
    buffer.value += decoder.decode(value, { stream: true });
  }
}

it('AC-05: плановые, реактивные и адаптивные вводные ограничены полномочиями и причинами', async () => {
  await withKshviDatabase(async store => {
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    await sessions.createAccount({
      userId: 'director', username: 'director', password: 'secret123', organizationId: 'org-ac05',
      roles: [{ id: 'director-role', role: 'DIRECTOR', sideId: 'blue', authorities: ['instance:command', 'projection:read'], assignedNodeIds: ['node-1'] }],
    });
    const login = await sessions.login('director', 'secret123');
    await sessions.selectRole(login.token, 'director-role');
    const subscriptions = new SubscriptionService();
    const operations = {
      knownInstanceIds: ['ac05', 'node-1'], availableChannelIds: ['radio'], channels: [], nodes: [],
      delegation: { allowedSeverities: [1], allowedAreas: ['area-A'], allowedStages: ['stage-1'], allowEffects: true },
    } as const;
    const commands = new CommandService({ store, organizationId: 'org-ac05', operations, eventSink: event => publishChainEvent(subscriptions, event) });
    const service = createService({ name: 'kshvi-ac05', port: 0, router: buildRouter({ sessions, commands, subscriptions }) });
    services.push(service);
    const port = await service.listen();
    const base = `http://127.0.0.1:${port}`;
    const command = async (expectedRevision: number, type: string, payload: Record<string, unknown>) => {
      const response = await fetch(`${base}/kshvi/instances/ac05/commands`, {
        method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: 'main', expectedRevision, idempotencyKey: `${type}-${expectedRevision}`, type, at: '2030-01-01T01:00:00Z', payload }),
      });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      return text;
    };
    await command(0, 'input.planned', { input: { id: 'planned-1', sourceRole: 'DIRECTOR', recipients: ['blue'], scheduledAt: '2030-01-01T02:00:00Z', actualAt: '2030-01-01T01:00:00Z', channelId: 'radio' } });
    await command(1, 'input.reactive', { input: { id: 'reactive-1', causeId: 'trainee-action-1', recipients: ['blue'], channelId: 'radio', actualAt: '2030-01-01T01:00:00Z', condition: { left: 'REPORT_RECEIVED', operator: 'EQ', right: 'REPORT_RECEIVED' } } });

    const stream = await fetch(`${base}/kshvi/instances/ac05/events`, { headers: { Authorization: `Bearer ${login.token}`, 'Last-Event-ID': '2' } });
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    readers.push(reader);
    const buffer = { value: '' };
    expect(await nextFrame(reader, buffer)).toContain('ready');
    await command(2, 'input.adaptive', { input: { id: 'adaptive-inside', severity: 1, areaId: 'area-A', stageId: 'stage-1', recipients: ['blue'], channelId: 'radio', actualAt: '2030-01-01T01:00:00Z', effects: [{ type: 'DELAY', amount: 5 }] } });
    expect(await nextFrame(reader, buffer)).toContain('input.adaptive.applied.v1');
    await command(3, 'input.adaptive', { input: { id: 'adaptive-outside', severity: 9, areaId: 'area-A', stageId: 'stage-1', recipients: ['blue'], channelId: 'radio', actualAt: '2030-01-01T01:00:00Z', effects: [{ type: 'DELAY', amount: 50 }] } });
    const pending = commands.state('ac05', 'main').inputs['adaptive-outside']!;
    expect(pending.status).toBe('APPROVAL_REQUIRED');
    const requestId = pending.requestId!;
    await command(4, 'input.approve', { requestId, approved: true });
    expect(commands.state('ac05', 'main').inputs['adaptive-outside']!.status).toBe('APPLIED');
    await command(5, 'trigger.validate', { rules: [{ id: 'A', emits: ['B'] }, { id: 'B', emits: ['A'] }] });
    await command(6, 'input.reactive', { input: { id: 'reactive-unknown', causeId: 'unknown-condition', recipients: ['blue'], channelId: 'radio', actualAt: '2030-01-01T01:00:00Z', condition: { left: { status: 'UNKNOWN' }, operator: 'EQ', right: true } } });

    const state = commands.state('ac05', 'main');
    expect(state.inputs['planned-1']).toMatchObject({ status: 'REVIEW_REQUIRED', deviation: 'EARLY' });
    expect(state.inputs['reactive-1']).toMatchObject({ status: 'APPLIED', causeIds: ['trainee-action-1'] });
    expect(state.inputs['adaptive-inside']!.status).toBe('APPLIED');
    expect(state.triggerValidations[0]!.status).toBe('REQUIRES_REVIEW');
    expect(state.inputs['reactive-unknown']!.status).toBe('REQUIRES_REVIEW');

    const history = await store.listEvents('org-ac05', 'ac05', 'main');
    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (runId) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const directory = 'docs/release/kshvi/evidence/ac05';
      await mkdir(directory, { recursive: true });
      const initialScenario = { delegation: operations.delegation, inputs: ['planned-1', 'reactive-1', 'adaptive-inside', 'adaptive-outside'], cycle: ['A', 'B'] };
      const initialRevision = { id: 'ac05-inputs', revision: 1, sha256: hashCanonical(initialScenario) };
      const environment = { transport: 'HTTP+SSE', delegation: operations.delegation };
      const metrics = { planned: 1, reactive: 2, adaptive: 2, approvalRequests: 1, cyclesStopped: 1, unresolvedStopped: 1 };
      const initialPath = `${directory}/initial-scenario.json`;
      const journalPath = `${directory}/journal.json`;
      const protocolPath = `${directory}/protocol.txt`;
      const metricsPath = `${directory}/metrics.json`;
      const environmentPath = `${directory}/environment.json`;
      const limitations = ['Проверяется управляемый цикл вводных; долговременная нагрузка планировщика измеряется отдельно.'];
      await writeFile(initialPath, JSON.stringify({ initialRevision, scenario: initialScenario }, null, 2));
      await writeFile(journalPath, JSON.stringify({ runId, commit, events: history }, null, 2));
      await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
      await writeFile(environmentPath, JSON.stringify(environment, null, 2));
      await writeFile(protocolPath, `AC-05 завершён\nrunId: ${runId}\ncommit: ${commit}\nДосрочная вводная отмечена; реактивная причина сохранена; адаптация ограничена; заявка применена после утверждения; цикл и UNKNOWN остановлены.\n`);
      const proof = {
        runId, commit, initialRevision,
        journal: { path: journalPath, sha256: hashCanonical(history), eventCount: history.length },
        hashes: { scenario: initialRevision.sha256, environment: hashCanonical(environment), journal: hashCanonical(history) },
        protocols: [protocolPath], screenshots: [], metrics, limitations,
        artifacts: [initialPath, journalPath, protocolPath, metricsPath, environmentPath],
      };
      await writeFile('docs/release/kshvi/acceptance/AC-05.proof.json', JSON.stringify(proof, null, 2));
    }
  });
}, 15_000);
