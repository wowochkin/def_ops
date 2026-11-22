import { createHash } from 'node:crypto';
import { modernCorpus, type ModernCorpus } from '@def-ops/knowledge';
import { commitModernImport, previewModernImport, type ModernImportSource, type ModernKnowledgeScenarioCopy, type ModernRecordKind, type ScenarioValue } from '@def-ops/kshvi';
import { HttpError, Router, reply, type Ctx, type Handler } from '@def-ops/service-kit';
import { authorize, type ParticipantContext } from '../auth/authorize';
import { assertCsrf, type SessionManager } from '../auth/sessions';

export type ModernImportInput = { source: ModernImportSource; sideId: string; parentNodeId: string; scenarioValues: readonly ScenarioValue[] };
export type ModernImportActor = Readonly<{ organizationId: string; userId: string; sideId?: string | null }>;
type StoredCopy = Readonly<{ organizationId: string; copy: ModernKnowledgeScenarioCopy }>;

function tokenOf(ctx: Ctx): string {
  const bearer = ctx.req.headers.authorization;
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  const pair = (ctx.req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith('kshvi_session='));
  if (!pair) throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
  return decodeURIComponent(pair.slice('kshvi_session='.length));
}
function recordKind(source: ModernImportSource): ModernRecordKind {
  return source.recordKind ?? 'REPRESENTATIVE';
}
function sourceRecord(corpus: ModernCorpus, source: ModernImportSource): Readonly<Record<string, unknown>> {
  const kind = recordKind(source);
  const records = kind === 'UNIT' ? corpus.units : kind === 'HIERARCHY' ? corpus.hierarchyTemplates : corpus.representatives;
  const record = records.find(item => item.id === source.sourceRecordId);
  if (!record || source.sourceRevision !== 1) throw new HttpError(422, 'source_not_found', 'Запись источника и её редакция не найдены в серверном корпусе');
  return record as unknown as Readonly<Record<string, unknown>>;
}
function assertSourceHash(record: Readonly<Record<string, unknown>>, source: ModernImportSource): void {
  const actual = createHash('sha256').update(JSON.stringify(record)).digest('hex');
  if (actual !== source.sourceHash) throw new HttpError(422, 'source_hash_mismatch', 'SHA-256 источника не совпадает с серверным корпусом');
}

export class MemoryModernImportStore {
  private readonly copies: StoredCopy[] = [];
  private readonly corpus: ModernCorpus;

  constructor(corpus: ModernCorpus = modernCorpus) {
    this.corpus = corpus;
  }

  async import(actor: ModernImportActor, input: ModernImportInput): Promise<ModernKnowledgeScenarioCopy> {
    if (!input || typeof input !== 'object') throw new HttpError(422, 'invalid_import', 'Проверьте данные импорта');
    if (actor.sideId && actor.sideId !== input.sideId) throw new HttpError(403, 'forbidden', '403: Сторона не соответствует назначенной роли');
    const sideId = actor.sideId ?? input.sideId;
    if (!sideId) throw new HttpError(422, 'side_required', 'Выберите сторону сценарной копии');
    const record = sourceRecord(this.corpus, input.source);
    assertSourceHash(record, input.source);
    try {
      const created = commitModernImport(previewModernImport(input.source, record), { ...input, sideId });
      this.copies.push({ organizationId: actor.organizationId, copy: structuredClone(created) });
      return structuredClone(created);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(422, 'invalid_import', error instanceof Error ? error.message : 'Проверьте данные импорта');
    }
  }

  async list(organizationId: string, sideId?: string | null): Promise<ModernKnowledgeScenarioCopy[]> {
    return this.copies
      .filter(item => item.organizationId === organizationId && (!sideId || item.copy.sideId === sideId))
      .map(item => structuredClone(item.copy));
  }
}

export function registerForceRoutes(router: Router, store: MemoryModernImportStore, sessions?: SessionManager): void {
  const participant = async (ctx: Ctx, action: string, mutation = false): Promise<ParticipantContext> => {
    if (!sessions) throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
    const current = await sessions.authenticate(tokenOf(ctx));
    authorize(current, { action, organizationId: current.organizationId });
    if (mutation) assertCsrf(current, String(ctx.req.headers['x-csrf-token'] ?? ''));
    return current;
  };
  const handle = (handler: (ctx: Ctx) => Promise<unknown>): Handler => async ctx => handler(ctx);

  router.post('/kshvi/forces/import', handle(async ctx => {
    const actor = await participant(ctx, 'exercise:revise', true);
    return reply(201, await store.import(actor, await ctx.json<ModernImportInput>()));
  }));
  router.get('/kshvi/forces/import', handle(async ctx => {
    const actor = await participant(ctx, 'exercise:read');
    return store.list(actor.organizationId, actor.sideId);
  }));
}

export function buildForceRouter(store: MemoryModernImportStore, sessions?: SessionManager): Router {
  const router = new Router();
  registerForceRoutes(router, store, sessions);
  return router;
}
