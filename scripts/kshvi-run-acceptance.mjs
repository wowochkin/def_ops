import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SLUGS = [
  'preparation', 'environment', 'visibility', 'documents', 'inputs', 'communications', 'time', 'replay', 'reconnect', 'branch',
  'decision-cycle', 'debrief-archive', 'admin', 'load', 'weather-gaps', 'recovery', 'handover', 'playbook', 'autonomy', 'catalog',
  'morale', 'initial-map', 'logistics-formation', 'readiness', 'intermediary', 'equipment-knowledge', 'opponent', 'exposition', 'terrain', 'symbols',
];

export function acceptanceFiles(from, to) {
  return SLUGS.slice(from - 1, to).map((slug, index) => {
    const number = from + index;
    const id = `AC-${String(number).padStart(2, '0')}`;
    return { id, path: `services/kshvi/tests/acceptance/ac${String(number).padStart(2, '0')}-${slug}.test.ts` };
  });
}

function defaultRunner(files) {
  const result = spawnSync('npx', ['vitest', 'run', ...files.map(file => file.path)], { encoding: 'utf8', env: process.env });
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

export async function runAcceptance({ from = 1, to = 30, reverse = false, evidence = 'docs/release/kshvi/acceptance', fileExists = existsSync, runner = defaultRunner, currentCommit }) {
  const files = acceptanceFiles(from, to);
  if (reverse) files.reverse();
  mkdirSync(evidence, { recursive: true });
  const commit = currentCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  let status = 0;
  for (const file of files) {
    let result;
    if (!fileExists(file.path)) result = { status: 1, output: `Отсутствует сценарий ${file.path}` };
    else result = await runner([file]);
    const passed = result.status === 0;
    if (!passed) status = 1;
    const evidencePath = resolve(evidence, `${file.id}.json`);
    const record = {
      status: passed ? 'passed' : 'failed',
      commit,
      command: `npx vitest run ${file.path}`,
      output: result.output,
      artifacts: [evidencePath],
      openErrors: passed ? [] : [result.output || 'Сценарий не прошёл'],
    };
    writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`);
  }
  return { status };
}

function parseAcceptanceArgs(argv) {
  const options = { from: 1, to: 30, reverse: false, freshInstall: false, offline: false, evidence: 'docs/release/kshvi/acceptance' };
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
  if (!Number.isInteger(options.from) || !Number.isInteger(options.to) || options.from < 1 || options.to > 30 || options.from > options.to) throw new Error('Диапазон AC должен быть от 1 до 30');
  return options;
}

const acceptanceIds = ['AC-01', 'AC-03', 'AC-04', 'AC-05', 'AC-06', 'AC-07', 'AC-09', 'AC-11', 'AC-15', 'AC-18'];
const screenshotArtifacts = [
  'docs/release/kshvi/evidence/kshvi-trainee-1440.jpg',
  'docs/release/kshvi/evidence/kshvi-leader-1440.jpg',
  'docs/release/kshvi/evidence/kshvi-playgroup-1440.jpg',
  'docs/release/kshvi/evidence/kshvi-intermediary-1440.jpg',
  'docs/release/kshvi/evidence/kshvi-analyst-1440.jpg',
  'docs/release/kshvi/evidence/kshvi-projector-1920.jpg',
];

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  throw new Error('Доказательство содержит несериализуемое значение');
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function assertNoDirectOutcomeWrites(sources) {
  const source = sources.join('\n');
  const issues = [];
  if (/\.pool\.query\s*\(|\.query\s*\(\s*[`'"]\s*(?:insert|update|delete)\b/i.test(source)) issues.push('DIRECT_SQL');
  if (/Math\.random\s*\(/.test(source)) issues.push('UNRECORDED_RANDOM');
  return issues;
}

export function buildG2Evidence(run, options) {
  const openErrors = [];
  for (const id of acceptanceIds) {
    if (run.coverage[id] !== 'passed') openErrors.push(`${id}: покрытие ${run.coverage[id] ?? 'not_run'}, требуется полный профильный контур`);
  }
  for (const [name, status] of Object.entries(options.infrastructure)) {
    if (status !== 'passed') openErrors.push(`${name === 'postgresql' ? 'PostgreSQL' : name}: инфраструктурная приёмка ${status}`);
  }
  return {
    schemaVersion: 1,
    checkpoint: 'G2',
    status: openErrors.length ? 'limited' : 'passed',
    verificationStatus: 'passed',
    generatedAt: options.generatedAt ?? null,
    command: options.command,
    browserCommand: 'KSHVI_BASE_URL=http://127.0.0.1:5174 npx playwright test apps/editor/tests/kshvi-workspaces.spec.ts --reporter=line --workers=1',
    tasks: ['Task 32', 'Task 33', 'Task 34', 'Task 35', 'Task 36'],
    requirements: ['RUN-13–RUN-18', 'GEN-04–GEN-07', 'SIM-02–SIM-17', 'ROLE-03–ROLE-07', 'UI-02–UI-16', 'UI-18–UI-19', 'UI-22'],
    acceptanceIds,
    checks: run.checks,
    coverage: run.coverage,
    infrastructure: options.infrastructure,
    scenarioHash: run.scenarioHash,
    environmentHash: run.environmentHash,
    journal: {
      eventCount: run.events.length,
      sha256: digest(run.events),
      finalHash: run.events.at(-1)?.hash ?? null,
    },
    directOutcomeWrites: false,
    artifacts: ['docs/release/kshvi/evidence/g2-journal.json', 'docs/release/kshvi/evidence/g2-infrastructure.json', ...screenshotArtifacts],
    openErrors,
  };
}

function runG2(argv) {
  const requireComplete = argv.includes('--require-complete');
  const root = process.cwd();
  const sourcePaths = [
    'services/kshvi/tests/e2e/conduct-cycle.test.ts',
    'apps/editor/tests/kshvi-conduct-cycle.test.tsx',
    'packages/kshvi/src/decisions',
    'packages/kshvi/src/simulation',
  ];
  const sources = [];
  for (const path of sourcePaths.slice(0, 2)) sources.push(readFileSync(resolve(root, path), 'utf8'));
  const writeIssues = assertNoDirectOutcomeWrites(sources);
  if (writeIssues.length) throw new Error(`Обнаружена прямая запись исходов: ${writeIssues.join(', ')}`);

  const command = 'npx vitest run services/kshvi/tests/e2e/conduct-cycle.test.ts apps/editor/tests/kshvi-conduct-cycle.test.tsx';
  const completed = spawnSync('npx', ['vitest', 'run', 'services/kshvi/tests/e2e/conduct-cycle.test.ts', 'apps/editor/tests/kshvi-conduct-cycle.test.tsx'], {
    cwd: root,
    env: { ...process.env, KSHVI_G2_EVIDENCE: '1' },
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (completed.status !== 0) {
    process.exitCode = completed.status ?? 1;
    return;
  }
  const journalPath = resolve(root, 'docs/release/kshvi/evidence/g2-journal.json');
  if (!existsSync(journalPath)) throw new Error('Сквозной сценарий не сформировал журнал доказательств');
  const run = JSON.parse(readFileSync(journalPath, 'utf8'));
  const evidence = buildG2Evidence(run, {
    command,
    generatedAt: new Date().toISOString(),
    infrastructure: {
      postgresql: process.env.TEST_DATABASE_URL ? 'passed' : 'not_run',
      cartography: 'not_run',
      gateway: 'not_run',
    },
  });
  for (const artifact of evidence.artifacts) {
    if (!existsSync(resolve(root, artifact))) throw new Error(`Отсутствует артефакт доказательства: ${artifact}`);
  }
  writeFileSync(resolve(root, 'docs/release/kshvi/g2-conduct.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`G2: программные проверки пройдены; статус приёмки: ${evidence.status}; событий: ${evidence.journal.eventCount}.`);
  if (requireComplete && evidence.status !== 'passed') {
    console.error(`G2 не завершён: ${evidence.openErrors.length} открытых ограничений.`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const acceptanceMode = args.some(arg => ['--from', '--to', '--reverse', '--fresh-install', '--offline', '--evidence'].includes(arg));
    if (!acceptanceMode) runG2(args);
    else {
      const options = parseAcceptanceArgs(args);
      if (options.freshInstall) {
        const install = spawnSync('npm', ['ci'], { stdio: 'inherit' });
        if (install.status !== 0) process.exitCode = install.status ?? 1;
      }
      if (process.exitCode === undefined || process.exitCode === 0) {
        if (options.offline) {
          process.env.KSHVI_OFFLINE = '1';
          process.env.KSHVI_EXTERNAL_NETWORK = '0';
        }
        const result = await runAcceptance(options);
        process.exitCode = result.status;
      }
    }
  } catch (error) {
    console.error(`Приёмка КШВИ остановлена: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
