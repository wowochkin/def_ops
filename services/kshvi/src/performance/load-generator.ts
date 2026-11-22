import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { ResourceBudget } from '../admin/resource-budget';
import { SubscriptionService } from '../http/subscription-service';
import type { KshviEventStore } from '../store/event-store';
import type { FixturePlan } from './fixture-generator';
import { createLatencyDistribution, type LatencyDistribution, type LoadPhaseReport } from './latency-collector';

export type HeavyJobKind = 'EXPORT' | 'ARCHIVE' | 'MASS_CALCULATION' | 'REPLAY';

export type LoadTestOptions = Readonly<{
  connections: number;
  activeParticipants: number;
  sustainedRate: number;
  sustainedSeconds: number;
  burstRate: number;
  burstSeconds: number;
  heavyJobKinds?: readonly HeavyJobKind[];
  continuousHeavyJobs?: boolean;
}>;

export type LoadTestReport = Readonly<{
  schemaVersion: 1;
  transport: 'HTTP+SSE+PostgreSQL';
  connections: number;
  activeParticipants: number;
  commands: Readonly<{ attempted: number; confirmed: number; failed: number; idempotentReplays: number }>;
  delivery: LatencyDistribution;
  map: LatencyDistribution;
  confirmedLost: number;
  duplicateEffects: number;
  duplicateDeliveries: number;
  orderingErrors: number;
  deliveryMissing: number;
  sustained: LoadPhaseReport;
  burst: LoadPhaseReport;
  dataset: Readonly<{ instances: number; forces: number; events: number }>;
  heavyJobs: Readonly<{ attempted: number; completed: number; failed: number; maxRunning: number; results: readonly unknown[]; resultsTruncated: number }>;
  time: Readonly<{ clientClockIndependent: boolean; serverSamples: readonly unknown[] }>;
  scenario: Readonly<{ delayedCommands: number; configuredDelayMs: number }>;
  errors: readonly string[];
}>;

type PendingCommand = {
  eventId?: string;
  targetRecipient: number;
  delivered: boolean;
};

type CommandResponse = {
  eventId: string;
  sequence: number;
  idempotent: boolean;
};

const emptyDistribution = (): LatencyDistribution => ({ samples: 0, p50Ms: Number.NaN, p95Ms: Number.NaN, p99Ms: Number.NaN, maxMs: Number.NaN, rawMs: [] });
const delay = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function waitUntil(deadline: number): Promise<void> {
  while (true) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) return;
    await delay(Math.min(remaining, 50));
  }
}

