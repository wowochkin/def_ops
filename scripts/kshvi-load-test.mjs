import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');

export function buildNfEvidence({ report, thresholdIssues, offlineStatus, ntpStatus, networkScope }) {
  const failed = (id, checks, openErrors) => ({ id, status: 'failed', checks, openErrors });
  const blocked = (id, checks, openErrors) => ({ id, status: 'blocked', checks, openErrors });
  const passed = (id, checks) => ({ id, status: 'passed', checks, openErrors: [] });
  const nf01Checks = { offlineStatus, networkScope, connections: report.connections, activeParticipants: report.activeParticipants };
  const nf02Issues = thresholdIssues.filter(issue => ['DELIVERY_P95_EXCEEDED', 'MAP_P95_EXCEEDED', 'DELIVERY_MEASUREMENTS_MISSING', 'MAP_MEASUREMENTS_MISSING', 'DELIVERY_MISSING'].includes(issue));
  const nf04Issues = thresholdIssues.filter(issue => /^(HEAVY|DELIVERY|MAP|CONFIRMED|DUPLICATE|ORDERING)/.test(issue));
  return [
    offlineStatus === 'failed'
      ? failed('NF-01', nf01Checks, ['OFFLINE_CHECK_FAILED'])
      : offlineStatus !== 'passed' || networkScope !== 'physical-lan'
        ? blocked('NF-01', nf01Checks, [offlineStatus !== 'passed' ? 'OFFLINE_CHECK_NOT_PASSED' : 'PHYSICAL_LAN_NOT_VERIFIED'])
        : passed('NF-01', nf01Checks),
    nf02Issues.length
      ? failed('NF-02', { delivery: report.delivery, map: report.map, deliveryMissing: report.deliveryMissing }, nf02Issues)
      : networkScope !== 'physical-lan'
        ? blocked('NF-02', { delivery: report.delivery, map: report.map, deliveryMissing: report.deliveryMissing, measurementStatus: 'passed' }, ['PHYSICAL_LAN_NOT_VERIFIED'])
        : passed('NF-02', { delivery: report.delivery, map: report.map, deliveryMissing: report.deliveryMissing }),
    thresholdIssues.length
      ? failed('NF-03', { sustained: report.sustained, burst: report.burst, dataset: report.dataset, confirmedLost: report.confirmedLost, duplicateEffects: report.duplicateEffects, orderingErrors: report.orderingErrors }, thresholdIssues)
      : networkScope !== 'physical-lan'
        ? blocked('NF-03', { sustained: report.sustained, burst: report.burst, dataset: report.dataset, confirmedLost: report.confirmedLost, duplicateEffects: report.duplicateEffects, orderingErrors: report.orderingErrors, measurementStatus: 'passed' }, ['PHYSICAL_LAN_NOT_VERIFIED'])
        : passed('NF-03', { sustained: report.sustained, burst: report.burst, dataset: report.dataset, confirmedLost: report.confirmedLost, duplicateEffects: report.duplicateEffects, orderingErrors: report.orderingErrors }),
    nf04Issues.length
      ? failed('NF-04', { heavyJobs: report.heavyJobs, deliveryP95Ms: report.delivery.p95Ms, mapP95Ms: report.map.p95Ms }, nf04Issues)
      : networkScope !== 'physical-lan'
        ? blocked('NF-04', { heavyJobs: report.heavyJobs, deliveryP95Ms: report.delivery.p95Ms, mapP95Ms: report.map.p95Ms, measurementStatus: 'passed' }, ['PHYSICAL_LAN_NOT_VERIFIED'])
        : passed('NF-04', { heavyJobs: report.heavyJobs, deliveryP95Ms: report.delivery.p95Ms, mapP95Ms: report.map.p95Ms }),
    !report.time.clientClockIndependent
      ? failed('NF-05', { time: report.time, ntpStatus }, ['CLIENT_CLOCK_AFFECTED_OPERATIONAL_TIME'])
      : ntpStatus === 'failed'
        ? failed('NF-05', { time: report.time, ntpStatus }, ['NTP_CHECK_FAILED'])
        : ntpStatus !== 'passed'
          ? blocked('NF-05', { time: report.time, ntpStatus }, ['LOCAL_NTP_NOT_VERIFIED'])
          : passed('NF-05', { time: report.time, ntpStatus }),
  ];
}

