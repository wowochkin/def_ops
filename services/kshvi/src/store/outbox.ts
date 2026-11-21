import { tx, type Pool } from '@def-ops/db';
import type { ChainEvent } from '@def-ops/kshvi';

export async function publishOutbox(pool: Pool, schema: string, handler: (event: ChainEvent) => Promise<void>): Promise<number> {
  const pending = await pool.query(`select event_id from ${schema}.outbox where status='pending' order by created_at, event_id`);
  let published = 0;
  for (const row of pending.rows) {
    const didPublish = await tx(pool, async client => {
      const current = await client.query(`select event_id, payload from ${schema}.outbox where event_id=$1 and status='pending' for update`, [row.event_id]);
      if (!current.rows[0]) return false;
      await handler(current.rows[0].payload as ChainEvent);
      await client.query(`update ${schema}.outbox set status='published', published_at=now() where event_id=$1`, [row.event_id]);
      return true;
    });
    if (didPublish) published += 1;
  }
  return published;
}
