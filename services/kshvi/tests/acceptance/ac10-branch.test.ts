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
const decision = (id: string) => ({
  id, sideId: 'blue', authorId: 'leader', createdAt: '2030-01-01T01:00:00Z', intent: `Замысел ${id}`,
  goals: [], tasks: [{ id: `task-${id}`, assigneeId: 'node-1', title: 'Задача' }], resources: [], deadlines: [], coordination: [], reserves: [], transitionConditions: [], assumptions: [],
}) as const;
const documentDraft = {
  id: 'official-doc:r1', documentId: 'official-doc', revision: 1,
  requisites: {
    exerciseId: 'ac10', scenarioRevisionId: 'scenario-r1', instanceId: 'ac10', authorId: 'author', category: 'OPERATIONAL', type: 'ORDER',
    title: 'Приказ', number: '1', operationalAt: '2030-01-01T01:00:00Z', place: 'Район', validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z',
    stageId: 'stage', sideId: 'blue', visibility: { sideIds: ['blue'], instanceIds: [], roles: [] }, addressees: [{ instanceId: 'node-1', channelId: 'radio' }],
    copies: [], sourceRole: 'LEADER', deliveryChannelId: 'radio', basis: 'decision-1', executorId: 'node-1', deadlineAt: '2030-01-01T02:00:00Z',
    linkedEventIds: [], linkedDecisionIds: ['official-decision'], linkedTaskIds: ['task'], templateVersion: '1',
  },
  content: { body: 'Выполнить задачу', units: {} }, map: null, attachments: [], approvalRouteId: 'route', supersedes: null, supersedesRevision: null, supersedeReason: null,
} as const;

