import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SLUGS = [
  'deployment', 'latency', 'load', 'heavy-jobs', 'time', 'security', 'organizations', 'log-redaction',
  'security-audit', 'distribution-labels', 'durability', 'recovery-time', 'backups', 'reconnect',
  'replay-compatibility', 'localization', 'accessibility', 'local-formats', 'contracts', 'observability',
  'licenses', 'test-pyramid',
];

export function nfFiles(from, to) {
  return SLUGS.slice(from - 1, to).map((slug, index) => {
    const number = from + index;
    return { id: `NF-${String(number).padStart(2, '0')}`, path: `services/kshvi/tests/nonfunctional/nf${String(number).padStart(2, '0')}-${slug}.test.ts` };
  });
}

function defaultRunner(files) {
  const result = spawnSync('npx', ['vitest', 'run', ...files.map(file => file.path)], { encoding: 'utf8', env: process.env });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

export async function runNfQuality({ from = 1, to = 22, reverse = false, evidence = 'docs/release/kshvi/nonfunctional', fileExists = existsSync, runner = defaultRunner, currentCommit }) {
  const files = nfFiles(from, to);
  if (reverse) files.reverse();
  mkdirSync(evidence, { recursive: true });
  const commit = currentCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  let status = 0;
  for (const file of files) {
    const result = fileExists(file.path) ? await runner([file]) : { status: 1, output: `Отсутствует протокол ${file.path}` };
    const passed = result.status === 0;
    if (!passed) status = 1;
    const evidencePath = resolve(evidence, `${file.id}.json`);
    writeFileSync(evidencePath, `${JSON.stringify({
      status: passed ? 'passed' : 'failed', commit,
      command: `npx vitest run ${file.path}`, output: result.output,
      artifacts: [evidencePath], openErrors: passed ? [] : [result.output || 'Протокол не прошёл'],
    }, null, 2)}\n`);
  }
  return { status };
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

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  if (options.freshInstall) {
    const install = spawnSync('npm', ['ci'], { stdio: 'inherit' });
    if (install.status !== 0) process.exitCode = install.status ?? 1;
  }
  if (process.exitCode === undefined || process.exitCode === 0) {
    if (options.offline) {
      process.env.KSHVI_OFFLINE = '1';
      process.env.KSHVI_EXTERNAL_NETWORK = '0';
    }
    const result = await runNfQuality(options);
    process.exitCode = result.status;
  }
}
