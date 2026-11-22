import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createService, Router } from '@def-ops/service-kit';
import profile from '../../../packages/kshvi-agents/data/modern-profiles/balanced.json';
import type { AgentEvaluation, AgentEvaluationRequest } from '../../../packages/kshvi-agents/src/ports/agent-engine';
import { assertModernAgentProfile } from '../../../packages/kshvi-agents/src/ports/modern-choice';
import { createAudiencePolicy } from '../../../packages/kshvi/src/exposition/audience-policy';
import type { ExpositionPresenterSession } from '../../../packages/kshvi/src/exposition/exposition-session';
import { expositionProgram, officialArchive } from '../../../packages/kshvi/tests/fixtures/exposition';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { SystemAgentExpositionCalculator } from '../src/exposition/system-agent-calculator';
import { ExpositionSessionService } from '../src/exposition/exposition-session-service';
import { registerExpositionRoutes } from '../src/http/exposition-routes';
import { createProjectorProfile, type AudienceProjection } from '../src/exposition/exposition-projection';
import { InMemoryExpositionRepository, sealOfficialExpositionArchive } from '../src/exposition/exposition-repository';
import type { DerivedExpositionArchive } from '../src/exposition/exposition-export';

let server: ReturnType<typeof createService> | null = null;
let baseUrl = '';
const agentRequests: AgentEvaluationRequest[] = [];
type Login = { token: string; csrfToken: string };
let presenterLogin: Login;
let projectorLogin: Login;
let outsiderLogin: Login;