function parseArgs(argv) {
  const options = {
    connections: 50, active: 25, rate: 5, sustainedSeconds: 60, burstRate: 20, burstSeconds: 60,
    output: 'docs/release/kshvi/nonfunctional/load-distributions.json',
    offlineEvidence: null, networkScope: 'loopback',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--connections') options.connections = Number(argv[++index]);
    else if (arg === '--active') options.active = Number(argv[++index]);
    else if (arg === '--rate') options.rate = Number(argv[++index]);
    else if (arg === '--sustained-seconds') options.sustainedSeconds = Number(argv[++index]);
    else if (arg === '--burst-rate') options.burstRate = Number(argv[++index]);
    else if (arg === '--burst-seconds') options.burstSeconds = Number(argv[++index]);
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--offline-evidence') options.offlineEvidence = argv[++index];
    else if (arg === '--network-scope') options.networkScope = argv[++index];
    else throw new Error(`Неизвестный аргумент: ${arg}`);
  }
  if (!['loopback', 'physical-lan'].includes(options.networkScope)) throw new Error('network-scope должен быть loopback или physical-lan');
  return options;
}

function checkLocalNtp() {
  const chrony = spawnSync('chronyc', ['tracking'], { encoding: 'utf8', timeout: 5000 });
  if (!chrony.error && chrony.status === 0 && /Leap status\s*:\s*Normal/.test(chrony.stdout)) {
    return { status: 'passed', mechanism: 'chronyc tracking', output: chrony.stdout };
  }
  const ntpstat = spawnSync('ntpstat', [], { encoding: 'utf8', timeout: 5000 });
  if (!ntpstat.error && ntpstat.status === 0) return { status: 'passed', mechanism: 'ntpstat', output: ntpstat.stdout };
  if (chrony.error?.code === 'ENOENT' && ntpstat.error?.code === 'ENOENT') {
    return { status: 'not-verified', mechanism: null, openError: 'chronyc и ntpstat недоступны; локальная синхронизация не доказана' };
  }
  return { status: 'failed', mechanism: 'chronyc/ntpstat', chrony: { status: chrony.status, stdout: chrony.stdout, stderr: chrony.stderr }, ntpstat: { status: ntpstat.status, stdout: ntpstat.stdout, stderr: ntpstat.stderr } };
}

