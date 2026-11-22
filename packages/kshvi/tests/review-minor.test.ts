import { expect, it } from 'vitest';
import { addInitialMapMarker, createInitialSituationMap, type MapMarker } from '../src/scenario/initial-map';
import { formationExecutionStatus, type FormationPlan } from '../src/forces/formation';

it('Minor: добавление отметки увеличивает ревизию исходной карты', () => {
  const map = createInitialSituationMap({
    id: 'map', revision: 1, environment: { snapshotId: 'env', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
    initialOperationalAt: '2030-01-01T00:00:00Z', timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: 'symbols', revision: 1, sha256: 'b'.repeat(64) }, attribution: [],
  });
  const marker: MapMarker = {
    id: 'marker', revision: 1, kind: 'FORCE', layerId: 'TRUE_FORCES', truth: 'TRUTH', geometry: { type: 'Point', coordinates: [0.5, 0.5] },
    sourceId: 'source', authorId: 'author', eventId: 'event', validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z',
    state: 'OBSERVED', confidence: 1, uncertainty: { radiusM: 0, note: '' }, visibility: { sideIds: ['blue'] }, links: { forceId: 'force-1' }, sideId: 'blue',
    symbol: { id: 'symbol', version: '1', sideId: 'blue', status: 'APPROVED', sourceDocument: 'source', sourcePage: 1 },
  };
  expect(addInitialMapMarker(map, marker).revision).toBe(2);
});

it('Minor: построение со всеми FAILED имеет итог FAILED', () => {
  const plan = { id: 'formation', echelons: [{ id: 'e1' }, { id: 'e2' }], reserves: [], supportGroups: [] } as unknown as FormationPlan;
  const result = formationExecutionStatus(plan, [
    { elementId: 'e1', stage: 'FAILED', route: null, reportIds: [] },
    { elementId: 'e2', stage: 'FAILED', route: null, reportIds: [] },
  ]);
  expect(result.status).toBe('FAILED');
});
