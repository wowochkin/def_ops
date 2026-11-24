import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { coverageReport, sourceRegistry, verifyArchive, verifyDerivedFiles } from '../../../../packages/tactical-symbols/src/source/index';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';

it('AC-30: технические проверки знаков выполнены, но методическое утверждение и пообъектная сверка остаются блокерами', { timeout: 120_000 }, async () => {
  const output = execFileSync('npx', ['vitest', 'run', 'packages/tactical-symbols/tests'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  expect(output).toContain('Test Files');
  const archivePath = 'packages/tactical-symbols/source/TacticalSignsRussianForces.zip';
  const archiveSha256 = await verifyArchive(archivePath);
  expect(archiveSha256).toBe('123731284d4fd3ed3c3963afe457f1cf3cdb34db500a38cdc33451ca2ddc6331');
  const coverage = coverageReport();
  expect(coverage).toMatchObject({ documents: 29, fonts: 2, status: 'PARTIAL', missingDocuments: [], uncoveredTopics: [] });
  expect(sourceRegistry.fragments.every(fragment => fragment.status === 'IMPORTED')).toBe(true);
  const derived = await verifyDerivedFiles();
  expect(derived.checked).toBe(sourceRegistry.fragments.length);

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const directory = 'docs/release/kshvi/evidence/ac30';
  await mkdir(directory, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const journalPath = `${directory}/journal.json`;
  const coveragePath = `${directory}/source-coverage.json`;
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const journal = { runId, commit, output, archiveSha256, coverage, derived };
  const journalSha256 = hashCanonical(journal);
  const metrics = {
    sourceDocuments: coverage.documents, sourceFonts: coverage.fonts, derivedFragmentsChecked: derived.checked,
    importedFragmentsAwaitingReview: sourceRegistry.fragments.length, automaticallyApprovedSymbols: 0,
    humanMethodicalApprovals: 0,
  };
  const limitations = [
    'HUMAN_METHODICAL_APPROVAL_REQUIRED: руководитель и методист должны проверить содержание, объяснения, печатные формы и разбор.',
    'SOURCE_FRAGMENTS_NOT_INDIVIDUALLY_APPROVED: исходные фрагменты имеют IMPORTED, покрытие PARTIAL; APPROVED автоматически не присваивается.',
  ];
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(coveragePath, JSON.stringify({ archiveSha256, coverage, fragments: sourceRegistry.fragments }, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-30 заблокирован\nrunId: ${runId}\ncommit: ${commit}\nSHA-256 исходного архива совпал; 29 DOC и 2 TTF учтены; производные файлы проверены; TTF не нужны для отрисовки. Пообъектная сверка и человеческое методическое утверждение не выполнены.\n`);
  const artifacts = [journalPath, coveragePath, protocolPath, metricsPath, 'docs/img/modern-symbols.jpg', 'docs/img/modern-symbols-documents.jpg'];
  await writeFile('docs/release/kshvi/acceptance/AC-30.proof.json', JSON.stringify({
    runId, commit, status: 'blocked',
    initialRevision: { id: 'TacticalSignsRussianForces', revision: 1, sha256: archiveSha256 },
    journal: { path: journalPath, sha256: journalSha256, eventCount: derived.checked },
    hashes: { scenario: archiveSha256, environment: archiveSha256, journal: journalSha256 },
    protocols: [protocolPath], screenshots: ['docs/img/modern-symbols.jpg', 'docs/img/modern-symbols-documents.jpg'],
    metrics, limitations, artifacts,
  }, null, 2));
  await writeFile('docs/release/kshvi/acceptance/AC-30.json', JSON.stringify({
    schemaVersion: 1, id: 'AC-30', status: 'blocked', commit, runId,
    command: 'KSHVI_ACCEPTANCE_RUN_ID=ac30-human-review npx vitest run services/kshvi/tests/acceptance/ac30-symbols.test.ts',
    output, metrics, limitations, artifacts, openErrors: limitations,
  }, null, 2));
});
