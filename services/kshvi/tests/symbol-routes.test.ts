import { expect, it } from 'vitest';
import { createService } from '@def-ops/service-kit';
import { buildSymbolRouter } from '../src/http/symbol-routes';

it('отдаёт реестр и исходный фрагмент без DOC/TTF в runtime', async () => {
  const service = createService({ name: 'symbols-test', port: 0, router: buildSymbolRouter() });
  const port = await service.listen();
  try {
    const catalog = await fetch(`http://127.0.0.1:${port}/kshvi/symbols/catalog`);
    expect(catalog.status).toBe(200);
    const body = await catalog.json() as { coverage: { documents: number; fragments: number }; fontsRequired: boolean };
    expect(body.coverage).toMatchObject({ documents: 29, fragments: 83 });
    expect(body.fontsRequired).toBe(false);
    const list = await fetch(`http://127.0.0.1:${port}/kshvi/symbols/fragments`);
    const fragments = await list.json() as { id: string }[];
    const fragment = await fetch(`http://127.0.0.1:${port}/kshvi/symbols/fragments/${fragments[0].id}`);
    expect(fragment.status).toBe(200);
    expect(fragment.headers.get('content-type')).toBe('image/jpeg');
    expect((await fragment.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    expect((await fetch(`http://127.0.0.1:${port}/kshvi/symbols/fragments/not-found`)).status).toBe(404);
  } finally {
    await service.close();
  }
});
