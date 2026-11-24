import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNfQuality } from './kshvi-nf-quality.mjs';

function defaultAuditRunner() {
  const result = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', env: process.env });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

export async function runSecurityAcceptance(options = {}) {
  const evidence = options.evidence ?? 'docs/release/kshvi/nonfunctional';
  const result = await runNfQuality({ ...options, from: 6, to: 10, evidence });
  const audit = await (options.auditRunner ?? defaultAuditRunner)();
  let auditReport;
  let auditError = null;
  try { auditReport = JSON.parse(audit.output); }
  catch { auditError = 'npm audit вернул нечитаемый результат'; }
  const vulnerabilityCount = Number(auditReport?.metadata?.vulnerabilities?.total ?? 0);
  const auditPassed = audit.status === 0 && !auditError && vulnerabilityCount === 0;
  if (audit.status !== 0 && vulnerabilityCount === 0) auditError ??= 'npm audit завершился с ошибкой';
  const auditPath = resolve(evidence, 'dependency-audit.json');
  writeFileSync(auditPath, `${JSON.stringify({
    schemaVersion: 1,
    status: auditPassed ? 'passed' : 'failed',
    command: 'npm audit --json',
    vulnerabilityCount,
    error: auditError,
    output: audit.output,
    artifacts: [auditPath],
  }, null, 2)}\n`);
  const nf06Path = resolve(evidence, 'NF-06.json');
  const nf06 = JSON.parse(readFileSync(nf06Path, 'utf8'));
  nf06.dependencyAudit = auditPath;
  nf06.artifacts = [...new Set([...(nf06.artifacts ?? []), auditPath])];
  if (!auditPassed) {
    nf06.status = 'failed';
    nf06.openErrors = [...(nf06.openErrors ?? []), auditError ?? `DEPENDENCY_VULNERABILITIES: ${vulnerabilityCount}`];
  }
  writeFileSync(nf06Path, `${JSON.stringify(nf06, null, 2)}\n`);
  const commit = options.currentCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (nf06.commit !== commit) throw new Error('Смена revision во время security acceptance');
  const overallStatus = result.overallStatus === 'failed' || !auditPassed ? 'failed' : result.overallStatus ?? (result.status === 0 ? 'passed' : 'failed');
  return { status: result.status === 0 && auditPassed ? 0 : 1, overallStatus };
}

function parseArgs(argv) {
  const options = { freshInstall: false, evidence: 'docs/release/kshvi/nonfunctional' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--fresh-install') options.freshInstall = true;
    else if (arg === '--evidence') options.evidence = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  return options;
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.freshInstall) {
      const install = spawnSync('npm', ['ci'], { stdio: 'inherit' });
      if (install.status !== 0) process.exitCode = install.status ?? 1;
    }
    if (process.exitCode === undefined || process.exitCode === 0) {
      const result = await runSecurityAcceptance(options);
      console.log(`NF-06–NF-10: ${result.status === 0 ? 'passed' : 'failed'}`);
      process.exitCode = result.status;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
