import { expect, it } from 'vitest';
import { addInitialMapMarker, approveInitialMap, createInitialSituationMap, hashCanonical, READINESS_AREAS, REHEARSAL_CHECKS, type SealScenarioInput } from '@def-ops/kshvi';
import { SealingService } from '../src/instances/sealing-service';
import { registerSealingRoutes } from '../src/http/sealing-routes';
import { createService } from '@def-ops/service-kit';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const start = '2030-01-01T06:00:00+03:00';
const end = '2030-01-02T06:00:00+03:00';
const scenario = { id: 'scenario-ac01', title: 'Многоступенчатое учение', sides: ['blue', 'red'], trainedLevels: 3, stages: ['stage-1', 'stage-2'], mapZoom: 8 };

function validMap() {
  const map = createInitialSituationMap({
    id: 'map-ac01', revision: 1,
    environment: { snapshotId: 'env-1', manifestSha256: HASH_A, bounds: [0, 0, 1, 1] },
    initialOperationalAt: start, timeZone: 'Europe/Moscow', weatherFrameRef: 'weather-1', terrainStateRef: 'terrain-1',
    symbolSet: { id: 'symbols', revision: 1, sha256: HASH_B }, attribution: ['OSM'],
  });
  return approveInitialMap(addInitialMapMarker(map, {
    id: 'force', revision: 1, kind: 'FORCE', layerId: 'TRUE_FORCES', truth: 'TRUTH',
    geometry: { type: 'Point', coordinates: [0.2, 0.2] }, sourceId: 'source', authorId: 'author', eventId: 'event',
    validFrom: start, validUntil: end, state: 'OBSERVED', confidence: 0.8,
    uncertainty: { radiusM: 10, note: '' }, visibility: { sideIds: ['blue'] }, links: { forceId: 'force-1' },
    sideId: 'blue', symbol: { id: 'force', version: 'v1', sideId: 'blue', status: 'APPROVED', sourceDocument: 'source.doc', sourcePage: 1 },
  }));
}

function sealInput(): SealScenarioInput {
  return {
    id: 'scenario-ac01', revision: 3, state: 'APPROVED', scenario, issues: [],
    requiredConfirmations: [...READINESS_AREAS],
    confirmations: READINESS_AREAS.map(area => ({ id: `confirmation-${area}`, area, userId: `user-${area}`, role: 'RESPONSIBLE', confirmedAt: start, subjectHash: HASH_A, dependsOn: [] })),
    confirmationSubjects: Object.fromEntries(READINESS_AREAS.map(area => [area, HASH_A])),
    rehearsal: { schemaVersion: 1, id: 'rehearsal-ac01', scenarioSha256: hashCanonical(scenario), full: true, isolated: true, status: 'PASSED', eventLogId: 'rehearsal-log-ac01', officialEventLogId: 'official-log-ac01', checks: Object.fromEntries(REHEARSAL_CHECKS.map(check => [check, true])) },
    initialMap: validMap(),
    environmentSnapshot: { manifestSha256: HASH_A, contentRef: 'environment/hash', autonomous: true },
    expectedEnvironmentSha256: HASH_A,
    officialEventLogId: 'official-log-ac01',
    hashes: { weather: HASH_B, elevation: HASH_B, symbols: HASH_B, agents: HASH_B, eventLibrary: HASH_B, models: HASH_B, roles: HASH_B, communications: HASH_B, documents: HASH_B, rehearsal: HASH_C },
    sealedAt: start,
  };
}

it('фиксирует сценарий и изолированные сеансы на сервере', async () => {
  const service = new SealingService();
  const sealed = await service.seal(sealInput());
  expect(sealed.state).toBe('SEALED');
  expect(sealed.hashes.initialMap).toBe(sealed.initialMap.sha256);
  const first = await service.start(sealed.id, { instanceId: 'i1', idempotencyKey: 'start-1', seed: 'seed-1', actorRole: 'DIRECTOR', serverCommand: true });
  const repeated = await service.start(sealed.id, { instanceId: 'i1', idempotencyKey: 'start-1', seed: 'seed-1', actorRole: 'DIRECTOR', serverCommand: true });
  const other = await service.start(sealed.id, { instanceId: 'i2', idempotencyKey: 'start-2', seed: 'seed-2', actorRole: 'DIRECTOR', serverCommand: true });
  expect(repeated.id).toBe(first.id);
  expect(other.id).not.toBe(first.id);
  expect(other.eventLogId).not.toBe(first.eventLogId);
});

it('отдаёт фиксацию и старт через HTTP без клиентского reducer', async () => {
  const sealing = new SealingService();
  const router = new (await import('@def-ops/service-kit')).Router();
  registerSealingRoutes(router, sealing);
  const service = createService({ name: 'sealing-test', port: 0, router });
  const port = await service.listen();
  try {
    const sealedResponse = await fetch(`http://127.0.0.1:${port}/kshvi/sealing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sealInput()) });
    expect(sealedResponse.status).toBe(200);
    const sealed = await sealedResponse.json() as { id: string };
    const started = await fetch(`http://127.0.0.1:${port}/kshvi/sealing/${sealed.id}/instances`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: 'i1', idempotencyKey: 'start-http', seed: 'seed-http', actorRole: 'DIRECTOR', serverCommand: true }) });
    expect(started.status).toBe(200);
    expect((await started.json()).state).toBe('ACTIVE');
  } finally {
    await service.close();
  }
});
