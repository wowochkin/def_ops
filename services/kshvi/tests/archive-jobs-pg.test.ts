import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPool, dropSchema, type Pool } from '@def-ops/db';
import { expect, it } from 'vitest';
import { PostgresArchiveJobManager } from '../src/archive/postgres-jobs';

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;
const owner = { organizationId: 'org-1', userId: 'owner-1', authorities: ['archive.jobs.create', 'archive.jobs.read', 'archive.jobs.cancel'] };
const taskModule = new URL('./fixtures/job-tasks.mjs', import.meta.url).href;
const durableTaskModule = new URL('./fixtures/durable-job-tasks.mjs', import.meta.url).href;
const crashDriver = fileURLToPath(new URL('./fixtures/durable-crash-driver.mjs', import.meta.url));

async function withSchema(run: (pool: Pool, schema: string) => Promise<void>): Promise<void> {
  const pool = createPool(process.env.TEST_DATABASE_URL, 8);
  const schema = `kshvi_jobs_${randomUUID().replaceAll('-', '')}`;
  try { await run(pool, schema); }
  finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
}
async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Условие не выполнено за 5000 мс');
}
function manager(pool: Pool, schema: string, managerId: string, maxConcurrent = 1, maxQueue = 2) {
  return new PostgresArchiveJobManager({ pool, schema, managerId, limits: { maxConcurrent, maxQueue, maxDurationMs: 1000, maxPayloadBytes: 10000, maxMemoryMb: 128, recoveryAfterMs: 200 } });
}

integration('D01: состояния/progress/attempts/results/idempotency сохраняются в PostgreSQL между экземплярами', async () => {
  await withSchema(async (pool, schema) => {
    const first = manager(pool, schema, 'manager-a');
    await first.init();
    const submitted = await first.submit({ idempotencyKey: 'durable-result', kind: 'EXPORT', payload: { ok: true }, owner, task: { module: taskModule, exportName: 'progress' } });
    expect(submitted.status).toBe('queued');
    await first.start();
    await first.wait(submitted.id);
    const stored = await first.get(submitted.id, owner);
    expect(stored).toMatchObject({ status: 'succeeded', progress: 100, attempts: 1, result: { ok: true } });

    const second = manager(pool, schema, 'manager-b');
    await second.init();
    expect((await second.get(submitted.id, owner)).result).toEqual({ ok: true });
    const repeated = await second.submit({ idempotencyKey: 'durable-result', kind: 'EXPORT', payload: { ok: true }, owner, task: { module: taskModule, exportName: 'progress' } });
    expect(repeated.id).toBe(submitted.id);
    expect(repeated.attempts).toBe(1);
    await expect(second.submit({ idempotencyKey: 'durable-result', kind: 'EXPORT', payload: { ok: true }, owner: { ...owner, authorities: ['archive.jobs.create'] }, task: { module: taskModule, exportName: 'progress' } })).rejects.toThrow('403');
  });
});

integration('D02: SIGKILL после эффекта не приводит к повторному эффекту при crash→retry', async () => {
  await withSchema(async (pool, schema) => {
    await manager(pool, schema, 'manager-crash-parent').init();
    await pool.query(`create table ${schema}.test_side_effects (id serial primary key, value text)`);
    const child = spawn(process.execPath, ['--import', 'tsx', crashDriver], {
      env: { ...process.env, JOB_SCHEMA: schema, JOB_TASK_MODULE: durableTaskModule },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', chunk => { output += String(chunk); });
    try {
      await waitFor(async () => Number((await pool.query(`select count(*)::int as count from ${schema}.test_side_effects`)).rows[0].count) === 1);
      child.kill('SIGKILL');
      await new Promise<void>(resolve => child.once('exit', () => resolve()));
      await new Promise(resolve => setTimeout(resolve, 250));
      const recovered = manager(pool, schema, 'manager-recovery');
      await recovered.init();
      expect(await recovered.recover()).toBe(1);
      const jobId = output.match(/JOB_ID=(\S+)/)?.[1];
      expect(jobId).toBeTruthy();
      expect((await recovered.get(jobId!, owner)).status).toBe('failed');
      await recovered.retry(jobId!, owner);
      await recovered.start();
      await recovered.wait(jobId!);
      expect((await recovered.get(jobId!, owner)).result).toMatchObject({ effect: 'REPLAYED', value: 'crash-result' });
      expect((await recovered.get(jobId!, owner)).attempts).toBe(2);
      expect(Number((await pool.query(`select count(*)::int as count from ${schema}.test_side_effects`)).rows[0].count)).toBe(1);
      expect(Number((await pool.query(`select count(*)::int as count from ${schema}.archive_job_effects`)).rows[0].count)).toBe(1);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });
}, 15000);

integration('D03: транзакционные блокировки обеспечивают глобальные лимиты и одно выполнение', async () => {
  await withSchema(async (pool, schema) => {
    const first = manager(pool, schema, 'manager-lock-a', 1, 2);
    const second = manager(pool, schema, 'manager-lock-b', 1, 2);
    await Promise.all([first.init(), second.init()]);
    const one = await first.submit({ idempotencyKey: 'lock-1', kind: 'BULK_REPLAY', payload: { ms: 100 }, owner, task: { module: taskModule, exportName: 'wait' } });
    const two = await second.submit({ idempotencyKey: 'lock-2', kind: 'BULK_REPLAY', payload: { ms: 100 }, owner, task: { module: taskModule, exportName: 'wait' } });
    await expect(second.submit({ idempotencyKey: 'lock-3', kind: 'BULK_REPLAY', payload: { ms: 100 }, owner, task: { module: taskModule, exportName: 'wait' } })).rejects.toThrow('лимит очереди');
    await Promise.all([first.start(), second.start()]);
    let maxRunning = 0;
    const measure = (async () => {
      while (maxRunning === 0 || (await first.activeCount()) > 0 || (await second.activeCount()) > 0) {
        const running = Number((await pool.query(`select count(*)::int as count from ${schema}.archive_jobs where status='running'`)).rows[0].count);
        maxRunning = Math.max(maxRunning, running);
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    })();
    await Promise.all([first.wait(one.id), second.wait(two.id), measure]);
    expect(maxRunning).toBe(1);
    expect((await first.get(one.id, owner)).attempts).toBe(1);
    expect((await second.get(two.id, owner)).attempts).toBe(1);
  });
}, 15000);

integration('D04: recovery явно завершает orphaned running перед безопасным retry', async () => {
  await withSchema(async (pool, schema) => {
    const orphaned = manager(pool, schema, 'manager-orphan');
    await orphaned.init();
    const job = await orphaned.submit({ idempotencyKey: 'orphan', kind: 'EXPORT', payload: { ok: true }, owner, task: { module: taskModule, exportName: 'returnPayload' } });
    await pool.query(`update ${schema}.archive_jobs set status='running', attempts=1, owner_manager='dead-manager', lease_until=now()-interval '1 minute' where id=$1`, [job.id]);
    const recovery = manager(pool, schema, 'manager-new');
    await recovery.init();
    expect(await recovery.recover()).toBe(1);
    expect((await recovery.get(job.id, owner)).status).toBe('failed');
    await recovery.retry(job.id, owner);
    await recovery.start();
    await recovery.wait(job.id);
    expect((await recovery.get(job.id, owner)).result).toEqual({ ok: true });
    expect((await recovery.get(job.id, owner)).attempts).toBe(2);
    expect(Number((await pool.query(`select count(*)::int as count from ${schema}.archive_jobs where owner_manager='dead-manager'`)).rows[0].count)).toBe(0);
  });
});
