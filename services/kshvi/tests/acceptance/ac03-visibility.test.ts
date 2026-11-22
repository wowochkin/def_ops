import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createService } from '@def-ops/service-kit';
import { afterEach, expect, it } from 'vitest';
import { buildTask52Router } from '../../src/http/contracts';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { CommandService } from '../../src/instances/command-service';
import { publishChainEvent, SubscriptionService } from '../../src/http/subscription-service';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { withKshviDatabase } from '../helpers/database';
import { linkedExercisePayload, serverExerciseEvidence } from '../helpers/full-seal';
import { InMemoryExerciseStore } from '../../src/store/exercise-store';

const services: Array<ReturnType<typeof createService>> = [];
const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
afterEach(async () => {
  for (const reader of readers.splice(0)) await reader.cancel().catch(() => undefined);
  while (services.length) await services.pop()?.close();
});
const decision = (id: string) => ({
  id, sideId: 'blue', authorId: 'leader', createdAt: '2030-01-01T01:00:00Z', intent: `Секретный замысел ${id}`,
  goals: [], tasks: [{ id: `task-${id}`, assigneeId: 'node-1', title: 'Задача' }], resources: [], deadlines: [], coordination: [], reserves: [], transitionConditions: [], assumptions: [],
}) as const;
const world = {
  forces: [{ id: 'force-blue', side: 'blue', secret: 'blue-force-secret' }, { id: 'force-red', side: 'red', secret: 'red-force-secret' }],
  observations: [
    { id: 'observation-blue', sideId: 'blue', secret: 'blue-observation-secret', visibility: { sideIds: ['blue'], instanceIds: ['node-1'], roles: [] } },
    { id: 'observation-red', sideId: 'red', secret: 'red-observation-secret', visibility: { sideIds: ['red'], instanceIds: ['node-1'], roles: [] } },
  ],
  inputs: [{ id: 'future-blue', availableAt: '2031-01-01T00:00:00Z', recipients: ['blue'], secret: 'future-blue-secret' }],
  documents: [
    {
      id: 'document-blue', title: 'Секретный приказ blue', sideId: 'blue', visibility: { sideIds: ['blue'], instanceIds: ['node-1'], roles: [] },
      attachments: [
        { id: 'attachment-blue', title: 'Схема blue', content: 'blue-attachment-secret', visibility: { sideIds: ['blue'], instanceIds: ['node-1'], roles: [] } },
        { id: 'attachment-red-hidden', title: 'Личное red', content: 'red-attachment-secret', visibility: { sideIds: ['red'], instanceIds: [], roles: [] } },
      ],
    },
    { id: 'document-red', title: 'Секретный приказ red', sideId: 'red', visibility: { sideIds: ['red'], instanceIds: ['node-1'], roles: [] }, attachments: [] },
  ],
  reference: { assessment: 'red-assessment-secret' },
};
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

