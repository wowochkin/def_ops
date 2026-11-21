import { createHash, randomUUID } from 'node:crypto';
import { createPool, migrate, tx, type Pool } from '@def-ops/db';
import { canonicalJson, eventHash, reduceWorld, type ChainEvent, type JsonValue, type WorldState } from '@def-ops/kshvi';
import { KSHVI_MIGRATIONS } from './migrations';
import { loadSnapshot, saveSnapshot, type SnapshotInput } from './snapshot-store';
import { publishOutbox } from './outbox';
import { submitJob, type JobInput, type JobResult } from './jobs';

export type AppendCommandInput = {
  organizationId: string;
  instanceId: string;
  branchId: string;
  aggregateRevision: number;
  idempotencyKey: string;
  type: string;
  payload: JsonValue;
};
export type AppendResult = { eventId: string; sequence: number; hash: string; idempotent: boolean };

function assertSchema(schema: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Недопустимое имя схемы КШВИ');
}

export class KshviEventStore {
  readonly pool: Pool;
  readonly schema: string;

  constructor(options: { pool?: Pool; url?: string; schema?: string } = {}) {
    this.pool = options.pool ?? createPool(options.url);
    this.schema = options.schema ?? 'kshvi';
    assertSchema(this.schema);
  }

  async init(): Promise<void> {
    await migrate(this.pool, this.schema, KSHVI_MIGRATIONS);
  }

  async appendCommand(input: AppendCommandInput): Promise<AppendResult> {
    const requestHash = createHash('sha256').update(canonicalJson(input)).digest('hex');
    return tx(this.pool, async client => {
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [`${input.organizationId}/${input.instanceId}/${input.branchId}`]);
      const existing = await client.query(
        `select event_id, request_hash, response from ${this.schema}.commands where organization_id=$1 and instance_id=$2 and idempotency_key=$3 for update`,
        [input.organizationId, input.instanceId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash) throw new Error('Идемпотентный ключ уже использован с другим содержимым');
        return { ...existing.rows[0].response, eventId: existing.rows[0].event_id, idempotent: true } as AppendResult;
      }
      const previous = await client.query(
        `select sequence, hash from ${this.schema}.events where organization_id=$1 and instance_id=$2 and branch_id=$3 order by sequence desc limit 1`,
        [input.organizationId, input.instanceId, input.branchId],
      );
      const currentRevision = Number(previous.rows[0]?.sequence ?? 0);
      if (input.aggregateRevision !== currentRevision) throw new Error(`Устаревшая ревизия агрегата: ${input.aggregateRevision}, актуальная ${currentRevision}`);
      const sequence = currentRevision + 1;
      const eventId = randomUUID();
      const prevHash = previous.rows[0]?.hash ?? null;
      const hash = eventHash({ eventId, sequence, type: input.type, payload: input.payload }, prevHash);
      await client.query(
        `insert into ${this.schema}.events (organization_id, instance_id, branch_id, sequence, event_id, type, payload, prev_hash, hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [input.organizationId, input.instanceId, input.branchId, sequence, eventId, input.type, input.payload, prevHash, hash],
      );
      await client.query(
        `insert into ${this.schema}.aggregates (organization_id, instance_id, branch_id, revision) values ($1,$2,$3,$4)
         on conflict (organization_id, instance_id, branch_id) do update set revision=excluded.revision`,
        [input.organizationId, input.instanceId, input.branchId, sequence],
      );
      const event: ChainEvent = { eventId, sequence, type: input.type, payload: input.payload, prevHash, hash };
      await client.query(
        `insert into ${this.schema}.outbox (id, organization_id, instance_id, event_id, payload, status) values ($1,$2,$3,$4,$5,'pending')`,
        [randomUUID(), input.organizationId, input.instanceId, eventId, event],
      );
      const response: AppendResult = { eventId, sequence, hash, idempotent: false };
      await client.query(
        `insert into ${this.schema}.commands (organization_id, instance_id, idempotency_key, request_hash, event_id, response)
         values ($1,$2,$3,$4,$5,$6)`,
        [input.organizationId, input.instanceId, input.idempotencyKey, requestHash, eventId, response],
      );
      return response;
    });
  }

  async eventCount(instanceId: string): Promise<number> {
    const result = await this.pool.query(`select count(*)::int as count from ${this.schema}.events where instance_id=$1`, [instanceId]);
    return result.rows[0].count;
  }

  async outboxCount(instanceId: string): Promise<number> {
    const result = await this.pool.query(`select count(*)::int as count from ${this.schema}.outbox where instance_id=$1`, [instanceId]);
    return result.rows[0].count;
  }

  async aggregateRevision(instanceId: string, branchId: string): Promise<number> {
    const result = await this.pool.query(`select revision from ${this.schema}.aggregates where instance_id=$1 and branch_id=$2`, [instanceId, branchId]);
    return Number(result.rows[0]?.revision ?? 0);
  }

  async saveSnapshot(input: SnapshotInput): Promise<void> {
    await tx(this.pool, async client => { await saveSnapshot(client, this.schema, input); });
  }

  async restoreWorld(instanceId: string, branchId: string): Promise<{ state: WorldState; sequence: number }> {
    return tx(this.pool, async client => {
      const snapshot = await loadSnapshot(client, this.schema, instanceId, branchId);
      if (!snapshot) throw new Error('Обязательный снимок отсутствует');
      const events = await client.query(
        `select event_id, sequence, type, payload, prev_hash, hash from ${this.schema}.events
         where instance_id=$1 and branch_id=$2 and sequence>$3 order by sequence`,
        [instanceId, branchId, snapshot.sequence],
      );
      let state = snapshot.state;
      for (const event of events.rows) {
        state = reduceWorld(state, { eventId: event.event_id, type: event.type, payload: event.payload, causeIds: [] }, { reducerVersion: snapshot.reducerVersion });
      }
      return { state, sequence: Number(events.rows.at(-1)?.sequence ?? snapshot.sequence) };
    });
  }

  async publishOutbox(handler: (event: ChainEvent) => Promise<void>): Promise<number> {
    return publishOutbox(this.pool, this.schema, handler);
  }

  async submitJob(input: JobInput): Promise<JobResult> {
    return tx(this.pool, async client => submitJob(client, this.schema, input));
  }
}
