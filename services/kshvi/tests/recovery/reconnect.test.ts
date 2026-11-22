import { expect, it } from 'vitest';
import { recoverConnection } from '../../src/admin/recovery-coordinator';

it('применяет права и очищает кэш до выдачи событий или снимка после обрыва', async () => {
  const calls: string[] = [];
  const snapshot = await recoverConnection(
    { lastSequence: 8, projectionRevision: 2, disconnectedAt: '2026-11-22T08:00:00.000Z', reconnectedAt: '2026-11-22T08:00:04.000Z' },
    { minAvailableSequence: 9 },
    {
      reauthorize: async () => { calls.push('authorize'); return { policyRevision: 3, scopeKey: 'new-rights' }; },
      clearCache: async () => { calls.push('clear'); },
      loadEvents: async () => { calls.push('events'); return []; },
      loadSnapshot: async (_from, scope) => { calls.push(`snapshot:${scope}`); return { sequence: 9, scope }; },
    },
  );
  expect(calls).toEqual(['authorize', 'clear', 'snapshot:new-rights']);
  expect(snapshot).toMatchObject({ kind: 'SNAPSHOT', reason: 'POLICY_CHANGED', outage: { durationMs: 4000 }, scopeKey: 'new-rights' });

  calls.length = 0;
  const events = await recoverConnection(
    { lastSequence: 8, projectionRevision: 4, disconnectedAt: '2026-11-22T08:00:00.000Z', reconnectedAt: '2026-11-22T08:00:01.000Z' },
    { minAvailableSequence: 9 },
    {
      reauthorize: async () => ({ policyRevision: 4, scopeKey: 'filtered' }),
      clearCache: async () => { calls.push('clear'); },
      loadEvents: async (from, scope) => { calls.push(`events:${from}:${scope}`); return [{ sequence: 9 }]; },
      loadSnapshot: async () => { throw new Error('Снимок не нужен'); },
    },
  );
  expect(calls).toEqual(['clear', 'events:9:filtered']);
  expect(events).toMatchObject({ kind: 'EVENTS', fromSequence: 9, events: [{ sequence: 9 }] });
});
