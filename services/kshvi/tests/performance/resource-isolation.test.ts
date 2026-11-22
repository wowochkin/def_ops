import { expect, it } from 'vitest';
import { ResourceBudget } from '../../src/admin/resource-budget';

it('ограничивает одновременные тяжёлые задания и сохраняет приём интерактивных команд', () => {
  const budget = new ResourceBudget({ maxConcurrentHeavyJobs: 2, maxQueuedHeavyJobs: 4, cpuUnitsPerJob: 2, memoryMbPerJob: 128 });
  budget.submit({ id: 'export', kind: 'EXPORT', cpuUnits: 1, memoryMb: 64 });
  budget.submit({ id: 'archive', kind: 'ARCHIVE', cpuUnits: 1, memoryMb: 64 });
  expect(budget.submit({ id: 'replay', kind: 'REPLAY', cpuUnits: 1, memoryMb: 64 }).status).toBe('QUEUED');
  for (let index = 0; index < 100; index += 1) budget.runInteractive(`command-${index}`, () => index);
  expect(budget.snapshot()).toEqual({ running: 2, queued: 1, interactiveCommandsAccepted: 100 });
  expect(() => budget.submit({ id: 'too-large', kind: 'MASS_CALCULATION', cpuUnits: 3, memoryMb: 64 })).toThrow('CPU');
});
