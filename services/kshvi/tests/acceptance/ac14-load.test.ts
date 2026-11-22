import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { modernCorpus } from '@def-ops/knowledge';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { afterEach, expect, it } from 'vitest';
import { createPool, dropSchema } from '@def-ops/db';
import { createService } from '@def-ops/service-kit';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { CommandService } from '../../src/instances/command-service';
import { KshviEventStore } from '../../src/store/event-store';
import { publishChainEvent, SubscriptionService } from '../../src/http/subscription-service';
import { ArchiveJobManager } from '../../src/archive/archive-jobs';
import { evaluateLoadThresholds, percentile } from '../../src/performance/latency-collector';

const INSTANCE_COUNT = 100;
const SEED_PER_INSTANCE = 100;
const WORKPLACES = 50;
const ACTIVE = 25;
const BASE_BATCHES = 5;
const BURST_BATCHES = 48;
const ORG = 'org-ac14';
let service: ReturnType<typeof createService> | undefined;
const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
afterEach(async () => {
  for (const reader of readers) await reader.cancel().catch(() => undefined);
  readers.clear();
  if (service) await service.close();
  service = undefined;
});

type Login = { token: string; csrfToken: string };
type Workplace = { id: number; instanceId: string; side: string; received: { type: string; payload?: Record<string, unknown>; receivedAt: number }[]; errors: string[] };
type LiveCommand = { expectedRevision: number; idempotencyKey: string; type: string; payload: Record<string, unknown>; at: string };

