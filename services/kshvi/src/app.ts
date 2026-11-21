import { HttpError, Router, reply, type Ctx } from '@def-ops/service-kit';
import { assertCsrf, clearSessionCookie, publicParticipant, SessionManager } from './auth/sessions';
import { KSHVI_ROUTE_PREFIX } from './http/router';

function tokenOf(ctx: Ctx): string {
  const bearer = ctx.req.headers.authorization;
  if (bearer?.startsWith('Bearer ')) return bearer.slice(7);
  const cookies = ctx.req.headers.cookie ?? '';
  const pair = cookies.split(';').map(part => part.trim()).find(part => part.startsWith('kshvi_session='));
  if (!pair) throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
  return decodeURIComponent(pair.slice('kshvi_session='.length));
}

export function buildRouter({ sessions }: { sessions: SessionManager }): Router {
  const router = new Router();
  const participant = async (ctx: Ctx) => sessions.authenticate(tokenOf(ctx));

  router.post(`${KSHVI_ROUTE_PREFIX}/auth/login`, async ctx => {
    const body = await ctx.json<{ username?: string; password?: string }>();
    if (!body.username || !body.password) throw new HttpError(422, 'invalid_credentials', 'Проверьте заполнение данных');
    const login = await sessions.login(body.username, body.password);
    return reply(200, { csrfToken: login.csrfToken, participant: publicParticipant(login.participant) }, { 'Set-Cookie': login.cookie });
  });

  router.get(`${KSHVI_ROUTE_PREFIX}/auth/me`, async ctx => publicParticipant(await participant(ctx)));

  router.post(`${KSHVI_ROUTE_PREFIX}/auth/role`, async ctx => {
    const token = tokenOf(ctx);
    const current = await sessions.authenticate(token);
    assertCsrf(current, String(ctx.req.headers['x-csrf-token'] ?? ''));
    const body = await ctx.json<{ roleId?: string }>();
    if (!body.roleId) throw new HttpError(422, 'invalid_role', 'Выберите назначенную роль');
    return publicParticipant(await sessions.selectRole(token, body.roleId));
  });

  router.post(`${KSHVI_ROUTE_PREFIX}/auth/logout`, async ctx => {
    const token = tokenOf(ctx);
    const current = await sessions.authenticate(token);
    assertCsrf(current, String(ctx.req.headers['x-csrf-token'] ?? ''));
    await sessions.revoke(token);
    return reply(204, null, { 'Set-Cookie': clearSessionCookie() });
  });

  return router;
}
