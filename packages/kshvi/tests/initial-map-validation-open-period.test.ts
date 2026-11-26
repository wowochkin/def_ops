import { expect, it } from 'vitest';
import { validateInitialMap } from '../src/scenario/initial-map-validation';
import { createInitialSituationMap } from '../src/scenario/initial-map';
import { emptyPreparationDraft, validatePreparationDraft } from '../src/scenario/preparation-draft';

it('принимает открытый срок и необязательные связь и неопределённость', () => {
  const issues = validateInitialMap({ bounds: [0, 0, 1, 1], markers: [{
    id: 'manual-object', revision: 1, kind: 'TASK', layerId: 'REFERENCE', truth: 'PRIVATE',
    geometry: { type: 'Point', coordinates: [0.5, 0.5] },
    sourceId: 'manual:initial-situation', authorId: 'author', eventId: 'manual:initial-situation',
    validFrom: '2030-01-01T00:00:00Z', validUntil: '', state: 'UNKNOWN', confidence: null,
    uncertainty: { radiusM: null, note: '' }, visibility: { staffOnly: true }, links: {}, sideId: 'blue',
    symbol: { id: 'symbol', version: 'v1', sideId: 'blue', status: 'APPROVED', sourceDocument: 'test', sourcePage: 1 },
  }] });
  for (const code of ['TIME_REQUIRED', 'LINK_REQUIRED', 'UNCERTAINTY_REQUIRED', 'CONFIDENCE_REQUIRED']) {
    expect(issues.map(issue => issue.code)).not.toContain(code);
  }
});

it('сохраняет объект с открытым сроком в серверном черновике подготовки', () => {
  const at = '2030-01-01T00:00:00Z';
  const map = createInitialSituationMap({ id: 'open-period-map', revision: 1,
    environment: { snapshotId: 'snapshot', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
    initialOperationalAt: at, timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: 'symbols', revision: 1, sha256: 'b'.repeat(64) }, attribution: ['test'] });
  const marker = {
    id: 'manual-object', revision: 1, kind: 'TASK' as const, layerId: 'REFERENCE' as const, truth: 'PRIVATE' as const,
    geometry: { type: 'Point' as const, coordinates: [0.5, 0.5] as [number, number] },
    sourceId: 'manual:initial-situation', authorId: 'author', eventId: 'manual:initial-situation',
    validFrom: at, validUntil: '', state: 'UNKNOWN' as const, confidence: null,
    uncertainty: { radiusM: null, note: '' }, visibility: { staffOnly: true }, links: {}, sideId: 'blue',
    symbol: { id: 'symbol', version: 'v1', sideId: 'blue', status: 'APPROVED' as const, sourceDocument: 'test', sourcePage: 1 },
  };
  expect(() => validatePreparationDraft({ ...emptyPreparationDraft(at), environmentSnapshotId: 'snapshot',
    initialMap: { ...map, markers: [marker] }, initialMapStatus: 'MAPPED' })).not.toThrow();
});
