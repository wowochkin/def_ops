import { test, expect } from 'playwright/test';
import { resolve } from 'node:path';
import { completeComponents, makeArchiveBundle } from '../../../packages/kshvi/tests/fixtures/archive-fixture';
import { serializeArchive } from '../../../services/kshvi/src/archive/archive-exporter';

const base = process.env.ARCHIVE_VIEWER_BASE_URL ?? 'http://127.0.0.1:5174';
test.use({ viewport: { width: 1440, height: 900 } });

test('standalone проверяет валидный, изменённый и неполный пакеты без внешней сети', async ({ page }) => {
  const external: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(base)) external.push(request.url()); });
  await page.goto(base);
  const valid = serializeArchive(makeArchiveBundle());
  await page.locator('#archive-file').setInputFiles({ name: 'valid.json', mimeType: 'application/json', buffer: Buffer.from(valid) });
  await expect(page.locator('#archive-status')).toContainText('Манифест и SHA-256 проверены');
  await expect(page.locator('#viewer')).toBeVisible();
  await page.screenshot({ path: resolve('docs/img/modern-kshvi-archive-viewer.jpg'), type: 'jpeg', quality: 88, fullPage: false });

  const changed = JSON.parse(valid);
  changed.files['replay/archive.json'] = Buffer.from('{"events":[],"snapshots":[]}').toString('base64');
  await page.locator('#archive-file').setInputFiles({ name: 'changed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) });
  await expect(page.locator('#error')).toContainText('Архив повреждён');
  await expect(page.locator('#viewer')).toBeHidden();

  const components = completeComponents();
  delete components['environment.weather'];
  const limited = serializeArchive(makeArchiveBundle({ components }));
  await page.locator('#archive-file').setInputFiles({ name: 'limited.json', mimeType: 'application/json', buffer: Buffer.from(limited) });
  await expect(page.locator('#archive-status')).toContainText('Ограниченное исследование');
  await expect(page.locator('#viewer')).toBeVisible();
  expect(external).toEqual([]);
});
