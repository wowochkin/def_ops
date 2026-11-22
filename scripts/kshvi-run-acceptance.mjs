import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SLUGS = [
  'preparation', 'environment', 'visibility', 'documents', 'inputs', 'communications', 'time', 'replay', 'reconnect', 'branch',
  'decision-cycle', 'debrief-archive', 'admin', 'load', 'weather-gaps', 'recovery', 'handover', 'playbook', 'autonomy', 'catalog',
  'morale', 'initial-map', 'logistics-formation', 'readiness', 'intermediary', 'equipment-knowledge', 'opponent', 'exposition', 'terrain', 'symbols',
];
const acceptanceIds = ['AC-01', 'AC-03', 'AC-04', 'AC-05', 'AC-06', 'AC-07', 'AC-09', 'AC-11', 'AC-15', 'AC-18'];
const officialCommandTypes = new Set([
  'decision.create', 'decision.transition', 'decision.revise', 'order.issue', 'order.advance', 'order.cancel',
  'calculation.create', 'calculation.approve', 'calculation.apply', 'calculation.override', 'calculation.replay',
  'observation.record', 'document.create', 'document.transition', 'communication.enqueue',
  'time.jump', 'stage.assign', 'playbook.evaluate', 'exercise.complete',
]);
const requirements = [
  'RUN-13', 'RUN-14', 'RUN-15', 'RUN-16', 'RUN-17', 'RUN-18', 'GEN-04', 'GEN-05', 'GEN-06', 'GEN-07',
  'SIM-02', 'SIM-03', 'SIM-04', 'SIM-09', 'SIM-10', 'SIM-11', 'SIM-12', 'SIM-13', 'SIM-14', 'SIM-15', 'SIM-16', 'SIM-17',
  'ROLE-03', 'ROLE-04', 'ROLE-05', 'ROLE-06', 'ROLE-07', 'UI-02', 'UI-03', 'UI-07', 'UI-08', 'UI-09', 'UI-10', 'UI-11',
  'UI-12', 'UI-13', 'UI-14', 'UI-15', 'UI-16', 'UI-18', 'UI-19', 'UI-22',
];
const screenshotArtifacts = [
  'docs/release/kshvi/evidence/kshvi-trainee-1440.jpg', 'docs/release/kshvi/evidence/kshvi-leader-1440.jpg',
  'docs/release/kshvi/evidence/kshvi-playgroup-1440.jpg', 'docs/release/kshvi/evidence/kshvi-intermediary-1440.jpg',
  'docs/release/kshvi/evidence/kshvi-analyst-1440.jpg', 'docs/release/kshvi/evidence/kshvi-projector-1920.jpg',
];

