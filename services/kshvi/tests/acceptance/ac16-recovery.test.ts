import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';

it('AC-16: аварийный перезапуск и изолированное восстановление сохраняют журнал без дублей', { timeout: 120_000 }, async () => {
  const directory = 'docs/release/kshvi/evidence/ac16';
  await mkdir(directory, { recursive: true });
  const drillPath = `${directory}/recovery-drill.json`;
  const output = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/kshvi-disaster-drill.mjs', '--output', drillPath], {
    encoding: 'utf8', env: { ...process.env, TEST_DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://vladimirabramov@127.0.0.1:5432/postgres' }, maxBuffer: 4 * 1024 * 1024,
  });
  const report = JSON.parse(output) as {
    status: string; confirmedEvents: number; duplicateEventsAfterRetry: number; confirmedEventsLost: number;
    restartMs: number; restartTargetMs: number; nodeRestoreMs: number; nodeRestoreTargetMs: number;
    verifiedBackupFiles: number; isolatedRestore: boolean; divergence: { allowed: boolean; requiredReport: string; preservedSequence: number };
    limitations: string[];
  };
  expect(report.status).toBe('passed');
  expect(report.confirmedEvents).toBe(1);
  expect(report.duplicateEventsAfterRetry).toBe(0);
  expect(report.confirmedEventsLost).toBe(0);
  expect(report.restartMs).toBeLessThanOrEqual(report.restartTargetMs);
  expect(report.nodeRestoreMs).toBeLessThanOrEqual(report.nodeRestoreTargetMs);
  expect(report.verifiedBackupFiles).toBe(5);
  expect(report.isolatedRestore).toBe(true);
  expect(report.divergence).toMatchObject({ allowed: false, requiredReport: 'DIVERGENCE', preservedSequence: 140 });
  expect(JSON.parse(await readFile(drillPath, 'utf8')).status).toBe('passed');

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const initialRevision = { id: 'ac16-recovery', revision: 1, sha256: hashCanonical(report) };
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const metrics = {
    confirmedEvents: report.confirmedEvents, duplicateEventsAfterRetry: report.duplicateEventsAfterRetry, confirmedEventsLost: report.confirmedEventsLost,
    restartMs: report.restartMs, nodeRestoreMs: report.nodeRestoreMs, verifiedBackupFiles: report.verifiedBackupFiles, isolatedRestore: report.isolatedRestore ? 1 : 0,
  };
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-16 завершён\nrunId: ${runId}\ncommit: ${commit}\nRPO 0; перезапуск и восстановление уложились в цели; старая копия не затирает поздний журнал; worker не повторил эффект.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-16.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: drillPath, sha256: hashCanonical(report), eventCount: report.confirmedEvents },
    hashes: { scenario: initialRevision.sha256, environment: hashCanonical({ verifiedBackupFiles: report.verifiedBackupFiles }), journal: hashCanonical(report) },
    protocols: [protocolPath], screenshots: [], metrics, limitations: report.limitations,
    artifacts: [drillPath, protocolPath, metricsPath],
  }, null, 2));
});
