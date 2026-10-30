import { describe, expect, it } from 'vitest';
import { EXPO_DEFAULTS, type ExpoSettings } from '../src/expo/settings';
import { desktopWindows, plan, type MonitorInfo } from '../src/expo/windows';

const mon = (id: string, x: number): MonitorInfo => ({ id, name: id, x, y: 0, width: 1920, height: 1080, scale: 1 });
const A = mon('A', 0);
const B = mon('B', 1920);
const C = mon('C', 3840);
const withScreens = (count: 1 | 2 | 3, order: string[]): ExpoSettings => ({ ...EXPO_DEFAULTS, screens: { count, order } });

describe('план окон по мониторам', () => {
  it('plan orders by settings', () => {
    expect(plan([B, C, A], withScreens(3, ['C', 'A']))).toEqual({
      count: 3,
      windows: [{ index: 0, monitor: 'C' }, { index: 1, monitor: 'A' }, { index: 2, monitor: 'B' }],
    });
  });

  it('monitor loss relayouts', () => {
    const s = withScreens(3, ['C', 'A']);
    expect(plan([A, B, C], s).count).toBe(3);
    expect(plan([A, C], s)).toEqual({ count: 2, windows: [{ index: 0, monitor: 'C' }, { index: 1, monitor: 'A' }] });
    expect(plan([C], s)).toEqual({ count: 1, windows: [{ index: 0, monitor: 'C' }] });
  });

  it('unknown ids ignored', () => {
    expect(plan([C, A, B], withScreens(3, ['Z', 'Y'])).windows.map((w) => w.monitor)).toEqual(['A', 'B', 'C']);
  });

  it('fewer windows wanted than monitors', () => {
    expect(plan([A, B, C], withScreens(2, ['B']))).toEqual({ count: 2, windows: [{ index: 0, monitor: 'B' }, { index: 1, monitor: 'A' }] });
  });

  it('no monitors still gives one window', () => {
    expect(plan([], withScreens(3, []))).toEqual({ count: 1, windows: [{ index: 0, monitor: '' }] });
  });
});

describe('окна в приложении', () => {
  const noListen = async () => () => {};
  const p = { count: 1 as const, windows: [{ index: 0, monitor: 'A' }] };

  it('open retries while editor not ready', async () => {
    const calls: string[] = [];
    let left = 2;
    const invoke = async (cmd: string) => { calls.push(cmd); if (left-- > 0) throw 'EXPO_NOT_READY: главное окно ещё на странице запуска'; return null; };
    await desktopWindows(invoke, noListen, { retryMs: 1 }).open(p);
    expect(calls).toEqual(['expo_open', 'expo_open', 'expo_open']);
  });

  it('open fails on other errors at once', async () => {
    let n = 0;
    const invoke = async () => { n++; throw 'окно expo-1 не открылось'; };
    await expect(desktopWindows(invoke, noListen, { retryMs: 1 }).open(p)).rejects.toBe('окно expo-1 не открылось');
    expect(n).toBe(1);
  });
});
