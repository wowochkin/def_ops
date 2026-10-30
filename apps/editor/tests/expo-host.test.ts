import { expect, it } from 'vitest';
import { createHost } from '../src/expo/host';
import { memoryBus } from '../src/expo/bus';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import type { Windows } from '../src/expo/windows';
it('host synchronizes views and ignores operator events from visitor bus', async () => {
  const [a, b] = memoryBus();
  const frames: any[] = [];
  b.on((m) => frames.push(m));
  let guarded = false;
  const windows: Windows = {
    monitors: async () => [{ id: 'a', name: 'A', x: 0, y: 0, width: 100, height: 100, scale: 1 }],
    open: async () => {},
    closeAll: async () => {},
    guard: async (v) => {
      guarded = v;
    },
    onMonitors: () => () => {},
  };
  const host = createHost(EXPO_DEFAULTS, a, windows, () => {});
  await host.start();
  expect(guarded).toBe(true);
  expect(host.snapshot().count).toBe(1);
  host.dispatch({ t: 'ready' });
  host.dispatch({ t: 'tick', now: host.snapshot().state.now + 1000 });
  b.send({ k: 'input', ev: { t: 'touch' } });
  expect(host.snapshot().state.phase.kind).toBe('welcome');
  b.send({ k: 'input', ev: { t: 'jump', phase: 'result' } });
  expect(host.snapshot().state.phase.kind).toBe('welcome');
  expect(frames.at(-1).state.phase.kind).toBe('welcome');
  await host.stop();
  expect(guarded).toBe(false);
  b.close();
});
it('pause freezes the host until resume and settings never expose PIN on bus', async () => {
  const [a, b] = memoryBus();
  let latest: any;
  b.on((m) => {
    if (m.k === 'state') latest = m;
  });
  const windows: Windows = {
    monitors: async () => [],
    open: async () => {},
    closeAll: async () => {},
    guard: async () => {},
    onMonitors: () => () => {},
  };
  const host = createHost(EXPO_DEFAULTS, a, windows, () => {});
  await host.start();
  host.dispatch({ t: 'jump', phase: 'turn' });
  const begin = host.snapshot().state.now;
  host.dispatch({ t: 'tick', now: begin + 10000 });
  host.dispatch({ t: 'pause' });
  host.dispatch({ t: 'tick', now: begin + 70000 });
  expect(host.snapshot().state.phase).toMatchObject({ kind: 'turn', step: 'choose' });
  host.dispatch({ t: 'resume' });
  host.dispatch({ t: 'tick', now: begin + 99000 });
  expect(host.snapshot().state.phase).toMatchObject({ step: 'choose' });
  expect(latest.settings.pin).toBe('');
  await host.stop();
  b.close();
});
it('ordinary setting changes preserve runtime fallback without changing operator preference', async () => {
  const [a, b] = memoryBus();
  const windows: Windows = {
    monitors: async () => [],
    open: async () => {},
    closeAll: async () => {},
    guard: async () => {},
    onMonitors: () => () => {},
  };
  const host = createHost(EXPO_DEFAULTS, a, windows, () => {});
  await host.start();
  host.setAiMode('noai');
  await host.configure({ ...EXPO_DEFAULTS, timer: { on: true, seconds: 45 } });
  expect(host.snapshot().settings.aiMode).toBe('noai');
  expect(host.configuration().aiMode).toBe('ai');
  await host.stop();
  b.close();
});
it('visitor cannot restart while operator menu pauses the session', async () => {
  const [a, b] = memoryBus();
  const windows: Windows = {
    monitors: async () => [],
    open: async () => {},
    closeAll: async () => {},
    guard: async () => {},
    onMonitors: () => () => {},
  };
  const host = createHost(EXPO_DEFAULTS, a, windows, () => {});
  await host.start();
  host.dispatch({ t: 'jump', phase: 'turn', n: 2 });
  host.dispatch({ t: 'pause' });
  b.send({ k: 'input', ev: { t: 'restart' } });
  expect(host.snapshot().state.phase).toMatchObject({ kind: 'turn', n: 2 });
  host.dispatch({ t: 'restart' });
  expect(host.snapshot().state.phase.kind).toBe('welcome');
  await host.stop();
  b.close();
});
it('settings other than screens do not rearrange windows', async () => {
  const [a, b] = memoryBus();
  let opened = 0;
  const windows: Windows = {
    monitors: async () => [],
    open: async () => {
      opened++;
    },
    closeAll: async () => {},
    guard: async () => {},
    onMonitors: () => () => {},
  };
  const host = createHost(EXPO_DEFAULTS, a, windows, () => {});
  await host.start();
  expect(opened).toBe(1);
  await host.configure({ ...EXPO_DEFAULTS, volume: { ...EXPO_DEFAULTS.volume, voice: 0.3 } });
  await host.configure({ ...EXPO_DEFAULTS, timer: { on: true, seconds: 45 } });
  expect(opened).toBe(1);
  await host.configure({ ...EXPO_DEFAULTS, screens: { count: 2, order: [] } });
  expect(opened).toBe(2);
  await host.stop();
  b.close();
});
