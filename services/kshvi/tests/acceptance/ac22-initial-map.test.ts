import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createService, Router } from '@def-ops/service-kit';
import { expect, it } from 'vitest';
import {
  addInitialMapMarker, createInitialSituationMap, importInitialMap, initialMapCanonicalJson, initialMapHash,
  projectInitialMap, validateInitialMap, type InitialSituationMap, type MapMarker,
} from '../../../../packages/kshvi/src/scenario/initial-map';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { createAutonomousArchive, createInitialWorld, sealScenario } from '../../../../packages/kshvi/src/scenario/sealing';
import { READINESS_AREAS, type JsonValue } from '../../../../packages/kshvi/src';
import type { EnvironmentSnapshot } from '../../../../packages/kshvi/src/environment/provider';
import { initialMapAudiences } from '../../../../apps/editor/src/modern/kshvi/preparation/initial-map-audiences';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { registerExerciseRoutes } from '../../src/http/exercise-routes';
import { InMemoryExerciseEvidenceService } from '../../src/store/exercise-evidence-service';
import { InMemoryExerciseStore, type ExerciseSealActor } from '../../src/store/exercise-store';
import { approveExercise, linkedExercisePayload, SEAL_HASH_A, SEAL_HASH_B } from '../helpers/full-seal';
import { rehearsalProfile } from '../helpers/rehearsal-profile';

const start = '2030-01-01T06:00:00+03:00';
const end = '2030-01-02T06:00:00+03:00';
const director: ExerciseSealActor = { organizationId: 'org-ac22', userId: 'director-ac22', activeRole: 'DIRECTOR', authorities: ['scenario.seal'] };
const bounds = [0, 0, 1, 1] as const;
let environment = {
  schemaVersion: 1, id: SEAL_HASH_A, manifestSha256: SEAL_HASH_A, region: { name: 'Область AC-22', bounds },
  atlases: [{
    meta: { id: 'atlas-ac22', bounds, attribution: 'Учебный атлас' }, id: 'atlas-ac22', sha256: SEAL_HASH_B,
    attribution: 'Учебный атлас', license: 'Учебная лицензия', exportRights: 'ALLOWED',
    style: { contentRef: { path: `content/${SEAL_HASH_B}.json`, sha256: SEAL_HASH_B, bytes: 2 }, sha256: SEAL_HASH_B },
    export: { contentRef: { path: `content/${SEAL_HASH_B}.mbtiles`, sha256: SEAL_HASH_B, bytes: 2 }, sha256: SEAL_HASH_B },
    elevations: { contentRef: { path: `content/${SEAL_HASH_B}.json`, sha256: SEAL_HASH_B, bytes: 2 }, sha256: SEAL_HASH_B },
  }], resources: [],
  weather: { mode: 'scenario', contentRef: { path: `content/${SEAL_HASH_B}.json`, sha256: SEAL_HASH_B, bytes: 2 }, sourceId: 'scenario', attribution: 'Сценарная погода', license: 'Учебная лицензия' },
  elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 }, autonomy: 'COMPLETE', limitations: [],
} as unknown as EnvironmentSnapshot;

function marker(id: string, sideId = 'blue', instanceId = 'blue-hq'): MapMarker {
  return {
    id, revision: 1, kind: 'FORCE', layerId: 'TRUE_FORCES', truth: 'TRUTH',
    geometry: { type: 'Point', coordinates: [0.2, 0.2] }, sourceId: `source-${id}`, authorId: 'author-ac22', eventId: `event-${id}`,
    validFrom: start, validUntil: end, state: 'OBSERVED', confidence: 0.8,
    uncertainty: { radiusM: 20, note: 'Исходное наблюдение' }, visibility: { sideIds: [sideId], instanceIds: [instanceId] },
    links: { forceId: `force-${sideId}` }, sideId,
    symbol: { id: 'infantry', version: 'v1', sideId, status: 'APPROVED', sourceDocument: 'signs.doc', sourcePage: 12 },
  };
}
function feature(item: MapMarker) {
  const { geometry, ...properties } = item;
  return { type: 'Feature' as const, geometry, properties };
}

