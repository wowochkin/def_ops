import { emptyWorld, reduceWorld } from '@def-ops/kshvi';
import { expect, it } from 'vitest';
import { appendCommittedCommand } from '../../src/admin/recovery-coordinator';
import { assertRecoveryObjectives } from '../../src/admin/restore-verification';
import { command, withKshviDatabase } from '../helpers/database';

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;

integration('измеряет восстановление до последнего подтверждённого события и цели RTO', async () => {
  await withKshviDatabase(async store => {
    const input = command('nf-12-restart');
    const committed = await appendCommittedCommand(store, input);
    const world = reduceWorld(emptyWorld('scenario-1'), { eventId: committed.eventId, type: input.type, payload: input.payload, causeIds: [] }, { reducerVersion: 1 });
    await store.saveSnapshot({ organizationId: 'org1', instanceId: 'i1', branchId: 'b1', sequence: 1, state: world, environment: { id: 'env-1', revision: 1, sha256: 'a'.repeat(64) }, reducerVersion: 1 });
    const started = performance.now();
    const restarted = new (store.constructor as new (options: { pool: typeof store.pool; schema: string }) => typeof store)({ pool: store.pool, schema: store.schema });
    const restored = await restarted.restoreWorld('org1', 'i1', 'b1');
    const restartMs = performance.now() - started;
    expect(restored.sequence).toBe(1);
    expect(assertRecoveryObjectives({ confirmedEventsLost: 0, restartMs, nodeRestoreMs: restartMs })).toMatchObject({ rpo: 0, restartWithinTarget: true, nodeRestoreWithinTarget: true });
    expect(() => assertRecoveryObjectives({ confirmedEventsLost: 0, restartMs: 300_001, nodeRestoreMs: restartMs })).toThrow('5 мин');
    expect(() => assertRecoveryObjectives({ confirmedEventsLost: 0, restartMs, nodeRestoreMs: 1_800_001 })).toThrow('30 мин');
  });
});
