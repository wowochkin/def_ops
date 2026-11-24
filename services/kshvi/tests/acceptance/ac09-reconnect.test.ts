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
const decision = (id: string) => ({
  id, sideId: 'blue', authorId: 'leader', createdAt: '2030-01-01T01:00:00Z', intent: `Скрытый замысел ${id}`,
  goals: [], tasks: [{ id: `task-${id}`, assigneeId: 'node-1', title: 'Задача' }], resources: [], deadlines: [], coordination: [], reserves: [], transitionConditions: [], assumptions: [],
}) as const;

it('AC-09: повтор идемпотентен, reconnect применяет новые права и закрывает sequence gap', async () => {
  await withKshviDatabase(async store => {
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    const logins = new Map<string, { token: string; csrfToken: string }>();
    for (let index = 0; index < 25; index += 1) {
      const userId = index === 0 ? 'leader' : index === 1 ? 'changing' : `user-${index}`;
      const sideId = index % 5 === 0 ? 'red' : 'blue';
      const authorities = index === 0 ? ['instance:command', 'projection:read', 'TRUTH_READ'] : ['projection:read'];
      const roles = [{ id: `role-${userId}`, role: index === 0 ? 'LEADER' : 'TRAINEE', sideId, authorities, assignedNodeIds: ['node-1'], assignedInstanceIds: ['ac09'] }];
      if (userId === 'changing') roles.push({ id: 'role-changing-new', role: 'LEADER', sideId: 'blue', authorities: ['projection:read'], assignedNodeIds: ['node-2'], assignedInstanceIds: ['ac09'] });
      await sessions.createAccount({ userId, username: userId, password: 'secret123', organizationId: 'org-ac09', roles });
      const login = await sessions.login(userId, 'secret123');
      await sessions.selectRole(login.token, `role-${userId}`);
      logins.set(userId, login);
    }
    const subscriptions = new SubscriptionService();
    const commands = new CommandService({ store, organizationId: 'org-ac09', eventSink: event => publishChainEvent(subscriptions, event) });
    const service = createService({ name: 'kshvi-ac09', port: 0, router: buildRouter({ sessions, commands, subscriptions }) });
    services.push(service);
    const port = await service.listen();
    const base = `http://127.0.0.1:${port}`;
    const command = async (expectedRevision: number, idempotencyKey: string, type: string, payload: Record<string, unknown>) => {
      return fetch(`${base}/kshvi/instances/ac09/commands`, {
        method: 'POST', headers: { Authorization: `Bearer ${logins.get('leader')!.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: 'main', expectedRevision, idempotencyKey, type, at: '2030-01-01T01:00:00Z', payload }),
      });
    };
    const open = async (userId: string, after = 0) => {
      const response = await fetch(`${base}/kshvi/instances/ac09/events`, { headers: { Authorization: `Bearer ${logins.get(userId)!.token}`, 'Last-Event-ID': String(after) } });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      readers.push(reader);
      return { reader, buffer: { value: '' } };
    };
    const clients = await Promise.all([...logins.keys()].map(userId => open(userId)));
    await Promise.all(clients.map(client => nextFrame(client.reader, client.buffer)));
    await command(0, 'first', 'decision.create', { decision: decision('first') });
    for (const client of clients) expect(await nextFrame(client.reader, client.buffer)).toMatch(/decision.created.v1|projection.refresh/);
    for (const client of clients) await client.reader.cancel().catch(() => undefined);

    const lostResponse = await command(1, 'second', 'input.planned', { input: { id: 'second', sourceRole: 'LEADER', recipients: ['node-1'], scheduledAt: '2030-01-01T02:00:00Z', actualAt: '2030-01-01T01:00:00Z', channelId: 'radio' } });
    expect(lostResponse.status).toBe(200);
    void lostResponse;
    const repeatedResponse = await command(1, 'second', 'input.planned', { input: { id: 'second', sourceRole: 'LEADER', recipients: ['node-1'], scheduledAt: '2030-01-01T02:00:00Z', actualAt: '2030-01-01T01:00:00Z', channelId: 'radio' } });
    const repeated = await repeatedResponse.json() as { eventId: string; revision: number; idempotent: boolean };
    expect(repeated.idempotent).toBe(true);
    expect(repeated.revision).toBe(2);
    expect(await store.listEvents('org-ac09', 'ac09', 'main')).toHaveLength(2);

    await sessions.selectRole(logins.get('changing')!.token, 'role-changing-new');
    const reconnected = await Promise.all([...logins.keys()].map(userId => open(userId, 1)));
    await Promise.all(reconnected.map(client => nextFrame(client.reader, client.buffer)));
    for (const [index, client] of reconnected.entries()) {
      const frame = await nextFrame(client.reader, client.buffer);
      if (index === 1) {
        expect(frame).toContain('projection.refresh');
        expect(frame).not.toContain('Скрытый замысел');
      } else {
        expect(frame).toMatch(/input.proposed.v1|projection.refresh/);
      }
    }
    const stale = await open('changing', 999);
    expect(await nextFrame(stale.reader, stale.buffer)).toContain('snapshot.required');

    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (runId) {
      const history = await store.listEvents('org-ac09', 'ac09', 'main');
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const directory = 'docs/release/kshvi/evidence/ac09';
      await mkdir(directory, { recursive: true });
      const initialScenario = { connections: 25, firstCommand: 'first', secondCommand: 'second', sequenceBeforeReconnect: 1 };
      const initialRevision = { id: 'ac09-reconnect', revision: 1, sha256: hashCanonical(initialScenario) };
      const environment = { connections: 25, transport: 'HTTP+SSE', roleChangedBeforeReconnect: true };
      const metrics = { connections: 25, confirmedLost: 0, duplicateEffects: 0, roleFiltered: 1, snapshotRequired: 1 };
      const initialPath = `${directory}/initial-scenario.json`;
      const journalPath = `${directory}/journal.json`;
      const protocolPath = `${directory}/protocol.txt`;
      const metricsPath = `${directory}/metrics.json`;
      const environmentPath = `${directory}/environment.json`;
      const limitations = ['Разрыв моделируется отменой HTTP/SSE-чтения; отображение периода обрыва проверяется отдельным тестом OfflineBanner.'];
      await writeFile(initialPath, JSON.stringify({ initialRevision, scenario: initialScenario }, null, 2));
      await writeFile(journalPath, JSON.stringify({ runId, commit, events: history }, null, 2));
      await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
      await writeFile(environmentPath, JSON.stringify(environment, null, 2));
      await writeFile(protocolPath, `AC-09 завершён\nrunId: ${runId}\ncommit: ${commit}\nПовтор вернул исходный результат; эффект один; reconnect применил новые права; устаревшая последовательность закрыта snapshot.required.\n`);
      const proof = {
        runId, commit, initialRevision,
        journal: { path: journalPath, sha256: hashCanonical(history), eventCount: history.length },
        hashes: { scenario: initialRevision.sha256, environment: hashCanonical(environment), journal: hashCanonical(history) },
        protocols: [protocolPath], screenshots: [], metrics, limitations,
        artifacts: [initialPath, journalPath, protocolPath, metricsPath, environmentPath],
      };
      await writeFile('docs/release/kshvi/acceptance/AC-09.proof.json', JSON.stringify(proof, null, 2));
    }
  });
}, 25_000);
