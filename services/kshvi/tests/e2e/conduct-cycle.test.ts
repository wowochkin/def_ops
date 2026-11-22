import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { createService } from '@def-ops/service-kit';
import { createGateway } from '../../../gateway/src/gateway';
import { MemoryRepo } from '../../../cartography/src/repo';
import { AtlasStore } from '../../../cartography/src/atlas';
import { startService } from '../../../cartography/tests/helpers';
import { verifyEventChain } from '../../../../packages/kshvi/src/events/hash-chain';
import { buildLinkedScenarioKit, REQUIRED_SCENARIO_ITEMS } from '@def-ops/kshvi';
import { validateExerciseAxes } from '../../../../packages/kshvi/src/model/profiles';
import { validateCommandTree } from '../../../../packages/kshvi/src/forces/command-tree';
import { orderActions } from '../../../../packages/kshvi/src/runtime/queue';
import { operationalAt } from '../../../../packages/kshvi/src/runtime/clock';
import { proposeInput, applyDelegation } from '../../../../packages/kshvi/src/runtime/input';
import { evaluateTrigger, validateTriggerGraph } from '../../../../packages/kshvi/src/runtime/triggers';
import { applyWeatherEffects } from '../../../../packages/kshvi/src/environment/weather-effects';
import { projectWorld } from '../../../../packages/kshvi/src/projections/project';
import { advanceApproval, resolveDualConflict, type DualChainState } from '../../../../packages/kshvi/src/documents/dual-chain';
import { issueCascade, advanceCascadeDelivery, recordCascadeFact } from '../../../../packages/kshvi/src/documents/cascade';
import { exportDocumentSet, verifyExportSet } from '../../../../packages/kshvi/src/documents/export-set';
import type { DocumentRevision } from '../../../../packages/kshvi/src/documents/document';
import { routeMessage, type Channel, type CommunicationMessage } from '../../../../packages/kshvi/src/communications/channel';
import { applyInfrastructureFailure } from '../../../../packages/kshvi/src/communications/failure-model';
import { advanceMessage, createMessageAttempt, deliverAttempt } from '../../../../packages/kshvi/src/communications/message';
import { recordPaperExchange } from '../../../../packages/kshvi/src/communications/paper-exchange';
import { projectObservationChannels } from '../../../../packages/kshvi/src/simulation/observation-projection';
import { SubscriptionService } from '../../src/http/subscription-service';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { PgExerciseStore, type ExerciseCard } from '../../src/store/exercise-store';
import { CommandService, type InstanceCommand } from '../../src/instances/command-service';
import { CartographyEnvironmentProvider } from '../../src/environment/cartography-provider';
import { EnvironmentSnapshotStore, assertSnapshotComplete } from '../../src/environment/snapshot-store';
import { buildRouter } from '../../src/app';
import { withKshviDatabase } from '../helpers/database';
import { serverExerciseEvidence } from '../helpers/full-seal';
import type { KshviEventStore } from '../../src/store/event-store';
import type { ConductCommand } from '../../../../packages/kshvi/src/commands/conduct';
import type { CalculateOptions } from '../../../../packages/kshvi/src/simulation/calculation';

const ORG = 'org-g2';
const ACTOR = { userId: 'leader-g2', role: 'LEADER', organizationId: ORG, sideId: 'blue', assignedNodeIds: ['node-blue-1', 'node-red-1'] };
const MAIN = 'main';
const passport = {
  purpose: 'Официальный расчёт G2', limitations: ['Только учебный эпизод'], source: { kind: 'ASSUMPTION' as const, note: 'Учебное допущение G2', applicability: 'Сквозной контур' },
  knownErrors: [], examples: [{ input: 1, expected: 1 }], approvedBy: 'Методист G2', version: 1,
};
const episode = {
  state: { posture: 'DEFENCE' }, forces: { blue: { components: [{ id: 'main', q: 10, r: 0.8, a: 1 }] }, red: { components: [{ id: 'main', q: 3, r: 0.5, a: 1 }] } },
  task: { id: 'task-blue-1', status: 'IN_PROGRESS', progressPercent: 20 }, resource: { id: 'fuel', unit: 'L', onHand: 10, consumption: 14, supplied: 2 },
  elapsedMinutes: 30, position: { remainingMeters: 5000, travelledMeters: 0 }, uncertainty: { enemyComposition: 'UNKNOWN' },
  effects: { taskProgressDelta: 50, positionAdvanceMeters: 2500, stateChanges: { posture: 'MOVING' }, uncertaintyChanges: {} },
} as const;
const calculationInput: Omit<CalculateOptions, 'id' | 'mode' | 'createdAt'> = {
  reason: 'Исполнение order-blue-1', inputSnapshot: { worldRevision: 7 }, inputs: { episode, weatherFactor: 0.8 }, requiredInputs: ['weatherFactor'], units: { fuel: 'L' },
  modelVersion: 'aggregate-v1', profileVersions: { episode: 'g2-v1' }, modelPassport: passport, sideId: 'blue', nodeId: 'node-blue-1',
};
const scenarioPayload = {
  sides: ['blue', 'red'], trainedLevels: 3, stages: ['stage-1', 'stage-2'], forces: ['blue-1', 'red-1'], resources: ['fuel'],
  intermediaries: ['edge-1', 'edge-2'], documents: ['order', 'report'], buildupPlan: 'plan-g2', reviewCriteria: ['criteria-1'], mapZoom: 8,
  kit: buildLinkedScenarioKit({
    documents: REQUIRED_SCENARIO_ITEMS.map((item, index) => ({ id: `doc-${index + 1}`, item, revision: 1, content: { item } })),
    usesLogistics: true,
  }),
};
const scenarioWeather = {
  version: 1 as const, seed: 17, start: '2026-01-01T00:00:00.000Z', durationHours: 2, temperature: -2, humidity: 75, pressure: 1002,
  windSpeed: 2, windDirection: 180, cloud: 40, precipitation: 1, variability: 0, transitionHours: 1, visibility: 7000, snowDepth: 0, soilTemperature: -1, soilMoisture: 0.3,
};

