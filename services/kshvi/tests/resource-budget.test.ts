import { afterEach, expect, it } from 'vitest';
import { ResourceBudget } from '../src/admin/resource-budget';

const budgets: ResourceBudget[] = [];
afterEach(async () => { await Promise.all(budgets.splice(0).map(budget => budget.close())); });

function budget(events: string[]): ResourceBudget {
  const value = new ResourceBudget(
    { maxConcurrentHeavyJobs: 1, maxQueuedHeavyJobs: 2, cpuUnitsPerJob: 2, memoryMbPerJob: 128 },
    { event: event => events.push(event) },
  );
  budgets.push(value);
  return value;
}

it('выполняет тяжёлые задания в отдельных процессах с лимитом памяти и реальной очередью', async () => {
  const events: string[] = [];
  const service = budget(events);
  const first = service.submit({ id: 'cpu-1', kind: 'MASS_CALCULATION', cpuUnits: 1, memoryMb: 64, operation: { kind: 'CPU_WORK', iterations: 200_000 } });
  const second = service.submit({ id: 'cpu-2', kind: 'REPLAY', cpuUnits: 1, memoryMb: 64, operation: { kind: 'CPU_WORK', iterations: 100_000 } });
  expect(first.status).toBe('RUNNING');
  expect(second.status).toBe('QUEUED');
  expect(() => service.submit({ id: 'cpu-3', kind: 'EXPORT', cpuUnits: 1, memoryMb: 64, operation: { kind: 'CPU_WORK', iterations: 1 } })).not.toThrow();
  expect(() => service.submit({ id: 'cpu-4', kind: 'EXPORT', cpuUnits: 1, memoryMb: 64, operation: { kind: 'CPU_WORK', iterations: 1 } })).toThrow('очередь');
  const firstResult = await service.wait('cpu-1');
  const secondResult = await service.wait('cpu-2');
  await service.wait('cpu-3');
  expect(firstResult).toMatchObject({ status: 'SUCCEEDED', result: { iterations: 200_000 } });
  expect(firstResult.result.cpuUsage.userMs).toBeGreaterThanOrEqual(0);
  expect(firstResult.result.cpuUsage.systemMs).toBeGreaterThanOrEqual(0);
  expect(service.capabilities()).toMatchObject({ cpuControl: 'BLOCKED', cpuUnitsAdmissionOnly: true, nf04Confirmed: false });
  expect(secondResult.result.pid).not.toBe(process.pid);
  expect(firstResult.result.pid).not.toBe(secondResult.result.pid);
  expect(events.filter(event => event.startsWith('started:'))).toEqual(['started:cpu-1', 'started:cpu-2', 'started:cpu-3']);
});

it('пропускает критическую интерактивную команду перед следующим тяжёлым заданием', async () => {
  const events: string[] = [];
  const service = budget(events);
  service.submit({ id: 'heavy-1', kind: 'ARCHIVE', cpuUnits: 2, memoryMb: 64, operation: { kind: 'CPU_WORK', iterations: 500_000 } });
  service.submit({ id: 'heavy-2', kind: 'EXPORT', cpuUnits: 1, memoryMb: 64, operation: { kind: 'CPU_WORK', iterations: 100_000 } });
  expect(service.runInteractive('critical-command', () => {
    events.push('interactive:critical-command');
    return 'accepted';
  })).toBe('accepted');
  await service.wait('heavy-1');
  await service.wait('heavy-2');
  expect(events.indexOf('interactive:critical-command')).toBeLessThan(events.indexOf('started:heavy-2'));
  expect(service.snapshot()).toMatchObject({ running: 0, queued: 0, interactiveCommandsAccepted: 1, completed: 2 });
});

it('отклоняет превышение CPU и памяти до запуска процесса', () => {
  const service = budget([]);
  expect(() => service.submit({ id: 'cpu-limit', kind: 'EXPORT', cpuUnits: 3, memoryMb: 64, operation: { kind: 'CPU_WORK', iterations: 1 } })).toThrow('CPU');
  expect(() => service.submit({ id: 'memory-limit', kind: 'EXPORT', cpuUnits: 1, memoryMb: 256, operation: { kind: 'CPU_WORK', iterations: 1 } })).toThrow('памяти');
});
