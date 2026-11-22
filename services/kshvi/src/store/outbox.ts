import { randomUUID } from 'node:crypto';
import { tx, type Pool } from '@def-ops/db';
import type { ChainEvent } from '@def-ops/kshvi';

export type OutboxDelivery = Readonly<{
  id: string;
  eventId: string;
  consumer: string;
  attempt: number;
  /** Стабилен между повторами: обработчик обязан дедуплицировать внешний эффект по этому ключу. */
  idempotencyKey: string;
}>;

/** At-least-once: внешний эффект может повториться, если фиксация delivery record потеряна. */
export async function publishOutbox(
  pool: Pool,
  schema: string,
  handler: (event: ChainEvent, delivery: OutboxDelivery) => Promise<void>,
  consumer = 'default',
): Promise<number> {
  const pending = await pool.query(`select event_id from ${schema}.outbox where status='pending' order by created_at, event_id`);
  let published = 0;
  for (const row of pending.rows) {
    const claim = await tx(pool, async client => {
      const current = await client.query(
        `select o.event_id, o.payload,
           (select coalesce(max(d.attempt),0)::int from ${schema}.outbox_deliveries d
            where d.event_id=o.event_id and d.consumer=$2) as last_attempt
         from ${schema}.outbox o
         where o.event_id=$1 and o.status='pending'
         for update of o`,
        [row.event_id, consumer],
      );
      if (!current.rows[0]) return null;
      const delivery: OutboxDelivery = Object.freeze({
        id: randomUUID(), eventId: String(row.event_id), consumer,
        attempt: Number(current.rows[0].last_attempt) + 1,
        idempotencyKey: `kshvi:${row.event_id}`,
      });
      await client.query(
        `insert into ${schema}.outbox_deliveries (id,event_id,consumer,attempt,idempotency_key,status)
         values ($1,$2,$3,$4,$5,'delivering')`,
        [delivery.id, delivery.eventId, consumer, delivery.attempt, delivery.idempotencyKey],
      );
      return { event: current.rows[0].payload as ChainEvent, delivery };
    });
    if (!claim) continue;
    try {
      // Внешняя система не участвует в транзакции PostgreSQL и вызывается до отдельной фиксации результата.
      await handler(claim.event, claim.delivery);
      await tx(pool, async client => {
        await client.query(
          `update ${schema}.outbox_deliveries set status='published', finished_at=now(), error=null where id=$1`,
          [claim.delivery.id],
        );
        await client.query(`update ${schema}.outbox set status='published', published_at=now() where event_id=$1 and status='pending'`, [claim.delivery.eventId]);
      });
      published += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await pool.query(
        `update ${schema}.outbox_deliveries set status='failed', finished_at=now(), error=$2 where id=$1`,
        [claim.delivery.id, message.slice(0, 500)],
      ).catch(() => undefined);
      throw error;
    }
  }
  return published;
}
