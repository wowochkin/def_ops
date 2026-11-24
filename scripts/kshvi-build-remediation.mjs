import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const commit = ref => execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim();
const sha256 = async path => createHash('sha256').update(await readFile(resolve(path))).digest('hex');
const reviewLog = 'docs/release/kshvi/original-findings.md';
const reReviewLog = 'docs/release/kshvi/rereview.md';
const evidence = {
  schemaVersion: 1,
  status: 'implemented',
  baseCommit: commit('2e99ba0a'),
  reviewedRange: { from: commit('ccf69ac4'), to: commit('4be48c1d') },
  reviewLog,
  reviewLogSha256: await sha256(reviewLog),
  reReviewLog,
  reReviewLogSha256: await sha256(reReviewLog),
  items: [
    { id: 'REREVIEW-CRITICAL-01', severity: 'Critical', summary: 'Recovery grant только для технических метаданных', tests: ['services/kshvi/tests/accounts.test.ts'] },
    { id: 'REREVIEW-CRITICAL-02', severity: 'Critical', summary: 'Backup graph и журнальная целостность snapshot restore', tests: ['services/kshvi/tests/backup-graph-regression.test.ts', 'services/kshvi/tests/backup-regimen.test.ts'] },
    { id: 'REREVIEW-IMPORTANT-01', severity: 'Important', summary: 'Настоящие actor/org операционного аудита', tests: ['services/kshvi/tests/operations-audit.test.ts'] },
    { id: 'REREVIEW-IMPORTANT-02', severity: 'Important', summary: 'Идемпотентный эффект в crash-window worker', tests: ['services/kshvi/tests/worker-crash-window.test.ts', 'services/kshvi/tests/backup-regimen.test.ts'] },
    { id: 'REREVIEW-IMPORTANT-03', severity: 'Important', summary: 'CPU measurement и явный BLOCKED протокол без NF-04', tests: ['services/kshvi/tests/resource-budget.test.ts', 'services/kshvi/tests/cpu-control-protocol.test.ts'] },
    { id: 'REREVIEW-IMPORTANT-04', severity: 'Important', summary: 'LINK_ONLY исходных документов и fragments', tests: ['apps/editor/tests/kshvi-offline-assets.test.ts'] },
    { id: 'REREVIEW-MINOR-01', severity: 'Minor', summary: 'Live duration только от OFFLINE/serverTime', tests: ['apps/editor/tests/kshvi-async-states.test.tsx'] },
    { id: 'REREVIEW-MINOR-02', severity: 'Minor', summary: 'Версионируемые журналы и фактические hashes', tests: ['services/kshvi/tests/review-evidence.test.ts'] },
  ],
  limitations: [
    'Физическая потеря узла, нагрузка 50 рабочих мест и стендовые RTO/RPO здесь не заявляются.',
    'Поддерживаемый CPU-троттлинг отсутствует; NF-04 и AC-14 не подтверждаются протоколом BLOCKED.',
    'Атомарность внешнего эффекта worker обеспечивается обязательным идемпотентным портом эффекта.',
  ],
};
await writeFile(resolve('docs/release/kshvi/admin-remediation.json'), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`Журналы и hashes записаны для ${evidence.items.length} пунктов повторной ревизии\n`);
