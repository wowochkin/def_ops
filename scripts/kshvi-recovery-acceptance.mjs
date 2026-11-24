import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNfQuality } from './kshvi-nf-quality.mjs';

export async function runRecoveryAcceptance(options = {}) {
  return runNfQuality({ ...options, from: 11, to: 15, evidence: options.evidence ?? 'docs/release/kshvi/nonfunctional' });
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
      const result = await runRecoveryAcceptance(options);
      console.log(`NF-11–NF-15: ${result.overallStatus ?? (result.status === 0 ? 'passed' : 'failed')}`);
      process.exitCode = result.status;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
