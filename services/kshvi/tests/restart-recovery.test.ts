import { emptyWorld, reduceWorld } from '@def-ops/kshvi';
import { expect, it } from 'vitest';
import { KshviEventStore } from '../src/store/event-store';
import { appendCommittedCommand, recoverConnection } from '../src/admin/recovery-coordinator';
import { assertRecoveryObjectives } from '../src/admin/restore-verification';
import { command, withKshviDatabase } from './helpers/database';

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;

integration('сохраняет подтверждённую команду при отказе после COMMIT и восстанавливается новым экземпляром', async () => {
  await withKshviDatabase(async store => {
    const input = command('restart-rpo-1');
    await expect(appendCommittedCommand(store, input, { afterCommit: () => { throw new Error('Ответ потерян'); } })).rejects.toThrow('Ответ потерян');
    const repeated = await appendCommittedCommand(store, input);
    expect(repeated.idempotent).toBe(true);
    expect(await store.eventCount('i1')).toBe(1);
    const world = reduceWorld(emptyWorld('scenario-1'), { eventId: repeated.eventId, type: input.type, payload: input.payload, causeIds: [] }, { reducerVersion: 1 });
    await store.saveSnapshot({ organizationId: 'org1', instanceId: 'i1', branchId: 'b1', sequence: 1, state: world, environment: { id: 'env-1', revision: 1, sha256: 'a'.repeat(64) }, reducerVersion: 1 });

    const startedAt = performance.now();
    const restarted = new KshviEventStore({ pool: store.pool, schema: store.schema });
    const restored = await restarted.restoreWorld('i1', 'b1');
    const restartMs = performance.now() - startedAt;
    expect(restored.sequence).toBe(1);
    expect(await restarted.eventCount('i1')).toBe(1);
    expect(assertRecoveryObjectives({ confirmedEventsLost: 0, restartMs, nodeRestoreMs: restartMs }).passed).toBe(true);
  });
});

it('применяет новые права и очищает кэш до досылки, показывая период обрыва', async () => {
  const calls: string[] = [];
  const result = await recoverConnection(
    { lastSequence: 8, projectionRevision: 2, disconnectedAt: '2026-11-22T08:00:00.000Z', reconnectedAt: '2026-11-22T08:00:04.000Z' },
    { minAvailableSequence: 9 },
    {
      reauthorize: async () => { calls.push('authorize'); return { policyRevision: 3, scopeKey: 'new-scope' }; },
      clearCache: async () => { calls.push('clear'); },
      loadEvents: async () => { calls.push('events'); return []; },
      loadSnapshot: async (_fromSequence, scopeKey) => { calls.push(`snapshot:${scopeKey}`); return { sequence: 9, scopeKey }; },
    },
  );
  expect(calls).toEqual(['authorize', 'clear', 'snapshot:new-scope']);
  expect(result).toMatchObject({ kind: 'SNAPSHOT', reason: 'POLICY_CHANGED', outage: { durationMs: 4000 }, policyRevision: 3 });

  calls.length = 0;
  const events = await recoverConnection(
    { lastSequence: 8, projectionRevision: 4, disconnectedAt: '2026-11-22T08:00:00.000Z', reconnectedAt: '2026-11-22T08:00:01.000Z' },
    { minAvailableSequence: 9 },
    {
      reauthorize: async () => ({ policyRevision: 4, scopeKey: 'filtered-scope' }),
      clearCache: async () => { calls.push('clear'); },
      loadEvents: async (fromSequence, scopeKey) => { calls.push(`events:${fromSequence}:${scopeKey}`); return [{ sequence: 9, scopeKey }]; },
      loadSnapshot: async () => { throw new Error('Снимок не требуется'); },
    },
  );
  expect(calls).toEqual(['clear', 'events:9:filtered-scope']);
  expect(events).toMatchObject({ kind: 'EVENTS', fromSequence: 9 });
});