it('AC-10: альтернатива изолирована, а перенос возможен только новым официальным решением', async () => {
  await withKshviDatabase(async store => {
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    const logins = new Map<string, { token: string; csrfToken: string }>();
    for (const [userId, authorities] of [['leader', ['instance:command', 'projection:read', 'OFFICIAL_DECISION']], ['trainee', ['instance:command']]] as const) {
      await sessions.createAccount({ userId, username: userId, password: 'secret123', organizationId: 'org-ac10', roles: [{ id: `role-${userId}`, role: 'LEADER', sideId: 'blue', authorities, assignedNodeIds: ['node-1'] }] });
      const login = await sessions.login(userId, 'secret123');
      await sessions.selectRole(login.token, `role-${userId}`);
      logins.set(userId, login);
    }
    const subscriptions = new SubscriptionService();
    const commands = new CommandService({ store, organizationId: 'org-ac10', eventSink: event => publishChainEvent(subscriptions, event) });
    const service = createService({ name: 'kshvi-ac10', port: 0, router: buildRouter({ sessions, commands, subscriptions }) });
    services.push(service);
    const port = await service.listen();
    const base = `http://127.0.0.1:${port}`;
    const post = async (userId: string, route: string, body: unknown, expected = 200) => {
      const response = await fetch(`${base}${route}`, { method: 'POST', headers: { Authorization: `Bearer ${logins.get(userId)!.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await response.text();
      expect(response.status, text).toBe(expected);
      return text;
    };
    const command = async (branchId: string, expectedRevision: number, type: string, payload: Record<string, unknown>, userId = 'leader', expected = 200) => post(userId, `/kshvi/instances/ac10/${branchId === 'main' ? 'commands' : `branches/${branchId}/commands`}`, {
      branchId, expectedRevision, idempotencyKey: `${branchId}-${type}-${expectedRevision}`, type, at: '2030-01-01T01:00:00Z', payload,
    }, expected);
    await command('main', 0, 'decision.create', { decision: decision('official-decision') });
    await command('main', 1, 'document.create', { revision: documentDraft });
    await command('main', 2, 'document.transition', { documentId: 'official-doc', action: 'SUBMIT' });
    await command('main', 3, 'document.transition', { documentId: 'official-doc', action: 'APPROVE' });
    const officialBefore = await store.listEvents('org-ac10', 'ac10', 'main');
    expect(officialBefore).toHaveLength(4);

    await post('leader', '/kshvi/instances/ac10/branches', {
      sourceBranchId: 'main', branchId: 'alternative-1', assumption: 'Новое учебное допущение',
      versionChanges: { model: { id: 'aggregate-v2', revision: 2, sha256: hashCanonical({ id: 'aggregate-v2' }) } },
    }, 201);
    await command('alternative-1', 0, 'decision.create', { decision: decision('alternative-decision') });
    await command('alternative-1', 1, 'calculation.create', { calculationId: 'alternative-calc', mode: 'DETERMINISTIC', input: {
      reason: 'Альтернативная модель', inputSnapshot: { revision: 2 }, inputs: { episode: { state: {}, forces: {}, task: { id: 'task', status: 'IN_PROGRESS', progressPercent: 0 }, resource: { id: 'fuel', unit: 'L', onHand: 20, consumption: 10, supplied: 0 }, elapsedMinutes: 30, position: { remainingMeters: 100, travelledMeters: 0 }, uncertainty: {}, effects: { taskProgressDelta: 10, positionAdvanceMeters: 20, stateChanges: {}, uncertaintyChanges: {} } } },
      requiredInputs: [], units: {}, modelVersion: 'aggregate-v2', profileVersions: {}, modelPassport: { purpose: 'Альтернатива', limitations: ['Учебное допущение'], source: { kind: 'ASSUMPTION', note: 'Новая модельная версия', applicability: 'AC-10' }, knownErrors: [], examples: [{ input: 1, expected: 1 }], approvedBy: 'Методист', version: 2 }, sideId: 'blue', nodeId: 'node-1',
    } });
    const comparisonResponse = await fetch(`${base}/kshvi/instances/ac10/branches/alternative-1/compare?sourceBranchId=main`, { headers: { Authorization: `Bearer ${logins.get('leader')!.token}` } });
    const comparison = await comparisonResponse.json() as { differences: { kind: string }[]; causalAttribution: string };
    expect(comparisonResponse.status, JSON.stringify(comparison)).toBe(200);
    expect(comparison.differences[0]!.kind).toBe('MODEL_VERSION');
    expect(comparison.causalAttribution).toBe('NOT_CAUSALLY_COMPARABLE');
    expect(await store.listEvents('org-ac10', 'ac10', 'main')).toHaveLength(4);
    await post('trainee', '/kshvi/instances/ac10/branches/alternative-1/publish', {}, 500);
    await post('trainee', '/kshvi/instances/ac10/branches/alternative-1/adopt', { sourceEventId: (await store.listEvents('org-ac10', 'ac10', 'alternative-1'))[0]!.eventId, rationale: 'Без полномочия', decision: decision('forbidden-adoption'), expectedRevision: 4 }, 500);
    expect(await store.listEvents('org-ac10', 'ac10', 'main')).toHaveLength(4);
    await post('leader', '/kshvi/instances/ac10/branches/alternative-1/adopt', { sourceEventId: (await store.listEvents('org-ac10', 'ac10', 'alternative-1'))[0]!.eventId, rationale: 'Новое официальное решение руководителя', decision: decision('adopted-official'), expectedRevision: 4 });
    const officialAfter = await store.listEvents('org-ac10', 'ac10', 'main');
    expect(officialAfter).toHaveLength(5);
    expect(officialAfter.at(-1)).toMatchObject({ type: 'branch.decision.adopted.v1', payload: { rationale: 'Новое официальное решение руководителя', sourceBranchId: 'alternative-1' } });
    expect(await store.listEvents('org-ac10', 'ac10', 'alternative-1')).toHaveLength(2);
    expect(commands.state('ac10', 'main').documents['official-doc']!.signatures).not.toHaveLength(0);

    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (runId) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const directory = 'docs/release/kshvi/evidence/ac10';
      await mkdir(directory, { recursive: true });
      const initialRevision = { id: 'ac10-branch', revision: 1, sha256: hashCanonical({ officialBefore, model: 'aggregate-v2' }) };
      const environment = { officialEventsBefore: 4, officialEventsAfter: 5, alternativeEvents: 2, comparison: comparison.causalAttribution };
      const metrics = { publicationRejected: 1, unauthorizedAdoptionRejected: 1, adoptedByLeader: 1, officialHistoryPreserved: 1 };
      const initialPath = `${directory}/initial-scenario.json`;
      const journalPath = `${directory}/journal.json`;
      const protocolPath = `${directory}/protocol.txt`;
      const metricsPath = `${directory}/metrics.json`;
      const environmentPath = `${directory}/environment.json`;
      const limitations = ['Сравнение доказывает изоляцию и различие версий, но не причинное превосходство модели; единый рейтинг не создаётся.'];
      await writeFile(initialPath, JSON.stringify({ initialRevision, scenario: { officialBefore, alternative: 'alternative-1' } }, null, 2));
      await writeFile(journalPath, JSON.stringify({ runId, commit, official: officialBefore, alternative: await store.listEvents('org-ac10', 'ac10', 'alternative-1'), adopted: officialAfter.at(-1) }, null, 2));
      await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
      await writeFile(environmentPath, JSON.stringify(environment, null, 2));
      await writeFile(protocolPath, `AC-10 завершён\nrunId: ${runId}\ncommit: ${commit}\nАльтернатива изолирована; сравнение началось с версии модели; обычная публикация запрещена; перенос оформлен новым решением руководителя.\n`);
      const proof = {
        runId, commit, initialRevision,
        journal: { path: journalPath, sha256: hashCanonical({ officialBefore, officialAfter }), eventCount: officialAfter.length },
        hashes: { scenario: initialRevision.sha256, environment: hashCanonical(environment), journal: hashCanonical({ officialBefore, officialAfter }) },
        protocols: [protocolPath], screenshots: [], metrics, limitations,
        artifacts: [initialPath, journalPath, protocolPath, metricsPath, environmentPath],
      };
      await writeFile('docs/release/kshvi/acceptance/AC-10.proof.json', JSON.stringify(proof, null, 2));
    }
  });
}, 20_000);
