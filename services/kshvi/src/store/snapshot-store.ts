import { createHash } from 'node:crypto';
import { canonicalJson, type VersionRef, type WorldState } from '@def-ops/kshvi';
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
  const hash = stateHash(input.state);
  await client.query(
    `insert into ${schema}.snapshots (organization_id, instance_id, branch_id, sequence, state, state_hash, environment, reducer_version)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [input.organizationId, input.instanceId, input.branchId, input.sequence, input.state, hash, input.environment, input.reducerVersion],
  );
  return { ...input, stateHash: hash };
}

export async function loadSnapshot(client: Client, schema: string, instanceId: string, branchId: string): Promise<StoredSnapshot | null> {
  const result = await client.query(
    `select organization_id, sequence, state, state_hash, environment, reducer_version
     from ${schema}.snapshots where instance_id=$1 and branch_id=$2 order by sequence desc limit 1`,
    [instanceId, branchId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const snapshot = {
    organizationId: row.organization_id,
    instanceId,
    branchId,
    sequence: Number(row.sequence),
    state: row.state,
    stateHash: row.state_hash,
    environment: row.environment,
    reducerVersion: row.reducer_version,
  } as StoredSnapshot;
  if (stateHash(snapshot.state) !== snapshot.stateHash) throw new Error('Хеш снимка не совпадает');
  return snapshot;
}
