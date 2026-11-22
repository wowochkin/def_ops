import { test, expect } from 'playwright/test';
import { exportArchive, serializeArchive } from '../../../services/kshvi/src/archive/archive-exporter';
import { buildOfflineViewer } from '../../../services/kshvi/src/archive/offline-viewer-builder';
import { archiveVersions, completeComponents, fullArchiveExportPolicy } from '../../../packages/kshvi/tests/fixtures/archive-fixture';

test('открывается без сети и восстанавливает сохранённые кадры', async ({ page }) => {
  const archive = exportArchive({
    actor: { organizationId: 'org-1', userId: 'offline-exporter', authorities: ['archive.export'] }, organizationId: 'org-1', archiveId: 'offline-1', kind: 'OFFICIAL',
    createdAt: '2026-11-21T12:00:00.000Z', versions: archiveVersions, components: completeComponents(), exportPolicy: fullArchiveExportPolicy,
    atlasLicense: { offlineExport: true, attribution: 'Локальный атлас' },
  });
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.route('**/*', route => route.abort());
  await page.setContent(buildOfflineViewer(archive), { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Автономный реплей КШВИ' })).toBeVisible();
  await expect(page.getByTestId('offline-frame')).toHaveAttribute('data-sequence', '0');
  await page.getByLabel('Позиция автономного реплея').fill('3');
  await expect(page.getByTestId('offline-frame')).toHaveAttribute('data-sequence', '3');
  await expect(page.getByTestId('offline-hash')).not.toHaveText('Нет данных');
  expect(requests.filter(url => /^https?:/.test(url))).toEqual([]);
});


test('сгенерированный viewer отклоняет изменённый после сборки журнал', async ({ page }) => {
  const archive = exportArchive({
    actor: { organizationId: 'org-1', userId: 'offline-exporter', authorities: ['archive.export'] }, organizationId: 'org-1', archiveId: 'offline-1', kind: 'OFFICIAL',
    createdAt: '2026-11-21T12:00:00.000Z', versions: archiveVersions, components: completeComponents(), exportPolicy: fullArchiveExportPolicy,
    atlasLicense: { offlineExport: true, attribution: 'Локальный атлас' },
  });
  const original = JSON.parse(serializeArchive(archive)).files['replay/archive.json'] as string;
  const changed = Buffer.from('{"events":[],"snapshots":[]}').toString('base64');
  const html = buildOfflineViewer(archive).replace(original, changed);
  await page.setContent(html, { waitUntil: 'load' });
  await expect(page.locator('#archive-error')).toContainText('Архив повреждён');
  await expect(page.locator('#offline-frame')).toBeHidden();
});
