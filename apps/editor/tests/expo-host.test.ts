import { expect, it, vi } from 'vitest';
import { createHost } from '../src/expo/host';
import { memoryBus } from '../src/expo/bus';
import { EXPO_DEFAULTS } from '../src/expo/settings';
import type { Windows } from '../src/expo/windows';
import { watchdog } from '../src/expo/health';
const tickTo = (host: ReturnType<typeof createHost>, target: number) => {
  while (host.snapshot().state.now < target) host.dispatch({ t: 'tick', now: Math.min(target, host.snapshot().state.now + 250) });
};
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
  tickTo(host, host.snapshot().state.now + 1000);
  b.send({ k: 'input', ev: { t: 'touch' } });
  expect(host.snapshot().state.phase.kind).toBe('intro');
  b.send({ k: 'input', ev: { t: 'introSeek', line: 3 } });
  expect(host.snapshot().state.phase).toEqual({ kind: 'intro', line: 3 });
  expect(frames.at(-1).state.phase).toEqual({ kind: 'intro', line: 3 });
  // Центр трёхэкранной раскладки — окно вида: пропуск приходит по шине.
  b.send({ k: 'input', ev: { t: 'skipIntro' } });
  expect(host.snapshot().state.phase.kind).toBe('welcome');
  b.send({ k: 'input', ev: { t: 'jump', phase: 'result' } });
  expect(host.snapshot().state.phase.kind).toBe('welcome');
  expect(frames.at(-1).state.phase.kind).toBe('welcome');
  host.setModel({ view: null, error: 'Модель недоступна: нет ядра' });
  expect(frames.at(-1).model).toEqual({ view: null, error: 'Модель недоступна: нет ядра' });
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
  tickTo(host, begin + 10000);
  host.dispatch({ t: 'pause' });
  tickTo(host, begin + 70000);
  expect(host.snapshot().state.phase).toMatchObject({ kind: 'turn', step: 'choose' });
  host.dispatch({ t: 'resume' });
  tickTo(host, begin + 99000);
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
it('просроченный сигнал восстанавливает раскладку без закрытия исправных окон', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const [a, b] = memoryBus();
  const calls: string[] = [];
  const two = [
    { id: 'a', name: 'A', x: 0, y: 0, width: 100, height: 100, scale: 1 },
    { id: 'b', name: 'B', x: 100, y: 0, width: 100, height: 100, scale: 1 },
  ];
  const windows: Windows = {
    monitors: async () => two,
    open: async (p) => {
      calls.push(`open:${p.count}`);
    },
    closeAll: async () => {
      calls.push('closeAll');
    },
    guard: async (on) => {
      calls.push(`guard:${on}`);
    },
    onMonitors: () => () => {},
  };
  const host = createHost({ ...EXPO_DEFAULTS, screens: { count: 2, order: [] }, generation: { ...EXPO_DEFAULTS.generation, comments: false } }, a, windows, () => {});
  try {
    await host.start();
    expect(host.ready()).toBe(false);
    b.send({ k: 'beat', window: 1, at: Date.now() });
    host.dispatch({ t: 'jump', phase: 'turn', n: 3 });
    host.dispatch({ t: 'step', step: 'choose' });
    host.dispatch({ t: 'choose', card: 0 });
    host.dispatch({ t: 'scrollReady' });
    host.dispatch({ t: 'scrollDone' });
    const before = host.snapshot().state;
    expect(before.phase).toMatchObject({ kind: 'turn', n: 3, preparing: true });
    await vi.advanceTimersByTimeAsync(10001);
    await Promise.all([host.checkWindows(), host.checkWindows()]);
    expect(calls).toEqual(['guard:true', 'open:2', 'open:2']);
    expect(host.snapshot().state).toBe(before);
    b.send({ k: 'beat', window: 1, at: Date.now() });
    expect(host.ready()).toBe(true);
    await host.checkWindows();
    expect(calls).toHaveLength(3);
    host.dispatch({ t: 'debriefReady' });
    expect(host.snapshot().state.phase.kind).toBe('result');
    expect(host.snapshot().state.session).toBe(before.session);
  } finally {
    await host.stop();
    b.close();
    vi.useRealTimers();
  }
  expect(calls.slice(3)).toEqual(['guard:false', 'closeAll']);
});

