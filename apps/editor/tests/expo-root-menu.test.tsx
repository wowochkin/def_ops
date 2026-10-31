// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { DirectorEvent } from '../src/expo/director';

const fake = vi.hoisted(() => ({ events: [] as unknown[], stopped: 0 }));

vi.mock('../src/expo/host', async () => {
  const { initialState } = await import('../src/expo/director');
  const { EXPO_DEFAULTS } = await import('../src/expo/settings');
  return {
    createHost: () => ({
      snapshot: () => ({ state: initialState(0), settings: EXPO_DEFAULTS, count: 1 }),
      dispatch: (ev: DirectorEvent) => fake.events.push(ev),
      ready: () => true,
      configuration: () => EXPO_DEFAULTS,
      setAiMode: () => {},
      setAi: () => {},
      checkWindows: async () => {},
      start: async () => {},
      configure: async () => {},
      stop: async () => {
        fake.stopped++;
      },
    }),
  };
});
vi.mock('../src/expo/stage', () => ({
  createStage: () => ({ hooks: {}, handle() {}, tick() {}, resume() {}, dispose() {} }),
}));
vi.mock('../src/expo/probes', () => ({
  localProbes: () => [],
  runProbes: async () => ({ core: 'ok', voice: 'ok', model: 'ok', windows: 'ok' }),
}));
vi.mock('../src/expo/bus', async () => {
  const { memoryBus } = await vi.importActual<typeof import('../src/expo/bus')>('../src/expo/bus');
  return { memoryBus, expoBus: () => memoryBus()[0] };
});
vi.mock('../src/expo/windows', async () => {
  const actual = await vi.importActual<typeof import('../src/expo/windows')>('../src/expo/windows');
  return {
    ...actual,
    expoWindows: () => ({ monitors: async () => [], open: async () => {}, closeAll: async () => {}, guard: async () => {}, onMonitors: () => () => {} }),
  };
});

const { ExpoRoot } = await import('../src/expo/ExpoRoot');

afterEach(() => {
  cleanup();
  fake.events.length = 0;
  fake.stopped = 0;
});

const combo = () => fireEvent.keyDown(document, { code: 'KeyO', ctrlKey: true, altKey: true, shiftKey: true });

it('operator menu pauses the session and resumes on close', async () => {
  const view = render(<ExpoRoot index={0} />);
  await waitFor(() => expect(fake.events).toContainEqual({ t: 'ready' }));
  combo();
  expect(fake.events.at(-1)).toEqual({ t: 'pause' });
  expect(view.getByRole('dialog', { name: 'Меню оператора' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Закрыть' }));
  expect(fake.events.at(-1)).toEqual({ t: 'resume' });
  expect(view.queryByRole('dialog')).toBeNull();
});

it('exit to full mode stops the host and leaves exhibition address', async () => {
  history.replaceState(null, '', '/?expo=0');
  let exited = false;
  const view = render(
    <ExpoRoot
      index={0}
      onExit={() => {
        exited = true;
      }}
    />,
  );
  await waitFor(() => expect(fake.events).toContainEqual({ t: 'ready' }));
  combo();
  fireEvent.change(view.getByLabelText('ПИН'), { target: { value: '0000' } });
  fireEvent.click(view.getByRole('button', { name: 'Открыть меню' }));
  fireEvent.click(view.getByRole('button', { name: 'Выйти в полный режим' }));
  await waitFor(() => expect(exited).toBe(true));
  expect(fake.stopped).toBe(1);
  expect(new URL(location.href).searchParams.has('expo')).toBe(false);
});
