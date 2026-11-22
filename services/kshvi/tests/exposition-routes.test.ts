import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createService, Router } from '@def-ops/service-kit';
import profile from '../../../packages/kshvi-agents/data/modern-profiles/balanced.json';
import type { AgentEvaluation, AgentEvaluationRequest } from '../../../packages/kshvi-agents/src/ports/agent-engine';
import { assertModernAgentProfile } from '../../../packages/kshvi-agents/src/ports/modern-choice';
import { createAudiencePolicy } from '../../../packages/kshvi/src/exposition/audience-policy';
import type { ExpositionSession } from '../../../packages/kshvi/src/exposition/exposition-session';
import { expositionProgram, officialArchive } from '../../../packages/kshvi/tests/fixtures/exposition';
import { SystemAgentExpositionCalculator } from '../src/exposition/system-agent-calculator';
import { ExpositionSessionService } from '../src/exposition/exposition-session-service';
import { registerExpositionRoutes } from '../src/http/exposition-routes';
import { createProjectorProfile } from '../src/exposition/exposition-projection';

let server: ReturnType<typeof createService> | null = null;
let baseUrl = '';
const agentRequests: AgentEvaluationRequest[] = [];

beforeEach(async () => {
  agentRequests.length = 0;
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
    sourceArchive: officialArchive(),
    program: expositionProgram(),
    calculator,
    policy: createAudiencePolicy({
      id: 'route-policy', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols', 'forces', 'routes'],
      showPlanFact: true, showExplanations: true, publicCaptionIds: ['caption-public'], publicDecisionIds: [],
    }),
    projectors: [createProjectorProfile({
      id: 'route-projector', allowedLayers: ['weather', 'terrain', 'logistics', 'modern-symbols', 'forces', 'routes'],
    })],
  });
  const router = new Router();
  registerExpositionRoutes(router, service);
  server = createService({ name: 'exposition-route-test', port: 0, router });
  const port = await server.listen();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => { await server?.close(); server = null; });

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; data: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() as T };
}

async function start(source: 'ARCHIVE' | 'AUTONOMOUS', suffix: string): Promise<ExpositionSession> {
  const response = await request<ExpositionSession>('POST', '/kshvi/expositions', {
    source, seed: 42, sessionId: `route-${suffix}`, branchId: `route-${suffix}-branch`,
  });
  expect(response.status, JSON.stringify(response.data)).toBe(200);
  return response.data;
}

