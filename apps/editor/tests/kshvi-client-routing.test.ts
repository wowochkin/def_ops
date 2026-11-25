// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { createFetchSealingClient } from '../src/modern/kshvi/preparation/sealing-client';
import { ExpositionClient } from '../src/modern/kshvi/exposition/exposition-client';

afterEach(() => sessionStorage.clear());

it('клиент запуска по умолчанию идёт через API и берёт актуальный CSRF текущей сессии', async () => {
  const fetchImpl = vi.fn(async () => Response.json({ id: 'instance', state: 'ACTIVE' }));
  const client = createFetchSealingClient({ fetchImpl: fetchImpl as typeof fetch });
  sessionStorage.setItem('def_ops.kshvi.csrf:/api/kshvi', 'current-session-token');
  await client.start('saved', { instanceId: 'instance', idempotencyKey: 'start', seed: 'seed', actorRole: 'DIRECTOR', serverCommand: true });
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/kshvi/sealing/saved/instances');
  expect(init.headers).toMatchObject({ 'x-csrf-token': 'current-session-token' });
  expect(JSON.parse(String(init.body))).not.toHaveProperty('actorRole');
});

it('экспозиция использует токен общего клиента вместо устаревшего общего ключа', async () => {
  const fetchImpl = vi.fn(async () => Response.json({ sessionId: 'session' }));
  const client = new ExpositionClient({ fetch: fetchImpl });
  sessionStorage.setItem('def_ops.kshvi.csrf', 'old-session-token');
  sessionStorage.setItem('def_ops.kshvi.csrf:/api/kshvi', 'current-session-token');
  await client.presenter('session');
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('/api/kshvi/expositions/session/presenter');
  expect(init.headers).toMatchObject({ 'X-CSRF-Token': 'current-session-token' });
});

it('проведение отправляет команды с актуальным токеном общей сессии', async () => {
  const fetchImpl = vi.fn(async () => Response.json('PAUSED'));
  vi.stubGlobal('fetch', fetchImpl);
  try {
    const { HttpConductClient } = await import('../src/modern/kshvi/conduct/conduct-api');
    const client = new HttpConductClient({ instanceId: 'instance/id', sideId: 'side', role: 'DIRECTOR' });
    sessionStorage.setItem('def_ops.kshvi.csrf:/api/kshvi', 'current-session-token');
    await client.executeCritical('PAUSE');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/kshvi/instances/instance%2Fid/commands');
    expect(init.headers).toMatchObject({ 'x-csrf-token': 'current-session-token' });
  } finally { vi.unstubAllGlobals(); }
});
