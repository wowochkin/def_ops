import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { addInitialMapMarker, approveInitialMap, createInitialSituationMap, hashCanonical, READINESS_AREAS, REHEARSAL_CHECKS, type SealScenarioInput } from '@def-ops/kshvi';
import { SealingService } from '../../src/instances/sealing-service';

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

it('AC-01: подготовка и фиксация многоступенчатого учения с двумя независимыми сеансами', async () => {
  const service = new SealingService();
  const director = { userId: 'director', organizationId: 'org-1', activeRole: 'DIRECTOR', sideId: null, authorities: ['scenario.seal', 'instance.start'] };
  const sealed = await service.seal(sealInput(), director);
  const scenarioView = sealed.scenario as typeof scenario;
  expect(sealed.state).toBe('SEALED');
  expect(scenarioView.trainedLevels).toBe(3);
  expect(scenarioView.stages).toHaveLength(2);
  expect(scenarioView.mapZoom).toBe(8);
  expect(sealed.hashes.initialMap).toBe(sealed.initialMap.sha256);
  expect(sealed.environmentSnapshot.manifestSha256).toBe(HASH_A);
  expect(sealed.scenarioSha256).toBe(hashCanonical(scenario));
  expect(sealed.confirmations.map(confirmation => confirmation.area).sort()).toEqual([...READINESS_AREAS].sort());
  expect(sealed.rehearsal.status).toBe('PASSED');
  const first = await service.start(sealed.id, { instanceId: 'ac01-first', idempotencyKey: 'start-1', seed: 'seed-1', actorRole: 'DIRECTOR', serverCommand: true }, director);
  const repeated = await service.start(sealed.id, { instanceId: 'ac01-first', idempotencyKey: 'start-1', seed: 'seed-1', actorRole: 'DIRECTOR', serverCommand: true }, director);
  const second = await service.start(sealed.id, { instanceId: 'ac01-second', idempotencyKey: 'start-2', seed: 'seed-2', actorRole: 'DIRECTOR', serverCommand: true }, director);
  expect(repeated.id).toBe(first.id);
  expect(second.id).not.toBe(first.id);
  expect(second.eventLogId).not.toBe(first.eventLogId);
  expect(second.seed).not.toBe(first.seed);
  expect(first.scenarioSha256).toBe(second.scenarioSha256);
  expect(scenarioView.mapZoom).toBe(8);

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const directory = 'docs/release/kshvi/evidence/ac01';
  await mkdir(directory, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const journalPath = `${directory}/journal.json`;
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const journal = { runId, commit, sealed, sessions: { first, repeated, second } };
  const journalSha256 = hashCanonical(journal);
  const metrics = {
    sealedRevisions: 1, independentSessions: 2, repeatedSessionReused: repeated.id === first.id ? 1 : 0,
    readinessConfirmations: sealed.confirmations.length, rehearsalPassed: sealed.rehearsal.status === 'PASSED' ? 1 : 0,
  };
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-01 завершён\nrunId: ${runId}\ncommit: ${commit}\nМногоступенчатое учение запечатано; карта и среда связаны хешами; репетиция и персональные подтверждения проверены; два независимых сеанса созданы; повтор первого запуска идемпотентен.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-01.proof.json', JSON.stringify({
    runId, commit,
    initialRevision: { id: sealed.id, revision: sealed.revision, sha256: sealed.scenarioSha256 },
    journal: { path: journalPath, sha256: journalSha256, eventCount: 3 },
    hashes: { scenario: sealed.scenarioSha256, environment: sealed.environmentSnapshot.manifestSha256, journal: journalSha256 },
    protocols: [protocolPath], screenshots: [], metrics,
    limitations: ['Сценарная фиксация и независимость сеансов подтверждены; физическая чистая установка и распределённые рабочие места проверяются отдельно.'],
    artifacts: [journalPath, protocolPath, metricsPath],
  }, null, 2));
});
