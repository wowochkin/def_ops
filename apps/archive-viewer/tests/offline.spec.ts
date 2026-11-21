import { test, expect } from 'playwright/test';
import { exportArchive } from '../../../services/kshvi/src/archive/archive-exporter';
import { buildOfflineViewer } from '../../../services/kshvi/src/archive/offline-viewer-builder';
import { archiveVersions, completeComponents } from '../../../packages/kshvi/tests/fixtures/archive-fixture';

test('открывается без сети и восстанавливает сохранённые кадры', async ({ page }) => {
  const archive = exportArchive({
    actor: { organizationId: 'org-1', authorities: ['archive.export'] }, organizationId: 'org-1', archiveId: 'offline-1', kind: 'OFFICIAL',
    createdAt: '2026-11-21T12:00:00.000Z', versions: archiveVersions, components: completeComponents(),
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
