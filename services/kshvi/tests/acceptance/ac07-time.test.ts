import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createService } from '@def-ops/service-kit';
import { afterEach, expect, it } from 'vitest';
import type { WeatherScenario } from '@def-ops/core';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { CommandService } from '../../src/instances/command-service';
import { publishChainEvent, SubscriptionService } from '../../src/http/subscription-service';
import { CartographyEnvironmentProvider } from '../../src/environment/cartography-provider';
import { EnvironmentSnapshotStore } from '../../src/environment/snapshot-store';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { withKshviDatabase } from '../helpers/database';

const scenario: WeatherScenario = {
  version: 1, seed: 17, start: '2026-01-01T00:00:00.000Z', durationHours: 4,
  temperature: -2, humidity: 75, pressure: 1002, windSpeed: 2, windDirection: 180,
  cloud: 40, precipitation: 1, variability: 0, transitionHours: 1,
  visibility: 7000, snowDepth: 0, soilTemperature: -1, soilMoisture: 0.3,
};
const selection = () => ({
  region: { name: 'Район', bounds: [36, 54, 38, 56] as [number, number, number, number] },
  atlases: [{ id: 'a1', exportRights: 'ALLOWED' as const, elevationPoints: [[37, 55] as [number, number]] }],
  weather: { mode: 'scenario' as const, scenario }, elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 },
});
const services: Array<ReturnType<typeof createService>> = [];
const roots: string[] = [];
afterEach(async () => {
  while (services.length) await services.pop()?.close();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

it('AC-07: пауза, ускорение и скачок сохраняют мир и запрещают обратное время', async () => {
  await withKshviDatabase(async store => {
    const root = await mkdtemp(path.join('.tmp', 'ac07-time-'));
    roots.push(root);
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const key = `${init?.method ?? 'GET'} ${url.pathname}`;
      if (key === 'GET /cartography/atlas') return json([{ id: 'a1', name: 'Атлас', format: 'pbf', kind: 'vector', minzoom: 0, maxzoom: 12, bounds: [36, 54, 38, 56], attribution: '© Источник', layers: [], bytes: 3, sha256: 'a'.repeat(64) }]);
      if (key === 'GET /cartography/atlas/a1/style') return json({ version: 8, sources: { atlas: { type: 'vector', tiles: ['http://cartography.test/cartography/atlas/a1/tiles/{z}/{x}/{y}'] } }, layers: [] });
      if (key === 'GET /cartography/atlas/a1/export') return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (key === 'POST /cartography/atlas/a1/elevations') return json({ source: 'a1', values: [{ lon: 37, lat: 55, elevationM: 180 }] });
      return json({ error: { message: `Нет фикстуры ${key}` } }, 404);
    };
    const provider = new CartographyEnvironmentProvider({ baseUrl: 'http://cartography.test/cartography', store: new EnvironmentSnapshotStore(root), fetch: fetcher });
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    await sessions.createAccount({
      userId: 'director', username: 'director', password: 'secret123', organizationId: 'org-ac07',
      roles: [{ id: 'director-role', role: 'LEADER', sideId: 'blue', authorities: ['instance:command', 'projection:read'], assignedNodeIds: ['node-1'] }],
    });
    const login = await sessions.login('director', 'secret123');
    await sessions.selectRole(login.token, 'director-role');
    const operations = {
      knownInstanceIds: ['ac07', 'node-1'], availableChannelIds: ['radio'],
      channels: [{ id: 'radio', version: 1, fromInstanceId: 'ac07', toInstanceId: 'node-1', nodeIds: ['node-1'], direction: 'SIMPLEX' as const, allowedMessageTypes: ['ORDER'], capacity: 1, bytesPerSecond: 1000, baseDelayMs: 0, priorityPolicy: { allowQueuedPreemption: false }, availability: 'AVAILABLE' as const, encrypted: true, reserveChannelIds: [], validFrom: '2020-01-01T00:00:00Z', validUntil: '2031-01-01T00:00:00Z' }],
      nodes: [{ id: 'node-1', status: 'AVAILABLE' as const }],
    } as const;
    const subscriptions = new SubscriptionService();
    const commands = new CommandService({ store, organizationId: 'org-ac07', operations, eventSink: event => publishChainEvent(subscriptions, event) });
    const service = createService({ name: 'kshvi-ac07', port: 0, router: buildRouter({ sessions, commands, subscriptions, environmentProvider: provider }) });
    services.push(service);
    const port = await service.listen();
    const base = `http://127.0.0.1:${port}`;
    const command = async (expectedRevision: number, type: string, payload: Record<string, unknown>, at = '2030-01-01T01:00:00Z', expected = 200) => {
      const response = await fetch(`${base}/kshvi/instances/ac07/commands`, {
        method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: 'main', expectedRevision, idempotencyKey: `${type}-${expectedRevision}`, type, at, payload }),
      });
      const text = await response.text();
      expect(response.status, text).toBe(expected);
      return text;
    };
    const snapshotResponse = await fetch(`${base}/kshvi/environment/snapshots`, { method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(selection()) });
    const snapshot = await snapshotResponse.json() as { id: string };
    const boundResponse = await fetch(`${base}/kshvi/instances/ac07/environment`, {
      method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchId: 'main', expectedRevision: 0, idempotencyKey: 'bind-environment', snapshotId: snapshot.id }),
    });
    expect(boundResponse.status, await boundResponse.text()).toBe(200);
    const episode = {
      state: {}, forces: {}, task: { id: 'task', status: 'IN_PROGRESS', progressPercent: 0 },
      resource: { id: 'fuel', unit: 'L', onHand: 10, consumption: 14, supplied: 2 }, elapsedMinutes: 30,
      position: { remainingMeters: 100, travelledMeters: 0 }, uncertainty: {},
      effects: { taskProgressDelta: 20, positionAdvanceMeters: 50, stateChanges: {}, uncertaintyChanges: {} },
    } as const;
    const calculationInput = {
      reason: 'Движение и ресурс', inputSnapshot: { revision: 1 }, inputs: { episode }, requiredInputs: [], units: {}, modelVersion: 'aggregate-v1', profileVersions: {},
      modelPassport: { purpose: 'Скачок', limitations: ['Учебный стенд'], source: { kind: 'ASSUMPTION', note: 'Учебное допущение', applicability: 'AC-07' }, knownErrors: [], examples: [{ input: 1, expected: 1 }], approvedBy: 'Методист', version: 1 },
      sideId: 'blue', nodeId: 'node-1',
    } as const;
    await command(1, 'calculation.create', { calculationId: 'calc-1', mode: 'DETERMINISTIC', input: calculationInput }, '2030-01-01T01:30:00Z');
    await command(2, 'calculation.approve', { calculationId: 'calc-1' }, '2030-01-01T01:31:00Z');
    await command(3, 'calculation.apply', { calculationId: 'calc-1' }, '2030-01-01T01:32:00Z');
    await command(4, 'communication.enqueue', { message: { id: 'message-1', type: 'ORDER', senderRole: 'DIRECTOR', fromInstanceId: 'ac07', recipientIds: ['node-1'], sizeBytes: 100, priority: 1, domainKey: 'order-1', createdAt: '2030-01-01T01:32:00Z' } }, '2030-01-01T01:32:00Z');
    await command(5, 'weather.change', { changeId: 'weather-1', effectiveAt: '2026-01-01T01:00:00Z', reason: 'Плановая погода', supersedes: (await provider.loadSnapshot(snapshot.id)).manifestSha256, scenario: { ...scenario, temperature: 10 } }, '2026-01-01T01:00:00Z');
    await command(6, 'calculation.override', { calculationId: 'calc-1', manualId: 'manual-1', reason: 'Методическая корректировка', result: { delay: 15 } }, '2030-01-01T01:33:00Z');
    await command(7, 'time.pause', {}, '2030-01-01T01:34:00Z');
    await command(8, 'calculation.create', { calculationId: 'calc-paused', mode: 'DETERMINISTIC', input: calculationInput }, '2030-01-01T01:35:00Z', 500);
    await command(8, 'time.rate', { rate: 4 }, '2030-01-01T01:36:00Z');
    await command(9, 'time.jump', { jumpId: 'jump-1', targetOperationalAt: '2026-01-01T02:00:00Z', currentOperationalAt: '2026-01-01T01:00:00Z', elapsedMinutes: 60 }, '2030-01-01T01:40:00Z');
    await command(10, 'time.jump', { jumpId: 'jump-back', targetOperationalAt: '2026-01-01T00:00:00Z', currentOperationalAt: '2026-01-01T02:00:00Z', elapsedMinutes: -120 }, '2030-01-01T01:41:00Z', 500);
    await command(10, 'communication.admit', { channelId: 'radio' }, '2026-01-01T02:00:00Z');
    await command(11, 'communication.advance', { messageId: 'message-1', action: 'DELIVER' }, '2026-01-01T02:00:00.100Z');

    const state = commands.state('ac07', 'main');
    expect(state.world.resources.fuel).toEqual({ onHand: 0, consumed: 12, supplied: 2, deficit: 2 });
    expect(state.communications['message-1']!.status).toBe('delivered');
    expect(state.calculations['manual-1']!.supersedes).toBe('calc-1');
    expect(state.world.state.Time).toMatchObject({ operationalAt: '2026-01-01T02:00:00Z', playbackRate: 4, status: 'ACTIVE' });
    expect(state.jumpSnapshots['jump-1']!.reports.length).toBeGreaterThan(0);
    const weatherResponse = await fetch(`${base}/kshvi/instances/ac07/weather?lon=37&lat=55&operationalAt=${encodeURIComponent('2026-01-01T02:00:00Z')}`, { headers: { Authorization: `Bearer ${login.token}` } });
    expect((await weatherResponse.json() as { state: { temperature: number } }).state.temperature).toBe(10);

    const history = await store.listEvents('org-ac07', 'ac07', 'main');
    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (runId) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const directory = 'docs/release/kshvi/evidence/ac07';
      await mkdir(directory, { recursive: true });
      const initialScenario = { selection: selection(), calculationInput, message: 'message-1' };
      const initialRevision = { id: 'ac07-time', revision: 1, sha256: hashCanonical(initialScenario) };
      const environment = { snapshotId: snapshot.id, transport: 'HTTP', playbackRate: 4 };
      const metrics = { pausedCommandsRejected: 1, backwardJumpsRejected: 1, playbackRate: 4, jumpSnapshots: 1, manualOverrides: 1 };
      const initialPath = `${directory}/initial-scenario.json`;
      const journalPath = `${directory}/journal.json`;
      const protocolPath = `${directory}/protocol.txt`;
      const metricsPath = `${directory}/metrics.json`;
      const environmentPath = `${directory}/environment.json`;
      const limitations = ['Ускорение проверяется как версионный параметр и скачок; длительный прогон реального времени не входит в этот сценарий.'];
      await writeFile(initialPath, JSON.stringify({ initialRevision, scenario: initialScenario }, null, 2));
      await writeFile(journalPath, JSON.stringify({ runId, commit, events: history }, null, 2));
      await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
      await writeFile(environmentPath, JSON.stringify(environment, null, 2));
      await writeFile(protocolPath, `AC-07 завершён\nrunId: ${runId}\ncommit: ${commit}\nПауза заблокировала мир; скачок сохранил ресурсы, сообщение, ручную корректировку и погоду; обратный перенос отклонён.\n`);
      const proof = {
        runId, commit, initialRevision,
        journal: { path: journalPath, sha256: hashCanonical(history), eventCount: history.length },
        hashes: { scenario: initialRevision.sha256, environment: hashCanonical(environment), journal: hashCanonical(history) },
        protocols: [protocolPath], screenshots: [], metrics, limitations,
        artifacts: [initialPath, journalPath, protocolPath, metricsPath, environmentPath],
      };
      await writeFile('docs/release/kshvi/acceptance/AC-07.proof.json', JSON.stringify(proof, null, 2));
    }
  });
}, 20_000);