it('ошибка перестановки мониторов сохраняет сеанс и повторяется при восстановлении', async () => {
  const [a, b] = memoryBus();
  const monitors = ['a', 'b', 'c'].map((id, i) => ({ id, name: id, x: i * 100, y: 0, width: 100, height: 100, scale: 1 }));
  let notify = (_: typeof monitors) => {};
  const open = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Экран недоступен')).mockResolvedValueOnce(undefined);
  const windows: Windows = { monitors: async () => monitors, open, closeAll: async () => {}, guard: async () => {}, onMonitors: f => { notify = f; return () => {}; } };
  const report = vi.fn();
  const host = createHost(EXPO_DEFAULTS, a, windows, () => {}, undefined, report);
  try {
    await host.start();
    host.dispatch({ t: 'jump', phase: 'result' });
    for (const window of [1, 2]) b.send({ k: 'beat', window, at: Date.now() });
    const state = host.snapshot().state;
    notify(monitors);
    await vi.waitFor(() => expect(report).toHaveBeenCalledOnce());
    expect(host.snapshot().state).toBe(state);
    expect(host.windowsHealthy()).toBe(false);
    await host.checkWindows();
    expect(open).toHaveBeenCalledTimes(3);
    expect(host.snapshot().state).toBe(state);
    expect(host.windowsHealthy()).toBe(true);
  } finally { await host.stop(); b.close(); }
});

it('вернувшееся после 3→2→3 окно обязано прислать новое сердцебиение', async () => {
  const [a, b] = memoryBus();
  const monitors = ['a', 'b', 'c'].map((id, i) => ({ id, name: id, x: i * 100, y: 0, width: 100, height: 100, scale: 1 }));
  let changed = (_: typeof monitors) => {};
  const windows: Windows = { monitors: async () => monitors, open: async () => {}, closeAll: async () => {}, guard: async () => {}, onMonitors: f => { changed = f; return () => {}; } };
  const host = createHost(EXPO_DEFAULTS, a, windows, () => {});
  await host.start(); host.dispatch({ t: 'jump', phase: 'turn', n: 2 });
  for (const window of [1, 2]) b.send({ k: 'beat', window, at: Date.now() });
  changed(monitors.slice(0, 2)); await new Promise(r => setTimeout(r, 0));
  changed(monitors); await new Promise(r => setTimeout(r, 0));
  expect(host.snapshot().count).toBe(3);
  expect(host.ready()).toBe(false);
  expect(host.snapshot().state.phase).toMatchObject({ kind: 'turn', n: 2 });
  b.send({ k: 'beat', window: 2, at: Date.now() });
  expect(host.ready()).toBe(true);
  await host.stop(); b.close();
});

it('ошибка нового плана возвращает прежние настройки и окна без сброса сеанса', async () => {
  const [a, b] = memoryBus();
  const opened: number[] = [];
  const monitors = ['a', 'b', 'c'].map((id, i) => ({ id, name: id, x: i * 100, y: 0, width: 100, height: 100, scale: 1 }));
  const windows: Windows = { monitors: async () => monitors, open: async p => { opened.push(p.count); if (p.count === 2) throw Error('экран не открылся'); }, closeAll: async () => {}, guard: async () => {}, onMonitors: () => () => {} };
  const host = createHost(EXPO_DEFAULTS, a, windows, () => {});
  await host.start(); host.dispatch({ t: 'jump', phase: 'turn', n: 2 });
  await expect(host.configure({ ...EXPO_DEFAULTS, screens: { count: 2, order: [] }, aiMode: 'noai' })).rejects.toThrow('экран не открылся');
  expect(host.configuration()).toEqual(EXPO_DEFAULTS);
  expect(host.snapshot().count).toBe(3);
  expect(host.snapshot().settings.aiMode).toBe(EXPO_DEFAULTS.aiMode);
  expect(host.snapshot().state.phase).toMatchObject({ kind: 'turn', n: 2 });
  expect(opened).toEqual([3, 2, 3]);
  await host.stop(); b.close();
});

it('гонка hotplug перечитывает мониторы один раз и сохраняет фазу сеанса', async () => {
  const [a, b] = memoryBus();
  let monitors = ['a', 'b', 'c'].map((id, i) => ({ id, name: id, x: i * 100, y: 0, width: 100, height: 100, scale: 1 }));
  const opened: number[] = [];
  const windows: Windows = { monitors: async () => monitors, open: async p => {
    opened.push(p.count);
    if (opened.length === 2) { monitors = monitors.slice(0, 2); throw Error('EXPO_MONITORS_CHANGED: отключён экран'); }
  }, closeAll: async () => {}, guard: async () => {}, onMonitors: () => () => {} };
  const host = createHost(EXPO_DEFAULTS, a, windows, () => {});
  await host.start(); host.dispatch({ t: 'jump', phase: 'turn', n: 2 });
  await host.configure({ ...EXPO_DEFAULTS, screens: { count: 3, order: ['c', 'b', 'a'] } });
  expect(opened).toEqual([3, 3, 2]);
  expect(host.snapshot().count).toBe(2);
  expect(host.snapshot().state.phase).toMatchObject({ kind: 'turn', n: 2 });
  await host.stop(); b.close();
});

