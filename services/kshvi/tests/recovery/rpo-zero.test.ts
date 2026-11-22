import { expect, it } from 'vitest';
import { appendCommittedCommand } from '../../src/admin/recovery-coordinator';
import { command, withKshviDatabase } from '../helpers/database';

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;

integration('сохраняет RPO 0 при отказе после COMMIT и не дублирует повтор с прежним ключом', async () => {
  await withKshviDatabase(async store => {
    const input = command('nf-11-after-commit');
    await expect(appendCommittedCommand(store, input, { afterCommit: () => { throw new Error('Ответ потерян после COMMIT'); } })).rejects.toThrow('после COMMIT');
    expect(await store.eventCount('org1', 'i1')).toBe(1);
    const repeated = await appendCommittedCommand(store, input);
    expect(repeated.idempotent).toBe(true);
    expect(await store.eventCount('org1', 'i1')).toBe(1);
    expect(await store.outboxCount('org1', 'i1')).toBe(1);
    const events = await store.pool.query(`select event_id, sequence, hash from ${store.schema}.events where instance_id = 'i1'`);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].event_id).toBe(repeated.eventId);
  });
});
