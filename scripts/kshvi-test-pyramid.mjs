import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');

export const REQUIRED_LEVELS = ['unit', 'contract', 'integration', 'endToEnd', 'loadAndRecovery'];

const LEVELS = [
  {
    kind: 'unit',
    steps: [{ id: 'domain-unit-and-properties', command: 'npx vitest run packages/kshvi/tests' }],
  },
  {
    kind: 'contract',
    steps: [{
      id: 'schema-api-and-evidence-contracts',
      command: 'npx vitest run packages/kshvi/tests/contracts services/kshvi/tests/contracts/nf-quality.test.ts services/kshvi/tests/contracts/acceptance-scripts.test.ts',
    }],
  },
  {
    kind: 'integration',
    requiresDatabase: true,
    steps: [{
      id: 'postgres-environment-communication-agents-archive',
      command: 'npx vitest run services/kshvi/tests/event-store.test.ts services/kshvi/tests/routes-integration.test.ts services/kshvi/tests/environment-snapshot.test.ts services/kshvi/tests/sse-reconnect.test.ts services/kshvi/tests/opponent-worker.test.ts services/kshvi/tests/intermediary-worker.test.ts services/kshvi/tests/archive-offline.test.ts services/kshvi/tests/archive-roundtrip.test.ts',
    }],
  },
  {
    kind: 'endToEnd',
    steps: [{
      id: 'critical-role-workspaces',
      command: 'npx playwright test apps/editor/tests/kshvi-replay.spec.ts apps/editor/tests/kshvi-autonomy-ui.spec.ts apps/editor/tests/kshvi-exposition.spec.ts apps/editor/tests/kshvi-projector-accessibility.spec.ts --workers=1',
    }],
  },
  {
    kind: 'loadAndRecovery',
    requiresDatabase: true,
    steps: [
      { id: 'real-network-load', command: 'node scripts/kshvi-load-test.mjs --connections 50 --active 25 --rate 5 --burst-rate 20 --burst-seconds 60 --output docs/release/kshvi/nonfunctional/load-distributions.json', evidence: 'docs/release/kshvi/nonfunctional/load-distributions.json' },
      { id: 'security-and-isolation', command: 'node scripts/kshvi-security-acceptance.mjs --evidence docs/release/kshvi/nonfunctional' },
      { id: 'failure-and-recovery', command: 'node scripts/kshvi-recovery-acceptance.mjs --evidence docs/release/kshvi/nonfunctional' },
    ],
  },
];

function validate(pyramid, requirePassed) {
  const levels = Array.isArray(pyramid?.levels) ? pyramid.levels : [];
  const missingLevels = REQUIRED_LEVELS.filter(kind => !levels.some(level => level.kind === kind));
  const unexpectedLevels = levels.map(level => level.kind).filter(kind => !REQUIRED_LEVELS.includes(kind));
  const seen = new Set();
  const invalidLevels = [];
  for (const [index, level] of levels.entries()) {
    const duplicate = seen.has(level.kind);
    seen.add(level.kind);
    const validStatus = requirePassed ? level.status === 'passed' : ['passed', 'failed', 'blocked'].includes(level.status);
    const invalid = !REQUIRED_LEVELS.includes(level.kind)
      || level.kind !== REQUIRED_LEVELS[index]
      || duplicate
      || !validStatus
      || typeof level.command !== 'string' || level.command.trim().length === 0
      || !Array.isArray(level.artifacts) || level.artifacts.length === 0 || level.artifacts.some(path => typeof path !== 'string' || !path)
      || typeof level.commit !== 'string' || !level.commit
      || !Number.isFinite(Date.parse(level.completedAt))
      || !Array.isArray(level.steps) || level.steps.length === 0
      || level.steps.some(step => typeof step.command !== 'string' || !step.command || typeof step.output !== 'string');
    if (invalid) invalidLevels.push(level.kind);
  }
  return { missingLevels, invalidLevels: [...new Set(invalidLevels)], unexpectedLevels };
}

export function evaluatePyramid(pyramid) {
  return validate(pyramid, true);
}

export function validatePyramidStructure(pyramid) {
  return validate(pyramid, false);
}