async function captureStandCard(networkScope) {
  const browsers = {};
  try {
    const { chromium, firefox } = await import('playwright');
    for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
      try {
        const browser = await type.launch({ headless: true });
        browsers[name] = { version: browser.version(), launched: true };
        await browser.close();
      } catch (error) {
        browsers[name] = { version: null, launched: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  } catch (error) {
    browsers.error = error instanceof Error ? error.message : String(error);
  }
  const cpuCount = os.cpus().length;
  const memoryBytes = os.totalmem();
  const limitations = [];
  if (cpuCount < 8) limitations.push('Меньше 8 ядер CPU');
  if (memoryBytes < 16 * 1024 ** 3) limitations.push('Меньше 16 ГБ ОЗУ');
  if (networkScope !== 'physical-lan') limitations.push('Соединения созданы на loopback одного узла, а не на отдельных рабочих местах LAN');
  if (Object.values(browsers).some(value => value && typeof value === 'object' && value.launched === false)) limitations.push('Не все поддерживаемые браузеры запущены');
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: { model: os.cpus()[0]?.model ?? null, logicalCores: cpuCount, meetsMinimum: cpuCount >= 8 },
    memory: { bytes: memoryBytes, gibibytes: memoryBytes / 1024 ** 3, meetsMinimum: memoryBytes >= 16 * 1024 ** 3 },
    network: { scope: networkScope, ratedBandwidthMbps: null, externalAccessDeniedBySandboxEvidence: true },
    node: process.version,
    browsers,
    limitations,
  };
}

async function main(options) {
  const output = resolve(options.output);
  const evidenceDir = dirname(output);
  mkdirSync(evidenceDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const command = `node scripts/kshvi-load-test.mjs --connections ${options.connections} --active ${options.active} --rate ${options.rate} --burst-rate ${options.burstRate} --burst-seconds ${options.burstSeconds}`;
  let report;
  let thresholdIssues = [];
  let executionError = null;
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    executionError = 'TEST_DATABASE_URL не задан; нагрузка не выполнялась';
    thresholdIssues = ['LOAD_EXECUTION_FAILED'];
  } else {
    const { register } = await import('tsx/esm/api');
    const unregister = register();
    try {
      const { createPool, dropSchema } = await import('@def-ops/db');
      const { randomUUID } = await import('node:crypto');
      const { KshviEventStore } = await import('../services/kshvi/src/store/event-store.ts');
      const { createFixturePlan, materializeFixture } = await import('../services/kshvi/src/performance/fixture-generator.ts');
      const { runLoadTest } = await import('../services/kshvi/src/performance/load-generator.ts');
      const { evaluateLoadThresholds } = await import('../services/kshvi/src/performance/latency-collector.ts');
      const pool = createPool(databaseUrl, 32);
      const schema = `kshvi_accept_${randomUUID().replaceAll('-', '')}`;
      const store = new KshviEventStore({ pool, schema });
      try {
        await store.init();
        const plan = createFixturePlan(`acceptance-${Date.now()}`);
        await materializeFixture(store, plan);
        report = await runLoadTest(store, plan, {
          connections: options.connections,
          activeParticipants: options.active,
          sustainedRate: options.rate,
          sustainedSeconds: options.sustainedSeconds,
          burstRate: options.burstRate,
          burstSeconds: options.burstSeconds,
          heavyJobKinds: ['EXPORT', 'ARCHIVE', 'MASS_CALCULATION', 'REPLAY'],
          continuousHeavyJobs: true,
        });
        thresholdIssues = evaluateLoadThresholds({
          connections: report.connections,
          activeParticipants: report.activeParticipants,
          deliveryP95Ms: report.delivery.p95Ms,
          mapP95Ms: report.map.p95Ms,
          confirmedLost: report.confirmedLost,
          duplicateEffects: report.duplicateEffects,
          orderingErrors: report.orderingErrors,
          deliveryMissing: report.deliveryMissing,
          sustained: report.sustained,
          burst: report.burst,
          dataset: report.dataset,
          heavyJobs: report.heavyJobs,
        });
        if (report.commands.failed > 0 || report.commands.confirmed !== report.commands.attempted) thresholdIssues.push('COMMANDS_FAILED');
        if (report.duplicateDeliveries > 0) thresholdIssues.push('DUPLICATE_DELIVERIES');
      } catch (error) {
        executionError = error instanceof Error ? error.stack : String(error);
        thresholdIssues = ['LOAD_EXECUTION_FAILED'];
      } finally {
        await dropSchema(pool, schema);
        await pool.end();
      }
    } finally {
      unregister();
    }
  }
  const offlinePath = resolve(options.offlineEvidence ?? resolve(evidenceDir, 'offline.json'));
  const offline = existsSync(offlinePath) ? JSON.parse(readFileSync(offlinePath, 'utf8')) : { status: 'blocked' };
  const ntp = checkLocalNtp();
  const standCard = await captureStandCard(options.networkScope);
  const standCardPath = resolve(evidenceDir, 'stand-card.json');
  writeFileSync(standCardPath, `${JSON.stringify(standCard, null, 2)}\n`);
  const evidence = buildNfEvidence({
    report: report ?? {
      connections: 0, activeParticipants: 0, delivery: { p95Ms: null, samples: 0 }, map: { p95Ms: null, samples: 0 }, deliveryMissing: 0,
      confirmedLost: 0, duplicateEffects: 0, orderingErrors: 0, sustained: {}, burst: {}, dataset: {}, heavyJobs: {}, time: { clientClockIndependent: false },
    },
    thresholdIssues,
    offlineStatus: offline.status,
    ntpStatus: ntp.status,
    networkScope: options.networkScope,
  });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root }).trim();
  const finishedAt = new Date().toISOString();
  for (const item of evidence) {
    const path = resolve(evidenceDir, `${item.id}.json`);
    const record = { schemaVersion: 1, ...item, startedAt, finishedAt, commit, command, executionError, artifacts: [path, output, standCardPath, offlinePath] };
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  }
  const overallStatus = executionError || evidence.some(item => item.status === 'failed') ? 'failed' : evidence.some(item => item.status === 'blocked') ? 'blocked' : 'passed';
  const record = {
    schemaVersion: 1, status: overallStatus, startedAt, finishedAt, commit, command, transport: report?.transport ?? null,
    report: report ?? null, thresholdIssues, executionError, offlineEvidence: offlinePath, ntp,
    nf: evidence.map(({ id, status, openErrors }) => ({ id, status, openErrors })),
    artifacts: [output, standCardPath, ...evidence.map(item => resolve(evidenceDir, `${item.id}.json`))],
    limitations: standCard.limitations,
  };
  writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ status: overallStatus, thresholdIssues, executionError, deliveryP95Ms: report?.delivery.p95Ms ?? null, mapP95Ms: report?.map.p95Ms ?? null, commands: report?.commands ?? null, nf: record.nf }, null, 2));
  return overallStatus === 'passed' ? 0 : 1;
}

if (resolve(process.argv[1] ?? '') === scriptPath) {
  try { process.exitCode = await main(parseArgs(process.argv.slice(2))); }
  catch (error) { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; }
}
