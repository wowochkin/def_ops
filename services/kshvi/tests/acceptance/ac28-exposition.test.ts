import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createService, Router } from '@def-ops/service-kit';
import profile from '../../../../packages/kshvi-agents/data/modern-profiles/balanced.json';
import type { AgentEvaluation, AgentEvaluationRequest } from '../../../../packages/kshvi-agents/src/ports/agent-engine';
import { assertModernAgentProfile } from '../../../../packages/kshvi-agents/src/ports/modern-choice';
import { createAudiencePolicy } from '../../../../packages/kshvi/src/exposition/audience-policy';
import type { ExpositionPresenterSession } from '../../../../packages/kshvi/src/exposition/exposition-session';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { expositionProgram, officialArchive } from '../../../../packages/kshvi/tests/fixtures/exposition';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { SystemAgentExpositionCalculator } from '../../src/exposition/system-agent-calculator';
import { ExpositionSessionService } from '../../src/exposition/exposition-session-service';
import { registerExpositionRoutes } from '../../src/http/exposition-routes';
import { createProjectorProfile, type AudienceProjection } from '../../src/exposition/exposition-projection';
import { InMemoryExpositionRepository, sealOfficialExpositionArchive } from '../../src/exposition/exposition-repository';
import type { DerivedExpositionArchive } from '../../src/exposition/exposition-export';

let server: ReturnType<typeof createService> | null = null;
let repository: InMemoryExpositionRepository;
let sealedBefore: ReturnType<typeof sealOfficialExpositionArchive>;
let baseUrl = '';
let presenterLogin: { token: string; csrfToken: string };
let projectorLogin: { token: string; csrfToken: string };
const agentRequests: AgentEvaluationRequest[] = [];

