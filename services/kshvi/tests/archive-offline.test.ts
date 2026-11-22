import { expect, it } from 'vitest';
import { completeComponents, archiveVersions, fullArchiveExportPolicy } from '../../../packages/kshvi/tests/fixtures/archive-fixture';
import { exportArchive } from '../src/archive/archive-exporter';
import { buildOfflineViewer } from '../src/archive/offline-viewer-builder';

it('содержит локальный движок и ресурсы без исходных сервисов, Интернета и TTF', () => {
  const archive = exportArchive({
    actor: { organizationId: 'org-1', userId: 'offline-exporter', authorities: ['archive.export'] }, organizationId: 'org-1', archiveId: 'offline-1', kind: 'OFFICIAL',
    createdAt: '2026-11-21T12:00:00.000Z', versions: archiveVersions, components: completeComponents(), exportPolicy: fullArchiveExportPolicy,
    atlasLicense: { offlineExport: true, attribution: 'Локальный атлас' },
  });
  const html = buildOfflineViewer(archive);
  expect(html).toContain('Автономный реплей КШВИ');
  expect(html).toContain('recordedReplayAt');
  expect(html).toContain('application/json');
  expect(html).not.toMatch(/https?:\/\//i);
  expect(html).not.toMatch(/fetch\s*\(|XMLHttpRequest|EventSource|WebSocket/);
  expect(html).not.toMatch(/\.ttf|@font-face/i);
  expect(html).toContain('system-ui');
});