function decision(index: number) {
  return {
    id: `live-decision-${index}`, sideId: 'blue', authorId: 'leader', createdAt: '2030-01-01T01:00:00Z', intent: `Замысел ${index}`,
    goals: [{ id: `goal-${index}`, rank: 1, title: 'Цель' }], tasks: [{ id: `task-${index}`, assigneeId: 'node-1', title: 'Задача' }], resources: [],
    deadlines: [], coordination: [], reserves: [], transitionConditions: [], assumptions: [],
  } as const;
}
function observation(index: number) {
  return {
    id: `observation-${index}`, trueForceId: `force-${index}`, trueGeometry: { lon: 37.6, lat: 55.7 },
    trueAttributes: { type: 'motorized', readiness: 'hidden-readiness', personnel: 1000 }, observedAt: '2030-01-01T00:00:00Z',
    source: {
      id: `sensor-${index}`, kind: 'UAV', sideId: 'blue', profileVersion: 'uav-profile-v2',
      errorMeters: { min: 20, max: 100 }, delaySeconds: { min: 10, max: 60 }, completeness: 0.75, reliability: 0.8, validitySeconds: 600, attributeKeys: ['type'],
    },
    environment: { snapshotId: 'environment-1', errorMultiplier: 1.5, delayMultiplier: 2 },
    randomKey: { seed: '11', exerciseId: 'exercise-ac14', branchId: 'main', purpose: 'observation', ordinal: index, algorithmVersion: 1 },
  } as const;
}
const DOCUMENT_COUNT = 13;
function documentDraft(instanceId: string, index: number) {
  const documentId = `document-${instanceId}-${index}`;
  return {
    id: `${documentId}:r1`, documentId, revision: 1,
    requisites: {
      exerciseId: instanceId, scenarioRevisionId: 'scenario-r1', instanceId, authorId: 'scenario-author', category: 'OPERATIONAL', type: 'ORDER',
      title: `Приказ ${index}`, number: String(index + 1), operationalAt: '2030-01-01T01:00:00Z', place: 'Район', validFrom: '2030-01-01T00:00:00Z',
      validUntil: '2030-01-02T00:00:00Z', stageId: 'stage', sideId: 'blue', visibility: { sideIds: ['blue'], instanceIds: [], roles: [] },
      addressees: [{ instanceId: 'node-1', channelId: 'radio' }], copies: [], sourceRole: 'LEADER', deliveryChannelId: 'radio', basis: 'decision-1',
      executorId: 'node-1', deadlineAt: '2030-01-01T02:00:00Z', linkedEventIds: [], linkedDecisionIds: ['decision-1'], linkedTaskIds: ['task'], templateVersion: '1',
    },
    content: { body: `Выполнить задачу ${index}`, units: {} }, map: null, attachments: [], approvalRouteId: 'route',
    supersedes: null, supersedesRevision: null, supersedeReason: null,
  } as const;
}
function calculation(index: number) {
  return {
    reason: `Массовый расчёт ${index}`, inputSnapshot: { revision: 1 },
    inputs: { episode: {
      state: {}, forces: {}, task: { id: 'task', status: 'IN_PROGRESS', progressPercent: 0 },
      resource: { id: 'fuel', unit: 'L', onHand: 10, consumption: 14, supplied: 2 }, elapsedMinutes: 30,
      position: { remainingMeters: 100, travelledMeters: 0 }, uncertainty: {},
      effects: { taskProgressDelta: 20, positionAdvanceMeters: 50, stateChanges: {}, uncertaintyChanges: {} },
    } },
    requiredInputs: [], units: {}, modelVersion: 'aggregate-v1', profileVersions: {},
    modelPassport: { purpose: 'Нагрузочный расчёт', limitations: ['Только учебный стенд'], source: { kind: 'ASSUMPTION', note: 'Учебное допущение', applicability: 'AC-14' }, knownErrors: [], examples: [{ input: 1, expected: 1 }], approvedBy: 'Методист', version: 1 },
    sideId: 'blue', nodeId: 'node-1',
    stochastic: {
      key: { seed: '11', exerciseId: 'exercise-ac14', branchId: 'main', purpose: 'mass-calculation', ordinal: index, algorithmVersion: 1 },
      outcomes: [{ id: 'expected', weight: 1, effects: { taskProgressDelta: 20, positionAdvanceMeters: 50, stateChanges: {}, uncertaintyChanges: {} } }],
    },
  } as const;
}
function commandFor(instanceId: string, index: number, revision: number, key: string, includeDocumentIssue = true, fixtureOffset = 0): LiveCommand {
  if (index % 5 === 0) return { expectedRevision: revision, idempotencyKey: key, type: 'observation.record', payload: { input: observation(index) }, at: '2030-01-01T01:00:00Z' };
  if (includeDocumentIssue && index % 100 === 13) return {
    expectedRevision: revision, idempotencyKey: key, type: 'document.transition', at: '2030-01-01T01:00:00Z',
    payload: { documentId: `document-${instanceId}-${Math.floor((index - fixtureOffset) / 100)}`, action: 'ISSUE', recipient: { instanceId: 'node-1', sideId: 'blue', roles: ['TRAINEE'] } },
  };
  if (index % 10 === 3) return {
    expectedRevision: revision, idempotencyKey: key, type: 'communication.enqueue', at: '2030-01-01T01:00:00Z',
    payload: { message: { id: `message-${index}`, type: 'ORDER', senderRole: 'LEADER', fromInstanceId: instanceId, recipientIds: ['node-1'], sizeBytes: 100, priority: 1, domainKey: `domain-${index}`, createdAt: '2030-01-01T01:00:00Z' } },
  };
  if (index % 15 === 7) return { expectedRevision: revision, idempotencyKey: key, type: 'calculation.create', payload: { calculationId: `calculation-${index}`, mode: 'STOCHASTIC', input: calculation(index) }, at: '2030-01-01T01:00:00Z' };
  return { expectedRevision: revision, idempotencyKey: key, type: 'decision.create', payload: { decision: decision(index) }, at: '2030-01-01T01:00:00Z' };
}
async function mapLimit<T>(values: readonly T[], limit: number, worker: (value: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  async function run(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= values.length) return;
      await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, run));
}
async function waitUntil(deadline: number): Promise<void> {
  for (;;) {
    const remainingMs = deadline - performance.now();
    if (remainingMs <= 0) return;
    await new Promise(resolve => setTimeout(resolve, Math.min(remainingMs, 50)));
  }
}
async function frames(reader: ReadableStreamDefaultReader<Uint8Array>, workplace: Workplace): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    for (;;) {
      const boundary = buffer.indexOf('\n\n');
      if (boundary < 0) break;
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      if (!data) continue;
      try {
        const event = JSON.parse(data) as { type: string; payload?: Record<string, unknown> };
        if (event.type === 'ready') continue;
        workplace.received.push({ ...event, receivedAt: performance.now() });
      } catch (error) {
        workplace.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
}
async function openWorkplace(id: number, instanceId: string, side: string, baseUrl: string, token: string, afterSequence: number): Promise<Workplace> {
  const response = await fetch(`${baseUrl}/kshvi/instances/${instanceId}/events`, { headers: { Authorization: `Bearer ${token}`, 'Last-Event-ID': String(afterSequence) } });
  if (response.status !== 200) throw new Error(`Рабочее место ${id}: SSE ${response.status}`);
  const workplace: Workplace = { id, instanceId, side, received: [], errors: [] };
  const reader = response.body!.getReader();
  readers.add(reader);
  void frames(reader, workplace).catch(error => { if (workplace.errors.length === 0) workplace.errors.push(error instanceof Error ? error.message : String(error)); });
  return workplace;
}

it('AC-14: 50 мест, 25 участников, официальный API, per-role SSE и тяжёлый экспорт', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('AC-14 требует реальный PostgreSQL через TEST_DATABASE_URL');
  const pool = createPool(databaseUrl, 50);
  const schema = `kshvi_ac14_${randomUUID().replaceAll('-', '')}`;
  const store = new KshviEventStore({ pool, schema });
  const subscriptions = new SubscriptionService();
  const operations = {
    knownInstanceIds: ['node-1', ...Array.from({ length: INSTANCE_COUNT }, (_, index) => `load-${index}`)],
    availableChannelIds: ['radio'], nodes: [{ id: 'node-1', status: 'AVAILABLE' as const }],
    channels: Array.from({ length: INSTANCE_COUNT }, (_, index) => ({
      id: 'radio', version: 1, fromInstanceId: `load-${index}`, toInstanceId: 'node-1', nodeIds: ['node-1'], direction: 'SIMPLEX' as const,
      allowedMessageTypes: ['ORDER'], capacity: 100, bytesPerSecond: 1000, baseDelayMs: 25, priorityPolicy: { allowQueuedPreemption: false },
      availability: 'AVAILABLE' as const, encrypted: true, reserveChannelIds: [], validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z',
    })),
  };
  const commands = new CommandService({ store, organizationId: ORG, operations, eventSink: event => publishChainEvent(subscriptions, event) });
  const commandErrors: string[] = [];
  const revisions = new Map<string, number>();
  const confirmed = new Map<string, { eventId: string; revision: number }>();
  const commandInputs = new Map<string, LiveCommand>();
  const sentAt = new Map<string, number>();
  const sentTypes = new Map<string, string>();
  let phase = 'initialization';
  let baseUrl = '';
  let postgresVersion = 'unknown';
  const workplaces: Workplace[] = [];

  try {
    await store.init();
    postgresVersion = String((await pool.query('select version() as version')).rows[0]?.version ?? 'unknown');
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    const activeLogins: Login[] = [];
    const observerLogins: Login[] = [];
    for (let index = 0; index < ACTIVE; index += 1) {
      const userId = `active-${index}`;
      await sessions.createAccount({
        userId, username: userId, password: 'secret123', organizationId: ORG,
        roles: [{ id: `role-${userId}`, role: 'LEADER', sideId: 'blue', authorities: ['instance:command', 'projection:read', 'TRUTH_READ'], assignedNodeIds: ['node-1'] }],
      });
      const login = await sessions.login(userId, 'secret123');
      await sessions.selectRole(login.token, `role-${userId}`);
      activeLogins.push(login);
    }
    for (let index = 0; index < WORKPLACES - ACTIVE; index += 1) {
      const userId = `observer-${index}`;
      const sideId = index % 2 === 0 ? 'blue' : 'red';
      await sessions.createAccount({
        userId, username: userId, password: 'secret123', organizationId: ORG,
        roles: [{ id: `role-${userId}`, role: 'TRAINEE', sideId, authorities: ['projection:read'], assignedNodeIds: ['node-1'] }],
      });
      const login = await sessions.login(userId, 'secret123');
      await sessions.selectRole(login.token, `role-${userId}`);
      observerLogins.push(login);
    }
    await sessions.createAccount({
      userId: 'load-director', username: 'load-director', password: 'secret123', organizationId: ORG,
      roles: [{ id: 'role-load-director', role: 'DIRECTOR', sideId: null, authorities: ['exercise:read', 'exercise:revise'] }],
    });
    const directorLogin = await sessions.login('load-director', 'secret123');
    await sessions.selectRole(directorLogin.token, 'role-load-director');
    service = createService({ name: 'kshvi-ac14', version: '0', port: 0, router: buildRouter({ sessions, commands, subscriptions }) });
    const port = await service.listen();
    baseUrl = `http://127.0.0.1:${port}`;

    const execute = async (instanceId: string, login: Login, input: LiveCommand, duplicate = false) => {
      const key = input.idempotencyKey;
      try {
        const startedAt = performance.now();
        const response = await fetch(`${baseUrl}/kshvi/instances/${instanceId}/commands`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ branchId: 'main', ...input }),
        });
        const body = await response.json() as { eventId?: string; revision?: number; idempotent?: boolean; error?: { message?: string } };
        if (response.status !== 200 || !body.eventId || body.revision === undefined) {
          commandErrors.push(`${key}: ${response.status} ${body.error?.message ?? 'команда не подтверждена'}`);
          return;
        }
        if (duplicate) {
          if (!body.idempotent) commandErrors.push(`${key}: повтор не признан идемпотентным`);
          return;
        }
        if (!body.idempotent) revisions.set(instanceId, body.revision);
        if (key.startsWith('live-')) {
          confirmed.set(key, { eventId: body.eventId, revision: body.revision });
          sentAt.set(key, startedAt);
          sentTypes.set(key, input.type);
        }
      } catch (error) {
        commandErrors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    phase = 'official seed';
    const seedStartedAt = performance.now();
    const sourceRecord = modernCorpus.representatives[0]!;
    const source = {
      sourceRecordId: sourceRecord.id, sourceRevision: 1,
      sourceHash: createHash('sha256').update(JSON.stringify(sourceRecord)).digest('hex'),
      recordKind: 'REPRESENTATIVE' as const, modelInputs: false as const, simulationValidated: false as const, characteristics: [],
    };
    const createdForceIds = new Set<string>();
    await mapLimit(Array.from({ length: 1_000 }, (_, index) => index), 20, async index => {
      const response = await fetch(`${baseUrl}/kshvi/forces/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${directorLogin.token}`, 'X-CSRF-Token': directorLogin.csrfToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, sideId: index % 2 === 0 ? 'blue' : 'red', parentNodeId: `load-${Math.floor(index / 10)}`, scenarioValues: [] }),
      });
      const body = await response.json() as { id?: string; error?: { message?: string } };
      if (response.status !== 201 || !body.id) {
        commandErrors.push(`force-${index}: ${response.status} ${body.error?.message ?? 'сценарная копия не подтверждена'}`);
        return;
      }
      createdForceIds.add(body.id);
    });
    const forcesResponse = await fetch(`${baseUrl}/kshvi/forces/import`, { headers: { Authorization: `Bearer ${directorLogin.token}` } });
    const storedForces = await forcesResponse.json() as { id: string; parentNodeId: string }[];
    expect(forcesResponse.status).toBe(200);
    expect(storedForces).toHaveLength(1_000);
    expect(new Set(storedForces.map(force => force.id))).toEqual(createdForceIds);
    for (let instanceIndex = 0; instanceIndex < INSTANCE_COUNT; instanceIndex += 1) {
      expect(storedForces.filter(force => force.parentNodeId === `load-${instanceIndex}`)).toHaveLength(10);
    }
    await mapLimit(Array.from({ length: INSTANCE_COUNT }, (_, index) => index), 20, async instanceIndex => {
      const login = activeLogins[instanceIndex % ACTIVE];
      const instanceId = `load-${instanceIndex}`;
      let eventIndex = 0;
      for (let documentIndex = 0; documentIndex < DOCUMENT_COUNT; documentIndex += 1) {
        await execute(instanceId, login, {
          expectedRevision: eventIndex, idempotencyKey: `seed-${instanceIndex}-${eventIndex}`, type: 'document.create',
          payload: { revision: documentDraft(instanceId, documentIndex) }, at: '2030-01-01T01:00:00Z',
        });
        eventIndex += 1;
        for (const action of ['SUBMIT', 'APPROVE'] as const) {
          await execute(instanceId, login, {
            expectedRevision: eventIndex, idempotencyKey: `seed-${instanceIndex}-${eventIndex}`, type: 'document.transition',
            payload: { documentId: `document-${instanceId}-${documentIndex}`, action }, at: '2030-01-01T01:00:00Z',
          });
          eventIndex += 1;
        }
      }
      for (; eventIndex < SEED_PER_INSTANCE; eventIndex += 1) {
        const index = instanceIndex * SEED_PER_INSTANCE + eventIndex;
        await execute(instanceId, login, commandFor(instanceId, index, eventIndex, `seed-${instanceIndex}-${eventIndex}`, false));
      }
    });
    const seedMs = performance.now() - seedStartedAt;
    const seededEvents = Number((await pool.query(`select count(*)::int as count from ${schema}.events`)).rows[0].count);
    expect(seededEvents).toBe(10_000);

    phase = 'connect workplaces';
    for (let index = 0; index < ACTIVE; index += 1) {
      const instanceId = `load-${index}`;
      const afterSequence = subscriptions.after(instanceId, 0).at(-1)?.sequence ?? 0;
      workplaces.push(await openWorkplace(index * 2, instanceId, 'blue', baseUrl, activeLogins[index].token, afterSequence));
      workplaces.push(await openWorkplace(index * 2 + 1, instanceId, index % 2 === 0 ? 'blue' : 'red', baseUrl, observerLogins[index].token, afterSequence));
    }
    expect(workplaces).toHaveLength(WORKPLACES);

    phase = 'heavy export and official live load';
    const jobs = new ArchiveJobManager({ maxConcurrent: 2, maxQueue: 20, maxDurationMs: 240_000 });
    const owner = { organizationId: ORG, userId: 'load-director', authorities: ['archive.jobs.create', 'archive.jobs.read'] };
    const heavyKinds = ['EXPORT', 'ARCHIVE', 'MASS_CALCULATION', 'BULK_REPLAY'] as const;
    const heavySubmissions: { id: string; kind: typeof heavyKinds[number]; exportPath: string }[] = [];
    const submit = (kind: typeof heavyKinds[number], key: string) => {
      const exportPath = `docs/release/kshvi/acceptance/AC-14.${key}.json.gz`;
      const job = jobs.submit({
        idempotencyKey: key, kind, payload: { databaseUrl, schema, exportPath, jobKind: kind }, owner,
        task: { module: new URL('./ac14-export-worker.mjs', import.meta.url).href, exportName: 'default' },
      });
      heavySubmissions.push({ id: job.id, kind, exportPath });
    };
    const submitSet = (setIndex: number) => {
      for (const kind of heavyKinds) submit(kind, `set-${setIndex}-${kind.toLowerCase()}`);
    };
    submitSet(0);
    jobs.start();
    let maxRunningHeavy = 0;

    const baseStartedAt = performance.now();
    for (let batch = 0; batch < BASE_BATCHES; batch += 1) {
      const commandIndex = batch * 5;
      await Promise.all(Array.from({ length: 5 }, (_, offset) => {
        const index = commandIndex + offset;
        const participant = index % ACTIVE;
        const instanceId = `load-${participant}`;
        const input = commandFor(instanceId, 10_000 + index, revisions.get(instanceId)!, `live-${index}`, true, 10_000);
        commandInputs.set(input.idempotencyKey, input);
        return execute(instanceId, activeLogins[participant], input);
      }));
      maxRunningHeavy = Math.max(maxRunningHeavy, jobs.activeCount());
      await waitUntil(baseStartedAt + (batch + 1) * 1_000);
    }
    const baseMs = performance.now() - baseStartedAt;
    const burstWallStartedAt = Date.now();
    const burstStartedAt = performance.now();
    submitSet(1);
    for (let batch = 0; batch < BURST_BATCHES; batch += 1) {
      const commandIndex = BASE_BATCHES * 5 + batch * ACTIVE;
      await Promise.all(Array.from({ length: ACTIVE }, (_, participant) => {
        const index = commandIndex + participant;
        const instanceId = `load-${participant}`;
        const input = commandFor(instanceId, 10_000 + index, revisions.get(instanceId)!, `live-${index}`, true, 10_000);
        commandInputs.set(input.idempotencyKey, input);
        return execute(instanceId, activeLogins[participant], input);
      }));
      maxRunningHeavy = Math.max(maxRunningHeavy, jobs.activeCount());
      if (batch === 15) submitSet(2);
      if (batch === 31) submitSet(3);
      await waitUntil(burstStartedAt + (batch + 1) * 1_250);
    }
    const burstMs = performance.now() - burstStartedAt;
    const burstWallEndedAt = Date.now();
    submitSet(4);
    for (let index = 0; index < BASE_BATCHES * 5 + BURST_BATCHES * ACTIVE; index += 20) {
      const input = commandInputs.get(`live-${index}`)!;
      await execute(`load-${index % ACTIVE}`, activeLogins[index % ACTIVE], input, true);
    }

    const expectedUnique = BASE_BATCHES * 5 + BURST_BATCHES * ACTIVE;
    const expectedDeliveries = expectedUnique * 2;
    const waitStartedAt = performance.now();
    while (workplaces.reduce((sum, workplace) => sum + workplace.received.length, 0) < expectedDeliveries && performance.now() - waitStartedAt < 20_000) {
      maxRunningHeavy = Math.max(maxRunningHeavy, jobs.activeCount());
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    for (const submission of heavySubmissions) await jobs.wait(submission.id);
    maxRunningHeavy = Math.max(maxRunningHeavy, jobs.activeCount());
    const actor = { organizationId: ORG, userId: 'load-director', authorities: ['archive.jobs.read'] };
    const exportResults = heavySubmissions.map(submission => jobs.get(submission.id, actor));

    phase = 'measurements';
    const deliveryMs: number[] = [];
    const mapMs: number[] = [];
    let fullDeliveries = 0;
    let refreshDeliveries = 0;
    for (const workplace of workplaces) {
      for (const event of workplace.received) {
        if (event.type === 'projection.refresh') {
          refreshDeliveries += 1;
          continue;
        }
        if (!event.payload) {
          workplace.errors.push(`${workplace.instanceId}: доменное событие ${event.type} без payload`);
          continue;
        }
        fullDeliveries += 1;
        const commandId = String(event.payload.commandId ?? '');
        if (workplace.side === 'red') commandErrors.push(`red получил скрытое событие ${commandId}`);
        const startedAt = sentAt.get(commandId);
        if (startedAt === undefined) continue;
        const latency = event.receivedAt - startedAt;
        if (sentTypes.get(commandId) === 'observation.record') mapMs.push(latency);
        else deliveryMs.push(latency);
      }
    }
    const histories = await Promise.all(Array.from({ length: INSTANCE_COUNT }, (_, index) => store.listEvents(ORG, `load-${index}`, 'main')));
    const history = histories.flat();
    let orderingErrors = 0;
    for (const instanceHistory of histories) {
      instanceHistory.forEach((event, index) => { if (event.sequence !== index + 1) orderingErrors += 1; });
    }
    const duplicateEffects = history.length - INSTANCE_COUNT * SEED_PER_INSTANCE - confirmed.size;
    const heavyResultDetails = exportResults.map(job => job.result as { kind?: string; completedAtMs?: number; events?: number } | undefined);
    const heavyDuringBurst = heavyResultDetails.filter(result => (result?.completedAtMs ?? 0) >= burstWallStartedAt && (result?.completedAtMs ?? 0) <= burstWallEndedAt).length;
    const completedHeavyKinds = new Set(heavyResultDetails.map(result => result?.kind).filter(Boolean));
    const commandCoverage = Object.fromEntries(['decision.create', 'observation.record', 'document.transition', 'communication.enqueue', 'calculation.create']
      .map(type => [type, [...sentTypes.values()].filter(actual => actual === type).length]));
    const report = {
      connections: workplaces.length,
      activeParticipants: ACTIVE,
      deliveryP95Ms: percentile(deliveryMs, 0.95),
      mapP95Ms: percentile(mapMs, 0.95),
      confirmedLost: expectedUnique - confirmed.size,
      duplicateEffects,
      orderingErrors,
      deliveryMissing: expectedDeliveries - fullDeliveries - refreshDeliveries,
      sustained: { targetRate: 5, achievedRate: BASE_BATCHES * 5 / (baseMs / 1000), durationSeconds: baseMs / 1000, commands: BASE_BATCHES * 5 },
      burst: { targetRate: 20, achievedRate: BURST_BATCHES * ACTIVE / (burstMs / 1000), durationSeconds: burstMs / 1000, commands: BURST_BATCHES * ACTIVE },
      dataset: { instances: INSTANCE_COUNT, forces: storedForces.length, observationFixtures: seededEvents / 5, events: seededEvents },
      heavyJobs: { attempted: exportResults.length, completed: exportResults.filter(job => job.status === 'succeeded').length, maxRunning: maxRunningHeavy, duringBurst: heavyDuringBurst, kinds: [...completedHeavyKinds] },
    };
    const issues = evaluateLoadThresholds(report);
    if (commandErrors.length) issues.push('COMMAND_ERRORS');
    if (workplaces.some(workplace => workplace.errors.length)) issues.push('SSE_CLIENT_ERRORS');
    if (exportResults.some(job => job.status !== 'succeeded')) issues.push('EXPORT_FAILED');
    if (workplaces.reduce((sum, workplace) => sum + workplace.received.length, 0) !== expectedDeliveries) issues.push('DELIVERY_INCOMPLETE');
    if (burstMs < 55_000 || burstMs > 75_000) issues.push('BURST_DURATION_OUTSIDE_PROFILE');
    if (Object.values(commandCoverage).some(count => count === 0)) issues.push('COMMAND_COVERAGE_INCOMPLETE');
    if (completedHeavyKinds.size !== heavyKinds.length) issues.push('HEAVY_JOB_COVERAGE_INCOMPLETE');
    if (heavyDuringBurst === 0) issues.push('HEAVY_JOBS_NOT_DURING_BURST');
    const metrics = {
      schemaVersion: 1,
      criterion: 'AC-14',
      status: issues.length ? 'failed' : 'passed',
      phase,
      initialDataset: { instances: INSTANCE_COUNT, forces: storedForces.length, events: seededEvents, seedMs },
      load: { expectedUnique, confirmed: confirmed.size, duplicateRequests: Math.ceil(expectedUnique / 20), burstMs },
      ...report,
      fullDeliveries,
      refreshDeliveries,
      deliverySamples: deliveryMs.length,
      mapSamples: mapMs.length,
      distributions: {
        deliveryMs: { p50: percentile(deliveryMs, 0.5), p95: percentile(deliveryMs, 0.95), p99: percentile(deliveryMs, 0.99), raw: deliveryMs },
        mapMs: { p50: percentile(mapMs, 0.5), p95: percentile(mapMs, 0.95), p99: percentile(mapMs, 0.99), raw: mapMs },
      },
      exports: exportResults,
      commandCoverage,
      commandErrors,
      clientErrors: workplaces.filter(workplace => workplace.errors.length).map(workplace => ({ id: workplace.id, errors: workplace.errors })),
      issues,
    };
    const environment = {
      capturedAt: new Date().toISOString(),
      host: { platform: process.platform, architecture: process.arch, cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, memoryBytes: totalmem() },
      database: { version: postgresVersion, poolMaximum: 50 },
      network: 'loopback TCP; внешняя сеть не используется',
      topology: '50 независимых SSE-клиентов и 25 активных HTTP-участников; официальный API КШВИ',
    };
    await mkdir('docs/release/kshvi/acceptance', { recursive: true });
    await writeFile('docs/release/kshvi/acceptance/AC-14.metrics.json', JSON.stringify(metrics, null, 2));
    await writeFile('docs/release/kshvi/acceptance/AC-14.environment.json', JSON.stringify(environment, null, 2));

    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (runId) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const evidenceDirectory = 'docs/release/kshvi/evidence/ac14';
      await mkdir(evidenceDirectory, { recursive: true });
      const initialScenario = {
        organizationId: ORG, instances: INSTANCE_COUNT, eventsPerInstance: SEED_PER_INSTANCE, model: 'official-command-api', seed: 11,
        forceSource: source, forces: storedForces.map(force => ({ id: force.id, parentNodeId: force.parentNodeId })),
      };
      const initialRevision = { id: `ac14-${schema}`, revision: 1, sha256: hashCanonical(initialScenario) };
      const initialPath = `${evidenceDirectory}/initial-scenario.json`;
      const journalPath = `${evidenceDirectory}/journal.json`;
      const protocolPath = `${evidenceDirectory}/protocol.txt`;
      const metricsPath = `${evidenceDirectory}/metrics.json`;
      const environmentPath = `${evidenceDirectory}/environment.json`;
      const limitations = ['Физическая LAN 1 Гбит/с и локальный NTP не проверены; измерения относятся к loopback-стенду.'];
      await writeFile(initialPath, JSON.stringify({ initialRevision, scenario: initialScenario }, null, 2));
      await writeFile(journalPath, JSON.stringify({ runId, commit, events: history }, null, 2));
      await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
      await writeFile(environmentPath, JSON.stringify(environment, null, 2));
      await writeFile(protocolPath, [
        'AC-14: официальный нагрузочный контур завершён.',
        `runId: ${runId}`, `commit: ${commit}`,
        `События: ${seededEvents} seed + ${confirmed.size} live; SSE-кадры: ${fullDeliveries + refreshDeliveries}.`,
        `Метрики: ${JSON.stringify({ ...report, burstMs })}`,
        `Ограничения: ${limitations.join(' ')}`,
      ].join('\n'));
      const proof = {
        runId, commit,
        initialRevision,
        journal: { path: journalPath, sha256: hashCanonical(history), eventCount: history.length },
        hashes: { scenario: initialRevision.sha256, environment: hashCanonical(environment), journal: hashCanonical(history) },
        protocols: [protocolPath], screenshots: [],
        metrics: {
          deliveryP95Ms: report.deliveryP95Ms, mapP95Ms: report.mapP95Ms, confirmed: confirmed.size,
          connections: workplaces.length, activeParticipants: ACTIVE, duplicateEffects, orderingErrors, burstMs,
          exportJobsSucceeded: exportResults.filter(job => job.status === 'succeeded').length,
        },
        limitations,
        artifacts: [
          initialPath, journalPath, protocolPath, metricsPath, environmentPath,
          ...heavySubmissions.filter(submission => submission.kind === 'EXPORT' || submission.kind === 'ARCHIVE').map(submission => submission.exportPath),
        ],
      };
      await writeFile('docs/release/kshvi/acceptance/AC-14.proof.json', JSON.stringify(proof, null, 2));
    }
    expect(issues, JSON.stringify({ ...report, commandErrors, exportStatuses: exportResults.map(job => job.status) })).toEqual([]);
  } finally {
    for (const reader of readers) await reader.cancel().catch(() => undefined);
    readers.clear();
    if (service) await service.close();
    service = undefined;
    await dropSchema(pool, schema);
    await pool.end();
  }
}, 420_000);
