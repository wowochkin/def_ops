import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { afterEach, expect, it } from 'vitest';
import { completeComponents, archiveVersions } from '../../../../packages/kshvi/tests/fixtures/archive-fixture';
import { fullArchivePolicyAdapter } from '../helpers/archive-policy';
import { exportArchive } from '../../src/archive/archive-exporter';
import { buildOfflineViewer } from '../../src/archive/offline-viewer-builder';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

it('AC-12: автономный архив проверяется и воспроизводится в браузере без сервисов и сети', { timeout: 60_000 }, async () => {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(join('.tmp', 'ac12-offline-'));
  roots.push(root);
  const bundle = exportArchive({
    actor: { organizationId: 'org-1', userId: 'offline-exporter', authorities: ['archive.export'] }, organizationId: 'org-1', archiveId: 'offline-ac12', kind: 'OFFICIAL',
    createdAt: '2026-11-21T12:00:00.000Z', versions: archiveVersions, components: completeComponents(), policyAdapter: fullArchivePolicyAdapter,
    atlasLicense: { offlineExport: true, attribution: 'Локальный атлас' },
  });
  const html = buildOfflineViewer(bundle);
  const viewerPath = join(root, 'viewer.html');
  await writeFile(viewerPath, html);
  await mkdir('docs/release/kshvi/evidence/ac12', { recursive: true });
  await writeFile('docs/release/kshvi/evidence/ac12/offline-viewer.html', html);
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const network: string[] = [];
  let firstHash = '';
  let secondHash = '';
  let sequence = '';
  try {
    const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 900 } });
    await context.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith('file://')) { network.push(url); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(viewerPath).href);
    expect(await page.getByRole('status').textContent()).toContain('Автономное воспроизведение: проверено');
    expect(await page.locator('#archive-error').textContent()).toBe('');
    firstHash = await page.locator('#offline-hash').textContent() ?? '';
    expect(firstHash).toMatch(/^[0-9a-f]{64}$/);
    await page.locator('#replay-position').evaluate((element: HTMLInputElement) => { element.value = '1'; element.dispatchEvent(new Event('input', { bubbles: true })); });
    sequence = await page.locator('#offline-frame').getAttribute('data-sequence') ?? '';
    secondHash = await page.locator('#offline-hash').textContent() ?? '';
    expect(sequence).toBe('1');
    expect(secondHash).toMatch(/^[0-9a-f]{64}$/);
    expect(secondHash).not.toBe(firstHash);
    expect(network).toEqual([]);
    await mkdir('docs/release/kshvi/evidence/ac12', { recursive: true });
    await page.screenshot({ path: 'docs/release/kshvi/evidence/ac12/offline.png' });
  } finally {
    await browser.close();
  }

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const initialRevision = { id: bundle.manifest.archiveId, revision: 1, sha256: bundle.manifest.manifestSha256 };
  const journalPath = 'docs/release/kshvi/evidence/ac12/offline-journal.json';
  const protocolPath = 'docs/release/kshvi/evidence/ac12/protocol.txt';
  const metricsPath = 'docs/release/kshvi/evidence/ac12/metrics.json';
  const metrics = { networkRequestsOutsideFile: network.length, firstSequence: 0, secondSequence: Number(sequence), hashChanged: firstHash !== secondHash ? 1 : 0 };
  await writeFile(journalPath, JSON.stringify({ runId, commit, archiveId: bundle.manifest.archiveId, manifestSha256: bundle.manifest.manifestSha256, sequence, firstHash, secondHash, network }, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-12 завершён\nrunId: ${runId}\ncommit: ${commit}\nКонтекст браузера offline; внешних запросов нет; манифест проверен; кадр 1 воспроизводится с новым SHA-256.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-12.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: journalPath, sha256: hashCanonical({ firstHash, secondHash, sequence }), eventCount: 2 },
    hashes: { scenario: initialRevision.sha256, environment: bundle.manifest.manifestSha256, journal: hashCanonical({ firstHash, secondHash, sequence }) },
    protocols: [protocolPath], screenshots: ['docs/release/kshvi/evidence/ac12/offline.png'], metrics,
    limitations: ['Автономность доказана на встроенной учебной реплей-фикстуре; человеческая оценка содержания разбора выполняется отдельно.'],
    artifacts: [journalPath, protocolPath, metricsPath, 'docs/release/kshvi/evidence/ac12/offline.png', 'docs/release/kshvi/evidence/ac12/offline-viewer.html'],
  }, null, 2));
});
