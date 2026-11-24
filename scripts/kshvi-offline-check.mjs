import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');
const profilePath = resolve(root, 'deploy/kshvi/closed-lan/local-only.sb');

export function evaluateOfflineEvidence({ localAssetsVerified, externalRequests, physicalIsolation }) {
  const issues = [];
  if (!localAssetsVerified) issues.push('LOCAL_ASSETS_INVALID');
  if (externalRequests > 0) issues.push('EXTERNAL_REQUESTS_DETECTED');
  if (physicalIsolation === 'failed') issues.push('PHYSICAL_ISOLATION_FAILED');
  if (issues.length) return { status: 'failed', issues };
  if (physicalIsolation === 'not-verified') return { status: 'blocked', issues: ['PHYSICAL_ISOLATION_NOT_VERIFIED'] };
  return { status: 'passed', issues: [] };
}

function verifyLocalAssets() {
  const errors = [];
  const manifestPath = resolve(root, 'packages/kshvi/assets/manifest.json');
  const runtimePath = resolve(root, 'deploy/kshvi/runtime.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'));
  if (runtime.network?.mode !== 'closed-lan' || runtime.network?.externalAccess !== false) errors.push('RUNTIME_NOT_CLOSED');
  if (runtime.network?.minWorkstations !== 2 || runtime.network?.maxWorkstations !== 50) errors.push('WORKSTATION_RANGE_INVALID');
  if (runtime.assets?.remoteResources !== false) errors.push('REMOTE_RESOURCES_ENABLED');
  if (/https?:\/\//i.test(JSON.stringify(manifest)) || /https?:\/\//i.test(JSON.stringify(runtime))) errors.push('EXTERNAL_URL_IN_CONFIGURATION');
  const assets = [];
  for (const asset of manifest.assets ?? []) {
    const path = resolve(root, 'packages/kshvi/assets', asset.path);
    if (!existsSync(path)) {
      errors.push(`MISSING:${asset.path}`);
      continue;
    }
    const content = readFileSync(path);
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (sha256 !== asset.sha256) errors.push(`SHA256:${asset.path}`);
    if (!asset.offlineReady || !asset.attribution || !asset.license) errors.push(`METADATA:${asset.path}`);
    assets.push({ id: asset.id, kind: asset.kind, path: asset.path, bytes: content.length, sha256 });
  }
  if (!existsSync(profilePath)) errors.push('MISSING:deploy/kshvi/closed-lan/local-only.sb');
  return { localAssetsVerified: errors.length === 0, errors, assets };
}

function connectProbe(host, port, timeoutMs = 3000) {
  return new Promise(resolveProbe => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ connected: true, code: null }));
    socket.once('timeout', () => finish({ connected: false, code: 'ETIMEDOUT' }));
    socket.once('error', error => finish({ connected: false, code: error?.code ?? 'UNKNOWN', message: String(error?.message ?? error) }));
  });
}

async function sandboxProbe(localPort) {
  const local = await connectProbe('127.0.0.1', localPort);
  const external = await connectProbe(process.env.KSHVI_EXTERNAL_PROBE_IP ?? '93.184.216.34', 443);
  return { local, external };
}

export function buildSandboxArguments(localPort) {
  return ['-f', profilePath, process.execPath, scriptPath, '--sandbox-probe', '--local-port', String(localPort)];
}

function probeSandboxIsolation() {
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) {
    return { status: 'not-verified', reason: 'sandbox-exec недоступен; физическая изоляция не подтверждена' };
  }
  return new Promise(resolveProbe => {
    const localServer = net.createServer();
    localServer.listen(0, '127.0.0.1', () => {
      const address = localServer.address();
      const localPort = typeof address === 'object' && address ? address.port : 0;
      const result = spawnSync('/usr/bin/sandbox-exec', buildSandboxArguments(localPort), {
        encoding: 'utf8', timeout: 15_000, env: { ...process.env, KSHVI_OFFLINE: '1' },
      });
      localServer.close();
      if (result.error || result.status !== 0) {
        resolveProbe({ status: 'not-verified', reason: 'Профиль изоляции не запустился', error: String(result.error ?? ''), stderr: result.stderr, stdout: result.stdout, exitStatus: result.status });
        return;
      }
      let probe;
      try { probe = JSON.parse(result.stdout.trim().split('\n').at(-1)); }
      catch {
        resolveProbe({ status: 'not-verified', reason: 'Дочерний протокол изоляции нечитаем', stdout: result.stdout, stderr: result.stderr });
        return;
      }
      if (!probe.local?.connected) {
        resolveProbe({ status: 'not-verified', reason: 'Локальное TCP-соединение внутри профиля не удалось', probe });
      } else if (probe.external?.connected) {
        resolveProbe({ status: 'failed', reason: 'Внешнее TCP-соединение не было запрещено', probe });
      } else if (['EACCES', 'EPERM'].includes(probe.external?.code)) {
        resolveProbe({ status: 'passed', reason: `Внешнее TCP-соединение запрещено ядром (${probe.external.code})`, probe });
      } else {
        resolveProbe({ status: 'not-verified', reason: 'Внешнее соединение не состоялось без подтверждения запрета политики', probe });
      }
    });
    localServer.once('error', error => resolveProbe({ status: 'not-verified', reason: 'Не удалось открыть локальный TCP-пробник', error: String(error) }));
  });
}

export async function runOfflineCheck({ denyExternal = false, physicalProbe } = {}) {
  const local = verifyLocalAssets();
  const externalRequests = 0;
  const probe = physicalProbe
    ? await physicalProbe()
    : denyExternal
      ? await probeSandboxIsolation()
      : { status: 'not-verified', reason: 'Флаг --deny-external не задан' };
  const physical = typeof probe === 'string' ? { status: probe, reason: 'Результат передан проверкой' } : probe;
  const evaluation = evaluateOfflineEvidence({ localAssetsVerified: local.localAssetsVerified, externalRequests, physicalIsolation: physical.status });
  return {
    ...evaluation,
    localAssetsVerified: local.localAssetsVerified,
    localAssetErrors: local.errors,
    assets: local.assets,
    externalRequests,
    processChecks: { localConfigurationOnly: true, externalFetchExecuted: false },
    physicalIsolation: physical,
    limitations: physical.status === 'passed' ? [] : ['Закрытие внешней сети на физическом стенде требует отдельного подтверждения'],
  };
}

function parseArgs(argv) {
  const options = { denyExternal: false, output: null, sandboxProbe: false, localPort: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--deny-external') options.denyExternal = true;
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--sandbox-probe') options.sandboxProbe = true;
    else if (arg === '--local-port') options.localPort = Number(argv[++index]);
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  return options;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.sandboxProbe) {
      const probe = await sandboxProbe(options.localPort);
      process.stdout.write(`${JSON.stringify(probe)}\n`);
    } else {
      const startedAt = new Date().toISOString();
      const report = await runOfflineCheck(options);
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root }).trim();
      const record = { schemaVersion: 1, id: 'NF-01-OFFLINE', startedAt, finishedAt: new Date().toISOString(), commit, command: 'node scripts/kshvi-offline-check.mjs --deny-external', ...report };
      if (options.output) {
        const output = resolve(options.output);
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, `${JSON.stringify({ ...record, artifacts: [output] }, null, 2)}\n`);
      }
      process.stdout.write(`${JSON.stringify({ status: record.status, issues: record.issues, physicalIsolation: record.physicalIsolation.status, assets: record.assets.length }, null, 2)}\n`);
      process.exitCode = record.status === 'passed' ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
