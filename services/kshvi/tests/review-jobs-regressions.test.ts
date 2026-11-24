import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ArchiveJobManager } from '../src/archive/archive-jobs';

const owner = {
  organizationId: 'org-1', userId: 'owner-1',
  authorities: ['archive.jobs.create', 'archive.jobs.read', 'archive.jobs.cancel'],
};
const other = { ...owner, userId: 'other-user' };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const taskModule = new URL('./fixtures/job-tasks.mjs', import.meta.url).href;

it('R16: идемпотентный ключ изолирован владельцем и не раскрывает результат другому пользователю', async () => {
  const manager = new ArchiveJobManager();
  const first = manager.submit({ idempotencyKey: 'shared-key', kind: 'EXPORT', payload: { value: 1 }, owner, run: () => ({ secret: 'owner-result' }) });
  const second = manager.submit({ idempotencyKey: 'shared-key', kind: 'EXPORT', payload: { value: 1 }, owner: other, run: () => ({ secret: 'other-result' }) });
  expect(second.id).not.toBe(first.id);
  expect(() => manager.get(first.id, other)).toThrow('403');
  expect(manager.get(first.id, owner).owner.userId).toBe('owner-1');
  expect(() => manager.submit({ idempotencyKey: 'forbidden', kind: 'EXPORT', payload: {}, owner: { ...other, authorities: [] }, run: () => null })).toThrow('403');
  manager.start();
  await Promise.all([manager.wait(first.id), manager.wait(second.id)]);
  expect(manager.get(first.id, owner).result).toEqual({ secret: 'owner-result' });
  expect(manager.get(second.id, other).result).toEqual({ secret: 'other-result' });
});

it('R17: cancel и retry требуют владельца и право управления заданием', async () => {
  const manager = new ArchiveJobManager();
  const job = manager.submit({ idempotencyKey: 'rights', kind: 'VERIFY', payload: {}, owner, run: () => 'ok' });
  expect(() => manager.cancel(job.id, other)).toThrow('403');
  expect(() => manager.retry(job.id, other)).toThrow('403');
  expect(() => manager.cancel(job.id, { ...owner, authorities: ['archive.jobs.create', 'archive.jobs.read'] })).toThrow('403');
  expect(manager.cancel(job.id, owner).status).toBe('cancelled');
  expect(manager.retry(job.id, owner).status).toBe('queued');
});

function timeline(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as { attempt: number; kind: 'start' | 'end'; at: number }[];
}
function prepareTimeline(name: string): string {
  const path = `.tmp/${name}.json`;
  rmSync(path, { force: true });
  mkdirSync('.tmp', { recursive: true });
  writeFileSync(path, '[]');
  return path;
}
async function waitForStart(file: string, attempt: number): Promise<void> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (timeline(file).some(entry => entry.kind === 'start' && entry.attempt === attempt)) return;
    await delay(5);
  }
  throw new Error(`Worker attempt ${attempt} не записал старт за 2000 мс`);
}

it('R18: синхронная тяжёлая работа выполняется вне цикла событий основного потока', async () => {
  const manager = new ArchiveJobManager({ maxConcurrent: 1 });
  const busy = function busy() {
    const until = Date.now() + 250;
    while (Date.now() < until) { /* намеренная синхронная нагрузка */ }
    return { done: true };
  };
  const job = manager.submit({ idempotencyKey: 'busy', kind: 'BULK_REPLAY', payload: {}, owner, run: busy });
  manager.start();
  const started = Date.now();
  await delay(20);
  const commandDelay = Date.now() - started;
  expect(commandDelay).toBeLessThan(200);
  await manager.wait(job.id);
  expect(manager.get(job.id, owner)).toMatchObject({ status: 'succeeded', result: { done: true } });
});

it('R19: timeout/cancel завершает worker до retry и исключает поздние эффекты и параллельный повтор', async () => {
  for (const mode of ['cancel', 'timeout'] as const) {
    const file = prepareTimeline(`review-${mode}-timeline`);
    const manager = new ArchiveJobManager({ maxConcurrent: 1, maxDurationMs: mode === 'timeout' ? 200 : 1000 });
    const job = manager.submit({
      idempotencyKey: `unsafe-${mode}`, kind: 'BULK_REPLAY', payload: { file, ms: 500, retryMs: 5 }, owner,
      task: { module: taskModule, exportName: 'timeline' },
    });
    manager.start();
    await waitForStart(file, 1);
    if (mode === 'cancel') manager.cancel(job.id, owner);
    expect(() => manager.retry(job.id, owner)).toThrow();
    await manager.wait(job.id);
    expect(manager.retry(job.id, owner).status).toBe('queued');
    await manager.wait(job.id);
    await delay(150);
    const entries = timeline(file);
    const starts = entries.filter(entry => entry.kind === 'start');
    const ends = entries.filter(entry => entry.kind === 'end');
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(1);
    expect(starts[1].attempt).toBe(2);
    expect(ends[0].attempt).toBe(2);
    expect(ends[0].at).toBeGreaterThanOrEqual(starts[1].at);
    expect(manager.get(job.id, owner)).toMatchObject({ status: 'succeeded', attempts: 2 });
  }
});
