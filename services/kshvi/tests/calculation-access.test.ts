import { expect, it } from 'vitest';
import { createService } from '@def-ops/service-kit';
import { CalculationJournal, buildCalculationRouter, type CalculationActor } from '../src/http/calculation-routes';

const episode = {
  state: {}, forces: {}, task: { id: 'task', status: 'IN_PROGRESS', progressPercent: 0 },
  resource: { id: 'fuel', unit: 'L', onHand: 10, consumption: 2, supplied: 0 }, elapsedMinutes: 10,
  position: { remainingMeters: 5000, travelledMeters: 0 }, uncertainty: {},
  effects: { taskProgressDelta: 20, positionAdvanceMeters: 2500, stateChanges: {}, uncertaintyChanges: {} },
};
const modelPassport = {
  purpose: 'HTTP гибрид', limitations: ['Только тест'], source: { kind: 'ASSUMPTION' as const, note: 'Учебное допущение', applicability: 'Тест' }, knownErrors: [], examples: [{ input: 1, expected: 1 }], approvedBy: 'Методист', version: 1,
};
const leader: CalculationActor = {
  userId: 'leader', organizationId: 'org', sideId: 'blue', assignedNodeIds: ['node-1'],
  authorities: ['calculation:create', 'calculation:approve', 'calculation:read', 'calculation:read:truth'],
};

async function withActor(actor: CalculationActor, run: (baseUrl: string, setActor: (actor: CalculationActor) => void) => Promise<void>) {
  let current = actor;
  const journal = new CalculationJournal({ idFactory: () => 'calc-http' });
  const service = createService({ name: 'calculation-access', port: 0, router: buildCalculationRouter(journal, () => current) });
  const port = await service.listen();
  try { await run(`http://127.0.0.1:${port}`, next => { current = next; }); } finally { await service.close(); }
}
async function post(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

it('Important 2: HTTP утверждает гибрид с reviewedParameters и возвращает пересчитанный результат', async () => {
  await withActor(leader, async baseUrl => {
    const created = await post(baseUrl, '/kshvi/calculations', {
      mode: 'HYBRID', reason: 'Гибридный эпизод', createdAt: '2030-01-01T00:00:00Z', inputSnapshot: { revision: 1 }, inputs: { episode }, requiredInputs: [], units: {}, modelVersion: 'aggregate-v1', profileVersions: {}, modelPassport,
      hybridReviewParameters: ['episode'], idempotencyKey: 'hybrid-create', sideId: 'red', nodeId: 'node-attacker',
    });
    expect(created.status).toBe(200);
    const reviewedEpisode = { ...episode, effects: { ...episode.effects, positionAdvanceMeters: 4000 } };
    const approved = await post(baseUrl, '/kshvi/calculations/calc-http/approve', { reviewedParameters: { episode: reviewedEpisode } });
    expect(approved.status).toBe(200);
    const body = await approved.json() as { state: string; result: { position: { travelledMeters: number } }; sideId: string; nodeId: string; hybridReview: { effectiveInputHash: string } };
    expect(body.state).toBe('APPROVED');
    expect(body.result.position.travelledMeters).toBe(4000);
    expect(body.sideId).toBe('blue');
    expect(body.nodeId).toBe('node-1');
    expect(body.hybridReview.effectiveInputHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

it('Important 5: чтение требует calculation:read и возвращает ролевую проекцию без полных входов и randomKeys', async () => {
  await withActor(leader, async (baseUrl, setActor) => {
    await post(baseUrl, '/kshvi/calculations', {
      mode: 'MANUAL', reason: 'Закрытый расчёт', createdAt: '2030-01-01T00:00:00Z', inputSnapshot: { secretSnapshot: true }, inputs: { note: 'secret-input' }, requiredInputs: [], units: {}, modelVersion: 'manual-v1', profileVersions: {}, modelPassport,
      manual: { author: 'leader', reason: 'Основание', result: { delay: 10 } }, idempotencyKey: 'read-scope',
    });
    setActor({ ...leader, authorities: [] });
    expect((await fetch(`${baseUrl}/kshvi/calculations/calc-http`)).status).toBe(403);
    setActor({ ...leader, sideId: 'red', authorities: ['calculation:read'] });
    expect((await fetch(`${baseUrl}/kshvi/calculations/calc-http`)).status).toBe(404);
    setActor({ ...leader, assignedNodeIds: ['node-other'], authorities: ['calculation:read'] });
    expect((await fetch(`${baseUrl}/kshvi/calculations/calc-http`)).status).toBe(404);
    setActor({ ...leader, authorities: ['calculation:read'] });
    const own = await fetch(`${baseUrl}/kshvi/calculations/calc-http`);
    expect(own.status).toBe(200);
    const text = await own.text();
    expect(text).not.toContain('secret-input');
    expect(text).not.toContain('secretSnapshot');
    expect(text).not.toContain('randomKeys');
    expect(JSON.parse(text)).toMatchObject({ id: 'calc-http', sideId: 'blue', nodeId: 'node-1', result: { delay: 10 } });
    setActor({ ...leader, authorities: ['calculation:read:truth'] });
    const truth = await fetch(`${baseUrl}/kshvi/calculations/calc-http`);
    expect(truth.status).toBe(200);
    expect(await truth.text()).toContain('secret-input');
  });
});
