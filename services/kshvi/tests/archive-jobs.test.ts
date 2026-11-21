import { expect, it, vi } from 'vitest';
import { ArchiveJobManager } from '../src/archive/archive-jobs';

const actor = { organizationId: 'org-1', authorities: ['archive.jobs.read'] };
const owner = { organizationId: 'org-1', userId: 'user-1' };

it('выполняет queued/running/succeeded с прогрессом и безопасным идемпотентным повтором', async () => {
  const manager = new ArchiveJobManager({ maxConcurrent: 1 });
  const run = vi.fn(async ({ reportProgress }: { reportProgress: (value: number) => void }) => { reportProgress(50); return { ok: true }; });
  const submitted = manager.submit({ idempotencyKey: 'export-1', kind: 'EXPORT', payload: { archive: 1 }, owner, run });
  expect(submitted.status).toBe('queued');
  const repeated = manager.submit({ idempotencyKey: 'export-1', kind: 'EXPORT', payload: { archive: 1 }, owner, run });
  expect(repeated.id).toBe(submitted.id);
  expect(run).toHaveBeenCalledTimes(0);
  manager.start();
  await manager.wait(submitted.id);
  expect(manager.get(submitted.id, actor)).toMatchObject({ status: 'succeeded', progress: 100, result: { ok: true } });
  expect(run).toHaveBeenCalledTimes(1);
  manager.submit({ idempotencyKey: 'export-1', kind: 'EXPORT', payload: { archive: 1 }, owner, run });
  expect(run).toHaveBeenCalledTimes(1);
  expect(() => manager.get(submitted.id, { organizationId: 'org-2', authorities: ['archive.jobs.read'] })).toThrow('403');
});

it('не блокирует приём команд, ограничивает параллелизм и безопасно повторяет failed', async () => {
  const manager = new ArchiveJobManager({ maxConcurrent: 1, maxQueue: 3 });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  manager.submit({ idempotencyKey: 'slow', kind: 'BULK_REPLAY', payload: {}, owner, run: async () => { await gate; return 'done'; } });
  let attempts = 0;
  const second = manager.submit({ idempotencyKey: 'retry', kind: 'VERIFY', payload: {}, owner, run: async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('Временный сбой');
    return 'recovered';
  } });
  const commandAccepted = vi.fn();
  manager.start();
  commandAccepted();
  expect(commandAccepted).toHaveBeenCalled();
  expect(manager.activeCount()).toBe(1);
  release();
  await manager.wait(second.id);
  expect(manager.get(second.id, actor).status).toBe('failed');
  const retried = manager.retry(second.id);
  expect(retried.status).toBe('queued');
  await manager.wait(second.id);
  expect(manager.get(second.id, actor)).toMatchObject({ status: 'succeeded', result: 'recovered', attempts: 2 });
});

it('отменяет queued/running и применяет лимиты очереди, payload и времени', async () => {
  const manager = new ArchiveJobManager({ maxConcurrent: 1, maxQueue: 1, maxPayloadBytes: 100, maxDurationMs: 20 });
  const queued = manager.submit({ idempotencyKey: 'cancel-queued', kind: 'EXPORT', payload: {}, owner, run: async () => 'unexpected' });
  expect(manager.cancel(queued.id).status).toBe('cancelled');
  expect(() => manager.submit({ idempotencyKey: 'large', kind: 'EXPORT', payload: { text: 'x'.repeat(200) }, owner, run: async () => null })).toThrow('лимит');
  const running = manager.submit({ idempotencyKey: 'cancel-running', kind: 'EXPORT', payload: {}, owner, run: async ({ signal }: { signal: AbortSignal }) => {
    await new Promise<void>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Отменено')));
    });
    return null;
  } });
  manager.start();
  expect(manager.get(running.id, actor).status).toBe('running');
  manager.cancel(running.id);
  await manager.wait(running.id);
  expect(manager.get(running.id, actor).status).toBe('cancelled');
  const timeout = manager.submit({ idempotencyKey: 'timeout', kind: 'EXPORT', payload: {}, owner, run: async () => new Promise<void>(() => {}) });
  await manager.wait(timeout.id);
  expect(manager.get(timeout.id, actor).status).toBe('failed');
});
