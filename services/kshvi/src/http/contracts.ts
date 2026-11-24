import { HttpError, reply, Router, type Ctx, type Handler } from '@def-ops/service-kit';
import { buildRouter, type BuildRouterOptions } from '../app';
import { auditRecord, type AuditInput } from '../auth/audit';
import type { ParticipantContext } from '../auth/authorize';
import { kshviError, type KshviErrorStatus } from './errors';

export type RouteAuditRecord = AuditInput & { organizationId?: string; outcome: 'ALLOWED' | 'DENIED' };
export type HttpContractOptions = {
  audit(record: RouteAuditRecord): Promise<void>;
  identify?(ctx: Ctx): Promise<Pick<ParticipantContext, 'userId' | 'organizationId'> | null>;
};

function tokenOf(ctx: Ctx): string | null {
  const bearer = ctx.req.headers.authorization;
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  const pair = (ctx.req.headers.cookie ?? '').split(';').map(part => part.trim()).find(part => part.startsWith('kshvi_session='));
  return pair ? decodeURIComponent(pair.slice('kshvi_session='.length)) : null;
}

function contractHandler(handler: Handler, route: { method: string; pattern: string }, options: HttpContractOptions): Handler {
  return async ctx => {
    let identity: Pick<ParticipantContext, 'userId' | 'organizationId'> | null = null;
    try { identity = await options.identify?.(ctx) ?? null; } catch { identity = null; }
    const base = {
      actorId: identity?.userId ?? 'anonymous',
      action: `${route.method} ${route.pattern}`,
      correlationId: ctx.requestId,
      ...(ctx.params.id ? { resourceId: ctx.params.id } : {}),
      ...(identity?.organizationId ? { organizationId: identity.organizationId } : {}),
    };
    try {
      const result = await handler(ctx);
      await options.audit(auditRecord({ ...base, outcome: 'ALLOWED' }) as RouteAuditRecord);
      return result;
    } catch (error) {
      const status = (error instanceof HttpError ? error.status : 500) as KshviErrorStatus;
      const code = error instanceof HttpError ? error.code : 'internal';
      await options.audit(auditRecord({ ...base, outcome: 'DENIED' }) as RouteAuditRecord).catch(() => undefined);
      const converted = kshviError(status in ({ 400: 1, 401: 1, 403: 1, 404: 1, 405: 1, 409: 1, 422: 1, 500: 1, 503: 1 }) ? status : 500, code, ctx.requestId);
      return reply(converted.status, converted.body);
    }
  };
}

export function withKshviHttpContracts(router: Router, options: HttpContractOptions): Router {
  return router.mapHandlers((handler, route) => contractHandler(handler, route, options));
}

/** Обвязывает внешний match: серверная аутентификация тоже проходит единый конверт ошибок и аудит. */
export function buildTask52Router(options: BuildRouterOptions & { audit: HttpContractOptions['audit']; identify?: HttpContractOptions['identify'] }): Router {
  const { audit, identify, ...routerOptions } = options;
  const contractOptions = {
    audit,
    identify: identify ?? (async ctx => {
      const token = tokenOf(ctx);
      if (!token) return null;
      const participant = await options.sessions.authenticate(token);
      return { userId: participant.userId, organizationId: participant.organizationId };
    }),
  };
  const router = buildRouter(routerOptions);
  const match = router.match.bind(router);
  router.match = (method, path) => {
    const route = match(method, path);
    if (!route || route === 'method') return route;
    return { ...route, handler: contractHandler(route.handler, { method, pattern: path }, contractOptions) };
  };
  return router;
}