it('AC-22: карта исправляется, утверждается сервером и без утечек входит в SEALED и автономный архив', { timeout: 120_000 }, async () => {
  const uiOutput = execFileSync('npx', ['vitest', 'run', 'apps/editor/tests/kshvi-initial-map-audiences.test.ts', 'apps/editor/tests/kshvi-initial-map.test.tsx'], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  expect(uiOutput).toContain('13 passed');

  const blue = marker('blue-force');
  const secretRed = { ...marker('secret-red', 'red', 'red-hq'), geometry: { type: 'Point', coordinates: [0.8, 0.8] } as const };
  const reportedRed: MapMarker = {
    ...marker('reported-red', 'red', 'blue-hq'), truth: 'PRIVATE', layerId: 'OBSERVATIONS', state: 'ASSUMED',
    geometry: { type: 'Point', coordinates: [0.7, 0.7] }, visibility: { sideIds: ['blue'], instanceIds: ['blue-hq'] },
  };
  const commandPost: MapMarker = { ...marker('blue-command'), kind: 'COMMAND_POST' };
  const logistics: MapMarker = { ...marker('blue-logistics'), kind: 'LOGISTICS', layerId: 'RESOURCES' };
  const route: MapMarker = {
    ...marker('route-blue'), kind: 'ROUTE', layerId: 'RESOURCES',
    geometry: { type: 'LineString', coordinates: [[0.2, 0.2], [0.4, 0.4]] },
    links: { linkedMarkerIds: ['blue-force'] }, loadTonnes: 30, crossingCapacityTonnes: 40, passable: true,
  };
  const crossing: MapMarker = { ...marker('crossing-blue'), kind: 'CROSSING', layerId: 'RESOURCES', crossingCapacityTonnes: 40 };
  const column: MapMarker = { ...marker('column-blue'), kind: 'COLUMN', layerId: 'RESOURCES', routeId: 'route-blue' };
  const obstacle: MapMarker = { ...marker('obstacle-blue'), kind: 'OBSTACLE', layerId: 'EVENTS', passable: true };
  const area: MapMarker = {
    ...marker('area-blue'), kind: 'AREA', layerId: 'REFERENCE',
    geometry: { type: 'Polygon', coordinates: [[[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.1]]] },
  };
  const markers = [blue, secretRed, reportedRed, commandPost, logistics, route, crossing, column, obstacle, area];
  const invalid = [
    { ...marker('outside'), geometry: { type: 'Point', coordinates: [2, 2] } as const },
    { ...marker('unknown-position'), geometry: null },
    { ...marker('overloaded-route'), kind: 'ROUTE' as const, loadTonnes: 42, crossingCapacityTonnes: 40 },
    { ...marker('wrong-time'), validFrom: end, validUntil: start },
    { ...marker('wrong-symbol'), symbol: { ...blue.symbol, sideId: 'red' } },
  ];
  const invalidCodes = validateInitialMap({ bounds, markers: invalid }).map(issue => issue.code);
  expect(invalidCodes).toEqual(expect.arrayContaining(['OUTSIDE_BOUNDS', 'POSITION_UNKNOWN', 'CROSSING_OVERLOAD', 'TIME_CONTRADICTORY', 'SYMBOL_SIDE_MISMATCH']));
  expect(JSON.stringify(invalid)).not.toContain('"coordinates":[0,0]');

  const imported = importInitialMap({ type: 'FeatureCollection', features: markers.map(feature) }, { bounds });
  expect(imported.issues).toEqual([]);
  const environmentReference = { snapshotId: SEAL_HASH_A, manifestSha256: SEAL_HASH_A, bounds };
  let map = createInitialSituationMap({
    id: 'map-ac22', revision: 1, environment: environmentReference,
    initialOperationalAt: start, timeZone: 'Europe/Moscow', weatherFrameRef: 'weather-ac22', terrainStateRef: 'terrain-ac22',
    symbolSet: { id: 'modern-signs', revision: 1, sha256: SEAL_HASH_B }, attribution: ['OSM', 'Учебный атлас'],
  });
  for (const item of imported.markers) map = addInitialMapMarker(map, item);
  expect(validateInitialMap(map).filter(issue => issue.severity === 'ERROR')).toEqual([]);
  const audiences = initialMapAudiences(map.markers);
  expect(audiences).toEqual(expect.arrayContaining([
    { sideId: 'blue', instanceId: 'blue-hq', role: 'TRAINEE', label: 'Штаб blue · blue-hq' },
    { sideId: 'red', instanceId: 'red-hq', role: 'TRAINEE', label: 'Штаб red · red-hq' },
  ]));
  const blueProjection = projectInitialMap(map, { mode: 'INSTANCE', sideId: 'blue', instanceId: 'blue-hq', role: 'TRAINEE' });
  const redProjection = projectInitialMap(map, { mode: 'INSTANCE', sideId: 'red', instanceId: 'red-hq', role: 'TRAINEE' });
  const truthProjection = projectInitialMap(map, { mode: 'TRUTH', role: 'DIRECTOR' });
  expect(blueProjection.markers.map(item => item.id)).toContain('reported-red');
  expect(JSON.stringify(blueProjection)).not.toContain('secret-red');
  expect(JSON.stringify(blueProjection)).not.toContain('0.8,0.8');
  expect(redProjection.markers.map(item => item.id)).toEqual(['secret-red']);
  expect(JSON.stringify(redProjection)).not.toContain('blue-force');
  expect(truthProjection.markers).toHaveLength(markers.length);
  expect(initialMapCanonicalJson(blueProjection)).toBe(initialMapCanonicalJson(projectInitialMap(map, { mode: 'INSTANCE', sideId: 'blue', instanceId: 'blue-hq', role: 'TRAINEE' })));

  const evidence = new InMemoryExerciseEvidenceService({ environment: { load: async () => environment }, now: () => new Date('2030-01-01T03:00:00Z') });
  const store = new InMemoryExerciseStore({ evidence, now: () => new Date('2030-01-01T03:00:00Z') });
  const created = await store.create(director, { title: 'AC-22', purpose: 'planned', scale: 'operational', payload: linkedExercisePayload() });
  const rawMap = JSON.parse(JSON.stringify({ ...map, state: 'DRAFT', sha256: undefined })) as InitialSituationMap;
  const card = await store.createRevision(director, created.id, {
    expectedRevision: 1,
    payload: linkedExercisePayload({ initialMap: rawMap as unknown as JsonValue, environmentSnapshotId: SEAL_HASH_A, rehearsalProfile: rehearsalProfile() as unknown as JsonValue }),
  });
  await approveExercise(store, director, card, 2);

  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await sessions.createAccount({
    userId: director.userId, username: 'director-ac22', password: 'secret123', organizationId: director.organizationId,
    roles: [{ id: 'map-approver', role: 'APPROVER', sideId: null, authorities: ['initialMap.approve'] }],
  });
  const login = await sessions.login('director-ac22', 'secret123');
  await sessions.selectRole(login.token, 'map-approver');
  const router = new Router();
  registerExerciseRoutes(router, { store, sessions, evidence });
  const service = createService({ name: 'kshvi-ac22', port: 0, router });
  const port = await service.listen();
  const callApproval = (value: InitialSituationMap) => fetch(`http://127.0.0.1:${port}/kshvi/exercises/${created.id}/map-approval`, {
    method: 'POST', headers: { Authorization: `Bearer ${login.token}`, 'X-CSRF-Token': login.csrfToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision: 2, map: value }),
  });
  let approvalBody: { sha256: string; state: string };
  try {
    const rejected = await callApproval({ ...rawMap, markers: [...rawMap.markers, invalid[0]] });
    expect(rejected.ok).toBe(false);
    expect(await evidence.approvedMap(card.revisions[1])).toBeNull();
    const approved = await callApproval(rawMap);
    expect(approved.status).toBe(200);
    approvalBody = await approved.json() as { sha256: string; state: string };
  } finally {
    await service.close();
  }
  expect(approvalBody!).toMatchObject({ state: 'APPROVED', sha256: initialMapHash(map) });
  for (const [index, area] of READINESS_AREAS.entries()) {
    await evidence.confirm(
      { ...director, userId: `responsible-ac22-${index}`, activeRole: 'RESPONSIBLE', authorities: ['readiness.confirm', `readiness.confirm:${area}`] },
      created.id, card.revisions[1], { expectedRevision: 2, area },
    );
  }
  const serverEvidence = await evidence.forRevision({ actor: director, exerciseId: created.id, revision: card.revisions[1] });
  const sealed = sealScenario({
    id: card.revisions[1].id, revision: 2, state: 'APPROVED', scenario: card.revisions[1].payload,
    requiredConfirmations: [...READINESS_AREAS], sealedAt: '2030-01-01T03:00:00Z', ...serverEvidence,
  });
  expect(sealed.hashes.initialMap).toBe(approvalBody!.sha256);
  const initialWorld = createInitialWorld(sealed);
  expect(initialWorld.initialMapSha256).toBe(approvalBody!.sha256);
  const archive = createAutonomousArchive(sealed);
  expect(archive.initialMap.sha256).toBe(approvalBody!.sha256);
  expect(archive.initialMap.layers).toEqual(map.layers);
  expect(JSON.parse(JSON.stringify(archive)).initialMap.markers).toHaveLength(markers.length);
  await store.seal(director, created.id, { expectedRevision: 2 });
  await expect(store.createSession(director, created.id, { revision: 2 })).resolves.toMatchObject({ state: 'ACTIVE' });

  environment = { ...environment, manifestSha256: SEAL_HASH_B };
  expect(map.environment.manifestSha256).toBe(SEAL_HASH_A);
  expect(archive.initialMap.environment.manifestSha256).toBe(SEAL_HASH_A);
  await expect(evidence.forRevision({ actor: director, exerciseId: created.id, revision: card.revisions[1] })).rejects.toThrow('ENVIRONMENT_HASH_INVALID');

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const directory = 'docs/release/kshvi/evidence/ac22';
  await mkdir(directory, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const initialRevision = { id: map.id, revision: map.revision, sha256: initialMapHash(map) };
  const journalPath = `${directory}/journal.json`;
  const mapPath = `${directory}/approved-map.json`;
  const archivePath = `${directory}/autonomous-archive.json`;
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const journal = JSON.parse(JSON.stringify({
    runId, commit, uiOutput, invalidCodes, imported: imported.markers.map(item => item.id),
    audiences, blueProjection, redProjection, serverApproval: approvalBody,
    sealed: { hashes: sealed.hashes, rehearsalSha256: sealed.rehearsalSha256 }, initialWorld, archiveSha256: archive.sha256,
    environmentChangeRejected: 'ENVIRONMENT_HASH_INVALID',
  }));
  const journalSha256 = hashCanonical(journal);
  const metrics = {
    importedMarkers: imported.markers.length, validationErrorTypes: new Set(invalidCodes).size,
    blueProjectionMarkers: blueProjection.markers.length, redProjectionMarkers: redProjection.markers.length,
    hiddenTruthMarkers: 1, serverApprovals: 1, sealedHashMatches: 1, archiveHashMatches: 1,
  };
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(mapPath, JSON.stringify(archive.initialMap, null, 2));
  await writeFile(archivePath, JSON.stringify(archive, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-22 завершён\nrunId: ${runId}\ncommit: ${commit}\nОшибки координат, моста, времени и знака показаны; GeoJSON и ручные слои прошли; сервер отклонил невалидную карту; проекции разделены; хеш совпал в SEALED, начальном мире и архиве.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-22.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: journalPath, sha256: journalSha256, eventCount: imported.markers.length },
    hashes: { scenario: initialRevision.sha256, environment: SEAL_HASH_A, journal: journalSha256 },
    protocols: [protocolPath], screenshots: [], metrics,
    limitations: ['Серверный контур проверен через HTTP и полный seal; физическая сверка печатной формы и проекторов выполняется на контрольном стенде.'],
    artifacts: [journalPath, mapPath, archivePath, protocolPath, metricsPath],
  }, null, 2));
});