async function runEndToEnd(step) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: resolve(root, 'apps/editor'),
    configFile: resolve(root, 'apps/editor/vite.config.ts'),
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    logLevel: 'error',
  });
  try {
    await server.listen();
    return await new Promise(resolveResult => {
      const child = spawn(step.command, {
        shell: true, cwd: root, env: { ...process.env, KSHVI_BASE_URL: 'http://127.0.0.1:5173' }, timeout: 300_000,
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      child.once('error', error => { output += String(error); });
      child.once('close', code => resolveResult({ status: code ?? 1, protocolStatus: code === 0 ? 'passed' : 'failed', output }));
    });
  } finally {
    await server.close();
  }
}

async function defaultRunner(step, level) {
  if (level.kind === 'endToEnd') return runEndToEnd(step);
  if (level.requiresDatabase && !process.env.TEST_DATABASE_URL) {
    return { status: 2, protocolStatus: 'blocked', output: 'TEST_DATABASE_URL не задан; реальная интеграция не выполнялась' };
  }
  const result = spawnSync(step.command, {
    shell: true, cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: level.kind === 'loadAndRecovery' ? 600_000 : 300_000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  let protocolStatus = result.status === 0 ? 'passed' : 'failed';
  if (/NF-\d+–NF-\d+: blocked/.test(output)) protocolStatus = 'blocked';
  if (step.evidence && existsSync(resolve(root, step.evidence))) {
    try {
      const evidence = JSON.parse(readFileSync(resolve(root, step.evidence), 'utf8'));
      if (evidence.status === 'blocked') protocolStatus = 'blocked';
      else if (evidence.status === 'failed') protocolStatus = 'failed';
      else if (evidence.status !== 'passed') protocolStatus = 'failed';
    } catch {
      protocolStatus = 'failed';
    }
  }
  return { status: result.status ?? 1, protocolStatus, output: output || (result.error ? String(result.error) : 'Команда завершена без вывода') };
}

function overallFor(levels) {
  if (levels.some(level => level.status === 'failed')) return 'failed';
  if (levels.some(level => level.status === 'blocked')) return 'blocked';
  return 'passed';
}

export async function runPyramid({
  output = 'docs/release/kshvi/test-pyramid.json', requireComplete = false,
  runner = defaultRunner, currentCommit,
} = {}) {
  const outputPath = resolve(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  const commit = currentCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root }).trim();
  const levels = [];
  for (const definition of LEVELS) {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    const stepResults = [];
    for (const step of definition.steps) {
      const stepStarted = performance.now();
      const result = await runner(step, definition);
      stepResults.push({
        id: step.id,
        command: step.command,
        status: result.protocolStatus ?? (result.status === 0 ? 'passed' : 'failed'),
        exitStatus: result.status,
        output: result.output,
        durationMs: performance.now() - stepStarted,
        evidence: step.evidence ?? null,
      });
    }
    const status = stepResults.some(step => step.status === 'failed') ? 'failed' : stepResults.some(step => step.status === 'blocked') ? 'blocked' : 'passed';
    const logPath = resolve(dirname(outputPath), 'pyramid', `${definition.kind}.txt`);
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, stepResults.map(step => `### ${step.id}\n$ ${step.command}\nstatus=${step.status} exit=${step.exitStatus}\n${String(step.output).trimEnd()}\n`).join('\n'));
    const artifacts = [logPath, ...definition.steps.filter(step => step.evidence).map(step => resolve(root, step.evidence))];
    levels.push({
      kind: definition.kind,
      status,
      command: definition.steps.map(step => step.command).join(' ; '),
      artifacts,
      commit,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
      steps: stepResults,
      openErrors: stepResults.filter(step => step.status !== 'passed').map(step => `${step.id}: ${step.output}`),
    });
  }
  const overallStatus = overallFor(levels);
  const pyramid = {
    schemaVersion: 2,
    overallStatus,
    commit,
    generatedAt: new Date().toISOString(),
    levels,
    ...validate({ levels }, false),
    requireComplete,
  };
  writeFileSync(outputPath, `${JSON.stringify(pyramid, null, 2)}\n`);
  return { status: overallStatus === 'passed' ? 0 : 1, overallStatus };
}

function parseArgs(argv) {
  const options = { output: 'docs/release/kshvi/test-pyramid.json', requireComplete: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') options.output = argv[++index];
    else if (arg === '--require-complete') options.requireComplete = true;
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  return options;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runPyramid(options);
    const saved = JSON.parse(readFileSync(resolve(options.output), 'utf8'));
    console.log(JSON.stringify({ status: result.overallStatus, levels: saved.levels.map(level => ({ kind: level.kind, status: level.status })), output: resolve(options.output) }, null, 2));
    process.exitCode = result.status;
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  }
}