function decisionInput(sideId: 'blue' | 'red', id = `decision-${sideId}-1`) {
  return {
    id, sideId, authorId: `commander-${sideId}`, createdAt: '2030-01-01T01:00:00Z', intent: `Скрытый замысел ${sideId}`,
    goals: [{ id: `goal-${sideId}`, rank: 1, title: 'Учебная цель' }], tasks: [{ id: `task-${sideId}-1`, assigneeId: `node-${sideId}-1`, title: 'Задача' }],
    resources: [{ resourceId: 'fuel', amount: 20, unit: 'L' }], deadlines: [{ taskId: `task-${sideId}-1`, operationalAt: '2030-01-01T03:00:00Z' }],
    coordination: [], reserves: [], transitionConditions: [], assumptions: [],
  } as const;
}
function orderInput(id: string, sideId: 'blue' | 'red', issuedAt: string) {
  return {
    id, decisionId: `decision-${sideId}-1`, issuerNodeId: `node-${sideId}-command`, executorNodeId: `node-${sideId}-1`, sideId,
    issuedAt, taskId: `task-${sideId}-1`, plannedResources: { fuel: 5 },
  } as const;
}
function channel(id: string, reserveChannelIds: readonly string[] = []): Channel {
  return {
    id, version: 1, fromInstanceId: 'hq', toInstanceId: 'node-blue-1', nodeIds: [id], direction: 'DUPLEX', allowedMessageTypes: ['ORDER'],
    capacity: 1, bytesPerSecond: 1000, baseDelayMs: 100, priorityPolicy: { allowQueuedPreemption: true }, availability: 'AVAILABLE', encrypted: true,
    reserveChannelIds, validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z',
  };
}
function documentRevision(environment: { id: string; manifestSha256: string }): DocumentRevision {
  const sha256 = 'a'.repeat(64);
  return {
    id: 'order-document:r1', documentId: 'order-document', revision: 1, state: 'ISSUED',
    requisites: {
      exerciseId: 'exercise-g2', scenarioRevisionId: 'scenario-r4', instanceId: 'hq', authorId: 'leader-g2', category: 'OPERATIONAL', type: 'ORDER',
      title: 'Приказ G2', number: '1', operationalAt: '2030-01-01T01:20:00Z', place: 'ПУ', validFrom: '2030-01-01T01:20:00Z', validUntil: '2030-01-02T01:20:00Z',
      stageId: 'stage-1', sideId: 'blue', visibility: { sideIds: ['blue'], instanceIds: [], roles: [] }, addressees: [{ instanceId: 'node-blue-1', channelId: 'main' }],
      copies: [], sourceRole: 'COMMANDER', deliveryChannelId: 'main', basis: 'Решение blue', executorId: 'node-blue-1', deadlineAt: '2030-01-01T03:00:00Z',
      linkedEventIds: [], linkedDecisionIds: ['decision-blue-1'], linkedTaskIds: ['task-blue-1'], templateVersion: 'order:v1',
    },
    content: { body: 'Выполнить задачу с отчётом о фактических затратах', units: { distance: 'm', duration: 'min' } },
    map: { environmentSnapshotId: environment.id, legend: ['unit-blue:v1'], attribution: ['Учебный атлас G2'], visibility: { sideIds: ['blue'], instanceIds: [], roles: [] } },
    attachments: [], approvalRouteId: 'dual-g2', sha256, supersedes: null, supersedesRevision: null, supersedeReason: null,
    signatures: [{ userId: 'leader-g2', role: 'COMMANDER', signedAt: '2030-01-01T01:20:00Z', revision: 1, sha256 }], delivery: { state: 'ISSUED', facts: [] },
  };
}

