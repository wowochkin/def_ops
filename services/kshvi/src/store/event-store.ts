import { createHash, randomUUID } from 'node:crypto';
import { createPool, migrate, tx, type Pool } from '@def-ops/db';
import {
  canonicalJson, eventHash, operationalAt, reduceWorld, replayWorld, verifyEventChain,
  ReducerRegistry, type ChainEvent, type ChainEventInput, type EventActor, type JsonValue,
  type OperationalTime, type VersionRef, type WorldState,
} from '@def-ops/kshvi';
import { KSHVI_MIGRATIONS } from './migrations';
import { loadSnapshot, saveSnapshot, type SnapshotInput } from './snapshot-store';
import { publishOutbox, type OutboxDelivery } from './outbox';
import { runNextJob, submitJob, transitionJob, type JobInput, type JobRecord, type JobResult, type JobTransition } from './jobs';

export type AppendCommandInput = {
  organizationId: string;
  instanceId: string;
  branchId: string;
  aggregateRevision: number;
  idempotencyKey: string;
  type: string;
  payload: JsonValue;
  /** ID вычисляется только официальной доменной командой, а не произвольным результатом клиента. */
  eventId?: string;
  schemaVersion?: number;
  wallClockAt?: string;
  operationalAt?: OperationalTime;
  actor?: EventActor;
  causeIds?: readonly string[];
  versions?: Readonly<Record<string, VersionRef>>;
  reducerVersion?: number;
};
export type AppendResult = { eventId: string; sequence: number; hash: string; prevHash: string | null; idempotent: boolean; event: ChainEvent };

function assertSchema(schema: string): void {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Недопустимое имя схемы КШВИ');
}

function storedEvent(row: Record<string, unknown>): ChainEvent {
  return {
    eventId: String(row.event_id),
    organizationId: String(row.organization_id),
    instanceId: String(row.instance_id),
    branchId: String(row.branch_id),
    sequence: Number(row.sequence),
    type: String(row.type),
    schemaVersion: Number(row.schema_version),
    wallClockAt: String(row.wall_clock_at),
    operationalAt: row.operational_at as OperationalTime,
    actor: row.actor as EventActor,
    causeIds: row.cause_ids as readonly string[],
    versions: row.versions as Readonly<Record<string, VersionRef>>,
    reducerVersion: Number(row.reducer_version),
    payload: row.payload as JsonValue,
    prevHash: row.prev_hash ? String(row.prev_hash) : null,
    hash: String(row.hash),
    hashVersion: Number(row.hash_version) as 1 | 2,
  };
}

export class KshviEventStore {
  readonly pool: Pool;
  readonly schema: string;
  readonly registry: ReducerRegistry;
  private readonly now: () => Date;

  constructor(options: { pool?: Pool; url?: string; schema?: string; registry?: ReducerRegistry; now?: () => Date } = {}) {
    this.pool = options.pool ?? createPool(options.url);
    this.schema = options.schema ?? 'kshvi';
    assertSchema(this.schema);
    this.now = options.now ?? (() => new Date());
    this.registry = options.registry ?? new ReducerRegistry();
    if (!options.registry) this.registry.register(1, reduceWorld);
  }

  async init(): Promise<void> {
    await migrate(this.pool, this.schema, KSHVI_MIGRATIONS);
  }

  async migrateCopy(schema: string): Promise<KshviEventStore> {
    if (schema === this.schema) throw new Error('Схема копии должна отличаться от рабочей схемы');
    const copy = new KshviEventStore({ pool: this.pool, schema, registry: this.registry, now: this.now });
    await copy.init();
    return copy;
  }

