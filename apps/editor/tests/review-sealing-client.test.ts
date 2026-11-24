import { expect, it, vi } from 'vitest';
import { createFetchSealingClient } from '../src/modern/kshvi/preparation/sealing-client';

it('C3: browser client отправляет запуск на сервер без самоподтверждённых полномочий и без node:*', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'instance', state: 'ACTIVE' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  const client = createFetchSealingClient({ baseUrl: 'https://kshvi.local', csrfToken: 'csrf', fetchImpl: fetchImpl as typeof fetch });
  await client.start('sealed', { instanceId: 'instance', idempotencyKey: 'start', seed: 'seed', actorRole: 'DIRECTOR', serverCommand: true });
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://kshvi.local/kshvi/sealing/sealed/instances');
  expect(init.credentials).toBe('same-origin');
  expect(init.headers).toMatchObject({ 'x-csrf-token': 'csrf' });
  expect(JSON.parse(String(init.body))).toEqual({ instanceId: 'instance', idempotencyKey: 'start', seed: 'seed' });
});
