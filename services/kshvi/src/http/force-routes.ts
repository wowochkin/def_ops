import { Router } from '@def-ops/service-kit';
import { commitModernImport, previewModernImport, type ModernImportSource, type ModernKnowledgeScenarioCopy, type ScenarioValue } from '@def-ops/kshvi';

export type ModernImportInput = { source: ModernImportSource; sideId: string; parentNodeId: string; scenarioValues: readonly ScenarioValue[] };

export class MemoryModernImportStore {
  private readonly copies: ModernKnowledgeScenarioCopy[] = [];

  async import(input: ModernImportInput): Promise<ModernKnowledgeScenarioCopy> {
    const created = commitModernImport(previewModernImport(input.source), input);
    this.copies.push(created);
    return created;
  }

  async list(sideId: string): Promise<ModernKnowledgeScenarioCopy[]> {
    return this.copies.filter(copy => copy.sideId === sideId).map(copy => ({ ...copy }));
  }
}

export function registerForceRoutes(router: Router, store: MemoryModernImportStore): void {
  router.post('/kshvi/forces/import', async ctx => store.import(await ctx.json<ModernImportInput>()));
  router.get('/kshvi/forces/import', async ctx => store.list(ctx.query.get('sideId') ?? ''));
}

export function buildForceRouter(store: MemoryModernImportStore): Router {
  const router = new Router();
  registerForceRoutes(router, store);
  return router;
}
