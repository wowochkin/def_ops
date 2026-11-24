import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { WorkerRecoveryService, type WorkerEffectResult } from '../src/admin/worker-recovery';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('не повторяет эффект при сбое между идемпотентным эффектом и checkpoint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kshvi-worker-crash-'));
  roots.push(root);
  const stateFile = join(root, 'workers.jsonl');
  const applied = new Set<string>();
  const effects: string[] = [];
  async function effect(context: { workerId: string; sequence: number; idempotencyKey: string }, crash: boolean): Promise<WorkerEffectResult> {
    if (applied.has(context.idempotencyKey)) return 'ALREADY_APPLIED';
    applied.add(context.idempotencyKey);
    effects.push(context.idempotencyKey);
    if (crash) throw new Error('Сбой после эффекта до checkpoint');
    return 'APPLIED';
  }
  const first = new WorkerRecoveryService({ stateFile });
  await expect(first.resume('outbox', 42, context => effect(context, true))).rejects.toThrow('до checkpoint');
  const restarted = new WorkerRecoveryService({ stateFile });
  expect(await restarted.resume('outbox', 42, context => effect(context, false))).toBe(true);
  expect(await restarted.resume('outbox', 42, context => effect(context, false))).toBe(false);
  expect(effects).toEqual(['outbox:42']);
});
