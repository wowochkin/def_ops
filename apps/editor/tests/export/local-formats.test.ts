import JSZip from 'jszip';
import { afterEach, expect, it, vi } from 'vitest';
import type { DocumentRevision } from '../../../../packages/kshvi/src/documents/document';
import { exportDocumentSet, verifyExportSet } from '../../../../packages/kshvi/src/documents/export-set';
import { makeArchiveBundle } from '../../../../packages/kshvi/tests/fixtures/archive-fixture';
import { deserializeArchive, serializeArchive } from '../../../../services/kshvi/src/archive/archive-exporter';
import { verifyArchive } from '../../../../services/kshvi/src/archive/integrity-check';

afterEach(() => vi.unstubAllGlobals());

const revision: DocumentRevision = {
  id: 'order-1:r2', documentId: 'order-1', revision: 2, state: 'APPROVED',
  requisites: {
    exerciseId: 'exercise-1', scenarioRevisionId: 'scenario-3', instanceId: 'hq', authorId: 'author-1', category: 'OPERATIONAL', type: 'ORDER',
    title: 'Приказ на действия', number: '15', operationalAt: '2030-01-01T06:00:00+03:00', place: 'Пункт управления',
    validFrom: '2030-01-01T06:00:00+03:00', validUntil: '2030-01-02T06:00:00+03:00', stageId: 'stage-1', sideId: 'blue',
    visibility: { sideIds: ['blue'], instanceIds: [], roles: [] }, addressees: [{ instanceId: 'unit-1', channelId: 'radio-1' }], copies: [],
    sourceRole: 'COMMANDER', deliveryChannelId: 'radio-1', basis: 'Замысел учения', executorId: 'unit-1', deadlineAt: '2030-01-01T08:00:00+03:00',
    linkedEventIds: [], linkedDecisionIds: [], linkedTaskIds: [], templateVersion: 'order:v1',
  },
  content: { body: 'Перейти рубеж «Северный».', units: { distance: 'км', duration: 'мин' } },
  map: { environmentSnapshotId: 'environment-1', legend: ['Синяя рамка — свои силы'], attribution: ['Учебный атлас'], visibility: { sideIds: ['blue'], instanceIds: [], roles: [] } },
  attachments: [], approvalRouteId: 'route-1', sha256: 'a'.repeat(64), supersedes: null, supersedesRevision: null, supersedeReason: null,
  signatures: [], delivery: { state: 'NOT_ISSUED', facts: [] },
};

it('формирует и открывает PDF, DOCX и JSON локально со всеми реквизитами', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const result = await exportDocumentSet(revision, { exerciseTitle: 'Учение «Взаимодействие»', exerciseRevision: 7, exportedAt: '2030-01-01T07:00:00.000Z' });
  expect(new TextDecoder().decode(result.pdf.slice(0, 8))).toBe('%PDF-1.3');
  const zip = await JSZip.loadAsync(result.docx);
  const document = await zip.file('word/document.xml')?.async('string');
  const footer = await zip.file('word/footer1.xml')?.async('string');
  expect(document).toContain('Приказ на действия');
  expect(document).toContain('Синяя рамка — свои силы');
  expect(document).toContain('Учебный атлас');
  expect(document).toContain('distance=км');
  expect(footer).toContain('NUMPAGES');
  const json = JSON.parse(result.json) as typeof result.model;
  expect(json).toMatchObject({ schemaVersion: 1, pageNumbering: 'decimal', source: { revision: 2 }, document: { units: { distance: 'км' } } });
  expect(json.legend).toEqual(['Синяя рамка — свои силы']);
  expect(json.attribution).toEqual(['Учебный атлас']);
  await expect(verifyExportSet(result)).resolves.toEqual({ valid: true, issues: [] });
  expect(fetchMock).not.toHaveBeenCalled();
});

it('открывает автономный архивный пакет без внешних ресурсов и сохраняет хеши', () => {
  const archive = makeArchiveBundle();
  expect(verifyArchive(archive)).toMatchObject({ valid: true, autonomous: true, mode: 'AUTONOMOUS' });
  const restored = deserializeArchive(serializeArchive(archive));
  expect(restored.manifest.manifestSha256).toBe(archive.manifest.manifestSha256);
  expect(verifyArchive(restored)).toMatchObject({ valid: true, autonomous: true });
});
