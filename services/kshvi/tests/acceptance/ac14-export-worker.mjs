import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createPool } from '@def-ops/db';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const completed = (kind, startedAtMs, extra) => ({ kind, startedAtMs, completedAtMs: Date.now(), ...extra });

function initialReplayState(domains) {
  return {
    domains: Object.fromEntries(domains.map(domain => [domain,
      domain === 'EventFeed' ? { status: 'KNOWN', items: [] } : { status: 'UNKNOWN', reason: 'В нагрузочном журнале домен не поступал' },
    ])),
    appliedEventIds: [], eventCauses: {},
  };
}
function replayArchive(instanceId, rows, api) {
  const branchId = 'main';
  const replayEvents = rows.map((row, index) => ({
    eventId: row.event_id, branchId, sequence: Number(row.sequence), type: row.type,
    operationalAt: row.payload.at ?? '2030-01-01T01:00:00Z', wallClockAt: row.payload.at ?? '2030-01-01T01:00:00Z',
    payload: row.payload,
    changes: [{
      domain: 'EventFeed',
      value: { status: 'KNOWN', items: rows.slice(0, index + 1).map(item => ({ eventId: item.event_id, type: item.type, payload: item.payload })) },
    }],
    reducerVersion: 1,
  }));
  const state = initialReplayState(api.REPLAY_DOMAINS);
  return {
    archiveId: `ac14-${instanceId}`, organizationId: rows[0]?.organization_id ?? 'org-ac14', schemaVersion: 1, branchId,
    versions: {
      model: { id: 'ac14-model', revision: 1, sha256: '0'.repeat(64) },
      environment: { id: 'ac14-environment', revision: 1, sha256: '0'.repeat(64) }, reducerVersion: 1,
    },
    snapshots: [{ snapshotId: `snapshot-${instanceId}-0`, branchId, sequence: 0, operationalAt: '2030-01-01T01:00:00Z', wallClockAt: '2030-01-01T01:00:00Z', reducerVersion: 1, state, stateHash: api.replayStateHash(state) }],
    events: replayEvents, controlPoints: [],
  };
}
function runObserverReplay(rows, api) {
  const { REPLAY_DOMAINS, restoreAt, ReplayService } = api;
  const grouped = new Map();
  for (const row of rows) {
    const events = grouped.get(row.instance_id) ?? [];
    events.push(row);
    grouped.set(row.instance_id, events);
  }
  const service = new ReplayService();
  const hash = createHash('sha256');
  let eventCount = 0;
  let instanceCount = 0;
  for (const [instanceId, instanceRows] of grouped) {
    instanceRows.sort((left, right) => left.sequence - right.sequence);
    const archive = replayArchive(instanceId, instanceRows, api);
    const truth = restoreAt({ archive, cursor: instanceRows.length });
    if (truth.compatibility !== 'REPRODUCIBLE' || truth.appliedEventIds.length !== instanceRows.length) throw new Error(`Реплей ${instanceId} не восстановлен`);
    const frame = {
      participantId: 'observer-blue', role: 'TRAINEE', organizationId: archive.organizationId, sideId: 'blue', branchId: archive.branchId,
      sequence: instanceRows.length, policyRevision: 1, allowedEventIds: instanceRows.map(row => row.event_id), events: archive.events, state: truth.state,
    };
    const projected = service.project({
      archive, cursor: instanceRows.length, participantId: 'observer-blue', participantFrames: [frame],
      actor: { organizationId: archive.organizationId, userId: 'observer-blue', sideId: 'blue', role: 'TRAINEE', authorities: ['replay.read'] }, perspective: 'PARTICIPANT',
    });
    if (projected.source !== 'RECORDED_PARTICIPANT_PROJECTION' || projected.stateHash !== truth.stateHash || projected.events.length !== instanceRows.length) {
      throw new Error(`Перспектива наблюдателя ${instanceId} не совпадает с восстановленным журналом`);
    }
    hash.update(projected.stateHash);
    eventCount += instanceRows.length;
    instanceCount += 1;
  }
  return { instances: instanceCount, events: eventCount, stateHash: hash.digest('hex') };
}

async function withTypescript(task) {
  const { register } = await import('tsx/esm/api');
  const unregister = register();
  try { return await task(); } finally { unregister(); }
}

export default async function exportAc14({ payload, reportProgress }) {
  const startedAtMs = Date.now();
  const pool = createPool(payload.databaseUrl, 4);
  try {
    const result = await pool.query(
      `select organization_id, instance_id, branch_id, sequence, event_id, type, payload, prev_hash, hash from ${payload.schema}.events order by instance_id, sequence`,
    );
    const rows = result.rows;
    reportProgress(35);
    const kind = payload.jobKind;
    if (kind === 'MASS_CALCULATION') return withTypescript(async () => {
      const { replayCalculation } = await import('../../../../packages/kshvi/src/simulation/calculation.ts');
      let count = 0;
      const hash = createHash('sha256');
      for (const row of rows.filter(item => item.type === 'calculation.calculated.v1')) {
        if (!row.payload.calculation) throw new Error(`В событии ${row.event_id} отсутствует расчёт для повтора`);
        const replayed = replayCalculation(row.payload.calculation);
        if (replayed.inputHash !== row.payload.calculation.inputHash
          || replayed.intermediateResults.selectedOutcomeId !== row.payload.calculation.intermediateResults.selectedOutcomeId
          || replayed.randomKeys[0]?.digest !== row.payload.calculation.randomKeys[0]?.digest) {
          throw new Error(`Расчёт ${row.payload.calculation.id} не воспроизведён`);
        }
        hash.update(replayed.inputHash);
        hash.update(replayed.randomKeys[0].digest);
        count += 1;
      }
      if (!count) throw new Error('Массовое задание не нашло расчёты для повтора');
      reportProgress(90);
      return completed(kind, startedAtMs, { events: rows.length, calculations: count, sha256: hash.digest('hex') });
    });
    if (kind === 'BULK_REPLAY') return withTypescript(async () => {
      const [replayEngine, replayService] = await Promise.all([
        import('../../../../packages/kshvi/src/replay/replay-engine.ts'),
        import('../../src/replay/replay-service.ts'),
      ]);
      const replay = runObserverReplay(rows, { ...replayEngine, ...replayService });
      reportProgress(90);
      return completed(kind, startedAtMs, replay);
    });
    if (!['EXPORT', 'ARCHIVE'].includes(kind)) throw new Error(`Неизвестный тип нагрузочного задания: ${kind}`);
    const content = kind === 'ARCHIVE'
      ? {
          manifest: {
            schemaVersion: 1, kind: 'AC14_LOAD_ARCHIVE', eventCount: rows.length, journalSha256: digest(rows),
            missing: ['Полный снимок среды и автономный просмотр проверяются отдельно в AC-12'],
          },
          events: rows,
        }
      : rows;
    const compressed = gzipSync(JSON.stringify(content), { level: 9 });
    mkdirSync(dirname(payload.exportPath), { recursive: true });
    writeFileSync(payload.exportPath, compressed);
    reportProgress(90);
    return completed(kind, startedAtMs, {
      events: rows.length, compressedBytes: compressed.length, sha256: createHash('sha256').update(compressed).digest('hex'), path: payload.exportPath,
    });
  } finally {
    await pool.end();
  }
}
