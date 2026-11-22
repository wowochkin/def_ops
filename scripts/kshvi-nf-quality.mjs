import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const LOAD_COMMAND = 'node scripts/kshvi-load-test.mjs --connections 50 --active 25 --rate 5 --burst-rate 20 --burst-seconds 60 --output docs/release/kshvi/nonfunctional/load-distributions.json';

const DEFINITIONS = [
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `NF-${String(index + 1).padStart(2, '0')}`,
    path: `docs/release/kshvi/nonfunctional/NF-${String(index + 1).padStart(2, '0')}.json`,
    externalEvidence: `docs/release/kshvi/nonfunctional/NF-${String(index + 1).padStart(2, '0')}.json`,
    command: LOAD_COMMAND,
  })),
  { id: 'NF-06', path: 'services/kshvi/tests/security/authentication.test.ts' },
  { id: 'NF-07', path: 'services/kshvi/tests/security/tenant-isolation.test.ts' },
  { id: 'NF-08', path: 'services/kshvi/tests/security/log-redaction.test.ts' },
  { id: 'NF-09', path: 'services/kshvi/tests/security/security-audit.test.ts' },
  { id: 'NF-10', path: 'services/kshvi/tests/security/distribution-labels.test.ts' },
  { id: 'NF-11', path: 'services/kshvi/tests/recovery/rpo-zero.test.ts' },
  { id: 'NF-12', path: 'services/kshvi/tests/recovery/recovery-time.test.ts', paths: ['services/kshvi/tests/recovery/recovery-time.test.ts', 'services/kshvi/tests/recovery-drill.test.ts'], blockedReason: 'Локальное восстановление процесса и файлов проверено; полная потеря физического узла и RTO на эталонном наборе не проверялись' },
  { id: 'NF-13', path: 'services/kshvi/tests/recovery/backup-schedule.test.ts' },
  { id: 'NF-14', path: 'services/kshvi/tests/recovery/reconnect.test.ts' },
  { id: 'NF-15', path: 'services/kshvi/tests/recovery/archive-compatibility.test.ts' },
  { id: 'NF-16', path: 'apps/editor/tests/i18n/russian-consistency.test.ts' },
  { id: 'NF-17', path: 'apps/editor/tests/accessibility/full-workspace.spec.ts', runner: 'playwright', config: 'apps/editor/tests/accessibility/playwright.config.ts' },
  { id: 'NF-18', path: 'apps/editor/tests/export/local-formats.test.ts' },
  { id: 'NF-19', path: 'packages/kshvi/tests/contracts/schema-purity.test.ts', paths: ['packages/kshvi/tests/contracts/schema-purity.test.ts', 'packages/kshvi/tests/contracts/archive-migration.test.ts', 'services/kshvi/tests/contracts/test-pyramid.test.ts'] },
  { id: 'NF-20', path: 'services/kshvi/tests/observability.test.ts' },
  { id: 'NF-21', path: 'apps/editor/tests/kshvi-offline-assets.test.ts', paths: ['apps/editor/tests/kshvi-offline-assets.test.ts', 'services/kshvi/tests/archive-roundtrip.test.ts'] },
  { id: 'NF-22', path: 'docs/release/kshvi/test-pyramid.json', externalEvidence: 'docs/release/kshvi/test-pyramid.json', command: 'node scripts/kshvi-test-pyramid.mjs --require-complete --output docs/release/kshvi/test-pyramid.json' },
];

export function nfFiles(from, to) {
  return DEFINITIONS.slice(from - 1, to).map(file => ({ ...file }));
}

function commandFor(file) {
  if (file.command) return file.command;
  if (file.runner === 'playwright') return `npx playwright test --config=${file.config}`;
  return `npx vitest run ${(file.paths ?? [file.path]).join(' ')}`;
}