it('AC-03: проекции, поиск, вложения, экспорт, реплей и отзыв роли не раскрывают скрытое', async () => {
  await withKshviDatabase(async store => {
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    const logins = new Map<string, { token: string; csrfToken: string }>();
    const definitions = [
      ['leader', 'LEADER', 'blue', ['instance:command', 'projection:read', 'exercise:create', 'exercise:read', 'exercise:conduct', 'TRUTH_READ'], ['node-1']],
      ['blue', 'TRAINEE', 'blue', ['projection:read', 'exercise:read', 'replay.read'], ['node-1']],
      ['red', 'TRAINEE', 'red', ['projection:read', 'exercise:read'], ['node-1']],
      ['intermediary', 'INTERMEDIARY', 'blue', ['projection:read', 'exercise:read'], ['node-2']],
      ['author', 'AUTHOR', 'blue', ['exercise:revise'], ['node-1']],
      ['approver', 'APPROVER', 'blue', ['exercise:revise'], ['node-1']],
      ['director', 'DIRECTOR', 'blue', ['scenario.seal'], ['node-1']],
    ] as const;
    for (const [userId, role, sideId, authorities, assignedNodeIds] of definitions) {
      const assignedInstanceIds = userId === 'leader' ? undefined : ['instance-main'];
      await sessions.createAccount({
        userId, username: userId, password: 'secret123', organizationId: 'org-ac03',
        roles: [{ id: `role-${userId}`, role, sideId, authorities, assignedNodeIds, ...(assignedInstanceIds ? { assignedInstanceIds } : {}) }],
      });
      const login = await sessions.login(userId, 'secret123');
      await sessions.selectRole(login.token, `role-${userId}`);
      logins.set(userId, login);
    }
    const subscriptions = new SubscriptionService();
    const commands = new CommandService({ store, organizationId: 'org-ac03', eventSink: event => publishChainEvent(subscriptions, event) });
    const exerciseStore = new InMemoryExerciseStore({ evidence: serverExerciseEvidence() });
    const audit: Record<string, unknown>[] = [];
    const service = createService({ name: 'kshvi-ac03', port: 0, router: buildTask52Router({
      sessions, commands, subscriptions, exerciseStore, projectionWorld: world,
      audit: async record => { audit.push(record as unknown as Record<string, unknown>); },
    }) });
    services.push(service);
    const port = await service.listen();
    const base = `http://127.0.0.1:${port}`;
    const headers = (userId: string) => ({ Authorization: `Bearer ${logins.get(userId)!.token}`, 'X-CSRF-Token': logins.get(userId)!.csrfToken, 'Content-Type': 'application/json' });
    const get = async (userId: string, route: string, expected = 200) => {
      const response = await fetch(`${base}${route}`, { headers: headers(userId) });
      const text = await response.text();
      expect(response.status, text).toBe(expected);
      return text;
    };
    const post = async (userId: string, route: string, body: unknown, expected = 200) => {
      const response = await fetch(`${base}${route}`, { method: 'POST', headers: headers(userId), body: JSON.stringify(body) });
      const text = await response.text();
      expect(response.status, text).toBe(expected);
      return text;
    };
    const blueProjection = await get('blue', '/kshvi/instances/instance-main/projection?operationalAt=2030-01-01T01:00:00Z');
    expect(blueProjection).toContain('force-blue');
    expect(blueProjection).not.toContain('red-force-secret');
    expect(blueProjection).not.toContain('red-observation-secret');
    expect(blueProjection).not.toContain('future-blue-secret');
    expect(blueProjection).not.toContain('red-assessment-secret');
    expect(blueProjection).not.toContain('red-attachment-secret');
    expect(blueProjection).toContain('attachment-blue');
    expect(await get('intermediary', '/kshvi/instances/instance-main/projection?operationalAt=2030-01-01T01:00:00Z')).not.toContain('document-blue');
    expect(await get('red', '/kshvi/instances/instance-other/projection?operationalAt=2030-01-01T01:00:00Z', 403)).not.toContain('blue-force-secret');

    expect(await get('blue', '/kshvi/instances/instance-main/search?q=Секретный')).toContain('document-blue');
    expect(await get('blue', '/kshvi/instances/instance-main/search?q=Секретный')).not.toContain('document-red');
    expect(await get('red', '/kshvi/instances/instance-main/search?q=Секретный')).not.toContain('document-blue');
    expect(await get('blue', '/kshvi/instances/instance-main/documents/document-red/attachments/attachment-blue', 403)).not.toContain('secret');
    expect(await get('blue', '/kshvi/instances/instance-main/documents/document-blue/attachments/attachment-blue')).toBe('blue-attachment-secret');
    const redExport = await get('red', '/kshvi/instances/instance-main/export');
    expect(redExport).not.toContain('blue-force-secret');
    expect(redExport).not.toContain('blue-attachment-secret');
    expect(redExport).not.toContain('red-assessment-secret');

    const redStream = await fetch(`${base}/kshvi/instances/instance-main/events`, { headers: headers('red') });
    expect(redStream.status).toBe(200);
    const reader = redStream.body!.getReader();
    readers.push(reader);
    const buffer = { value: '' };
    expect(await nextFrame(reader, buffer)).toContain('ready');
    await post('leader', '/kshvi/instances/instance-main/commands', {
      branchId: 'main', expectedRevision: 0, idempotencyKey: 'private-blue-1', type: 'decision.create', at: '2030-01-01T01:00:00Z', payload: { decision: decision('private-blue-1') },
    });
    expect(await nextFrame(reader, buffer)).toContain('projection.refresh');
    expect(buffer.value).not.toContain('Секретный замысел');
    await sessions.revoke(logins.get('red')!.token);
    await post('leader', '/kshvi/instances/instance-main/commands', {
      branchId: 'main', expectedRevision: 1, idempotencyKey: 'private-blue-2', type: 'decision.create', at: '2030-01-01T01:01:00Z', payload: { decision: decision('private-blue-2') },
    });
    expect(await nextFrame(reader, buffer)).toContain('subscription.revoked');
    expect((await fetch(`${base}/kshvi/instances/instance-main/events`, { headers: headers('red') })).status).toBe(401);

    const card = await post('leader', '/kshvi/exercises', { title: 'AC-03', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload({ intent: 'Замысел', reference: 'red-reference-secret' }) }, 201);
    const cardId = JSON.parse(card).id;
    await post('author', `/kshvi/exercises/${cardId}/transitions`, { expectedRevision: 1, command: 'SUBMIT' });
    await post('approver', `/kshvi/exercises/${cardId}/transitions`, { expectedRevision: 1, command: 'APPROVE' });
    await post('director', `/kshvi/exercises/${cardId}/seal`, { expectedRevision: 1 });
    const session = await post('leader', `/kshvi/exercises/${cardId}/sessions`, { revision: 1 }, 201);
    const sessionId = JSON.parse(session).id;
    const participantReplay = await get('blue', `/kshvi/exercises/${cardId}/sessions/${sessionId}/replay?cursor=0&perspective=PARTICIPANT`);
    expect(participantReplay).not.toContain('red-reference-secret');
    expect(participantReplay).not.toContain('red-assessment-secret');
    expect(audit.length).toBeGreaterThan(0);

    const history = await store.listEvents('org-ac03', 'instance-main', 'main');
    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (runId) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const directory = 'docs/release/kshvi/evidence/ac03';
      await mkdir(directory, { recursive: true });
      const initialScenario = { world, instanceId: 'instance-main', roles: definitions.map(([id, role, side]) => ({ id, role, side })) };
      const initialRevision = { id: 'ac03-visibility', revision: 1, sha256: hashCanonical(initialScenario) };
      const environment = { transport: 'HTTP+SSE', serverFiltering: true, auditRecords: audit.length };
      const metrics = { forbiddenResponses: 0, revokedSubscriptions: 1, hiddenSearchResults: 0, auditRecords: audit.length };
      const initialPath = `${directory}/initial-scenario.json`;
      const journalPath = `${directory}/journal.json`;
      const protocolPath = `${directory}/protocol.txt`;
      const metricsPath = `${directory}/metrics.json`;
      const environmentPath = `${directory}/environment.json`;
      const limitations = ['Проверка выполнена на локальном серверном стенде; браузерная история и IndexedDB проверяются отдельно в AC-17.'];
      await writeFile(initialPath, JSON.stringify({ initialRevision, scenario: initialScenario }, null, 2));
      await writeFile(journalPath, JSON.stringify({ runId, commit, events: history }, null, 2));
      await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
      await writeFile(environmentPath, JSON.stringify(environment, null, 2));
      await writeFile(protocolPath, `AC-03 завершён\nrunId: ${runId}\ncommit: ${commit}\nСкрытые payload, поиск, вложения, экспорт и реплей не раскрыты; старая подписка отозвана.\n`);
      const proof = {
        runId, commit, initialRevision,
        journal: { path: journalPath, sha256: hashCanonical(history), eventCount: history.length },
        hashes: { scenario: initialRevision.sha256, environment: hashCanonical(environment), journal: hashCanonical(history) },
        protocols: [protocolPath], screenshots: [], metrics, limitations,
        artifacts: [initialPath, journalPath, protocolPath, metricsPath, environmentPath],
      };
      await writeFile('docs/release/kshvi/acceptance/AC-03.proof.json', JSON.stringify(proof, null, 2));
    }
  });
}, 20_000);
