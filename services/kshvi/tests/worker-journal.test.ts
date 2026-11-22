import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { FileWorkerJournal } from '../src/runtime/file-worker-journal';
import { assignmentFixture, projectionFixture } from '../../../packages/kshvi-agents/tests/fixtures';
import { createAgentCommands } from '../../../packages/kshvi-agents/src/intermediary/act';

it('C5/C6: файловый журнал workers восстанавливает autonomy и неподтверждённые команды после перезапуска', async () => {
  const directory = await mkdtemp(join('.tmp', `worker-journal-${randomUUID()}-`));
  try {
    const first = new FileWorkerJournal(directory);
    await first.save({ version: 1, intervals: {}, processedIntervalKeys: ['branch:0'], schedulerState: undefined }, 'instance', 'branch');
    const projection = projectionFixture();
    const command = createAgentCommands(assignmentFixture(), projection, 'wake', '2030-01-01T00:00:00Z', [projection.requestedActions[0]])[0];
    await first.enqueueCommand({ cycleId: 'cycle', command });
    const restarted = new FileWorkerJournal(directory);
    await expect(restarted.load('instance', 'branch')).resolves.toMatchObject({ processedIntervalKeys: ['branch:0'] });
    await expect(restarted.pendingCommands()).resolves.toHaveLength(1);
    await restarted.completeCommand(command.commandId, { commandId: command.commandId, accepted: true, idempotent: true, effectApplied: false, status: 'DUPLICATE' });
    await expect(restarted.pendingCommands()).resolves.toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
