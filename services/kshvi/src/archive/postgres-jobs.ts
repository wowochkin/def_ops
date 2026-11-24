import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { migrate, tx, type Client, type Pool } from '@def-ops/db';
import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';
import { sha256Canonical } from '../../../../packages/kshvi/src/archive/file-digest';
import type { ArchiveJob, ArchiveJobActor, ArchiveJobOwner, ArchiveJobStatus, ArchiveJobSubmit } from './archive-jobs';

type StoredTask = { moduleUrl?: string; exportName?: string; runSource?: string };
type JobRow = {
  id: string;
  organization_id: string;
  user_id: string;
  kind: ArchiveJob['kind'];
  idempotency_key: string;
  request_hash: string;
  payload: unknown;
  task: StoredTask;
  status: ArchiveJobStatus;
  progress: number;
  attempts: number;
  result: unknown;
  error: string | null;
  owner_manager: string | null;
  lease_until: string | null;
  cancel_requested: boolean;
};
type InternalJob = JobRow & { owner: ArchiveJobOwner };
export type PostgresArchiveJobOptions = {
  pool: Pool;
  schema: string;
  managerId: string;
  limits: {
    maxConcurrent: number;
    maxQueue: number;
    maxPayloadBytes: number;
    maxDurationMs: number;
    maxMemoryMb: number;
    recoveryAfterMs?: number;
  };
};

const MIGRATION = {
  id: 1,
  name: 'durable-archive-jobs',
  sql: `
    create table archive_jobs (
      id text primary key,
      organization_id text not null,
      user_id text not null,
      kind text not null,
      idempotency_key text not null,
      request_hash text not null,
      payload jsonb not null,
      task jsonb not null,
      status text not null check (status in ('queued','running','succeeded','failed','cancelled')),
      progress int not null default 0 check (progress between 0 and 100),
      attempts int not null default 0,
      result jsonb,
      error text,
      owner_manager text,
      lease_until timestamptz,
      cancel_requested boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (organization_id, user_id, idempotency_key)
    );
    create index archive_jobs_claim on archive_jobs(status, created_at);
    create index archive_jobs_lease on archive_jobs(status, lease_until);
    create table archive_job_effects (
      job_id text not null references archive_jobs(id),
      effect_key text not null,
      result jsonb not null,
      created_at timestamptz not null default now(),
      primary key (job_id, effect_key)
    );
  `,
};

function publicJob(row: JobRow): ArchiveJob {
  return {
    id: row.id, kind: row.kind, status: row.status, progress: row.progress, attempts: row.attempts,
    ...(row.result === null ? {} : { result: structuredClone(row.result) }),
    ...(row.error ? { error: row.error } : {}),
    owner: { organizationId: row.organization_id, userId: row.user_id },
  };
}
function internalJob(row: JobRow): InternalJob {
  return { ...row, owner: { organizationId: row.organization_id, userId: row.user_id, authorities: [] } };
}

export class PostgresArchiveJobManager {
  private readonly workers = new Map<string, Worker>();
  private readonly active = new Set<string>();
  private readonly limits: PostgresArchiveJobOptions['limits'] & { recoveryAfterMs: number };
  private started = false;

  constructor(private readonly options: PostgresArchiveJobOptions) {
    if (!/^[a-z_][a-z0-9_]*$/.test(options.schema)) throw new Error('Недопустимая схема заданий');
    if (!options.managerId) throw new Error('Нужен идентификатор менеджера заданий');
    this.limits = { ...options.limits, recoveryAfterMs: options.limits.recoveryAfterMs ?? 5000 };
  }

  async init(): Promise<void> {
    await migrate(this.options.pool, this.options.schema, [MIGRATION]);
  }