  private eventFact(input: AppendCommandInput, eventId: string, sequence: number): ChainEventInput {
    const now = this.now().toISOString();
    return {
      eventId,
      organizationId: input.organizationId,
      instanceId: input.instanceId,
      branchId: input.branchId,
      sequence,
      type: input.type,
      schemaVersion: input.schemaVersion ?? 1,
      wallClockAt: input.wallClockAt ?? now,
      operationalAt: input.operationalAt ?? operationalAt(now, 'UTC'),
      actor: input.actor ?? { id: 'system:kshvi', kind: 'SYSTEM' },
      causeIds: input.causeIds ?? [],
      versions: input.versions ?? {},
      reducerVersion: input.reducerVersion ?? 1,
      payload: input.payload,
    };
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
      const eventId = input.eventId ?? randomUUID();
      const prevHash = previous.rows[0]?.hash ?? null;
      const fact = this.eventFact(input, eventId, sequence);
      this.registry.get(fact.reducerVersion);
      const hash = eventHash(fact, prevHash);
      const event: ChainEvent = { ...fact, prevHash, hash, hashVersion: 2 };
      await client.query(
        `insert into ${this.schema}.events
         (organization_id,instance_id,branch_id,sequence,event_id,type,payload,prev_hash,hash,
          schema_version,wall_clock_at,operational_at,actor,cause_ids,versions,reducer_version,hash_version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,2)`,
        [input.organizationId, input.instanceId, input.branchId, sequence, eventId, input.type, JSON.stringify(input.payload), prevHash, hash,
          event.schemaVersion, event.wallClockAt, JSON.stringify(event.operationalAt), JSON.stringify(event.actor), JSON.stringify(event.causeIds), JSON.stringify(event.versions), event.reducerVersion],
      );
      await client.query(
        `insert into ${this.schema}.aggregates (organization_id, instance_id, branch_id, revision) values ($1,$2,$3,$4)
         on conflict (organization_id, instance_id, branch_id) do update set revision=excluded.revision`,
        [input.organizationId, input.instanceId, input.branchId, sequence],
      );
      await client.query(
        `insert into ${this.schema}.outbox (id, organization_id, instance_id, event_id, payload, status) values ($1,$2,$3,$4,$5,'pending')`,
        [randomUUID(), input.organizationId, input.instanceId, eventId, event],
      );
      const response: AppendResult = { eventId, sequence, hash, prevHash, idempotent: false, event };
      await client.query(
        `insert into ${this.schema}.commands (organization_id, instance_id, idempotency_key, request_hash, event_id, response)
         values ($1,$2,$3,$4,$5,$6)`,
        [input.organizationId, input.instanceId, input.idempotencyKey, requestHash, eventId, response],
      );
      return response;
    });
  }

  async eventCount(organizationId: string, instanceId: string): Promise<number> {
    const result = await this.pool.query(`select count(*)::int as count from ${this.schema}.events where organization_id=$1 and instance_id=$2`, [organizationId, instanceId]);
    return Number(result.rows[0].count);
  }

  async listEvents(organizationId: string, instanceId: string, branchId: string): Promise<ChainEvent[]> {
    const result = await this.pool.query(
      `select * from ${this.schema}.events where organization_id=$1 and instance_id=$2 and branch_id=$3 order by sequence`,
      [organizationId, instanceId, branchId],
    );
    return result.rows.map(storedEvent);
  }

  async outboxCount(organizationId: string, instanceId: string): Promise<number> {
    const result = await this.pool.query(`select count(*)::int as count from ${this.schema}.outbox where organization_id=$1 and instance_id=$2`, [organizationId, instanceId]);
    return Number(result.rows[0].count);
  }

  async aggregateRevision(organizationId: string, instanceId: string, branchId: string): Promise<number> {
    const result = await this.pool.query(
      `select revision from ${this.schema}.aggregates where organization_id=$1 and instance_id=$2 and branch_id=$3`,
      [organizationId, instanceId, branchId],
    );
    return Number(result.rows[0]?.revision ?? 0);
  }

  async saveSnapshot(input: SnapshotInput): Promise<void> {
    await tx(this.pool, async client => { await saveSnapshot(client, this.schema, input); });
  }

  async restoreWorld(organizationId: string, instanceId: string, branchId: string): Promise<{ state: WorldState; sequence: number }> {
    return tx(this.pool, async client => {
      const snapshot = await loadSnapshot(client, this.schema, organizationId, instanceId, branchId);
      if (!snapshot) throw new Error('Обязательный снимок отсутствует');
      const result = await client.query(
        `select * from ${this.schema}.events where organization_id=$1 and instance_id=$2 and branch_id=$3 order by sequence`,
        [organizationId, instanceId, branchId],
      );
      const events = result.rows.map(storedEvent);
      const issues = verifyEventChain(events);
      if (issues.length) throw new Error(`Цепочка событий повреждена: ${issues.join(',')}`);
      const lastSequence = events.at(-1)?.sequence ?? 0;
      if (snapshot.sequence > lastSequence) throw new Error('Снимок ссылается на отсутствующие события');
      const tail = events.filter(event => event.sequence > snapshot.sequence);
      const state = replayWorld(snapshot.state, tail, { reducerVersion: snapshot.reducerVersion, registry: this.registry });
      return { state, sequence: tail.at(-1)?.sequence ?? snapshot.sequence };
    });
  }

  async publishOutbox(handler: (event: ChainEvent, delivery: OutboxDelivery) => Promise<void>, consumer?: string): Promise<number> {
    return publishOutbox(this.pool, this.schema, handler, consumer);
  }

  async submitJob(input: JobInput): Promise<JobResult> {
    return tx(this.pool, async client => submitJob(client, this.schema, input));
  }

  async transitionJob(input: JobTransition): Promise<JobResult> {
    return tx(this.pool, async client => transitionJob(client, this.schema, input));
  }

  async runNextJob(input: { organizationId: string; kind: string; handler(job: JobRecord): Promise<JsonValue> }): Promise<JobRecord | null> {
    return runNextJob(this.pool, this.schema, input);
  }
}