function assertOptions(options: LoadTestOptions, plan: FixturePlan): void {
  if (!Number.isInteger(options.connections) || options.connections < 2) throw new Error('Нужно не менее двух TCP/SSE-соединений');
  if (!Number.isInteger(options.activeParticipants) || options.activeParticipants < 1 || options.activeParticipants > plan.instances.length) {
    throw new Error('Каждому активному участнику нужен отдельный инстанс эталонного набора');
  }
  for (const [value, name] of [[options.sustainedRate, 'устойчивый темп'], [options.burstRate, 'темп всплеска'], [options.sustainedSeconds, 'длительность устойчивой фазы'], [options.burstSeconds, 'длительность всплеска']] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Некорректное значение: ${name}`);
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.length;
    if (size > 1024 * 1024) throw new Error('Тело команды превышает 1 МБ');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function runWorker(kind: HeavyJobKind, rows: readonly unknown[]): Promise<unknown> {
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { createHash } = require('node:crypto');
    const hash = createHash('sha256');
    let checksum = 0;
    let previousSequence = 0;
    let orderingErrors = 0;
    for (const row of workerData.rows) {
      const text = JSON.stringify(row);
      hash.update(text);
      if (workerData.kind === 'MASS_CALCULATION') {
        for (let index = 0; index < text.length * 20; index += 1) checksum = (checksum * 33 + text.charCodeAt(index % text.length)) >>> 0;
      } else if (workerData.kind === 'REPLAY') {
        const sequence = Number(row.sequence);
        if (previousSequence && sequence < previousSequence) orderingErrors += 1;
        previousSequence = sequence;
        checksum = (checksum + sequence) >>> 0;
      } else {
        checksum = (checksum + text.length) >>> 0;
      }
    }
    parentPort.postMessage({ kind: workerData.kind, rows: workerData.rows.length, sha256: hash.digest('hex'), checksum, orderingErrors });
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { kind, rows }, resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error(`Тяжёлое задание завершилось с кодом ${code}`)); });
  });
}

async function startNetworkStand(store: KshviEventStore, plan: FixturePlan) {
  const clients = new Map<number, { response: ServerResponse; subscription: SubscriptionService }>();
  const mapState = new Map(plan.instances.map(instance => [instance.instanceId, { lastEventId: null as string | null, sequence: instance.eventCount }]));
  const budget = new ResourceBudget({ maxConcurrentHeavyJobs: 2, maxQueuedHeavyJobs: 16, cpuUnitsPerJob: 2, memoryMbPerJob: 128 });
  let nextClientId = 0;
  let runningHeavy = 0;
  let maxRunningHeavy = 0;
  let heavySequence = 0;
  const serverStartedAt = Date.now();

  const broadcast = (input: { eventId: string; sequence: number; type: string; payload: unknown; instanceId: string; idempotencyKey: string }) => {
    const publishedAt = performance.now();
    for (const [clientId, client] of clients) {
      if (!client.subscription.seen(input.eventId, input.sequence)) continue;
      const payload = client.subscription.payloadFor({ ...input, payload: input.payload as { side?: string } & Record<string, unknown> }, {
        side: 'blue', role: 'LEADER', scope: 'truth', operationalAt: new Date().toISOString(),
      });
      const data = { ...payload, eventId: input.eventId, sequence: input.sequence, instanceId: input.instanceId, idempotencyKey: input.idempotencyKey, clientId, publishedAt };
      client.response.write(`event: command.committed\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const runHeavy = async (kind: HeavyJobKind, response: ServerResponse) => {
    const id = `heavy-${heavySequence += 1}`;
    try {
      const initial = budget.submit({ id, kind, cpuUnits: 2, memoryMb: 128 });
      if (initial.status === 'RUNNING') {
        runningHeavy += 1;
        maxRunningHeavy = Math.max(maxRunningHeavy, runningHeavy);
      }
      while (budget.status(id) === 'QUEUED') await delay(2);
      if (initial.status === 'QUEUED') {
        runningHeavy += 1;
        maxRunningHeavy = Math.max(maxRunningHeavy, runningHeavy);
      }
      const rows = await store.pool.query(
        `select event_id, instance_id, sequence, type, payload, hash from ${store.schema}.events
         where organization_id = $1 order by instance_id, sequence limit 500`,
        [plan.organizationId],
      );
      const result = await runWorker(kind, rows.rows);
      runningHeavy -= 1;
      budget.complete(id);
      sendJson(response, 200, { id, status: 'succeeded', result });
    } catch (error) {
      sendJson(response, 500, { id, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  };

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/events') {
        const clientId = nextClientId;
        nextClientId += 1;
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        response.write('retry: 1000\n\n');
        clients.set(clientId, { response, subscription: new SubscriptionService() });
        response.write(`event: ready\ndata: ${JSON.stringify({ clientId })}\n\n`);
        request.on('close', () => clients.delete(clientId));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/commands') {
        if (request.headers['x-tenant-id'] !== plan.organizationId) return sendJson(response, 403, { error: 'Неверная организация' });
        const body = await readJson(request);
        const instanceId = String(body.instanceId ?? '');
        const sequence = Number(body.aggregateRevision);
        const input = {
          organizationId: plan.organizationId,
          instanceId,
          branchId: plan.branchId,
          aggregateRevision: sequence,
          idempotencyKey: String(body.idempotencyKey ?? ''),
          type: String(body.type ?? ''),
          payload: (body.payload ?? {}) as never,
        };
        const result = await store.appendCommand(input);
        if (!result.idempotent) {
          mapState.set(instanceId, { lastEventId: result.eventId, sequence: result.sequence });
          const scenarioDelayMs = Math.max(0, Number(body.scenarioDelayMs ?? 0));
          if (scenarioDelayMs > 0) await delay(scenarioDelayMs);
          broadcast({ ...result, type: input.type, payload: input.payload, instanceId, idempotencyKey: input.idempotencyKey });
        }
        return sendJson(response, 200, result satisfies CommandResponse);
      }
      if (request.method === 'GET' && url.pathname.startsWith('/map/')) {
        const instanceId = decodeURIComponent(url.pathname.slice('/map/'.length));
        return sendJson(response, 200, mapState.get(instanceId) ?? { lastEventId: null, sequence: 0 });
      }
      if (request.method === 'GET' && url.pathname === '/time') {
        const serverTimeMs = Date.now();
        return sendJson(response, 200, {
          clientTimeMs: Number(url.searchParams.get('clientTimeMs')),
          serverTimeMs,
          operationalTimeMs: serverTimeMs,
          source: 'authoritative-server',
          processMonotonicMs: performance.now(),
          serverStartedAt,
        });
      }
      if (request.method === 'POST' && url.pathname.startsWith('/heavy/')) {
        const kind = url.pathname.slice('/heavy/'.length) as HeavyJobKind;
        if (!['EXPORT', 'ARCHIVE', 'MASS_CALCULATION', 'REPLAY'].includes(kind)) return sendJson(response, 404, { error: 'Неизвестное задание' });
        return runHeavy(kind, response);
      }
      sendJson(response, 404, { error: 'Маршрут не найден' });
    })().catch(error => sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Сетевой стенд не получил TCP-порт');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    maxRunningHeavy: () => maxRunningHeavy,
    close: async () => {
      for (const client of clients.values()) client.response.end();
      clients.clear();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

function openEventStream(baseUrl: string, recipient: number, onEvent: (recipient: number, data: Record<string, unknown>) => void): Promise<{ close: () => void }> {
  return new Promise((resolve, reject) => {
    const request = http.get(`${baseUrl}/events`, { headers: { accept: 'text/event-stream' } });
    const timeout = setTimeout(() => { request.destroy(new Error('Таймаут SSE ready')); }, 5000);
    let buffer = '';
    request.on('response', response => {
      if (response.statusCode !== 200) return reject(new Error(`SSE вернул ${response.statusCode}`));
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        buffer += chunk;
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const eventName = block.match(/^event: (.+)$/m)?.[1];
          const raw = block.match(/^data: (.+)$/m)?.[1];
          if (eventName === 'ready') {
            clearTimeout(timeout);
            resolve({ close: () => request.destroy() });
          } else if (eventName === 'command.committed' && raw) {
            onEvent(recipient, JSON.parse(raw) as Record<string, unknown>);
          }
          boundary = buffer.indexOf('\n\n');
        }
      });
    });
    request.on('error', error => { clearTimeout(timeout); reject(error); });
  });
}

async function fetchJson(baseUrl: string, path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

export async function runLoadTest(store: KshviEventStore, plan: FixturePlan, options: LoadTestOptions): Promise<LoadTestReport> {
  assertOptions(options, plan);
  const stand = await startNetworkStand(store, plan);
  const errors: string[] = [];
  const pending = new Map<string, PendingCommand>();
  const deliveryRaw: number[] = [];
  const mapRaw: number[] = [];
  const confirmedEventIds = new Set<string>();
  const lastSequences = new Map<string, number>();
  let duplicateDeliveries = 0;
  let orderingErrors = 0;
  let attempted = 0;
  let confirmed = 0;
  let failed = 0;
  let idempotentReplays = 0;
  let commandIndex = 0;
  let delayedCommands = 0;
  const configuredDelayMs = 25;
  const streams: { close: () => void }[] = [];

  const onEvent = (recipient: number, data: Record<string, unknown>) => {
    const key = String(data.idempotencyKey);
    const item = pending.get(key);
    if (!item || item.targetRecipient !== recipient) return;
    if (item.delivered) {
      duplicateDeliveries += 1;
      return;
    }
    item.delivered = true;
    deliveryRaw.push(performance.now() - Number(data.publishedAt));
    const instanceId = String(data.instanceId);
    const sequence = Number(data.sequence);
    const previous = lastSequences.get(instanceId) ?? plan.instances.find(instance => instance.instanceId === instanceId)?.eventCount ?? 0;
    if (sequence <= previous) orderingErrors += 1;
    lastSequences.set(instanceId, sequence);
  };

  try {
    for (let recipient = 0; recipient < options.connections; recipient += 1) {
      streams.push(await openEventStream(stand.baseUrl, recipient, onEvent));
    }
    let chains = Array.from({ length: options.activeParticipants }, () => Promise.resolve());

    const executeCommand = (participant: number, recipient: number, index: number) => {
      const instance = plan.instances[participant];
      if (!instance) throw new Error('Инстанс участника отсутствует');
      const key = `load-${index}`;
      const scenarioDelayMs = index % 10 === 0 ? configuredDelayMs : 0;
      if (scenarioDelayMs) delayedCommands += 1;
      const body = {
        instanceId: instance.instanceId,
        aggregateRevision: instance.eventCount + Math.floor(index / options.activeParticipants),
        idempotencyKey: key,
        type: index % 3 === 0 ? 'document.published.v1' : index % 3 === 1 ? 'communication.published.v1' : 'map.updated.v1',
        payload: { commandIndex: index, participant, side: 'blue' },
        scenarioDelayMs,
      };
      const item: PendingCommand = { targetRecipient: recipient, delivered: false };
      pending.set(key, item);
      attempted += 1;
      return fetchJson(stand.baseUrl, '/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-tenant-id': plan.organizationId },
        body: JSON.stringify(body),
      }).then(async result => {
        confirmed += 1;
        const eventId = String(result.eventId);
        item.eventId = eventId;
        confirmedEventIds.add(eventId);
        const mapStarted = performance.now();
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const projection = await fetchJson(stand.baseUrl, `/map/${encodeURIComponent(instance.instanceId)}`);
          if (projection.lastEventId === eventId) {
            mapRaw.push(performance.now() - mapStarted);
            break;
          }
          if (attempt === 99) throw new Error(`Карта не отразила ${eventId}`);
          await delay(10);
        }
        if (index < options.activeParticipants) {
          const replay = await fetchJson(stand.baseUrl, '/commands', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant-id': plan.organizationId }, body: JSON.stringify(body),
          });
          if (replay.idempotent !== true || replay.eventId !== eventId) throw new Error(`Повтор ${key} создал другой результат`);
          idempotentReplays += 1;
        }
      }).catch(error => {
        failed += 1;
        errors.push(error instanceof Error ? error.message : String(error));
      });
    };

    const runPhase = (rate: number, seconds: number): Promise<LoadPhaseReport> => {
      const commands = Math.round(rate * seconds);
      const phaseStarted = performance.now();
      const scheduled: number[] = [];
      const schedule = async () => {
        for (let index = 0; index < commands; index += 1) {
          const target = phaseStarted + index * 1000 / rate;
          await waitUntil(target);
          const participant = commandIndex % options.activeParticipants;
          const recipient = commandIndex % options.connections;
          const current = commandIndex;
          commandIndex += 1;
          scheduled.push(performance.now());
          chains[participant] = chains[participant]!.then(() => executeCommand(participant, recipient, current));
        }
        const phaseEnded = phaseStarted + seconds * 1000;
        await waitUntil(phaseEnded);
        const first = scheduled[0] ?? phaseStarted;
        const last = scheduled.at(-1) ?? phaseStarted;
        const measuredSpan = Math.max(seconds, (last - first) / 1000 + 1 / rate);
        return { targetRate: rate, achievedRate: commands / measuredSpan, durationSeconds: (performance.now() - phaseStarted) / 1000, commands };
      };
      return schedule();
    };

    const sustained = await runPhase(options.sustainedRate, options.sustainedSeconds);
    const heavyResults: unknown[] = [];
    const heavyKinds = options.heavyJobKinds ?? [];
    let heavyAttempted = 0;
    let heavyCompleted = 0;
    let heavyFailed = 0;
    let heavyStopped = false;
    const heavyLoops = heavyKinds.map(async kind => {
      do {
        heavyAttempted += 1;
        try {
          const result = await fetchJson(stand.baseUrl, `/heavy/${kind}`, { method: 'POST' });
          heavyCompleted += 1;
          if (heavyResults.length < 8) heavyResults.push(result);
        } catch (error) {
          heavyFailed += 1;
          errors.push(error instanceof Error ? error.message : String(error));
        }
      } while (options.continuousHeavyJobs && !heavyStopped);
    });
    const burst = await runPhase(options.burstRate, options.burstSeconds);
    heavyStopped = true;
    await Promise.all(chains);
    await Promise.all(heavyLoops);
    const deliveryDeadline = performance.now() + 6000;
    while ([...pending.values()].some(item => item.eventId && !item.delivered) && performance.now() < deliveryDeadline) await delay(10);

    const timeSamples = [
      await fetchJson(stand.baseUrl, '/time?clientTimeMs=0'),
      await fetchJson(stand.baseUrl, `/time?clientTimeMs=${Date.now() + 86_400_000}`),
    ];
    const clientClockIndependent = timeSamples.every(sample => Math.abs(Number(sample.operationalTimeMs) - Number(sample.serverTimeMs)) <= 1)
      && Math.abs(Number(timeSamples[1]?.operationalTimeMs) - Number(timeSamples[0]?.operationalTimeMs)) < 5000;

    const counts = await store.pool.query(
      `select count(*)::int as events, count(distinct event_id)::int as unique_events,
              count(distinct instance_id)::int as instances,
              coalesce(sum(case when type = 'fixture.forces.v1' then jsonb_array_length(payload->'forces') else 0 end), 0)::int as forces
       from ${store.schema}.events where organization_id = $1`,
      [plan.organizationId],
    );
    const expectedEvents = plan.instances.reduce((sum, instance) => sum + instance.eventCount, 0) + confirmedEventIds.size;
    const persisted = await store.pool.query(
      `select event_id::text from ${store.schema}.events where organization_id = $1 and event_id = any($2::uuid[])`,
      [plan.organizationId, [...confirmedEventIds]],
    );
    const persistedIds = new Set(persisted.rows.map(row => String(row.event_id)));
    const confirmedLost = [...confirmedEventIds].filter(eventId => !persistedIds.has(eventId)).length;
    const duplicateEffects = Math.max(0, Number(counts.rows[0]?.events) - expectedEvents)
      + Math.max(0, Number(counts.rows[0]?.events) - Number(counts.rows[0]?.unique_events));
    const sequences = await store.pool.query(
      `select instance_id, sequence from ${store.schema}.events where organization_id = $1 order by instance_id, sequence`,
      [plan.organizationId],
    );
    const expectedSequence = new Map<string, number>();
    for (const row of sequences.rows) {
      const next = (expectedSequence.get(row.instance_id) ?? 0) + 1;
      if (Number(row.sequence) !== next) orderingErrors += 1;
      expectedSequence.set(row.instance_id, Number(row.sequence));
    }
    const distribution = (values: readonly number[]) => values.length ? createLatencyDistribution(values) : emptyDistribution();
    return {
      schemaVersion: 1,
      transport: 'HTTP+SSE+PostgreSQL',
      connections: options.connections,
      activeParticipants: options.activeParticipants,
      commands: { attempted, confirmed, failed, idempotentReplays },
      delivery: distribution(deliveryRaw),
      map: distribution(mapRaw),
      confirmedLost,
      duplicateEffects,
      duplicateDeliveries,
      orderingErrors,
      deliveryMissing: [...pending.values()].filter(item => item.eventId && !item.delivered).length,
      sustained,
      burst,
      dataset: {
        instances: Number(counts.rows[0]?.instances),
        forces: Number(counts.rows[0]?.forces),
        events: plan.instances.reduce((sum, instance) => sum + instance.eventCount, 0),
      },
      heavyJobs: { attempted: heavyAttempted, completed: heavyCompleted, failed: heavyFailed, maxRunning: stand.maxRunningHeavy(), results: heavyResults, resultsTruncated: heavyCompleted - heavyResults.length },
      time: { clientClockIndependent, serverSamples: timeSamples },
      scenario: { delayedCommands, configuredDelayMs },
      errors,
    };
  } finally {
    for (const stream of streams) stream.close();
    await stand.close();
  }
}
