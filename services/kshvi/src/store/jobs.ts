import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, type JsonValue } from '@def-ops/kshvi';
import type { Client } from '@def-ops/db';

export type JobInput = { organizationId: string; kind: string; key: string; payload: JsonValue };
export type JobResult = { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' };

export async function submitJob(client: Client, schema: string, input: JobInput): Promise<JobResult> {
  const requestHash = createHash('sha256').update(canonicalJson(input)).digest('hex');
  const existing = await client.query(`select id, request_hash, status from ${schema}.jobs where organization_id=$1 and kind=$2 and key=$3`, [input.organizationId, input.kind, input.key]);
  if (existing.rows[0]) {
    if (existing.rows[0].request_hash !== requestHash) throw new Error('Ключ задания уже использован с другим содержимым');
    return { id: existing.rows[0].id, status: existing.rows[0].status };
  }
  const id = randomUUID();
  await client.query(
    `insert into ${schema}.jobs (id, organization_id, kind, key, payload, request_hash, status) values ($1,$2,$3,$4,$5,$6,'queued')`,
    [id, input.organizationId, input.kind, input.key, input.payload, requestHash],
  );
  return { id, status: 'queued' };
}
