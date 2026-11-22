import { createHash } from 'node:crypto';
import { canonicalJson, versionRef, withResourceAlias, type VersionRef, type WorldState } from '@def-ops/kshvi';
import type { Client } from '@def-ops/db';

export type SnapshotInput = {
  organizationId: string;
  instanceId: string;
  branchId: string;
  sequence: number;
  state: WorldState;
  environment: VersionRef;
  reducerVersion: number;
};
export type StoredSnapshot = SnapshotInput & { stateHash: string };

export function stateHash(state: WorldState): string {
  return createHash('sha256').update(canonicalJson(state)).digest('hex');
}

export async function saveSnapshot(client: Client, schema: string, input: SnapshotInput): Promise<StoredSnapshot> {
  if (!input.organizationId.trim() || !input.instanceId.trim() || !input.branchId.trim()) throw new Error('Область снимка неполная');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) throw new Error('Некорректная последовательность снимка');
  if (!Number.isSafeInteger(input.reducerVersion) || input.reducerVersion < 1) throw new Error('Некорректная версия reducer снимка');
  versionRef(input.environment);
  const hash = stateHash(input.state);
  await client.query(
    `insert into ${schema}.snapshots (organization_id, instance_id, branch_id, sequence, state, state_hash, environment, reducer_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [input.organizationId, input.instanceId, input.branchId, input.sequence, JSON.stringify(input.state), hash, JSON.stringify(input.environment), input.reducerVersion],
  );
  return { ...input, stateHash: hash };
}

export async function loadSnapshot(client: Client, schema: string, organizationId: string, instanceId: string, branchId: string): Promise<StoredSnapshot | null> {
  const result = await client.query(
    `select organization_id, sequence, state, state_hash, environment, reducer_version
     from ${schema}.snapshots where organization_id=$1 and instance_id=$2 and branch_id=$3
     order by sequence desc, created_at desc`,
    [organizationId, instanceId, branchId],
  );
  let lastError: Error | null = null;
  for (const row of result.rows) {
    const rawState = row.state as WorldState;
    try {
      if (stateHash(rawState) !== row.state_hash) throw new Error(`Хеш снимка ${row.sequence} не совпадает`);
      return {
        organizationId,
        instanceId,
        branchId,
        sequence: Number(row.sequence),
        state: withResourceAlias(rawState),
        stateHash: row.state_hash,
        environment: versionRef(row.environment),
        reducerVersion: Number(row.reducer_version),
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (lastError) throw lastError;
  return null;
}

export type SnapshotReason = 'START' | 'BEFORE_JUMP' | 'AFTER_JUMP' | 'SCHEDULED' | 'BEFORE_COMPLETION' | 'BEFORE_BACKUP' | 'BEFORE_COPY';

/** Фактические точки жизненного цикла, к которым подключается владелец официального мира. */
export class SnapshotLifecycle {
  private sinceSnapshot = 0;
  constructor(private readonly options: {
    every: number;
    save(reason: SnapshotReason): Promise<void>;
    migrateOnCopy?(): Promise<void>;
  }) {
    if (!Number.isSafeInteger(options.every) || options.every < 1) throw new Error('Период снимков должен быть положительным целым');
  }

  private async save(reason: SnapshotReason): Promise<void> {
    await this.options.save(reason);
    this.sinceSnapshot = 0;
  }
  async start(): Promise<void> { await this.save('START'); }
  async beforeJump(): Promise<void> { await this.save('BEFORE_JUMP'); }
  async afterJump(): Promise<void> { await this.save('AFTER_JUMP'); }
  async afterEvents(count: number): Promise<void> {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Число событий должно быть неотрицательным целым');
    this.sinceSnapshot += count;
    if (this.sinceSnapshot >= this.options.every) await this.save('SCHEDULED');
  }
  async beforeCompletion(): Promise<void> { await this.save('BEFORE_COMPLETION'); }
  async beforeBackup(): Promise<void> { await this.save('BEFORE_BACKUP'); }
  async beforeCopy(): Promise<void> {
    await this.options.migrateOnCopy?.();
    await this.save('BEFORE_COPY');
  }
}
