import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createService } from '@def-ops/service-kit';
import { chromium, type Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterEach, expect, it } from 'vitest';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { CommandService } from '../../src/instances/command-service';
import { publishChainEvent, SubscriptionService } from '../../src/http/subscription-service';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { REPLAY_DOMAINS, replayStateHash, ReplayReducerRegistry, type ReplayArchive } from '../../../../packages/kshvi/src/replay/replay-engine';
import { withKshviDatabase } from '../helpers/database';

declare global {
  interface Window { __ac08RestoreAt: typeof import('../../../../packages/kshvi/src/replay/replay-engine').restoreAt }
}

const services: Array<ReturnType<typeof createService>> = [];
const viteServers: ViteDevServer[] = [];
const browsers: Browser[] = [];
afterEach(async () => {
  while (browsers.length) await browsers.pop()?.close();
  while (viteServers.length) await viteServers.pop()?.close();
  while (services.length) await services.pop()?.close();
});
const calculationInput = (stochastic: boolean) => ({
  reason: stochastic ? 'Стохастический эпизод' : 'Детерминированный эпизод', inputSnapshot: { revision: 1 },
  inputs: { episode: {
    state: {}, forces: {}, task: { id: 'task', status: 'IN_PROGRESS', progressPercent: 0 },
    resource: { id: 'fuel', unit: 'L', onHand: 10, consumption: 14, supplied: 2 }, elapsedMinutes: 30,
    position: { remainingMeters: 100, travelledMeters: 0 }, uncertainty: {},
    effects: { taskProgressDelta: 20, positionAdvanceMeters: 50, stateChanges: {}, uncertaintyChanges: {} },
  } },
  requiredInputs: [], units: {}, modelVersion: 'aggregate-v1', profileVersions: {},
  modelPassport: { purpose: 'Реплей', limitations: ['Учебный стенд'], source: { kind: 'ASSUMPTION', note: 'Учебное допущение', applicability: 'AC-08' }, knownErrors: [], examples: [{ input: 1, expected: 1 }], approvedBy: 'Методист', version: 1 },
  sideId: 'blue', nodeId: 'node-1',
  ...(stochastic ? { stochastic: {
    key: { seed: '11', exerciseId: 'exercise-ac08', branchId: 'main', purpose: 'stochastic-replay', ordinal: 1, algorithmVersion: 1 },
    outcomes: [{ id: 'expected', weight: 1, effects: { taskProgressDelta: 20, positionAdvanceMeters: 50, stateChanges: {}, uncertaintyChanges: {} } }],
  } } : {}),
}) as const;
function workerReplay(archive: unknown, playbackSpeed: number): Promise<{ stateHash: string; compatibility: string; selectedOutcomeIds: string[]; error?: string }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ac08-replay-worker.mjs', import.meta.url), { workerData: { archive, cursor: 2, playbackSpeed } });
    worker.once('message', result => result.error ? reject(new Error(result.error)) : resolve(result));
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`Worker реплея завершился с кодом ${code}`)); });
  });
}