describe('серверные API ведущего и отдельного проектора', () => {
  it('не отдаёт официальный архив и выполняет автономный расчёт через разрешённых системных агентов', async () => {
    const archive = await start('ARCHIVE', 'archive');
    const archiveText = JSON.stringify(archive);
    expect(archiveText).not.toContain('sourceArchive');
    expect(archiveText).not.toContain('officialAssessments');
    expect(archiveText).not.toContain('serviceIntent');
    expect(archiveText).not.toContain('browser-official-assessment');
    expect(agentRequests).toHaveLength(0);

    const autonomous = await start('AUTONOMOUS', 'auto');
    expect(autonomous.randomOutcomesCreated).toBeGreaterThan(0);
    expect(autonomous.rng).toMatchObject({ version: 'exposition-rng-v1', seed: 42, branchId: 'route-auto-branch' });
    expect(agentRequests).toHaveLength(4);
    expect(agentRequests.map(item => item.projection.agentId)).toEqual(['agent-blue', 'agent-red', 'agent-blue', 'agent-red']);
    expect(agentRequests.every(item => item.projection.instanceId === 'route-auto-branch')).toBe(true);
    expect(JSON.stringify(agentRequests, (_key, value: unknown) => typeof value === 'bigint' ? `${value}n` : value)).not.toContain('officialAssessments');

    const audience = await request<Record<string, unknown>>('GET', `/kshvi/expositions/${autonomous.sessionId}/projector`, undefined, { 'X-Projector-Id': 'route-projector' });
    expect(audience.status).toBe(200);
    const audienceText = JSON.stringify(audience.data);
    for (const forbidden of ['sourceArchive', 'officialAssessments', 'serviceIntent', 'hiddenRationale', 'journal', 'checkpoints', 'seed', 'rng']) {
      expect(audienceText).not.toContain(forbidden);
    }
    const denied = await request('GET', `/kshvi/expositions/${autonomous.sessionId}/projector`, undefined, { 'X-Projector-Id': 'presenter' });
    expect(denied.status).toBe(403);
  });

  it('выполняет часы, checkpoints, повтор линии, новую ветвь и повторную валидацию слоёв на сервере', async () => {
    const autonomous = await start('AUTONOMOUS', 'commands');
    const id = autonomous.sessionId;
    await request('POST', `/kshvi/expositions/${id}/commands`, { type: 'PLAY' });
    const advanced = await request<ExpositionSession>('POST', `/kshvi/expositions/${id}/commands`, { type: 'ADVANCE', elapsedMs: 1_000 });
    expect(advanced.data.playback.atMs).toBe(1_000);
    expect(advanced.data.world.resources.fuel.onHand).toBe(autonomous.checkpoints[0].world.resources.fuel.onHand);

    const continued = await request<ExpositionSession>('POST', `/kshvi/expositions/${id}/checkpoints/cp-1/continuations`, {
      sessionId: 'route-continued', branchId: 'route-continued-branch', seed: 42,
    });
    expect(continued.status).toBe(200);
    expect(continued.data.origin).toMatchObject({ parentBranchId: id.replace('route-commands', 'route-commands-branch'), checkpointId: 'cp-1' });

    const replayed = await request<ExpositionSession>('POST', `/kshvi/expositions/${continued.data.sessionId}/restarts`, {
      mode: 'REPLAY_SAVED_LINE', sessionId: 'route-replayed',
    });
    expect(replayed.data.journal).toEqual(continued.data.journal);
    expect(replayed.data.randomOutcomesCreated).toBe(0);
    const fresh = await request<ExpositionSession>('POST', `/kshvi/expositions/${continued.data.sessionId}/restarts`, {
      mode: 'NEW_BRANCH', sessionId: 'route-fresh', branchId: 'route-fresh-branch', seed: 43,
    });
    expect(fresh.data.origin.parentBranchId).toBe(continued.data.branchId);
    expect(fresh.data.journal).not.toEqual(continued.data.journal);

    const reducedProgram = { ...fresh.data.program, layers: ['terrain', 'modern-symbols'] };
    const updated = await request<ExpositionSession>('PUT', `/kshvi/expositions/${fresh.data.sessionId}/program`, reducedProgram);
    expect(updated.status).toBe(200);
    expect(updated.data.program.layers).toEqual(['terrain', 'modern-symbols']);
    const projection = await request<{ program: { layers: string[] } }>('GET', `/kshvi/expositions/${fresh.data.sessionId}/projector`, undefined, { 'X-Projector-Id': 'route-projector' });
    expect(projection.data.program.layers).toEqual(['terrain', 'modern-symbols']);
    const rejected = await request('PUT', `/kshvi/expositions/${fresh.data.sessionId}/program`, { ...fresh.data.program, layers: [] });
    expect(rejected.status).toBe(422);
    const unchanged = await request<{ program: { layers: string[] } }>('GET', `/kshvi/expositions/${fresh.data.sessionId}/projector`, undefined, { 'X-Projector-Id': 'route-projector' });
    expect(unchanged.data.program.layers).toEqual(['terrain', 'modern-symbols']);
  });

  it('создаёт версионный производный архив и сразу запрещает archiveId официального источника', async () => {
    const autonomous = await start('AUTONOMOUS', 'export');
    const exported = await request<{ schemaVersion: string; archiveId: string }>('POST', `/kshvi/expositions/${autonomous.sessionId}/exports`, { archiveId: 'route-derived' });
    expect(exported.status).toBe(200);
    expect(exported.data).toMatchObject({ schemaVersion: '1.0.0', archiveId: 'route-derived' });
    const duplicate = await request('POST', `/kshvi/expositions/${autonomous.sessionId}/exports`, { archiveId: 'official-archive-1' });
    expect(duplicate.status).toBe(422);
  });
});
