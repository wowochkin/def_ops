import { afterEach, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn(async (_cmd: string, _args?: unknown) => JSON.stringify({ id: 'berlin-1945' })));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
import { localProbes } from '../src/expo/probes';
afterEach(() => { vi.unstubAllGlobals(); invoke.mockClear(); });

it('проверка готовности не запускает и не останавливает единственный GAME', async () => {
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
  const core = localProbes(() => true).find(p => p.id === 'core')!;
  expect(await core.check()).toBe(true);
  expect(await core.check()).toBe(true);
  expect(invoke.mock.calls.map(c => c[0])).toEqual(['read_text', 'read_text']);
});
