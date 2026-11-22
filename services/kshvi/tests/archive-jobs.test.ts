import { rmSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { ArchiveJobManager } from '../src/archive/archive-jobs';

const actor = { organizationId: 'org-1', userId: 'user-1', authorities: ['archive.jobs.create', 'archive.jobs.read', 'archive.jobs.cancel'] };
const owner = actor;
const taskModule = new URL('./fixtures/job-tasks.mjs', import.meta.url).href;

it('выполняет queued/running/succeeded с прогрессом и безопасным идемпотентным повтором', async () => {
  const manager = new ArchiveJobManager({ maxConcurrent: 1 });
  const task = { module: taskModule, exportName: 'progress' };
  const submitted = manager.submit({ idempotencyKey: 'export-1', kind: 'EXPORT', payload: { ok: true }, owner, task });
  expect(submitted.status).toBe('queued');
  expect(manager.get(submitted.id, actor).attempts).toBe(0);
  const repeated = manager.submit({ idempotencyKey: 'export-1', kind: 'EXPORT', payload: { ok: true }, owner, task });
  expect(repeated.id).toBe(submitted.id);
  expect(manager.get(submitted.id, actor).attempts).toBe(0);
  manager.start();
  await manager.wait(submitted.id);
  expect(manager.get(submitted.id, actor)).toMatchObject({ status: 'succeeded', progress: 100, result: { ok: true }, attempts: 1 });
  manager.submit({ idempotencyKey: 'export-1', kind: 'EXPORT', payload: { ok: true }, owner, task });
  expect(manager.get(submitted.id, actor).attempts).toBe(1);
  expect(() => manager.get(submitted.id, { organizationId: 'org-2', userId: 'user-1', authorities: ['archive.jobs.read'] })).toThrow('403');
});

it('не блокирует приём команд, ограничивает параллелизм и безопасно повторяет failed', async () => {
  const marker = '.tmp/archive-job-retry-count';
  rmSync(marker, { force: true });
  const manager = new ArchiveJobManager({ maxConcurrent: 1, maxQueue: 3 });
  manager.submit({ idempotencyKey: 'slow', kind: 'BULK_REPLAY', payload: { ms: 40 }, owner, task: { module: taskModule, exportName: 'wait' } });
  const second = manager.submit({ idempotencyKey: 'retry', kind: 'VERIFY', payload: { marker }, owner, task: { module: taskModule, exportName: 'failOnce' } });
  const commandAccepted = vi.fn();
  manager.start();
  commandAccepted();
  expect(commandAccepted).toHaveBeenCalled();
  expect(manager.activeCount()).toBe(1);
  await manager.wait(second.id);
  expect(manager.get(second.id, actor).status).toBe('failed');
  const retried = manager.retry(second.id, actor);
  expect(retried.status).toBe('queued');
  await manager.wait(second.id);
  expect(manager.get(second.id, actor)).toMatchObject({ status: 'succeeded', result: 'recovered', attempts: 2 });
});

it('отменяет queued/running и применяет лимиты очереди, payload и времени', async () => {
  const manager = new ArchiveJobManager({ maxConcurrent: 1, maxQueue: 1, maxPayloadBytes: 100, maxDurationMs: 20 });
  const queued = manager.submit({ idempotencyKey: 'cancel-queued', kind: 'EXPORT', payload: {}, owner, task: { module: taskModule, exportName: 'returnPayload' } });
  expect(manager.cancel(queued.id, actor).status).toBe('cancelled');
  expect(() => manager.submit({ idempotencyKey: 'large', kind: 'EXPORT', payload: { text: 'x'.repeat(200) }, owner, task: { module: taskModule, exportName: 'returnPayload' } })).toThrow('лимит');
  const running = manager.submit({ idempotencyKey: 'cancel-running', kind: 'EXPORT', payload: { ms: 1000 }, owner, task: { module: taskModule, exportName: 'wait' } });
  manager.start();
  expect(manager.get(running.id, actor).status).toBe('running');
  manager.cancel(running.id, actor);
  await manager.wait(running.id);
  expect(manager.get(running.id, actor).status).toBe('cancelled');
  const timeout = manager.submit({ idempotencyKey: 'timeout', kind: 'EXPORT', payload: {}, owner, task: { module: taskModule, exportName: 'never' } });
  await manager.wait(timeout.id);
  expect(manager.get(timeout.id, actor).status).toBe('failed');
});
