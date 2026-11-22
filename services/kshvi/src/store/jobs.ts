import { createHash, randomUUID } from 'node:crypto';
import { canonicalJson, type JsonValue } from '@def-ops/kshvi';
import { tx, type Client, type Pool } from '@def-ops/db';

export type JobInput = { organizationId: string; kind: string; key: string; payload: JsonValue };
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type JobResult = { id: string; status: JobStatus; progress: number; result?: JsonValue; error?: string };
export type JobRecord = JobResult & { organizationId: string; kind: string; key: string; payload: JsonValue };
export type JobTransition = { organizationId: string; id: string; to: JobStatus; progress?: number; result?: JsonValue; error?: string };

const transitions: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: ['queued'],
  cancelled: ['queued'],
};

function job(row: Record<string, unknown>): JobResult {
  return {
    id: String(row.id), status: row.status as JobStatus, progress: Number(row.progress),
    ...(row.result === null || row.result === undefined ? {} : { result: row.result as JsonValue }),
    ...(row.error ? { error: String(row.error) } : {}),
  };
}

function assertRequestHash(row: Record<string, unknown>, requestHash: string): void {
  if (row.request_hash !== requestHash) throw new Error('Ключ задания уже использован с другим содержимым');
}

export async function submitJob(client: Client, schema: string, input: JobInput): Promise<JobResult> {
  const requestHash = createHash('sha256').update(canonicalJson(input)).digest('hex');
  const id = randomUUID();
  const inserted = await client.query(
    `insert into ${schema}.jobs (id, organization_id, kind, key, payload, request_hash, status)
     values ($1,$2,$3,$4,$5,$6,'queued')
     on conflict (organization_id, kind, key) do nothing
     returning id, status, progress, result, error, request_hash`,
    [id, input.organizationId, input.kind, input.key, JSON.stringify(input.payload), requestHash],
  );
  if (inserted.rows[0]) return job(inserted.rows[0]);
  const existing = await client.query(
    `select id, status, progress, result, error, request_hash from ${schema}.jobs
     where organization_id=$1 and kind=$2 and key=$3`,
    [input.organizationId, input.kind, input.key],
  );
  if (!existing.rows[0]) throw new Error('Не удалось прочитать исходное задание после конфликта');
  assertRequestHash(existing.rows[0], requestHash);
  return job(existing.rows[0]);
}

export async function transitionJob(client: Client, schema: string, input: JobTransition): Promise<JobResult> {
  const current = await client.query(`select * from ${schema}.jobs where organization_id=$1 and id=$2 for update`, [input.organizationId, input.id]);
  if (!current.rows[0]) throw new Error('Задание не найдено в организации');
  const from = current.rows[0].status as JobStatus;
  if (!transitions[from].includes(input.to)) throw new Error(`Недопустимый переход задания: ${from} -> ${input.to}`);
  const progress = input.progress ?? (input.to === 'succeeded' ? 100 : input.to === 'queued' ? 0 : Number(current.rows[0].progress));
  if (!Number.isSafeInteger(progress) || progress < 0 || progress > 100) throw new Error('Прогресс задания должен быть целым от 0 до 100');
  const result = input.to === 'queued' ? null : input.result === undefined ? current.rows[0].result : input.result;
  const error = input.to === 'failed' ? input.error ?? 'Задание завершилось ошибкой' : null;
  const updated = await client.query(
    `update ${schema}.jobs set status=$3, progress=$4, result=$5, error=$6, updated_at=now()
     where organization_id=$1 and id=$2 returning id,status,progress,result,error`,
    [input.organizationId, input.id, input.to, progress, result, error],
  );
  return job(updated.rows[0]);
}

async function claimNextJob(pool: Pool, schema: string, organizationId: string, kind: string): Promise<JobRecord | null> {
  return tx(pool, async client => {
    const selected = await client.query(
      `select * from ${schema}.jobs where organization_id=$1 and kind=$2 and status='queued'
       order by created_at,id for update skip locked limit 1`,
      [organizationId, kind],
    );
    if (!selected.rows[0]) return null;
    const claimed = await transitionJob(client, schema, { organizationId, id: String(selected.rows[0].id), to: 'running' });
    return {
      ...claimed, organizationId, kind, key: String(selected.rows[0].key), payload: selected.rows[0].payload as JsonValue,
    };
  });
}

export async function runNextJob(pool: Pool, schema: string, input: {
  organizationId: string;
  kind: string;
  handler(job: JobRecord): Promise<JsonValue>;
}): Promise<JobRecord | null> {
  const claimed = await claimNextJob(pool, schema, input.organizationId, input.kind);
  if (!claimed) return null;
  try {
    const result = await input.handler(claimed);
    const completed = await tx(pool, async client => transitionJob(client, schema, {
      organizationId: input.organizationId, id: claimed.id, to: 'succeeded', progress: 100, result,
    }));
    return { ...claimed, ...completed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await tx(pool, async client => transitionJob(client, schema, {
      organizationId: input.organizationId, id: claimed.id, to: 'failed', error: message,
    }));
    return { ...claimed, ...failed };
  }
}