it('hotplug в очереди применяет последний сохранённый порядок после завершения перестановки', async () => {
  const [a, b] = memoryBus();
  const monitors = ['a', 'b', 'c'].map((id, i) => ({ id, name: id, x: i * 100, y: 0, width: 100, height: 100, scale: 1 }));
  const opened: string[][] = [];
  let changed = (_: typeof monitors) => {};
  let finish = () => {};
  const windows: Windows = {
    monitors: async () => monitors, closeAll: async () => {}, guard: async () => {},
    onMonitors: f => { changed = f; return () => {}; },
    open: async p => {
      opened.push(p.windows.map(w => w.monitor));
      if (opened.length === 2) await new Promise<void>(r => { finish = r; });
    },
  };
  const host = createHost(EXPO_DEFAULTS, a, windows, () => {});
  await host.start(); host.dispatch({ t: 'jump', phase: 'turn', n: 2 });
  const order = ['c', 'b', 'a'];
  const saving = host.configure({ ...EXPO_DEFAULTS, screens: { count: 3, order } });
  await new Promise(r => setTimeout(r, 0));
  changed(monitors.map(m => ({ ...m, scale: 1.5 })));
  finish(); await saving;
  await new Promise(r => setTimeout(r, 0));
  expect(host.configuration().screens.order).toEqual(order);
  expect(opened.at(-1)).toEqual(order);
  expect(host.snapshot().state.phase).toMatchObject({ kind: 'turn', n: 2 });
  await host.stop(); b.close();
});

it('новое окно получает время на первый beat, а зависшее существующее окно не получает новую отсрочку', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const [a, b] = memoryBus();
  const monitors = ['a', 'b', 'c'].map((id, i) => ({ id, name: id, x: i * 100, y: 0, width: 100, height: 100, scale: 1 }));
  const windows: Windows = { monitors: async () => monitors, open: async () => {}, closeAll: async () => {}, guard: async () => {}, onMonitors: () => () => {} };
  const host = createHost({ ...EXPO_DEFAULTS, screens: { count: 2, order: [] } }, a, windows, () => {});
  let stop = () => {};
  const fail = vi.fn();
  try {
    await host.start(); host.dispatch({ t: 'jump', phase: 'turn', n: 2 });
    b.send({ k: 'beat', window: 1, at: Date.now() });
    stop = watchdog([{ id: 'windows', label: 'Экраны', check: async () => host.windowsHealthy() }], fail, 100);
    await host.configure(EXPO_DEFAULTS);
    expect(host.ready()).toBe(false); // готовность всё ещё требует собственного heartbeat каждого окна
    expect(host.windowsHealthy()).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.snapshot().state.phase).toMatchObject({ kind: 'turn', n: 2 });
    b.send({ k: 'beat', window: 2, at: Date.now() });
    expect(host.ready()).toBe(true);
    await vi.advanceTimersByTimeAsync(8100); // heartbeat старого окна 1 просрочен, окна 2 ещё свежий
    expect(host.windowsHealthy()).toBe(false);
    expect(fail).toHaveBeenCalledExactlyOnceWith('windows');
    expect(host.snapshot().state.phase).toMatchObject({ kind: 'turn', n: 2 });
  } finally { stop(); await host.stop(); b.close(); vi.useRealTimers(); }
});

it('отсрочка первого heartbeat ограничена и заново появляется только у вновь открытого окна', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const [a, b] = memoryBus();
  const monitors = ['a', 'b', 'c'].map((id, i) => ({ id, name: id, x: i * 100, y: 0, width: 100, height: 100, scale: 1 }));
  const windows: Windows = { monitors: async () => monitors, open: async () => {}, closeAll: async () => {}, guard: async () => {}, onMonitors: () => () => {} };
  const host = createHost(EXPO_DEFAULTS, a, windows, () => {});
  try {
    await host.start();
    await vi.advanceTimersByTimeAsync(10001);
    b.send({ k: 'beat', window: 1, at: Date.now() });
    expect(host.windowsHealthy()).toBe(false);
    await host.configure({ ...EXPO_DEFAULTS, screens: { count: 3, order: ['c', 'b', 'a'] } });
    expect(host.windowsHealthy()).toBe(false); // перестановка не перезапускает срок молчащего окна
    await host.configure({ ...EXPO_DEFAULTS, screens: { count: 2, order: [] } });
    await host.configure(EXPO_DEFAULTS);
    expect(host.windowsHealthy()).toBe(true);
    expect(host.ready()).toBe(false);
    await vi.advanceTimersByTimeAsync(10001);
    b.send({ k: 'beat', window: 1, at: Date.now() });
    expect(host.windowsHealthy()).toBe(false);
  } finally { await host.stop(); b.close(); vi.useRealTimers(); }
});
