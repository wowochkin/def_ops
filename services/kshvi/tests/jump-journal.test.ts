import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { executeJump } from '../../../packages/kshvi/src/runtime/jump';
import { FileJumpJournal } from '../src/runtime/file-jump-journal';

it('C6: durable jump journal сериализует процессы и возвращает сохранённый результат после restart', async () => {
  const directory = await mkdtemp(join('.tmp', `jump-journal-${randomUUID()}-`));
  let calculations = 0;
  try {
    const first = new FileJumpJournal(directory);
    const second = new FileJumpJournal(directory);
    const transaction = (journal: FileJumpJournal) => ({
      jumpId: 'jump', instanceId: 'instance', targetOperationalAt: '2030-01-01T01:00:00Z', world: { value: 0 }, journal,
      calculate: async (world: { value: number }) => {
        calculations += 1;
        await new Promise(resolve => setTimeout(resolve, 15));
        return { value: world.value + 1 };
      },
      approve: async () => {}, snapshot: async (world: { value: number }) => ({ state: world, hash: 'hash' }), report: async () => {},
    });
    const [left, right] = await Promise.all([executeJump(transaction(first)), executeJump(transaction(second))]);
    expect(left).toEqual(right);
    expect(calculations).toBe(1);
    const restarted = new FileJumpJournal(directory);
    await expect(executeJump({ jumpId: 'jump', instanceId: 'instance', targetOperationalAt: '2030-01-01T01:00:00Z', world: { value: 0 }, journal: restarted })).resolves.toEqual(left);
    expect(calculations).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