  private async lock(client: Client, key: string): Promise<void> {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [`archive-jobs:${this.options.schema}:${key}`]);
  }

  private async row(client: Client, id: string): Promise<JobRow | null> {
    const result = await client.query(`select * from ${this.options.schema}.archive_jobs where id=$1`, [id]);
    return (result.rows[0] as JobRow | undefined) ?? null;
  }

  private assertRead(row: JobRow, actor: ArchiveJobActor): void {
    const any = actor.authorities.includes('archive.jobs.read.any');
    if (row.organization_id !== actor.organizationId || (row.user_id !== actor.userId && !any)
      || (!actor.authorities.includes('archive.jobs.read') && !any)) throw new Error('403: Результат задания недоступен');
  }
  private assertManage(row: JobRow, actor: ArchiveJobActor): void {
    const any = actor.authorities.includes('archive.jobs.cancel.any');
    if (row.organization_id !== actor.organizationId || (row.user_id !== actor.userId && !any)
      || (!actor.authorities.includes('archive.jobs.cancel') && !any)) throw new Error('403: Управление заданием недоступно');
  }

  async submit(input: ArchiveJobSubmit): Promise<ArchiveJob> {
    if (!input.owner.authorities.includes('archive.jobs.create')) throw new Error('403: Создание задания недоступно');
    if (!input.run && !input.task || input.run && input.task) throw new Error('Нужен один worker task');
    const task: StoredTask = input.run
      ? { runSource: input.run.toString() }
      : { moduleUrl: new URL(input.task!.module, import.meta.url).href, exportName: input.task!.exportName ?? 'default' };
    if (task.moduleUrl && !task.moduleUrl.startsWith('file:')) throw new Error('Worker допускает только локальные модули');
    const requestHash = sha256Canonical({ kind: input.kind, payload: input.payload, task });
    return tx(this.options.pool, async client => {
      await this.lock(client, 'global');
      const existing = await client.query(
        `select * from ${this.options.schema}.archive_jobs where organization_id=$1 and user_id=$2 and idempotency_key=$3 for update`,
        [input.owner.organizationId, input.owner.userId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0] as JobRow;
        if (row.request_hash !== requestHash) throw new Error('Ключ задания уже использован с другим содержимым');
        this.assertRead(row, input.owner);
        return publicJob(row);
      }
      const queued = Number((await client.query(`select count(*)::int as count from ${this.options.schema}.archive_jobs where status='queued'`)).rows[0].count);
      if (queued >= this.limits.maxQueue) throw new Error('Превышен лимит очереди тяжёлых заданий');
      if (Buffer.byteLength(canonicalJson(input.payload)) > this.limits.maxPayloadBytes) throw new Error('Превышен лимит размера задания');
      const id = randomUUID();
      await client.query(
        `insert into ${this.options.schema}.archive_jobs (id,organization_id,user_id,kind,idempotency_key,request_hash,payload,task,status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'queued')`,
        [id, input.owner.organizationId, input.owner.userId, input.kind, input.idempotencyKey, requestHash, JSON.stringify(input.payload), task],
      );
      if (this.started) queueMicrotask(() => { void this.pump(); });
      return publicJob((await this.row(client, id))!);
    });
  }

  async get(id: string, actor: ArchiveJobActor): Promise<ArchiveJob> {
    return tx(this.options.pool, async client => {
      const row = await this.row(client, id);
      if (!row) throw new Error('Задание не найдено');
      this.assertRead(row, actor);
      return publicJob(row);
    });
  }

  async start(): Promise<void> {
    this.started = true;
    await this.pump();
  }

  private async claim(): Promise<InternalJob | null> {
    return tx(this.options.pool, async client => {
      await this.lock(client, 'global');
      const running = Number((await client.query(`select count(*)::int as count from ${this.options.schema}.archive_jobs where status='running'`)).rows[0].count);
      if (running >= this.limits.maxConcurrent) return null;
      const selected = await client.query(
        `select id from ${this.options.schema}.archive_jobs where status='queued' order by created_at for update skip locked limit 1`,
      );
      const id = selected.rows[0]?.id as string | undefined;
      if (!id) return null;
      await client.query(
        `update ${this.options.schema}.archive_jobs set status='running', attempts=attempts+1, owner_manager=$2,
         lease_until=now()+($3::text||' milliseconds')::interval, updated_at=now() where id=$1`,
        [id, this.options.managerId, this.limits.recoveryAfterMs],
      );
      return internalJob((await this.row(client, id))!);
    });
  }

  private async pump(): Promise<void> {
    if (!this.started) return;
    while (this.active.size < this.limits.maxConcurrent) {
      const job = await this.claim();
      if (!job) return;
      this.active.add(job.id);
      void this.execute(job).finally(() => {
        this.active.delete(job.id);
        if (this.started) queueMicrotask(() => { void this.pump(); });
      });
    }
  }

  private async execute(job: InternalJob): Promise<void> {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./job-worker.mjs', import.meta.url), {
        workerData: {
          ...job.task, payload: job.payload, attempt: job.attempts,
          db: { url: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL, schema: this.options.schema, jobId: job.id },
        },
        resourceLimits: { maxOldGenerationSizeMb: this.limits.maxMemoryMb },
      });
    } catch (error) {
      await tx(this.options.pool, async client => {
        await client.query(`update ${this.options.schema}.archive_jobs set status='failed',error=$2,owner_manager=null,updated_at=now() where id=$1`, [job.id, error instanceof Error ? error.message : String(error)]);
      });
      return;
    }
    this.workers.set(job.id, worker);
    let result: unknown;
    let resultReceived = false;
    let failure: string | null = null;
    let timedOut = false;
    let currentProgress = job.progress;
    worker.on('message', (message: { type?: string; progress?: number; result?: unknown; error?: string }) => {
      if (message.type === 'progress') {
        currentProgress = Math.max(0, Math.min(99, message.progress ?? 0));
        void tx(this.options.pool, async client => {
          await client.query(`update ${this.options.schema}.archive_jobs set progress=$2,updated_at=now() where id=$1 and status='running'`, [job.id, currentProgress]);
        });
      }
      if (message.type === 'result') { result = message.result; resultReceived = true; }
      if (message.type === 'error') failure = message.error ?? 'Ошибка worker';
    });
    worker.on('error', error => { failure = error.message; });
    const heartbeat = setInterval(() => {
      void tx(this.options.pool, async client => {
        const current = await this.row(client, job.id);
        if (current?.cancel_requested) worker.terminate();
        else await client.query(`update ${this.options.schema}.archive_jobs set lease_until=now()+($2::text||' milliseconds')::interval,updated_at=now() where id=$1 and status='running'`, [job.id, this.limits.recoveryAfterMs]);
      }).catch(() => undefined);
    }, Math.max(20, Math.floor(this.limits.recoveryAfterMs / 2)));
    heartbeat.unref();
    const timer = setTimeout(() => {
      timedOut = true;
      void worker.terminate();
    }, this.limits.maxDurationMs);
    timer.unref();
    await new Promise<void>(resolve => {
      worker.once('exit', code => {
        clearInterval(heartbeat);
        clearTimeout(timer);
        this.workers.delete(job.id);
        void (async () => {
          const cancelled = await tx(this.options.pool, async client => (await this.row(client, job.id))?.cancel_requested === true);
          const status: ArchiveJobStatus = cancelled ? 'cancelled' : timedOut || failure || code !== 0 || !resultReceived ? 'failed' : 'succeeded';
          const error = cancelled ? null : timedOut ? 'Превышен лимит времени задания' : failure ?? (code !== 0 || !resultReceived ? 'Worker завершился без результата' : null);
          await tx(this.options.pool, async client => {
            await client.query(
              `update ${this.options.schema}.archive_jobs set status=$2, progress=$3, result=$4, error=$5, owner_manager=null, updated_at=now()
               where id=$1 and owner_manager=$6 and status='running'`,
              [job.id, status, status === 'succeeded' ? 100 : currentProgress, status === 'succeeded' ? JSON.stringify(result) : null, error, this.options.managerId],
            );
          });
          resolve();
        })().catch(error => { failure = error instanceof Error ? error.message : String(error); resolve(); });
      });
    });
  }

  async recover(): Promise<number> {
    return tx(this.options.pool, async client => {
      await this.lock(client, 'global');
      const result = await client.query(
        `update ${this.options.schema}.archive_jobs set status='failed', error='Прервано при падении процесса', owner_manager=null, updated_at=now()
         where status='running' and (lease_until is null or lease_until<now())`,
      );
      return result.rowCount ?? 0;
    });
  }

  async cancel(id: string, actor: ArchiveJobActor): Promise<ArchiveJob> {
    return tx(this.options.pool, async client => {
      await this.lock(client, `cancel:${id}`);
      const row = await this.row(client, id);
      if (!row) throw new Error('Задание не найдено');
      this.assertManage(row, actor);
      if (row.status === 'queued') await client.query(`update ${this.options.schema}.archive_jobs set status='cancelled',updated_at=now() where id=$1`, [id]);
      else if (row.status === 'running') {
        await client.query(`update ${this.options.schema}.archive_jobs set cancel_requested=true,updated_at=now() where id=$1`, [id]);
        this.workers.get(id)?.terminate();
      }
      return publicJob((await this.row(client, id))!);
    });
  }

  async retry(id: string, actor: ArchiveJobActor): Promise<ArchiveJob> {
    return tx(this.options.pool, async client => {
      await this.lock(client, 'global');
      const row = await this.row(client, id);
      if (!row) throw new Error('Задание не найдено');
      this.assertManage(row, actor);
      if (this.workers.has(id)) throw new Error('Старое выполнение ещё не завершено');
      if (row.status !== 'failed' && row.status !== 'cancelled') throw new Error('Повторять можно только завершённые failed или cancelled задания');
      const queued = Number((await client.query(`select count(*)::int as count from ${this.options.schema}.archive_jobs where status='queued'`)).rows[0].count);
      if (queued >= this.limits.maxQueue) throw new Error('Превышен лимит очереди тяжёлых заданий');
      await client.query(
        `update ${this.options.schema}.archive_jobs set status='queued',progress=0,result=null,error=null,cancel_requested=false,owner_manager=null,lease_until=null,updated_at=now() where id=$1`,
        [id],
      );
      if (this.started) queueMicrotask(() => { void this.pump(); });
      return publicJob((await this.row(client, id))!);
    });
  }

  async wait(id: string): Promise<void> {
    for (;;) {
      const row = await tx(this.options.pool, async client => this.row(client, id));
      if (!row) throw new Error('Задание не найдено');
      if (row.status === 'succeeded' || row.status === 'failed' || row.status === 'cancelled') return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  async activeCount(): Promise<number> {
    const result = await this.options.pool.query(`select count(*)::int as count from ${this.options.schema}.archive_jobs where status='running'`);
    return Number(result.rows[0].count);
  }
}