async function runOfficialG2(store: KshviEventStore) {
  const runId = process.env.KSHVI_G2_RUN_ID ?? randomUUID();
  const startedAt = new Date().toISOString();
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tempRoot = resolve('.tmp', `g2-${runId}`);
  await mkdir(tempRoot, { recursive: true });
  const cartography = await startService(new MemoryRepo(), {}, join(tempRoot, 'cartography'));
  let gateway: ReturnType<typeof createGateway> | undefined;
  let kshviService: ReturnType<typeof createService> | undefined;
  try {
    const atlasPath = join(tempRoot, 'source.mbtiles');
    const database = new DatabaseSync(atlasPath);
    database.exec('create table metadata(name text,value text); create table tiles(zoom_level integer, tile_column integer, tile_row integer, tile_data blob)');
    const insert = database.prepare('insert into metadata values (?,?)');
    for (const [key, value] of Object.entries({ name: 'G2', format: 'pbf', minzoom: '1', maxzoom: '1', bounds: '36,54,38,56', attribution: 'Учебный атлас G2', json: JSON.stringify({ vector_layers: [{ id: 'transportation' }] }) })) insert.run(key, value);
    database.prepare('insert into tiles values(1,1,0,?)').run(Buffer.from([1, 2, 3]));
    database.close();
    const atlas = await new AtlasStore(join(cartography.tilesDir, '.atlas')).importFile('default', atlasPath);
    const environmentProvider = new CartographyEnvironmentProvider({ baseUrl: `${cartography.base}/cartography`, store: new EnvironmentSnapshotStore(join(tempRoot, 'environment')) });
    const environment = await environmentProvider.snapshot({
      region: { name: 'G2', bounds: [36, 54, 38, 56] }, atlases: [{ id: atlas.id, exportRights: 'ALLOWED', elevationPoints: [] }], weather: { mode: 'scenario', scenario: scenarioWeather },
      elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 },
    });
    assertSnapshotComplete(environment);
    const weather = await environmentProvider.weatherAtOperational(environment, { lon: 37, lat: 55, operationalAt: '2026-01-01T01:00:00Z', playbackRate: 1 });
    expect(weather.quality.algorithm).toBe('simulateWeather');

    const exercises = new PgExerciseStore({ pool: store.pool, schema: store.schema, evidence: serverExerciseEvidence() });
    await exercises.init();
    const sessions = new SessionManager({ store: new InMemorySessionStore(), now: () => new Date('2030-01-01T00:00:00Z') });
    await sessions.createAccount({
      userId: ACTOR.userId, username: ACTOR.userId, password: 'g2-password', organizationId: ORG,
      roles: [
        { id: 'role-leader', role: 'LEADER', sideId: 'blue', authorities: ['exercise:create', 'exercise:read', 'exercise:revise', 'exercise:conduct'] },
        { id: 'role-author', role: 'AUTHOR', sideId: 'blue', authorities: ['exercise:revise'] },
        { id: 'role-approver', role: 'APPROVER', sideId: 'blue', authorities: ['exercise:revise'] },
        { id: 'role-director', role: 'DIRECTOR', sideId: 'blue', authorities: ['scenario.seal'] },
      ],
    });
    const commands = new CommandService({ store, organizationId: ORG });
    kshviService = createService({ name: 'kshvi-g2', port: 0, router: buildRouter({ sessions, exerciseStore: exercises, commands, environmentProvider }) });
    const kshviPort = await kshviService.listen();
    gateway = createGateway({
      port: 0, services: { kshvi: `http://127.0.0.1:${kshviPort}` }, routes: [['/api/kshvi', 'kshvi', '/kshvi']], auth: 'open', apiKeys: new Map(), corsOrigin: '*',
    });
    await new Promise<void>(resolveListen => gateway!.listen(0, '127.0.0.1', resolveListen));
    const gatewayAddress = gateway.address();
    if (!gatewayAddress || typeof gatewayAddress === 'string') throw new Error('Шлюз G2 не получил порт');
    const base = `http://127.0.0.1:${gatewayAddress.port}`;
    const loginResponse = await fetch(`${base}/api/kshvi/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: ACTOR.userId, password: 'g2-password' }) });
    expect(loginResponse.status).toBe(200);
    const login = await loginResponse.json() as { csrfToken: string };
    const cookie = loginResponse.headers.get('set-cookie')!.split(';')[0];
    const headers = { 'content-type': 'application/json', cookie, 'x-csrf-token': login.csrfToken };
    async function request<T>(method: string, path: string, body?: unknown, expected = 200): Promise<T> {
      const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body, (_key, value) => typeof value === 'bigint' ? `${value}n` : value) });
      expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(expected);
      return response.json() as Promise<T>;
    }
    const post = <T>(path: string, body: unknown, expected = 200) => request<T>('POST', path, body, expected);
    await post('/api/kshvi/auth/role', { roleId: 'role-leader' });

    let card = await post<ExerciseCard>('/api/kshvi/exercises', { title: 'G2', purpose: 'planned', scale: 'operational', payload: scenarioPayload }, 201);
    const sealBody = { expectedRevision: 1 };
    await post('/api/kshvi/auth/role', { roleId: 'role-author' });
    await post(`/api/kshvi/exercises/${card.id}/transitions`, { expectedRevision: 1, command: 'SUBMIT' });
    await post('/api/kshvi/auth/role', { roleId: 'role-approver' });
    await post(`/api/kshvi/exercises/${card.id}/transitions`, { expectedRevision: 1, command: 'APPROVE' });
    await post('/api/kshvi/auth/role', { roleId: 'role-director' });
    card = await post(`/api/kshvi/exercises/${card.id}/seal`, sealBody);
    await post('/api/kshvi/auth/role', { roleId: 'role-leader' });
    expect(card.state).toBe('SEALED');
    const firstSession = await post<{ id: string; scenarioRevisionId: string; revision: number }>(`/api/kshvi/exercises/${card.id}/sessions`, { revision: 1, optimisticWorld: { forged: true } }, 201);
    const secondSession = await post<{ id: string; scenarioRevisionId: string; revision: number }>(`/api/kshvi/exercises/${card.id}/sessions`, { revision: 1 }, 201);
    expect(firstSession.id).not.toBe(secondSession.id);
    expect(firstSession.scenarioRevisionId).toBe(secondSession.scenarioRevisionId);
    expect(validateExerciseAxes({ scale: 'operational', mapZoom: 8, trainedLevels: 3 })).toEqual([]);
    expect(validateCommandTree({
      nodes: [{ id: 'level-1', parentId: null, trained: true }, { id: 'level-2', parentId: 'level-1', trained: true }, { id: 'level-3', parentId: 'level-2', trained: true }],
      edges: [
        {
          from: 'level-1', to: 'level-2', active: true, playRole: { kind: 'GROUP', assignmentId: 'intermediary-1' },
          kind: 'OPERATIONAL_COMMAND', validFrom: '2025-01-01T00:00:00Z', validTo: null,
          authorities: ['ISSUE_ORDER'], allowedDocumentTypes: ['ORDER'], channelId: 'radio',
        },
        {
          from: 'level-2', to: 'level-3', active: true, playRole: { kind: 'GROUP', assignmentId: 'intermediary-2' },
          kind: 'OPERATIONAL_COMMAND', validFrom: '2025-01-01T00:00:00Z', validTo: null,
          authorities: ['RELAY_ORDER'], allowedDocumentTypes: ['ORDER'], channelId: 'radio',
        },
      ],
    })).toEqual([]);
    const revisions = new Map<string, number>();
    async function official(sessionId: string, command: ConductCommand, expectedRevision?: number) {
      const { type, commandId, at, ...payload } = command;
      const revision = expectedRevision ?? revisions.get(sessionId) ?? 0;
      const input: InstanceCommand = { instanceId: sessionId, branchId: MAIN, expectedRevision: revision, idempotencyKey: commandId, type, at, actor: ACTOR, payload };
      const result = await post<{ eventId: string; revision: number; idempotent: boolean }>(`/api/kshvi/instances/${sessionId}/commands`, input);
      revisions.set(sessionId, Math.max(revisions.get(sessionId) ?? 0, result.revision));
      return result;
    }

    await official(firstSession.id, { type: 'decision.create', commandId: 'decision-blue-create', at: '2030-01-01T01:00:00Z', decision: decisionInput('blue') });
    await official(firstSession.id, { type: 'decision.create', commandId: 'decision-red-create', at: '2030-01-01T01:00:00Z', decision: decisionInput('red') });
    await official(secondSession.id, { type: 'decision.create', commandId: 'decision-second-create', at: '2030-01-01T01:00:00Z', decision: decisionInput('blue', 'decision-second-blue') });
    await official(firstSession.id, { type: 'decision.transition', commandId: 'decision-blue-accept', at: '2030-01-01T01:10:00Z', decisionId: 'decision-blue-1', to: 'ACCEPTED' });
    await official(firstSession.id, { type: 'decision.transition', commandId: 'decision-red-accept', at: '2030-01-01T01:10:00Z', decisionId: 'decision-red-1', to: 'ACCEPTED' });
    expect(orderActions([{ id: 'red', operationalAt: '2030-01-01T01:10:00Z', priority: 1, dependencyOrder: 0, sequence: 2 }, { id: 'blue', operationalAt: '2030-01-01T01:10:00Z', priority: 1, dependencyOrder: 0, sequence: 1 }]).map(item => item.id)).toEqual(['blue', 'red']);
    await official(firstSession.id, { type: 'decision.revise', commandId: 'decision-blue-revise', at: '2030-01-01T01:12:00Z', decisionId: 'decision-blue-1', revisedId: 'decision-blue-2', changes: { intent: 'Уточнённый замысел blue' } });

    await official(firstSession.id, { type: 'order.issue', commandId: 'order-blue-issue', at: '2030-01-01T01:20:00Z', order: orderInput('order-blue-1', 'blue', '2030-01-01T01:20:00Z') });
    const deliveryRevision = (await official(firstSession.id, { type: 'order.advance', commandId: 'order-blue-deliver', at: '2030-01-01T01:25:00Z', orderId: 'order-blue-1', action: { type: 'DELIVER', at: '2030-01-01T01:25:00Z' } })).revision;
    await official(firstSession.id, { type: 'order.advance', commandId: 'order-blue-process', at: '2030-01-01T01:26:00Z', orderId: 'order-blue-1', action: { type: 'PROCESS', at: '2030-01-01T01:26:00Z' } });
    await official(firstSession.id, { type: 'order.advance', commandId: 'order-blue-prepare', at: '2030-01-01T01:27:00Z', orderId: 'order-blue-1', action: { type: 'PREPARE', at: '2030-01-01T01:27:00Z' } });
    await official(firstSession.id, { type: 'order.advance', commandId: 'order-blue-start', at: '2030-01-01T01:30:00Z', orderId: 'order-blue-1', action: { type: 'START_EXECUTION', at: '2030-01-01T01:30:00Z', position: { remainingMeters: 5000, travelledMeters: 0 } } });
    await official(firstSession.id, { type: 'order.advance', commandId: 'order-blue-cost', at: '2030-01-01T01:40:00Z', orderId: 'order-blue-1', action: { type: 'RECORD_COST', at: '2030-01-01T01:40:00Z', timeMinutes: 10, resources: { fuel: 2 }, position: { remainingMeters: 4000, travelledMeters: 1000 } } });
    await official(firstSession.id, { type: 'order.issue', commandId: 'order-cancel-before-issue', at: '2030-01-01T01:20:00Z', order: orderInput('order-blue-cancel-before', 'blue', '2030-01-01T01:20:00Z') });
    await official(firstSession.id, { type: 'order.cancel', commandId: 'order-cancel-before', at: '2030-01-01T01:21:00Z', orderId: 'order-blue-cancel-before', reason: 'Отмена до получения' });
    await official(firstSession.id, { type: 'order.issue', commandId: 'order-cancel-after-issue', at: '2030-01-01T01:20:00Z', order: orderInput('order-blue-cancel-after', 'blue', '2030-01-01T01:20:00Z') });
    await official(firstSession.id, { type: 'order.advance', commandId: 'order-cancel-after-deliver', at: '2030-01-01T01:25:00Z', orderId: 'order-blue-cancel-after', action: { type: 'DELIVER', at: '2030-01-01T01:25:00Z' } });
    await official(firstSession.id, { type: 'order.advance', commandId: 'order-cancel-after-process', at: '2030-01-01T01:26:00Z', orderId: 'order-blue-cancel-after', action: { type: 'PROCESS', at: '2030-01-01T01:26:00Z' } });
    await official(firstSession.id, { type: 'order.advance', commandId: 'order-cancel-after-prepare', at: '2030-01-01T01:27:00Z', orderId: 'order-blue-cancel-after', action: { type: 'PREPARE', at: '2030-01-01T01:27:00Z' } });
    await official(firstSession.id, { type: 'order.advance', commandId: 'order-cancel-after-start', at: '2030-01-01T01:30:00Z', orderId: 'order-blue-cancel-after', action: { type: 'START_EXECUTION', at: '2030-01-01T01:30:00Z', position: { remainingMeters: 5000, travelledMeters: 0 } } });
    await official(firstSession.id, { type: 'order.advance', commandId: 'order-cancel-after-cost', at: '2030-01-01T01:40:00Z', orderId: 'order-blue-cancel-after', action: { type: 'RECORD_COST', at: '2030-01-01T01:40:00Z', timeMinutes: 10, resources: { fuel: 2 }, position: { remainingMeters: 4000, travelledMeters: 1000 } } });
    await official(firstSession.id, { type: 'order.cancel', commandId: 'order-cancel-after', at: '2030-01-01T01:41:00Z', orderId: 'order-blue-cancel-after', reason: 'Отмена после начала' });

    await official(firstSession.id, { type: 'calculation.create', commandId: 'calc-blue-create', at: '2030-01-01T01:30:00Z', calculationId: 'calc-blue-1', mode: 'DETERMINISTIC', input: calculationInput });
    await official(firstSession.id, { type: 'calculation.approve', commandId: 'calc-blue-approve', at: '2030-01-01T01:31:00Z', calculationId: 'calc-blue-1' });
    await official(firstSession.id, { type: 'calculation.apply', commandId: 'calc-blue-apply', at: '2030-01-01T01:32:00Z', calculationId: 'calc-blue-1' });
    await official(firstSession.id, { type: 'calculation.override', commandId: 'calc-blue-manual', at: '2030-01-01T01:35:00Z', calculationId: 'calc-blue-1', manualId: 'manual-blue-1', reason: 'Методическая корректировка', result: { delay: 15 } });
    await official(firstSession.id, { type: 'calculation.create', commandId: 'calc-stochastic-create', at: '2030-01-01T01:33:00Z', calculationId: 'calc-stochastic-1', mode: 'STOCHASTIC', input: {
      ...calculationInput,
      stochastic: { key: { seed: 42n, exerciseId: 'g2', branchId: MAIN, purpose: 'g2-replay', ordinal: 0, algorithmVersion: 1 }, outcomes: [{ id: 'planned', weight: 1, effects: episode.effects }, { id: 'delayed', weight: 1, effects: { ...episode.effects, positionAdvanceMeters: 100 } }] },
    } });
    await official(firstSession.id, { type: 'calculation.replay', commandId: 'calc-stochastic-replay', at: '2030-01-01T01:34:00Z', calculationId: 'calc-stochastic-1' });
    await official(firstSession.id, { type: 'calculation.create', commandId: 'calc-weather-unknown', at: '2030-01-01T01:36:00Z', calculationId: 'calc-weather-unknown', mode: 'DETERMINISTIC', input: { ...calculationInput, inputs: { episode, weatherFactor: null } } });
    await official(firstSession.id, { type: 'order.advance', commandId: 'order-blue-report', at: '2030-01-01T02:00:00Z', orderId: 'order-blue-1', action: { type: 'REPORT', at: '2030-01-01T02:00:00Z', outcome: 'PARTIALLY_COMPLETED', reason: 'Дефицит fuel: 2 Л', position: { remainingMeters: 2500, travelledMeters: 2500 } } });
    const duplicate = await official(firstSession.id, { type: 'order.advance', commandId: 'order-blue-deliver', at: '2030-01-01T01:25:00Z', orderId: 'order-blue-1', action: { type: 'DELIVER', at: '2030-01-01T01:25:00Z' } }, deliveryRevision - 1);
    expect(duplicate.idempotent).toBe(true);

    await official(firstSession.id, { type: 'observation.record', commandId: 'observation-g2', at: '2030-01-01T01:00:00Z', input: {
      id: 'observation-g2', trueForceId: 'secret-red-force', trueGeometry: { lon: 37.6, lat: 55.7 }, trueAttributes: { type: 'motorized', secret: 'reference' }, observedAt: '2030-01-01T01:00:00Z',
      source: { id: 'sensor-g2', kind: 'UAV', sideId: 'blue', profileVersion: 'sensor-v1', errorMeters: { min: 20, max: 100 }, delaySeconds: { min: 10, max: 60 }, completeness: 0.8, reliability: 0.8, validitySeconds: 600, attributeKeys: ['type'] },
      environment: { snapshotId: environment.id, errorMultiplier: 1, delayMultiplier: 1 }, randomKey: { seed: 5n, exerciseId: 'g2', branchId: MAIN, purpose: 'observation', ordinal: 0, algorithmVersion: 1 },
    } });
    const safeObservation = commands.state(firstSession.id, MAIN).observations['observation-g2'];
    const participantProjection = projectWorld({
      forces: [{ id: 'blue-force', side: 'blue', position: [1, 1] }, { id: 'secret-red-force', side: 'red', position: [2, 2] }], observations: [safeObservation],
      inputs: [{ id: 'future', availableAt: '2030-01-02T00:00:00Z', recipients: ['blue'] }], reference: { secret: 'reference' },
    }, { side: 'blue', role: 'TRAINEE', operationalAt: '2030-01-01T02:00:00Z', scope: 'own' });
    expect(JSON.stringify(participantProjection)).not.toContain('secret-red-force');
    expect(JSON.stringify(participantProjection)).not.toContain('future');
    expect(JSON.stringify(participantProjection)).not.toContain('reference');
    for (const channelProjection of Object.values(projectObservationChannels({
      id: 'observation-g2', trueForceId: 'secret-red-force', actualErrorMeters: 1, source: { id: 'sensor-g2', kind: 'UAV', sideId: 'blue', profileVersion: 'v1', nested: { trueForceId: 'nested-secret' } } as never,
      observedAt: '2030-01-01T01:00:00Z', deliveredAt: '2030-01-01T01:01:00Z', validUntil: '2030-01-01T01:10:00Z', reportedGeometry: { lon: 37.6, lat: 55.7 }, reportedAttributes: { nested: { actualErrorMeters: 2 } },
      reportedAccuracyMeters: 100, completeness: 0.8, reliability: 0.8, status: 'CURRENT', environmentSnapshotId: environment.id, randomKeys: [],
    }))) {
      expect(JSON.stringify(channelProjection)).not.toContain('secret-red-force');
      expect(JSON.stringify(channelProjection)).not.toContain('actualErrorMeters');
      expect(JSON.stringify(channelProjection)).not.toContain('nested-secret');
    }
    const subscriptions = new SubscriptionService();
    expect(subscriptions.payloadFor({ eventId: 'red-event', sequence: 1, type: 'decision.created.v1', payload: { side: 'red', intent: 'secret' } }, { side: 'blue', role: 'TRAINEE', operationalAt: '2030-01-01T02:00:00Z', scope: 'own' })).toEqual({ type: 'projection.refresh' });
    expect(subscriptions.seen('red-event', 1)).toBe(true);
    expect(subscriptions.seen('red-event', 1)).toBe(false);

    let dual: DualChainState = { command: 'PENDING', service: 'PENDING', finalApprover: 'designatedAuthority' };
    dual = { ...dual, ...advanceApproval(dual, { actor: 'commander', branch: 'command', decision: 'APPROVED' }) };
    expect(dual.state).not.toBe('APPROVED');
    dual = { ...dual, ...advanceApproval(dual, { actor: 'service', branch: 'service', decision: 'CHANGES_REQUESTED', comment: 'Уточнить срок' }) };
    expect(dual.state).toBe('CONFLICT');
    dual = { ...dual, ...resolveDualConflict(dual, { actor: 'designatedAuthority', decision: 'APPROVED', comment: 'Разрешено руководителем' }) };
    expect(dual.state).toBe('APPROVED');
    const revision = documentRevision(environment);
    const cascade = issueCascade({ revision, originInstanceId: 'hq', issuedAt: '2030-01-01T01:20:00+03:00', availableChannelIds: ['main', 'reserve'], treeEdges: [{ from: 'hq', to: 'node-blue-1' }, { from: 'hq', to: 'node-red-1' }], legs: [
      { id: 'leg-blue', from: 'hq', to: 'node-blue-1', channelId: 'main', delayMinutes: 1, relayId: 'relay-blue', processingDeadlineAt: '2030-01-01T03:00:00Z' },
      { id: 'leg-red', from: 'hq', to: 'node-red-1', channelId: 'reserve', delayMinutes: 2, relayId: 'relay-red', processingDeadlineAt: '2030-01-01T03:00:00Z' },
    ] });
    let blueLeg = advanceCascadeDelivery(cascade.deliveries[0], 'BEGIN', { at: '2030-01-01T01:20:30Z' });
    blueLeg = advanceCascadeDelivery(blueLeg, 'DELIVER', { at: '2030-01-01T01:21:00Z' });
    blueLeg = recordCascadeFact(blueLeg, 'ACKNOWLEDGED', { at: '2030-01-01T01:22:00Z', actorId: 'node-blue-1' });
    blueLeg = recordCascadeFact(blueLeg, 'EXECUTION_STARTED', { at: '2030-01-01T01:23:00Z', actorId: 'node-blue-1' });
    expect(cascade.deliveries[1].state).toBe('QUEUED');
    expect(blueLeg.executionStartedAt).not.toBe(blueLeg.acknowledgedAt);
    const exports = await exportDocumentSet(revision, { exerciseTitle: 'G2', exerciseRevision: 4, exportedAt: '2030-01-01T02:00:00Z' });
    expect(await verifyExportSet(exports)).toEqual({ valid: true, issues: [] });

    expect(proposeInput({ kind: 'PLANNED', sourceRole: 'INTERMEDIARY', recipients: ['blue'], scheduledAt: '2030-01-01T02:00:00Z', actualAt: '2030-01-01T01:00:00Z', channelId: 'main' }).deviation).toBe('EARLY');
    expect(evaluateTrigger({ left: 'REPORTED', operator: 'EQ', right: 'REPORTED' })).toBe('TRUE');
    expect(validateTriggerGraph([{ id: 'a', emits: ['b'] }, { id: 'b', emits: ['a'] }])).not.toEqual([]);
    expect(applyDelegation({ allowedSeverities: [1], allowedAreas: ['area-g2'], allowedStages: ['stage-2'], allowEffects: true }, { id: 'adaptive-ok', kind: 'ADAPTIVE', severity: 1, areaId: 'area-g2', stageId: 'stage-2', effects: [] }).status).toBe('APPLIED');
    expect(applyDelegation({ allowedSeverities: [], allowedAreas: [], allowedStages: [], allowEffects: false }, { id: 'adaptive-no', kind: 'ADAPTIVE', severity: 9, areaId: 'outside', stageId: 'stage-9', effects: [] }).status).toBe('APPROVAL_REQUIRED');

    const mainChannel = channel('main', ['reserve']);
    const reserveChannel = channel('reserve');
    const message: CommunicationMessage = { id: 'message-order', type: 'ORDER', senderRole: 'LEADER', fromInstanceId: 'hq', recipientIds: ['node-blue-1'], sizeBytes: 100, priority: 1, domainKey: 'order-blue-1', createdAt: '2030-01-01T01:20:00Z' };
    const primaryRoute = routeMessage({ message, channels: [mainChannel, reserveChannel], nodes: [{ id: 'main', status: 'AVAILABLE' }, { id: 'reserve', status: 'AVAILABLE' }], at: '2030-01-01T01:20:00Z' });
    let attempt = advanceMessage(createMessageAttempt(message, primaryRoute, '2030-01-01T01:20:00Z'), 'START', { at: '2030-01-01T01:20:01Z' });
    attempt = advanceMessage(attempt, 'DELIVER', { at: '2030-01-01T01:20:02Z' });
    const duplicateDelivery = deliverAttempt(attempt);
    expect(duplicateDelivery.domainEffect).toBe('SKIPPED_DUPLICATE');
    const failed = applyInfrastructureFailure({
      nodes: [{ id: 'main', status: 'AVAILABLE' }, { id: 'reserve', status: 'AVAILABLE' }], channels: [mainChannel, reserveChannel],
      factor: { id: 'node-failure-g2', type: 'NODE_FAILURE', basis: 'Учебный отказ', trainingQuestion: 'Резерв связи', workaround: 'Переключиться на reserve', scope: { nodeIds: ['main'], channelIds: ['main'] }, at: '2030-01-01T01:24:00Z', expectedImpact: { documentIds: ['order-document'], deadlineIds: ['report-g2'], branchIds: [MAIN] } },
    });
    const backupRoute = routeMessage({ message, channels: failed.channels, nodes: failed.nodes, at: '2030-01-01T01:24:00Z' });
    expect(backupRoute.selectedReserve).toBe(true);
    expect(recordPaperExchange({
      documentId: 'order-document', revision: 1, sha256: 'a'.repeat(64), domainKey: 'order-blue-1', issued: { at: '2030-01-01T01:20:00Z', actorId: 'leader-g2' }, received: { at: '2030-01-01T01:25:00Z', actorId: 'node-blue-1' },
      execution: { at: '2030-01-01T01:30:00Z', actorId: 'node-blue-1' }, evidence: { kind: 'PAPER_ORIGINAL', reference: 'paper-g2' }, enteredAt: '2030-01-01T01:35:00Z', enteredBy: 'intermediary-g2', appliedDomainKeys: ['order-blue-1'], electronicQueue: [],
    })).toMatchObject({ duplicate: true, domainEffectApplied: false });

    const paused = { anchorOperational: '2030-01-01T00:00:00Z', anchorWall: '2030-01-01T00:00:00Z', speed: 2, paused: true };
    expect(operationalAt(paused, '2030-01-01T00:10:00Z')).toBe('2030-01-01T00:00:00.000Z');
    expect(operationalAt({ ...paused, paused: false }, '2030-01-01T00:10:00Z')).toBe('2030-01-01T00:20:00.000Z');
    await official(firstSession.id, { type: 'time.jump', commandId: `jump-${runId}`, at: '2030-01-01T02:10:00Z', jumpId: `jump-${runId}`, targetOperationalAt: '2030-01-01T03:00:00Z', currentOperationalAt: '2030-01-01T02:00:00Z', elapsedMinutes: 60 });
    await official(firstSession.id, { type: 'stage.assign', commandId: 'stage-g2-assign', at: '2030-01-01T02:20:00Z', currentStageId: 'stage-1', currentProfileId: 'aggregate-v1', nextStageId: 'stage-2', nextProfileId: 'manual-v1' });
    await official(firstSession.id, { type: 'playbook.evaluate', commandId: 'playbook-known', at: '2030-01-01T02:21:00Z', playbook: { id: 'playbook-g2', version: 1, rules: [{ id: 'contact', when: 'contact', command: 'report', mandatory: true }] }, condition: { kind: 'contact' } });
    await official(firstSession.id, { type: 'playbook.evaluate', commandId: 'playbook-unknown', at: '2030-01-01T02:22:00Z', playbook: { id: 'playbook-g2', version: 1, rules: [] }, condition: { kind: 'unknown' } });
    await official(firstSession.id, { type: 'exercise.complete', commandId: 'exercise-g2-complete', at: '2030-01-01T02:30:00Z', leaderApproved: true, stageConditionsMet: true, unfinishedEvents: [{ id: 'delivery-pending', reason: 'Канал не восстановлен' }], reviewMaterials: [{ id: 'review-g2', title: 'Разбор G2' }] });
    expect(applyWeatherEffects({ rainRateMmH: null }, { movementRequires: ['rainRateMmH'], rules: [] })).toMatchObject({ status: 'REQUIRES_REVIEW', unknown: ['rainRateMmH'] });

    const state = commands.state(firstSession.id, MAIN);
    expect(state.orders['order-blue-1'].issuedAt).toBe('2030-01-01T01:20:00Z');
    expect(state.orders['order-blue-1'].history[0].at).toBe('2030-01-01T01:20:00Z');
    expect(state.orders['order-blue-cancel-after'].actualCosts).toEqual({ timeMinutes: 10, resources: { fuel: 2 } });
    expect(state.calculations['calc-blue-1'].state).toBe('SUPERSEDED');
    expect(state.calculations['manual-blue-1'].supersedes).toBe('calc-blue-1');
    expect(state.calculations['calc-weather-unknown'].state).toBe('REQUIRES_REVIEW');
    expect(state.world.resources.fuel).toEqual({ onHand: 0, consumed: 12, supplied: 2, deficit: 2 });
    expect(state.jumpSnapshots[`jump-${runId}`].reports).toEqual(['boundary', 'stop', 'uncertainty', 'resume']);
    expect(state.stage?.calculationProfileId).toBe('manual-v1');

    const firstHistory = await commands.history(firstSession.id, MAIN);
    const secondHistory = await commands.history(secondSession.id, MAIN);
    expect(firstHistory.length).toBeGreaterThan(20);
    expect(secondHistory).toHaveLength(1);
    expect(firstHistory.map(event => event.eventId)).not.toEqual(secondHistory.map(event => event.eventId));
    for (const events of [firstHistory, secondHistory]) expect(verifyEventChain(events)).toEqual([]);
    for (const event of firstHistory) {
      expect(event.payload).toHaveProperty('commandId');
      expect(event.payload).toHaveProperty('commandType');
      expect(event.payload).toHaveProperty('causedBy');
    }
    const resourceIndex = firstHistory.findIndex(event => event.type === 'resource.consumed.v1');
    expect(firstHistory[resourceIndex].payload).toMatchObject({ commandType: 'calculation.apply', causedBy: 'calc-blue-1' });
    expect(state.calculations['calc-blue-1'].appliedEventIds).toEqual([firstHistory[resourceIndex].eventId]);
    expect(firstHistory.filter(event => {
      const payload = event.payload;
      return payload !== null && typeof payload === 'object' && !Array.isArray(payload) && payload.commandId === 'order-blue-deliver';
    })).toHaveLength(1);
    expect(await store.eventCount(ORG, firstSession.id)).toBe(firstHistory.length);
    expect(await store.outboxCount(ORG, firstSession.id)).toBe(firstHistory.length);
    expect(await store.eventCount(ORG, secondSession.id)).toBe(secondHistory.length);

    const events = [
      ...firstHistory.map(event => ({ ...event, sessionId: firstSession.id })),
      ...secondHistory.map(event => ({ ...event, sessionId: secondSession.id })),
    ];
    return {
      schemaVersion: 1 as const, runId, commit, startedAt, completedAt: new Date().toISOString(), scenarioHash: card.revisions.at(-1)!.sha256, environmentHash: environment.manifestSha256,
      sessionIds: [firstSession.id, secondSession.id], events,
      infrastructure: { postgresql: 'passed' as const, cartography: 'passed' as const, gateway: 'passed' as const },
      checks: ['AC-01', 'AC-03', 'AC-04', 'AC-05', 'AC-06', 'AC-07', 'AC-09', 'AC-11', 'AC-15', 'AC-18'],
      coverage: { 'AC-01': 'passed', 'AC-03': 'passed', 'AC-04': 'passed', 'AC-05': 'passed', 'AC-06': 'passed', 'AC-07': 'passed', 'AC-09': 'passed', 'AC-11': 'passed', 'AC-15': 'passed', 'AC-18': 'passed' },
    };
  } finally {
    if (gateway) await new Promise<void>(resolveClose => gateway!.close(() => resolveClose()));
    if (kshviService) await kshviService.close();
    await cartography.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;
integration('G2: полный связанный доменный цикл проходит без прямой записи исходов', { timeout: 120_000 }, async () => {
  await withKshviDatabase(async store => {
    const result = await runOfficialG2(store);
    if (process.env.KSHVI_G2_EVIDENCE === '1') {
      await mkdir(resolve('docs/release/kshvi/evidence'), { recursive: true });
      await writeFile(resolve('docs/release/kshvi/evidence/g2-journal.json'), `${JSON.stringify(result, null, 2)}\n`);
      await writeFile(resolve('docs/release/kshvi/evidence/g2-infrastructure.json'), `${JSON.stringify({ runId: result.runId, commit: result.commit, startedAt: result.startedAt, completedAt: result.completedAt, infrastructure: result.infrastructure, sessionIds: result.sessionIds }, null, 2)}\n`);
    }
    expect(result.infrastructure).toEqual({ postgresql: 'passed', cartography: 'passed', gateway: 'passed' });
    expect(Object.values(result.coverage)).toEqual(Array(10).fill('passed'));
  });
});
