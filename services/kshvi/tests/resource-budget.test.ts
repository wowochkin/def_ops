import { expect, it } from 'vitest';
import { ResourceBudget } from '../src/admin/resource-budget';

it('изолирует тяжёлые задания ограничениями и не блокирует интерактивные команды', () => {
  const budget = new ResourceBudget({ maxConcurrentHeavyJobs: 1, maxQueuedHeavyJobs: 2, cpuUnitsPerJob: 2, memoryMbPerJob: 512 });
  expect(budget.submit({ id: 'export-1', kind: 'EXPORT', cpuUnits: 2, memoryMb: 256 }).status).toBe('RUNNING');
  expect(budget.submit({ id: 'archive-2', kind: 'ARCHIVE', cpuUnits: 2, memoryMb: 256 }).status).toBe('QUEUED');
  expect(budget.submit({ id: 'replay-3', kind: 'REPLAY', cpuUnits: 1, memoryMb: 128 }).status).toBe('QUEUED');
  expect(() => budget.submit({ id: 'export-4', kind: 'EXPORT', cpuUnits: 1, memoryMb: 128 })).toThrow('очередь');
  expect(() => budget.submit({ id: 'bad-5', kind: 'MASS_CALCULATION', cpuUnits: 3, memoryMb: 128 })).toThrow('CPU');

  for (let index = 0; index < 50; index += 1) {
    expect(budget.runInteractive(`command-${index}`, () => index)).toBe(index);
  }
  expect(budget.snapshot()).toMatchObject({ running: 1, queued: 2, interactiveCommandsAccepted: 50 });
  budget.complete('export-1');
  expect(budget.snapshot()).toMatchObject({ running: 1, queued: 1 });
  expect(budget.status('archive-2')).toBe('RUNNING');
  budget.complete('archive-2');
  expect(budget.status('replay-3')).toBe('RUNNING');
});
