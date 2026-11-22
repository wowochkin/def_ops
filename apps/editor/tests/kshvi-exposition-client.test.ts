import { describe, expect, it, vi } from 'vitest';
import { expositionProgram } from '../../../packages/kshvi/tests/fixtures/exposition';
import { ExpositionClient } from '../src/modern/kshvi/exposition/exposition-client';

describe('browser client серверной экспозиции', () => {
  it('вызывает раздельные presenter/projector API и не подменяет ответы локально', async () => {
    const calls: { url: string; method: string; body?: unknown; headers: Record<string, string> }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      const payload = url.includes('/projector')
        ? { purpose: 'EXPOSITION', map: {}, program: { layers: ['terrain'] } }
        : { sessionId: 'server-session', branchId: 'server-branch', purpose: 'EXPOSITION', label: 'Экспозиция' };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    const client = new ExpositionClient({ baseUrl: '/api/kshvi', fetch: fetcher });

    await client.start({ source: 'ARCHIVE', sessionId: 'archive', branchId: 'archive-branch' });
    await client.start({ source: 'AUTONOMOUS', seed: 42, sessionId: 'auto', branchId: 'auto-branch' });
    await client.command('auto', { type: 'ADVANCE', elapsedMs: 250 });
    await client.continueFromCheckpoint('auto', 'cp-1', { branchId: 'continued', seed: 42 });
    await client.restart('continued', { mode: 'REPLAY_SAVED_LINE' });
    await client.updateProgram('continued', expositionProgram());
    await client.projector('continued', 'projector-1');
    await client.exportArchive('continued', 'derived-1');

    expect(calls.map(call => [call.method, call.url])).toEqual([
      ['POST', '/api/kshvi/expositions'],
      ['POST', '/api/kshvi/expositions'],
      ['POST', '/api/kshvi/expositions/auto/commands'],
      ['POST', '/api/kshvi/expositions/auto/checkpoints/cp-1/continuations'],
      ['POST', '/api/kshvi/expositions/continued/restarts'],
      ['PUT', '/api/kshvi/expositions/continued/program'],
      ['GET', '/api/kshvi/expositions/continued/projector'],
      ['POST', '/api/kshvi/expositions/continued/exports'],
    ]);
    expect(calls[1].body).toMatchObject({ source: 'AUTONOMOUS', seed: 42 });
    expect(calls[6].headers['x-projector-id']).toBe('projector-1');
    expect(calls.every(call => call.body === undefined || !JSON.stringify(call.body).includes('sourceArchive'))).toBe(true);
  });

  it('возвращает серверную ошибку без локального fallback', async () => {
    const client = new ExpositionClient({
      fetch: async () => new Response(JSON.stringify({ error: { message: 'Сервер отклонил программу' } }), { status: 422, headers: { 'Content-Type': 'application/json' } }),
    });
    await expect(client.start({ source: 'ARCHIVE' })).rejects.toThrow('Сервер отклонил программу');
  });
});
