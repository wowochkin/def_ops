import { afterEach, expect, it, vi } from 'vitest';
import { startupPlan, startupVerdict, watchdog, missingWindows } from '../src/expo/health';
import { EXPO_DEFAULTS } from '../src/expo/settings';
afterEach(() => vi.useRealTimers());
it('startup all ok and fallback when model fails', () => {
  expect(startupVerdict({ core: 'ok', windows: 'ok', voice: 'ok', model: 'ok' }, EXPO_DEFAULTS)).toEqual({
    ready: true,
    aiMode: 'ai',
    note: null,
  });
  expect(startupVerdict({ core: 'ok', windows: 'ok', voice: 'ok', model: 'fail' }, EXPO_DEFAULTS)).toEqual({
    ready: true,
    aiMode: 'noai',
    note: 'Запуск в режиме без ИИ',
  });
  expect(startupVerdict({ core: 'fail', windows: 'ok', voice: 'ok', model: 'ok' }, EXPO_DEFAULTS).ready).toBe(false);
  expect(startupPlan({ ...EXPO_DEFAULTS, aiMode: 'noai' })).not.toContain('model');
});
it('watchdog restarts once per outage and recovers', async () => {
  vi.useFakeTimers();
  let healthy = false,
    restarts = 0;
  const failures: string[] = [],
    recoveries: string[] = [];
  const stop = watchdog(
    [
      {
        id: 'model',
        label: 'Модель',
        check: async () => healthy,
        restart: async () => {
          restarts++;
        },
      },
    ],
    (id) => failures.push(id),
    100,
    (id) => recoveries.push(id),
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(failures).toEqual([]);
  await vi.advanceTimersByTimeAsync(200);
  expect(failures).toEqual(['model']);
  expect(restarts).toBe(1);
  healthy = true;
  await vi.advanceTimersByTimeAsync(100);
  expect(recoveries).toEqual(['model']);
  stop();
});
it('missed beat reopens only expected secondary windows', () => {
  expect(
    missingWindows(
      3,
      new Map([
        [1, 10000],
        [2, 0],
      ]),
      11000,
    ),
  ).toEqual([2]);
  expect(missingWindows(1, new Map(), 11000)).toEqual([]);
});
it('reports a healthy first sweep so startup fallback can recover immediately', async () => {
  vi.useFakeTimers();
  let sweeps = 0;
  const stop = watchdog(
    [{ id: 'model', label: 'Модель', check: async () => true }],
    () => {},
    100,
    () => {},
    () => {
      sweeps++;
    },
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(sweeps).toBe(1);
  stop();
});
it('a hanging probe is bounded and abort releases it', async () => {
  vi.useFakeTimers();
  const { checkProbe } = await import('../src/expo/health');
  const probe = { id: 'model' as const, label: 'Модель', check: () => new Promise<boolean>(() => {}) };
  const pending = checkProbe(probe, 1000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toBe(false);
  const abort = new AbortController();
  const cancelled = checkProbe(probe, 10000, abort.signal);
  abort.abort();
  expect(await cancelled).toBe(false);
});
it('voice failure restarts it at once and reports once per outage', async () => {
  vi.useFakeTimers();
  let restarts = 0;
  const failures: string[] = [];
  const stop = watchdog(
    [{ id: 'voice', label: 'Голос', check: async () => false, restart: async () => { restarts++; } }],
    (id) => failures.push(id),
    100,
  );
  await vi.advanceTimersByTimeAsync(100);
  expect(failures).toEqual(['voice']);
  expect(restarts).toBe(1);
  await vi.advanceTimersByTimeAsync(300);
  expect(failures).toEqual(['voice']);
  expect(restarts).toBe(1);
  stop();
});