beforeEach(async () => {
  agentRequests.length = 0;
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({
    userId: 'presenter-user', username: 'presenter', password: 'secret123', organizationId: 'org1',
    roles: [{ id: 'presenter-role', role: 'DIRECTOR', sideId: null, authorities: ['exposition:present', 'exposition:edit', 'exposition:export'] }],
  });
  await sessions.createAccount({
    userId: 'route-projector', username: 'projector', password: 'secret123', organizationId: 'org1',
    roles: [{ id: 'projector-role', role: 'AUDIENCE_PROJECTOR', sideId: null, authorities: ['exposition:project'] }],
  });
  await sessions.createAccount({
    userId: 'outsider-user', username: 'outsider', password: 'secret123', organizationId: 'org1',
    roles: [{ id: 'outsider-role', role: 'TRAINEE', sideId: null, authorities: ['exposition:present', 'exposition:edit', 'exposition:export'] }],
  });
  presenterLogin = await sessions.login('presenter', 'secret123');
  projectorLogin = await sessions.login('projector', 'secret123');
  outsiderLogin = await sessions.login('outsider', 'secret123');
  await sessions.selectRole(presenterLogin.token, 'presenter-role');
  await sessions.selectRole(projectorLogin.token, 'projector-role');
  await sessions.selectRole(outsiderLogin.token, 'outsider-role');

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
  const service = new ExpositionSessionService({
    repository: new InMemoryExpositionRepository({
      archive: sealOfficialExpositionArchive(officialArchive()), program: expositionProgram(),
    }),
    calculator,
    policy: createAudiencePolicy({
      id: 'route-policy', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols', 'forces', 'routes'],
      showPlanFact: true, showExplanations: true, publicCaptionIds: ['caption-public'],
      publicExplanationIds: ['explanation-public'], publicDecisionIds: [],
    }),
    projectors: [createProjectorProfile({
      id: 'route-projector', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols', 'forces', 'routes'],
    })],
  });
  const router = new Router();
  registerExpositionRoutes(router, { service, sessions });
  server = createService({ name: 'exposition-route-test', port: 0, router });
  const port = await server.listen();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => { await server?.close(); server = null; });

async function request<T>(method: string, path: string, body?: unknown, options: {
  auth?: 'presenter' | 'projector' | 'outsider' | 'none';
  csrf?: boolean;
} = {}): Promise<{ status: number; data: T }> {
  const auth = options.auth ?? 'presenter';
  const login = auth === 'presenter' ? presenterLogin : auth === 'projector' ? projectorLogin : auth === 'outsider' ? outsiderLogin : null;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(login ? { Authorization: `Bearer ${login.token}` } : {}),
      ...(login && options.csrf !== false ? { 'X-CSRF-Token': login.csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() as T };
}

async function start(source: 'ARCHIVE' | 'AUTONOMOUS', suffix: string): Promise<ExpositionPresenterSession> {
  const response = await request<ExpositionPresenterSession>('POST', '/kshvi/expositions', {
    source, seed: 42, sessionId: `route-${suffix}`, branchId: `route-${suffix}-branch`,
  });
  expect(response.status, JSON.stringify(response.data)).toBe(200);
  return response.data;
}

describe('авторизованные API ведущего и проектора', () => {
  it('выполняет автономный расчёт и отдаёт проектору только его audience projection', async () => {
    const archive = await start('ARCHIVE', 'archive');
    const archiveText = JSON.stringify(archive);
    expect(archiveText).not.toContain('sourceArchive');
    expect(archiveText).not.toContain('officialAssessments');
    expect(archiveText).not.toContain('serviceIntent');
    expect(agentRequests).toHaveLength(0);

    const autonomous = await start('AUTONOMOUS', 'auto');
    expect(autonomous.randomOutcomesCreated).toBeGreaterThan(0);
    expect(autonomous.rng).toMatchObject({ version: 'exposition-rng-v1', seed: 42, branchId: 'route-auto-branch' });
    expect(agentRequests).toHaveLength(4);

    const audience = await request<AudienceProjection>('GET', `/kshvi/expositions/${autonomous.sessionId}/projector`, undefined, { auth: 'projector' });
    expect(audience.status).toBe(200);
    const audienceText = JSON.stringify(audience.data);
    for (const forbidden of ['sourceArchive', 'officialAssessments', 'serviceIntent', 'hiddenRationale', 'journal', 'checkpoints', 'seed', 'rng']) {
      expect(audienceText).not.toContain(forbidden);
    }
    expect(audience.data.handoffGeneration).toBeGreaterThan(0);
  });

  it('проводит continuation/restart и переводит активный проектор на новый session/branch', async () => {
    const autonomous = await start('AUTONOMOUS', 'commands');
    const id = autonomous.sessionId;
    await request('POST', `/kshvi/expositions/${id}/commands`, { type: 'PLAY' });
    const advanced = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${id}/commands`, { type: 'ADVANCE', elapsedMs: 1_000 });
    expect(advanced.data.playback.atMs).toBe(1_000);
    expect(advanced.data.world.resources.fuel.onHand).toBe(autonomous.checkpoints[0].world.resources.fuel.onHand);

    const continued = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${id}/checkpoints/cp-1/continuations`, {
      sessionId: 'route-continued', branchId: 'route-continued-branch', seed: 42,
    });
    expect(continued.status).toBe(200);
    const activeContinuation = await request<AudienceProjection>('GET', '/kshvi/expositions/active/projector', undefined, { auth: 'projector' });
    expect(activeContinuation.data).toMatchObject({ sessionId: 'route-continued', branchId: 'route-continued-branch' });

    const replayed = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${continued.data.sessionId}/restarts`, {
      mode: 'REPLAY_SAVED_LINE', sessionId: 'route-replayed',
    });
    expect(replayed.data.journal).toEqual(continued.data.journal);
    const activeReplay = await request<AudienceProjection>('GET', '/kshvi/expositions/active/projector', undefined, { auth: 'projector' });
    expect(activeReplay.data.sessionId).toBe('route-replayed');
    expect(activeReplay.data.handoffGeneration).toBeGreaterThan(activeContinuation.data.handoffGeneration);

    const fresh = await request<ExpositionPresenterSession>('POST', `/kshvi/expositions/${continued.data.sessionId}/restarts`, {
      mode: 'NEW_BRANCH', sessionId: 'route-fresh', branchId: 'route-fresh-branch', seed: 43,
    });
    expect(fresh.data.origin.parentBranchId).toBe(continued.data.branchId);
    const activeFresh = await request<AudienceProjection>('GET', '/kshvi/expositions/active/projector', undefined, { auth: 'projector' });
    expect(activeFresh.data).toMatchObject({ sessionId: 'route-fresh', branchId: 'route-fresh-branch' });

    const updated = await request<ExpositionPresenterSession>('PUT', `/kshvi/expositions/${fresh.data.sessionId}/program`, {
      ...fresh.data.program, layers: ['terrain', 'modern-symbols'],
    });
    expect(updated.status).toBe(200);
    const projection = await request<AudienceProjection>('GET', '/kshvi/expositions/active/projector', undefined, { auth: 'projector' });
    expect(projection.data.program.layers).toEqual(['terrain', 'modern-symbols']);
    const rejected = await request('PUT', `/kshvi/expositions/${fresh.data.sessionId}/program`, { ...fresh.data.program, layers: [] });
    expect(rejected.status).toBe(422);
  });

  it('фильтрует экспорт по назначениям и сохраняет согласованный playback/cursor/world/journal/RNG', async () => {
    const autonomous = await start('AUTONOMOUS', 'export');
    const exported = await request<DerivedExpositionArchive>('POST', `/kshvi/expositions/${autonomous.sessionId}/exports`, { archiveId: 'route-derived' });
    expect(exported.status).toBe(200);
    expect(exported.data).toMatchObject({ schemaVersion: '1.0.0', archiveId: 'route-derived', playback: { atMs: 0 }, journalCursor: 0 });
    expect(exported.data.journal).toEqual([]);
    expect(exported.data.rng).toMatchObject({ cursor: 0, branchId: autonomous.branchId });
    const { resources, ...canonicalWorld } = autonomous.world;
    expect(exported.data.world).toEqual(canonicalWorld);
    expect(exported.data.world.state.Resources).toEqual(resources);
    const serialized = JSON.stringify(exported.data);
    for (const forbidden of ['hiddenRationale', 'explanation-secret', 'serviceIntent', 'official-assessment-1', 'Скрытый служебный замысел']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(exported.data.officialAssessments).toEqual([]);
    expect(exported.data.program.explanations).toEqual([{ id: 'explanation-public', atMs: 1_000, text: 'Пояснение для аудитории', audience: true }]);
    const duplicate = await request('POST', `/kshvi/expositions/${autonomous.sessionId}/exports`, { archiveId: 'official-archive-1' });
    expect(duplicate.status).toBe(422);
    const empty = await request('POST', `/kshvi/expositions/${autonomous.sessionId}/exports`, { archiveId: '  ' });
    expect(empty.status).toBe(422);
  });

  it('не позволяет легализовать секрет через audience:true или заменить утверждённый публичный текст', async () => {
    const autonomous = await start('AUTONOMOUS', 'tamper');
    const legalized = {
      ...autonomous.program,
      explanations: autonomous.program.explanations.map(explanation => ({ ...explanation, audience: true })),
    };
    const rejected = await request('PUT', `/kshvi/expositions/${autonomous.sessionId}/program`, legalized);
    expect(rejected.status).toBe(422);
    const replacedCaption = {
      ...autonomous.program,
      captions: autonomous.program.captions.map(caption => ({ ...caption, text: 'Скрытый замысел вместо подписи' })),
    };
    expect((await request('PUT', `/kshvi/expositions/${autonomous.sessionId}/program`, replacedCaption)).status).toBe(422);
    const audience = await request<AudienceProjection>('GET', '/kshvi/expositions/active/projector', undefined, { auth: 'projector' });
    expect(JSON.stringify(audience.data)).not.toContain('Скрытый замысел');
    expect(audience.data.program.explanations.map(item => item.id)).toEqual(['explanation-public']);
  });

  it('не перезаписывает существующий sessionId', async () => {
    const original = await start('ARCHIVE', 'conflict');
    const conflict = await request('POST', '/kshvi/expositions', {
      source: 'ARCHIVE', sessionId: original.sessionId, branchId: 'attacker-branch',
    });
    expect(conflict.status).toBe(409);
    const current = await request<ExpositionPresenterSession>('GET', `/kshvi/expositions/${original.sessionId}/presenter`);
    expect(current.data.branchId).toBe(original.branchId);
  });

  it('требует SessionManager, роль, полномочия и CSRF на всех presenter/export/program маршрутах', async () => {
    const autonomous = await start('AUTONOMOUS', 'security');
    expect((await request('GET', `/kshvi/expositions/${autonomous.sessionId}/presenter`, undefined, { auth: 'none' })).status).toBe(401);
    expect((await request('POST', `/kshvi/expositions/${autonomous.sessionId}/exports`, { archiveId: 'anonymous' }, { auth: 'none' })).status).toBe(401);
    expect((await request('PUT', `/kshvi/expositions/${autonomous.sessionId}/program`, autonomous.program, { auth: 'none' })).status).toBe(401);
    expect((await request('POST', '/kshvi/expositions', { source: 'ARCHIVE' }, { csrf: false })).status).toBe(403);
    expect((await request('POST', `/kshvi/expositions/${autonomous.sessionId}/commands`, { type: 'PAUSE' }, { csrf: false })).status).toBe(403);
    expect((await request('GET', `/kshvi/expositions/${autonomous.sessionId}/presenter`, undefined, { auth: 'projector' })).status).toBe(403);
    expect((await request('POST', `/kshvi/expositions/${autonomous.sessionId}/exports`, { archiveId: 'projector-export' }, { auth: 'projector' })).status).toBe(403);
    expect((await request('PUT', `/kshvi/expositions/${autonomous.sessionId}/program`, autonomous.program, { auth: 'projector' })).status).toBe(403);
    expect((await request('GET', `/kshvi/expositions/${autonomous.sessionId}/presenter`, undefined, { auth: 'outsider' })).status).toBe(403);
    const audience = await request('GET', `/kshvi/expositions/${autonomous.sessionId}/projector`, undefined, { auth: 'projector' });
    expect(audience.status).toBe(200);
  });
});