export function acceptanceFiles(from, to) {
  return SLUGS.slice(from - 1, to).map((slug, index) => {
    const number = from + index;
    const id = `AC-${String(number).padStart(2, '0')}`;
    return { id, path: `services/kshvi/tests/acceptance/ac${String(number).padStart(2, '0')}-${slug}.test.ts` };
  });
}
export async function defaultRunner(files, cwd = process.cwd(), runId = '', spawn = spawnSync) {
  const result = spawn('npx', ['vitest', 'run', ...files.map(file => file.path)], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, KSHVI_ACCEPTANCE_RUN_ID: runId },
  });
  const status = typeof result.status === 'number' ? result.status : 1;
  const executionError = result.error ? `\nСистемная ошибка запуска: ${result.error.stack ?? result.error.message ?? String(result.error)}` : '';
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}${executionError}`;
  const proofPath = resolve(cwd, 'docs/release/kshvi/acceptance', `${files[0].id}.proof.json`);
  const evidence = status === 0 && existsSync(proofPath) ? JSON.parse(readFileSync(proofPath, 'utf8')) : undefined;
  return { status, output, evidence };
}
export function prepareFreshAcceptanceWorkspace({ root = process.cwd(), offline = true, installer = spawnSync } = {}) {
  mkdirSync(resolve(root, '.tmp'), { recursive: true });
  const workspace = mkdtempSync(resolve(root, '.tmp', 'kshvi-ac00-'));
  const excluded = new Set(['.git', 'node_modules', '.worktrees', '.tmp', 'dist']);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    cpSync(resolve(root, entry.name), resolve(workspace, entry.name), {
      recursive: true,
      filter: source => {
        const path = relative(root, source);
        if (!path) return true;
        const [top] = path.split(/[\\/]/);
        return !excluded.has(top);
      },
    });
  }
  const result = installer('npm', ['ci', ...(offline ? ['--offline'] : [])], {
    cwd: workspace,
    stdio: 'inherit',
    env: { ...process.env, KSHVI_OFFLINE: offline ? '1' : '0', KSHVI_EXTERNAL_NETWORK: '0' },
  });
  if (result.status !== 0) throw new Error(`npm ci в изолированной установке завершился с кодом ${result.status ?? 1}`);
  return workspace;
}
export function acceptanceEvidenceIssues(proof, fileExists = existsSync, freshness = {}) {
  const issues = [];
  const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
  if (!proof || typeof proof !== 'object') return ['initialRevision: обязательный комплект доказательств отсутствует'];
  if (freshness.runId && proof.runId !== freshness.runId) issues.push(`runId: ожидался ${freshness.runId}, получен ${proof.runId ?? 'отсутствующий'}`);
  if (freshness.commit && proof.commit !== freshness.commit) issues.push('commit: доказательство относится к другой редакции кода');
  if (!proof.initialRevision || typeof proof.initialRevision.id !== 'string' || !Number.isSafeInteger(proof.initialRevision.revision)
    || proof.initialRevision.revision < 1 || !hash(proof.initialRevision.sha256)) issues.push('initialRevision: нужна исходная редакция и SHA-256');
  if (!proof.journal || typeof proof.journal.path !== 'string' || !proof.journal.path || !hash(proof.journal.sha256)
    || !Number.isSafeInteger(proof.journal.eventCount) || proof.journal.eventCount < 1) issues.push('journal: нужен непустой журнал, путь и SHA-256');
  for (const key of ['scenario', 'environment', 'journal']) if (!hash(proof.hashes?.[key])) issues.push(`hashes.${key}: требуется SHA-256`);
  if (proof.hashes?.scenario !== proof.initialRevision?.sha256) issues.push('hashes.scenario: не совпадает с исходной редакцией');
  if (proof.hashes?.journal !== proof.journal?.sha256) issues.push('hashes.journal: не совпадает с журналом');
  const protocols = Array.isArray(proof.protocols) ? proof.protocols : [];
  const screenshots = Array.isArray(proof.screenshots) ? proof.screenshots : [];
  if (![...protocols, ...screenshots].some(path => typeof path === 'string' && path.length > 0)) issues.push('protocols/screenshots: нужен протокол или снимок');
  if (!proof.metrics || typeof proof.metrics !== 'object' || !Object.values(proof.metrics).some(value => typeof value === 'number' && Number.isFinite(value))) {
    issues.push('metrics: нужна хотя бы одна фактическая числовая метрика');
  }
  if (!Array.isArray(proof.limitations) || proof.limitations.some(value => typeof value !== 'string')) issues.push('limitations: требуется массив строк, пустой при отсутствии ограничений');
  const artifacts = Array.isArray(proof.artifacts) ? proof.artifacts : [];
  for (const path of [proof.journal?.path, ...protocols, ...screenshots]) if (path && !artifacts.includes(path)) issues.push(`artifacts: не указан ${path}`);
  for (const path of artifacts) if (typeof path !== 'string' || !path || !fileExists(path)) issues.push(`artifacts: файл недоступен ${path}`);
  return issues;
}

export async function runAcceptance({ from = 1, to = 30, reverse = false, evidence = 'docs/release/kshvi/acceptance', fileExists = existsSync, runner = defaultRunner, currentCommit, writeEvidence = true, freshInstall = false, offline = false, cwd = process.cwd(), runId = randomUUID() }) {
  const files = acceptanceFiles(from, to);
  if (reverse) files.reverse();
  if (writeEvidence) mkdirSync(evidence, { recursive: true });
  const commit = currentCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  let status = 0;
  const results = [];
  for (const file of files) {
    let result;
    if (!fileExists(file.path)) result = { status: 1, output: `Отсутствует сценарий ${file.path}` };
    else result = await runner([file], cwd, runId);
    const proofIssues = result.status === 0 ? acceptanceEvidenceIssues(result.evidence, path => fileExists(resolve(cwd, path)), { runId, commit }) : [];
    const passed = result.status === 0 && proofIssues.length === 0;
    if (!passed) status = 1;
    const evidencePath = resolve(evidence, `${file.id}.json`);
    const openErrors = result.status !== 0 ? [result.output || 'Сценарий не прошёл'] : proofIssues;
    const record = {
      status: passed ? 'passed' : 'failed', commit, runId, command: `npx vitest run ${file.path}`, output: result.output,
      ...(result.evidence && typeof result.evidence === 'object' ? result.evidence : {}),
      freshInstall, offline, cwd,
      artifacts: [...(Array.isArray(result.evidence?.artifacts) ? result.evidence.artifacts : []), evidencePath],
      openErrors,
    };
    if (writeEvidence) writeFileSync(evidencePath, `${JSON.stringify(record, null, 2)}\n`);
    results.push({ id: file.id, status: record.status, output: result.output, openErrors });
  }
  return { status, results };
}

export function resolveRunMode(argv) {
  const options = { generic: true, g2: true, from: 1, to: 30, reverse: false, freshInstall: false, offline: false, evidence: 'docs/release/kshvi/acceptance', writeGenericEvidence: false, requireComplete: false };
  let explicitG2 = false;
  let explicitGeneric = false;
  let genericFlags = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--g2-only') { options.g2 = true; options.generic = false; explicitG2 = true; }
    else if (arg === '--generic-only') { options.generic = true; options.g2 = false; explicitGeneric = true; }
    else if (arg === '--from') { options.from = Number(argv[++index]); genericFlags = true; }
    else if (arg === '--to') { options.to = Number(argv[++index]); genericFlags = true; }
    else if (arg === '--reverse') { options.reverse = true; genericFlags = true; }
    else if (arg === '--fresh-install') { options.freshInstall = true; genericFlags = true; }
    else if (arg === '--offline') { options.offline = true; genericFlags = true; }
    else if (arg === '--evidence') { options.evidence = argv[++index]; genericFlags = true; }
    else if (arg === '--require-complete') options.requireComplete = true;
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (explicitG2 && explicitGeneric) throw new Error('Режимы --g2-only и --generic-only несовместимы');
  if (explicitG2 && genericFlags) throw new Error('Generic-флаги влияют только на generic контур; для изоляции G2 укажите только --g2-only явно');
  if (!Number.isInteger(options.from) || !Number.isInteger(options.to) || options.from < 1 || options.to > 30 || options.from > options.to) throw new Error('Диапазон AC должен быть от 1 до 30');
  options.writeGenericEvidence = options.generic && !options.g2;
  return options;
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  throw new Error('Доказательство содержит несериализуемое значение');
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

export function assertNoDirectOutcomeWrites(sources) {
  const source = sources.join('\n');
  const issues = [];
  if (/\.pool\.query\s*\(|\.query\s*\(\s*[`'"]\s*(?:insert|update|delete)\b/i.test(source)) issues.push('DIRECT_SQL');
  if (/Math\.random\s*\(/.test(source)) issues.push('UNRECORDED_RANDOM');
  if (/(?:\.appendCommand|\bappend)\s*\(/.test(source)) issues.push('DIRECT_EVENT_APPEND');
  return issues;
}
function officialEvents(events) {
  return events.length > 0 && events.every(event => {
    const payload = event.payload;
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      && typeof payload.commandId === 'string' && payload.commandId.length > 0
      && typeof payload.commandType === 'string' && officialCommandTypes.has(payload.commandType)
      && typeof payload.causedBy === 'string' && payload.causedBy.length > 0;
  });
}
export function assertFreshG2Run(run, options) {
  const issues = [];
  if (!run || run.runId !== options.runId) issues.push('runId не совпадает со свежим запуском');
  if (!run || run.commit !== options.currentCommit) issues.push('commit журнала не совпадает с HEAD');
  if (!Array.isArray(run?.sessionIds) || run.sessionIds.length < 2 || new Set(run.sessionIds).size !== run.sessionIds.length || run.sessionIds.some(id => ['session-A', 'session-B'].includes(id))) issues.push('sessionId не подтверждает два реальных сеанса');
  for (const name of ['postgresql', 'cartography', 'gateway']) if (run?.infrastructure?.[name] !== 'passed') issues.push(`${name}: инфраструктура не подтверждена (${run?.infrastructure?.[name] ?? 'missing'})`);
  if (!Number.isFinite(Date.parse(run?.startedAt)) || !Number.isFinite(Date.parse(run?.completedAt)) || Date.parse(run.completedAt) < Date.parse(run.startedAt)) issues.push('Хронология запуска некорректна');
  if (!Array.isArray(run?.events) || !officialEvents(run.events)) issues.push('Журнал содержит события вне официальных типизированных команд');
  if (!/^[0-9a-f]{64}$/.test(run?.scenarioHash ?? '') || !/^[0-9a-f]{64}$/.test(run?.environmentHash ?? '')) issues.push('Хеши сценария или среды некорректны');
  return issues;
}

export function buildG2Evidence(run, options) {
  const openErrors = [];
  for (const id of acceptanceIds) if (run.coverage[id] !== 'passed') openErrors.push(`${id}: покрытие ${run.coverage[id] ?? 'not_run'}, требуется полный профильный контур`);
  const infrastructure = run.infrastructure ?? options.infrastructure ?? {};
  for (const [name, status] of Object.entries(infrastructure)) if (status !== 'passed') openErrors.push(`${name === 'postgresql' ? 'PostgreSQL' : name}: инфраструктурная приёмка ${status}`);
  const directOutcomeWrites = !officialEvents(run.events);
  if (directOutcomeWrites) openErrors.push('Журнал содержит результат вне официальных типизированных команд');
  if ((options.genericStatus ?? 0) !== 0) openErrors.push('AC-01–AC-30: полный generic контур не завершён');
  return {
    schemaVersion: 1,
    checkpoint: 'G2',
    status: openErrors.length ? 'limited' : 'passed',
    verificationStatus: options.verificationStatus ?? 'passed',
    generatedAt: options.generatedAt ?? null,
    runId: run.runId,
    commit: run.commit,
    command: options.command,
    browserCommand: 'KSHVI_BASE_URL=http://127.0.0.1:5174 npx playwright test apps/editor/tests/kshvi-workspaces.spec.ts --reporter=line --workers=1',
    tasks: ['Task 32', 'Task 33', 'Task 34', 'Task 35', 'Task 36'],
    requirements,
    acceptanceIds,
    sessionIds: run.sessionIds,
    checks: run.checks,
    coverage: run.coverage,
    infrastructure,
    genericAcceptance: options.genericStatus === undefined ? null : { status: options.genericStatus === 0 ? 'passed' : 'failed' },
    scenarioHash: run.scenarioHash,
    environmentHash: run.environmentHash,
    journal: { eventCount: run.events.length, sha256: digest(run.events), finalHash: run.events.at(-1)?.hash ?? null },
    directOutcomeWrites,
    artifacts: ['docs/release/kshvi/evidence/g2-journal.json', 'docs/release/kshvi/evidence/g2-infrastructure.json', ...screenshotArtifacts],
    openErrors,
  };
}

function runG2(options) {
  const root = options.cwd ?? process.cwd();
  if (!process.env.TEST_DATABASE_URL) throw new Error('Для G2 нужен проверенный TEST_DATABASE_URL; in-memory fallback запрещён');
  const currentCommit = options.currentCommit ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const runId = randomUUID();
  const sources = [
    readFileSync(resolve(root, 'services/kshvi/tests/e2e/conduct-cycle.test.ts'), 'utf8'),
    readFileSync(resolve(root, 'apps/editor/tests/kshvi-conduct-cycle.test.tsx'), 'utf8'),
  ];
  const writeIssues = assertNoDirectOutcomeWrites(sources);
  if (writeIssues.length) throw new Error(`Обнаружена прямая запись исходов: ${writeIssues.join(', ')}`);
  const files = ['services/kshvi/tests/e2e/conduct-cycle.test.ts', 'services/kshvi/tests/official-commands.test.ts', 'apps/editor/tests/kshvi-conduct-cycle.test.tsx'];
  const command = `npx vitest run ${files.join(' ')}`;
  const completed = spawnSync('npx', ['vitest', 'run', ...files], {
    cwd: root, env: { ...process.env, KSHVI_G2_EVIDENCE: '1', KSHVI_G2_RUN_ID: runId }, encoding: 'utf8', stdio: 'inherit',
  });
  if (completed.status !== 0) return { status: completed.status ?? 1 };
  const journalPath = resolve(root, 'docs/release/kshvi/evidence/g2-journal.json');
  if (!existsSync(journalPath)) throw new Error('Сквозной сценарий не сформировал свежий журнал');
  const run = JSON.parse(readFileSync(journalPath, 'utf8'));
  const freshnessIssues = assertFreshG2Run(run, { runId, currentCommit });
  if (freshnessIssues.length) throw new Error(`Свежий G2 не принят: ${freshnessIssues.join('; ')}`);
  const evidence = buildG2Evidence(run, { command, generatedAt: new Date().toISOString(), genericStatus: options.genericStatus });
  for (const artifact of evidence.artifacts) if (!existsSync(resolve(root, artifact))) throw new Error(`Отсутствует артефакт доказательства: ${artifact}`);
  writeFileSync(resolve(root, 'docs/release/kshvi/g2-conduct.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`G2: запуск ${runId}; статус ${evidence.status}; событий ${evidence.journal.eventCount}.`);
  if (options.requireComplete && evidence.status !== 'passed') return { status: 1, evidence };
  return { status: 0, evidence };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const options = resolveRunMode(process.argv.slice(2));
    const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
    const executionRoot = options.freshInstall ? prepareFreshAcceptanceWorkspace({ root: process.cwd(), offline: options.offline }) : process.cwd();
    if (options.offline) {
      process.env.KSHVI_OFFLINE = '1';
      process.env.KSHVI_EXTERNAL_NETWORK = '0';
      const guard = resolve(executionRoot, 'scripts/kshvi-network-guard.mjs');
      process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import ${guard}`.trim();
    }
    const generic = options.generic ? await runAcceptance({ ...options, cwd: executionRoot, currentCommit, writeEvidence: options.writeGenericEvidence }) : { status: 0, results: [] };
    const fullGeneric = options.from === 1 && options.to === 30;
    const g2 = options.g2 ? runG2({ cwd: executionRoot, currentCommit, requireComplete: options.requireComplete, genericStatus: generic.status || !fullGeneric ? 1 : 0 }) : { status: 0 };
    process.exitCode = generic.status || g2.status;
  } catch (error) {
    console.error(`Приёмка КШВИ остановлена: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
