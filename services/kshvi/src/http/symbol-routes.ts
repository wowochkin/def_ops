import { promises as fs } from 'node:fs';
import { resolve, sep } from 'node:path';
import { HttpError, Router, reply } from '@def-ops/service-kit';
import { coverageReport, sourceRegistry } from '@def-ops/tactical-symbols/source';
import { symbolSet } from '@def-ops/tactical-symbols';

export function registerSymbolRoutes(router: Router): void {
  router.get('/kshvi/symbols/catalog', () => ({ set: symbolSet, coverage: coverageReport(), fontsRequired: false }));
  router.get('/kshvi/symbols/fragments', () => sourceRegistry.fragments.map(fragment => ({
    id: fragment.id, documentId: fragment.documentId, sourceDocument: fragment.sourceDocument,
    page: fragment.page, symbolNumber: fragment.symbolNumber, sha256: fragment.referenceFragment.sha256,
    status: fragment.status, gaps: fragment.gaps,
  })));
  router.get('/kshvi/symbols/fragments/:id', async ctx => {
    const fragment = sourceRegistry.fragments.find(candidate => candidate.id === ctx.params.id);
    if (!fragment) throw new HttpError(404, 'not_found', 'Фрагмент источника не найден');
    const root = resolve('packages/tactical-symbols');
    const path = resolve(root, fragment.referenceFragment.path);
    if (!path.startsWith(`${root}${sep}`)) throw new HttpError(422, 'invalid_fragment', 'Некорректный путь фрагмента');
    const bytes = await fs.readFile(path);
    return reply(200, bytes, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable', 'x-content-sha256': fragment.referenceFragment.sha256 });
  });
}

export function buildSymbolRouter(): Router {
  const router = new Router();
  registerSymbolRoutes(router);
  return router;
}
