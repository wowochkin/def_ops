import {
  REPLAY_DOMAINS,
  REPLAY_FACT_TYPES,
  restoreAt,
  type ReplayArchive,
  type ReplayDomain,
  type ReplayEvent,
} from '../../src/replay/replay-engine';

const version = (id: string, revision = 1) => ({ id, revision, sha256: 'a'.repeat(64) });

export function replayDomains(value = 1): Record<ReplayDomain, unknown> {
  return Object.fromEntries(REPLAY_DOMAINS.map(domain => [domain, { value, items: [] }])) as Record<ReplayDomain, unknown>;
}

export function replayEvent(sequence: number, overrides: Partial<ReplayEvent> = {}): ReplayEvent {
  const type = REPLAY_FACT_TYPES[(sequence - 1) % REPLAY_FACT_TYPES.length];
  const domain = REPLAY_DOMAINS[(sequence - 1) % REPLAY_DOMAINS.length];
  return {
    eventId: `event-${sequence}`,
    branchId: 'official',
    sequence,
    type,
    operationalAt: `2026-11-21T06:${String(sequence).padStart(2, '0')}:00.000Z`,
    wallClockAt: `2026-11-21T09:${String(sequence).padStart(2, '0')}:00.000Z`,
    payload: { sequence, note: `Сохранённый факт ${sequence}` },
    causeIds: sequence > 1 ? [`event-${sequence - 1}`] : [],
    changes: [{ domain, value: { value: sequence + 1, items: [{ id: `object-${sequence}` }] } }],
    randomKey: sequence === 2 ? { seed: '7', purpose: 'scheduler', ordinal: 1, algorithmVersion: 1 } : null,
    ...overrides,
  };
}

export function makeReplayArchive(): ReplayArchive {
  const snapshotState = {
    domains: replayDomains(),
    appliedEventIds: [],
    eventCauses: {},
  };
  const archive: ReplayArchive = {
    archiveId: 'archive-1',
    schemaVersion: 1,
    branchId: 'official',
    versions: { model: version('model'), environment: version('environment'), reducerVersion: 1 },
    snapshots: [{
      snapshotId: 'snapshot-0', branchId: 'official', sequence: 0,
      operationalAt: '2026-11-21T06:00:00.000Z', wallClockAt: '2026-11-21T09:00:00.000Z',
      reducerVersion: 1, state: snapshotState,
    }, {
      snapshotId: 'snapshot-2', branchId: 'official', sequence: 2,
      operationalAt: '2026-11-21T06:02:00.000Z', wallClockAt: '2026-11-21T09:02:00.000Z',
      reducerVersion: 1, state: {
        domains: { ...replayDomains(), Map: { value: 3, items: [] } },
        appliedEventIds: ['event-1', 'event-2'],
        eventCauses: { 'event-1': [], 'event-2': ['event-1'] },
      },
    }],
    events: [replayEvent(1), replayEvent(2, { type: 'command.rejected' }), replayEvent(3, {
      type: 'calculation', causeIds: ['event-1'], changes: [{ domain: 'Decisions', value: { value: 4, selected: 'saved-choice' } }],
      randomKey: { seed: '7', purpose: 'agent', ordinal: 4, algorithmVersion: 1 },
    }), replayEvent(4, { type: 'technical.failure' }),
      ...Array.from({ length: 14 }, (_, index) => replayEvent(index + 5)),
      replayEvent(19, { type: 'world.event' }), replayEvent(20, { type: 'input' })],
  };
  archive.controlPoints = [{ sequence: 3, stateHash: restoreAt({ archive, cursor: 3 }).stateHash! }];
  return archive;
}