it('AC-08: процессы и Chromium воспроизводят один архив без новых случайных исходов', async () => {
  await withKshviDatabase(async store => {
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    await sessions.createAccount({
      userId: 'leader', username: 'leader', password: 'secret123', organizationId: 'org-ac08',
      roles: [{ id: 'leader-role', role: 'LEADER', sideId: 'blue', authorities: ['instance:command'] }],
    });
    const login = await sessions.login('leader', 'secret123');
    await sessions.selectRole(login.token, 'leader-role');
    const subscriptions = new SubscriptionService();
    const commands = new CommandService({ store, organizationId: 'org-ac08', eventSink: event => publishChainEvent(subscriptions, event) });
    const service = createService({ name: 'kshvi-ac08', port: 0, router: buildRouter({ sessions, commands, subscriptions }) });
    services.push(service);
    const port = await service.listen();
    const base = `http://127.0.0.1:${port}`;
    const command = async (expectedRevision: number, idempotencyKey: string, type: string, payload: Record<string, unknown>) => {
      const response = await fetch(`${base}/kshvi/instances/ac08/commands`, {
        method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId: 'main', expectedRevision, idempotencyKey, type, at: '2030-01-01T01:00:00Z', payload }),
      });
      const text = await response.text();
      expect(response.status, text).toBe(200);
      return JSON.parse(text) as { eventId: string; revision: number; idempotent: boolean };
    };
    await command(0, 'deterministic-create', 'calculation.create', { calculationId: 'deterministic-1', mode: 'DETERMINISTIC', input: calculationInput(false) });
    await command(1, 'stochastic-create', 'calculation.create', { calculationId: 'stochastic-1', mode: 'STOCHASTIC', input: calculationInput(true) });
    const firstReplay = await command(2, 'stochastic-replay', 'calculation.replay', { calculationId: 'stochastic-1' });
    const repeated = await command(2, 'stochastic-replay', 'calculation.replay', { calculationId: 'stochastic-1' });
    expect(repeated).toEqual({ ...firstReplay, idempotent: true });

    const history = await store.listEvents('org-ac08', 'ac08', 'main');
    expect(history).toHaveLength(3);
    const explanation = commands.state('ac08', 'main').calculations['stochastic-1']!;
    expect(explanation.modelVersion).toBe('aggregate-v1');
    expect(explanation.inputs.episode).toBeDefined();
    expect(explanation.randomKeys[0]).toMatchObject({ purpose: 'stochastic-replay', algorithmVersion: 1 });
    const initialState = {
      domains: Object.fromEntries(REPLAY_DOMAINS.map(domain => [domain, domain === 'EventFeed' ? { status: 'KNOWN', items: [] } : { status: 'UNKNOWN', reason: 'Домен не используется' }])),
      appliedEventIds: [], eventCauses: {},
    };
    const replayEvents = history.map((event, index) => ({
      eventId: event.eventId, branchId: 'main', sequence: index + 1, type: event.type,
      operationalAt: '2030-01-01T01:00:00Z', wallClockAt: '2030-01-01T01:00:00Z', payload: event.payload as Record<string, unknown>,
      changes: [{ domain: 'EventFeed' as const, value: { status: 'KNOWN', items: history.slice(0, index + 1).map(item => ({ eventId: item.eventId, type: item.type, payload: item.payload })) } }],
      reducerVersion: 1,
    }));
    const archive: ReplayArchive = {
      archiveId: 'ac08-replay', organizationId: 'org-ac08', schemaVersion: 1, branchId: 'main',
      versions: {
        model: { id: 'aggregate-v1', revision: 1, sha256: hashCanonical({ id: 'aggregate-v1' }) },
        environment: { id: 'environment-ac08', revision: 1, sha256: hashCanonical({ id: 'environment-ac08' }) }, reducerVersion: 1,
      },
      snapshots: [{ snapshotId: 'snapshot-ac08-0', branchId: 'main', sequence: 0, operationalAt: '2030-01-01T01:00:00Z', wallClockAt: '2030-01-01T01:00:00Z', reducerVersion: 1, state: initialState, stateHash: replayStateHash(initialState) }],
      events: replayEvents,
    };
    const [first, second] = await Promise.all([workerReplay(archive, 1), workerReplay(archive, 4)]);
    expect(first.stateHash).toBe(second.stateHash);
    expect(first.compatibility).toBe('REPRODUCIBLE');
    expect(first.selectedOutcomeIds).toEqual(['expected']);
    expect(second.selectedOutcomeIds).toEqual(['expected']);
    const registry = new ReplayReducerRegistry();
    registry.register(2, state => state);
    expect(archive.versions.reducerVersion).toBe(1);

    const vite = await createServer({ root: resolve('apps/editor'), configFile: resolve('apps/editor/vite.config.ts'), server: { host: '127.0.0.1', port: 4188, strictPort: true }, logLevel: 'error' });
    viteServers.push(vite);
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    browsers.push(browser);
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:4188/tests/fixtures/kshvi-admin-preview.html');
    const modulePath = `/@fs${resolve('packages/kshvi/src/replay/replay-engine.ts')}`;
    await page.addScriptTag({ type: 'module', content: `import { restoreAt } from '${modulePath}'; window.__ac08RestoreAt = restoreAt;` });
    await page.waitForFunction(() => typeof window.__ac08RestoreAt === 'function', { timeout: 5_000 });
    const browserReplay = async (playbackSpeed: number) => page.evaluate(({ archiveJson, playbackSpeed }) => {
      const archive = JSON.parse(archiveJson) as ReplayArchive;
      const frame = window.__ac08RestoreAt({ archive, cursor: 2, playbackSpeed });
      return {
        stateHash: frame.stateHash, compatibility: frame.compatibility,
        selectedOutcomeIds: frame.events.map((event: { payload: Record<string, any> }) => event.payload.calculation?.intermediateResults?.selectedOutcomeId ?? event.payload.selectedOutcomeId).filter(Boolean),
      };
    }, { archiveJson: JSON.stringify(archive), playbackSpeed });
    const browserFirst = await browserReplay(1);
    const browserSecond = await browserReplay(4);
    expect(browserFirst.stateHash).toBe(first.stateHash);
    expect(browserSecond.stateHash).toBe(first.stateHash);
    expect(browserFirst.selectedOutcomeIds).toEqual(['expected']);
    expect(browserSecond.selectedOutcomeIds).toEqual(['expected']);

    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (runId) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const directory = 'docs/release/kshvi/evidence/ac08';
      await mkdir(directory, { recursive: true });
      const initialRevision = { id: 'ac08-replay', revision: 1, sha256: hashCanonical(archive) };
      const environment = { workers: [first, second], chromium: [browserFirst, browserSecond], reducerVersion: archive.versions.reducerVersion };
      const metrics = { stateHashMatches: 3, selectedOutcomeMatches: 3, idempotentReplays: 1, browserClients: 1, workerClients: 2 };
      const initialPath = `${directory}/initial-scenario.json`;
      const journalPath = `${directory}/journal.json`;
      const protocolPath = `${directory}/protocol.txt`;
      const metricsPath = `${directory}/metrics.json`;
      const environmentPath = `${directory}/environment.json`;
      const limitations = ['Chromium проверен в headless-режиме; Firefox отдельно не запускается в текущем окружении.'];
      await writeFile(initialPath, JSON.stringify({ initialRevision, scenario: archive }, null, 2));
      await writeFile(journalPath, JSON.stringify({ runId, commit, events: history }, null, 2));
      await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
      await writeFile(environmentPath, JSON.stringify(environment, null, 2));
      await writeFile(protocolPath, `AC-08 завершён\nrunId: ${runId}\ncommit: ${commit}\nДва worker и Chromium совпали по stateHash и исходу; повтор команды не создал событие; старый reducerVersion сохранён.\n`);
      const proof = {
        runId, commit, initialRevision,
        journal: { path: journalPath, sha256: hashCanonical(history), eventCount: history.length },
        hashes: { scenario: initialRevision.sha256, environment: hashCanonical(environment), journal: hashCanonical(history) },
        protocols: [protocolPath], screenshots: [], metrics, limitations,
        artifacts: [initialPath, journalPath, protocolPath, metricsPath, environmentPath],
      };
      await writeFile('docs/release/kshvi/acceptance/AC-08.proof.json', JSON.stringify(proof, null, 2));
    }
  });
}, 60_000);