beforeEach(async () => {
  agentRequests.length = 0;
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({
    userId: 'ac28-presenter', username: 'ac28-presenter', password: 'secret123', organizationId: 'org-ac28',
    roles: [{ id: 'presenter-role', role: 'DIRECTOR', sideId: null, authorities: ['exposition:present', 'exposition:edit', 'exposition:export'] }],
  });
  await sessions.createAccount({
    userId: 'ac28-audience', username: 'ac28-audience', password: 'secret123', organizationId: 'org-ac28',
    roles: [{ id: 'audience-role', role: 'AUDIENCE_PROJECTOR', sideId: null, authorities: ['exposition:project'] }],
  });
  presenterLogin = await sessions.login('ac28-presenter', 'secret123');
  projectorLogin = await sessions.login('ac28-audience', 'secret123');
  await sessions.selectRole(presenterLogin.token, 'presenter-role');
  await sessions.selectRole(projectorLogin.token, 'audience-role');
  const calculator = new SystemAgentExpositionCalculator({
    engine: {
      async evaluateChoices(request): Promise<AgentEvaluation> {
        agentRequests.push(request);
        const advance = request.seed % 2n === 0n;
        return {
          selected: { id: advance ? 'advance' : 'hold', kind: advance ? 'ADVANCE' : 'HOLD', label: 'Решение системного агента', commandType: null },
          options: [{ id: 'choice', utility: advance ? 1 : 0 }], unknown: [], forkHashes: ['isolated-fork'], destroyedForks: 1,
          orders: [], reports: [], trace: { purpose: 'EXPOSITION' },
        };
      },
    },
    profileFor: side => assertModernAgentProfile({ ...profile, id: side.agentId, version: side.profileVersion }),
  });
  sealedBefore = sealOfficialExpositionArchive(officialArchive());
  repository = new InMemoryExpositionRepository({ archive: sealedBefore, program: expositionProgram() });
  const service = new ExpositionSessionService({
    repository,
    calculator,
    policy: createAudiencePolicy({
      id: 'ac28-policy', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols', 'forces', 'routes'],
      showPlanFact: true, showExplanations: true, publicCaptionIds: ['caption-public'], publicExplanationIds: ['explanation-public'], publicDecisionIds: [],
    }),
    projectors: [createProjectorProfile({ id: 'ac28-audience', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols', 'forces', 'routes'] })],
  });
  const router = new Router();
  registerExpositionRoutes(router, { service, sessions });
  server = createService({ name: 'kshvi-ac28', port: 0, router });
  const port = await server.listen();
  baseUrl = `http://127.0.0.1:${port}`;
});
afterEach(async () => { await server?.close(); server = null; });

async function request<T>(method: string, path: string, body?: unknown, audience = false): Promise<{ status: number; data: T }> {
  const login = audience ? projectorLogin : presenterLogin;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${login.token}`, 'X-CSRF-Token': login.csrfToken, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() as T };
}
async function start(source: 'ARCHIVE' | 'AUTONOMOUS', suffix: string): Promise<ExpositionPresenterSession> {
  const response = await request<ExpositionPresenterSession>('POST', '/kshvi/expositions', {
    source, seed: 42, sessionId: `ac28-${suffix}`, branchId: `ac28-${suffix}-branch`,
  });
  expect(response.status, JSON.stringify(response.data)).toBe(200);
  return response.data;
}

it('AC-28: архивный и автономный показ, seek мира, continuation, аудитория и доказательства', async () => {
  const archive = await start('ARCHIVE', 'archive');
  expect(archive.purpose).toBe('EXPOSITION');
  expect(JSON.stringify(archive)).not.toContain('officialAssessments');
  expect(agentRequests).toHaveLength(0);

  const autonomous = await start('AUTONOMOUS', 'auto');
  expect(autonomous.randomOutcomesCreated).toBeGreaterThan(0);
  expect(autonomous.rng).toMatchObject({ version: 'exposition-rng-v1', seed: 42, branchId: 'ac28-auto-branch' });
  expect(agentRequests).toHaveLength(4);
  const initialWorld = autonomous.world;

  await request('POST', `/kshvi/expositions/${autonomous.sessionId}/commands`, { type: 'PLAY' });
  const advanced = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${autonomous.sessionId}/commands`, { type: 'ADVANCE', elapsedMs: 1_000 });
  expect(advanced.data.playback.atMs).toBe(1_000);
  expect(advanced.data.world).not.toEqual(initialWorld);
  const tempo = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${autonomous.sessionId}/commands`, { type: 'SET_TEMPO', tempo: 2 });
  expect(tempo.data.playback.tempo).toBe(2);
  const rewound = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${autonomous.sessionId}/commands`, { type: 'SEEK', atMs: 0 });
  expect(rewound.data.world).toEqual(initialWorld);
  const sought = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${autonomous.sessionId}/commands`, { type: 'SEEK', atMs: 1_000 });
  expect(sought.data.world).toEqual(advanced.data.world);
  const chapter = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${autonomous.sessionId}/commands`, { type: 'SEEK_CHAPTER', chapterId: 'chapter-2' });
  expect(chapter.data.playback.chapterId).toBe('chapter-2');
  expect(chapter.data.program.cameraRoute.keyframes).toHaveLength(2);

  const continued = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${autonomous.sessionId}/checkpoints/cp-1/continuations`, {
    sessionId: 'ac28-continued', branchId: 'ac28-continued-branch', seed: 42,
  });
  expect(continued.status).toBe(200);
  expect(continued.data.randomOutcomesCreated).toBeGreaterThan(0);
  expect(agentRequests.length).toBeGreaterThan(4);
  const replayed = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${continued.data.sessionId}/restarts`, {
    mode: 'REPLAY_SAVED_LINE', sessionId: 'ac28-replayed',
  });
  expect(replayed.data.journal).toEqual(continued.data.journal);
  const fresh = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${continued.data.sessionId}/restarts`, {
    mode: 'NEW_BRANCH', sessionId: 'ac28-fresh', branchId: 'ac28-fresh-branch', seed: 43,
  });
  expect(fresh.data.origin.parentBranchId).toBe(continued.data.branchId);
  expect(fresh.data.rng?.seed).toBe(43);
  expect(continued.data).not.toHaveProperty('officialAssessments');
  expect(continued.data.officialAssessmentCreated).toBe(false);

  const audience = await request<AudienceProjection>('GET', '/kshvi/expositions/active/projector', undefined, true);
  expect(audience.status).toBe(200);
  expect(audience.data).toMatchObject({ sessionId: 'ac28-fresh', branchId: 'ac28-fresh-branch' });
  expect(audience.data.map).toHaveProperty('weather');
  expect(audience.data.program.cameraRoute.keyframes).toHaveLength(2);
  expect(audience.data.handoffGeneration).toBeGreaterThan(0);
  const audienceText = JSON.stringify(audience.data);
  for (const forbidden of ['sourceArchive', 'officialAssessments', 'serviceIntent', 'hiddenRationale', 'journal', 'checkpoints', 'seed', 'rng']) {
    expect(audienceText).not.toContain(forbidden);
  }

  await request('POST', `/kshvi/expositions/${continued.data.sessionId}/commands`, { type: 'PLAY' });
  const continuedAtEnd = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${continued.data.sessionId}/commands`, { type: 'ADVANCE', elapsedMs: 1_000 });
  expect(continuedAtEnd.data.playback.atMs).toBe(2_000);
  const exported = await request<DerivedExpositionArchive>('POST', `/kshvi/expositions/${continued.data.sessionId}/exports`, { archiveId: 'ac28-derived' });
  expect(exported.status).toBe(200);
  expect(exported.data.journal).toEqual(continuedAtEnd.data.journal);
  expect(exported.data.rng).toEqual(continuedAtEnd.data.rng);
  expect(exported.data.officialAssessments).toEqual([]);
  expect(JSON.stringify(exported.data)).not.toContain('Скрытый служебный замысел');
  expect(await repository.officialArchive()).toEqual(sealedBefore);

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const root = process.cwd();
  const directory = 'docs/release/kshvi/evidence/ac28';
  await mkdir(`${root}/${directory}`, { recursive: true });
  const scenario = officialArchive();
  const initialRevision = { id: scenario.archiveId, revision: 1, sha256: hashCanonical(scenario.demonstration) };
  const journalPath = `${directory}/journal.json`;
  const protocolPath = `${directory}/protocol.txt`;
  const initialPath = `${directory}/initial-scenario.json`;
  const exportPath = `${directory}/derived-archive.json`;
  const metrics = {
    randomOutcomesCreated: continued.data.randomOutcomesCreated,
    agentRequests: agentRequests.length,
    seekWorldMatches: 2,
    audienceForbiddenFields: 0,
    mapLayers: Object.keys(audience.data.map).length,
  };
  const limitations = ['Проверка выполнена на уровне двух HTTP-клиентов presenter/server/audience; визуальная проверка Playwright подключается отдельно.'];
  await writeFile(`${root}/${initialPath}`, JSON.stringify({ initialRevision, scenario: scenario.demonstration }, null, 2));
  await writeFile(`${root}/${journalPath}`, JSON.stringify({ runId, commit, events: continued.data.journal }, null, 2));
  await writeFile(`${root}/${exportPath}`, JSON.stringify(exported.data, null, 2));
  await writeFile(`${root}/${protocolPath}`, [
    'AC-28: архивный и автономный показ завершены.',
    `runId: ${runId}`, `commit: ${commit}`,
    'PLAY/ADVANCE/SET_TEMPO/SEEK/SEEK_CHAPTER: мир и камера восстановлены по фактическому журналу.',
    'Checkpoint continuation, replay saved line и new branch: подтверждены.',
    'Исходный архив не изменён; официальных оценок экспозиция не создала.',
    `Метрики: ${JSON.stringify(metrics)}`,
    `Ограничения: ${limitations.join(' ')}`,
  ].join('\n'));
  const proof = {
    runId, commit,
    initialRevision,
    journal: { path: journalPath, sha256: hashCanonical(continued.data.journal), eventCount: continued.data.journal.length },
    hashes: { scenario: initialRevision.sha256, environment: scenario.manifestHash, journal: hashCanonical(continued.data.journal) },
    protocols: [protocolPath], screenshots: [], metrics, limitations,
    artifacts: [initialPath, journalPath, protocolPath, exportPath],
  };
  await writeFile(`${root}/docs/release/kshvi/acceptance/AC-28.proof.json`, JSON.stringify(proof, null, 2));
});