function defaultRunner(files) {
  const file = files[0];
  if (!file) return { status: 1, output: 'Пустой набор проверок' };
  if (file.externalEvidence) {
    try {
      const evidence = JSON.parse(readFileSync(file.externalEvidence, 'utf8'));
      const evidenceStatus = evidence.status ?? evidence.overallStatus;
      const protocolStatus = ['passed', 'failed', 'blocked'].includes(evidenceStatus) ? evidenceStatus : 'failed';
      return { status: protocolStatus === 'passed' ? 0 : protocolStatus === 'blocked' ? 2 : 1, protocolStatus, output: JSON.stringify(evidence, null, 2) };
    } catch (error) {
      return { status: 1, protocolStatus: 'failed', output: `Не читается внешний протокол: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const args = file.runner === 'playwright' ? ['playwright', 'test', `--config=${file.config}`] : ['vitest', 'run', ...(file.paths ?? [file.path])];
  const result = spawnSync('npx', args, { encoding: 'utf8', env: process.env });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

export async function runNfQuality({
  from = 1, to = 22, reverse = false, evidence = 'docs/release/kshvi/nonfunctional',
  fileExists = existsSync, runner = defaultRunner, currentCommit,
}) {
  const files = nfFiles(from, to);
  if (reverse) files.reverse();
  mkdirSync(evidence, { recursive: true });
  const commit = currentCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  let status = 0;
  const protocolStatuses = [];
  for (const file of files) {
    const startedAt = new Date().toISOString();
    const required = file.externalEvidence ? [file.externalEvidence] : (file.paths ?? [file.path]);
    const missing = required.filter(path => !fileExists(path));
    const result = missing.length
      ? { status: 1, output: `Отсутствуют проверки или доказательства: ${missing.join(', ')}` }
      : await runner([file]);
    const runnerStatus = result.protocolStatus ?? (result.status === 0 ? 'passed' : 'failed');
    const protocolStatus = runnerStatus === 'passed' && file.blockedReason ? 'blocked' : runnerStatus;
    protocolStatuses.push(protocolStatus);
    if (protocolStatus !== 'passed') status = 1;
    const evidencePath = resolve(evidence, `${file.id}.json`);
    const output = [result.output || (runnerStatus === 'passed' ? 'Проверка завершена успешно' : 'Протокол не прошёл'), file.blockedReason].filter(Boolean).join('\n');
    writeFileSync(evidencePath, `${JSON.stringify({
      schemaVersion: 1,
      id: file.id,
      status: protocolStatus,
      startedAt,
      finishedAt: new Date().toISOString(),
      commit,
      command: commandFor(file),
      tests: file.externalEvidence ? [] : required,
      externalEvidence: file.externalEvidence ?? null,
      limitations: file.blockedReason ? [file.blockedReason] : [],
      output,
      artifacts: [evidencePath, ...(file.externalEvidence ? [resolve(file.externalEvidence)] : [])],
      openErrors: protocolStatus === 'passed' ? [] : [output],
    }, null, 2)}\n`);
  }
  const overallStatus = protocolStatuses.includes('failed') ? 'failed' : protocolStatuses.includes('blocked') ? 'blocked' : 'passed';
  return { status, overallStatus };
}

function parseArgs(argv) {
  const options = { from: 1, to: 22, reverse: false, freshInstall: false, offline: false, evidence: 'docs/release/kshvi/nonfunctional' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from') options.from = Number(argv[++index]);
    else if (arg === '--to') options.to = Number(argv[++index]);
    else if (arg === '--reverse') options.reverse = true;
    else if (arg === '--fresh-install') options.freshInstall = true;
    else if (arg === '--offline') options.offline = true;
    else if (arg === '--evidence') options.evidence = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (!Number.isInteger(options.from) || !Number.isInteger(options.to) || options.from < 1 || options.to > 22 || options.from > options.to) throw new Error('Диапазон NF должен быть от 1 до 22');
  return options;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.freshInstall) {
      const installArgs = ['ci'];
      if (options.offline) installArgs.push('--offline');
      const install = spawnSync('npm', installArgs, { stdio: 'inherit' });
      if (install.status !== 0) process.exitCode = install.status ?? 1;
    }
    if ((process.exitCode === undefined || process.exitCode === 0) && options.offline) {
      process.env.KSHVI_OFFLINE = '1';
      process.env.KSHVI_EXTERNAL_NETWORK = '0';
      const offlineOutput = resolve(options.evidence, 'offline.json');
      const offline = spawnSync(process.execPath, ['scripts/kshvi-offline-check.mjs', '--deny-external', '--output', offlineOutput], { stdio: 'inherit' });
      if (offline.status !== 0) process.exitCode = offline.status ?? 1;
    }
    if (process.exitCode === undefined || process.exitCode === 0) {
      const result = await runNfQuality(options);
      process.exitCode = result.status;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
