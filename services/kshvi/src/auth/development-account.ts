import type { SessionManager } from './sessions';

export type DevelopmentAccountEnvironment = Record<string, string | undefined>;

/** Локальный стенд получает обычную серверную учётную запись, а не обход авторизации. */
export async function ensureDevelopmentAccount(
  sessions: SessionManager,
  env: DevelopmentAccountEnvironment,
): Promise<{ created: boolean; username: string }> {
  if (env.KSHVI_DEVELOPMENT_AUTH !== '1') return { created: false, username: '' };
  if (env.NODE_ENV === 'production' || env.KSHVI_MODE === 'official' || env.KSHVI_OFFICIAL === '1') {
    throw new Error('Локальная учётная запись разработки в официальном режиме запрещена');
  }
  const username = env.KSHVI_DEVELOPMENT_USERNAME ?? 'local-leader';
  const organizationId = env.KSHVI_ORGANIZATION_ID ?? 'default';
  const accounts = await sessions.listAccounts(organizationId);
  if (accounts.some(account => account.username === username)) return { created: false, username };
  await sessions.createAccount({
    userId: 'local-leader', username, password: env.KSHVI_DEVELOPMENT_PASSWORD ?? 'local-kshvi', organizationId,
    roles: [{
      id: 'local-director-role', role: 'DIRECTOR', sideId: null,
      authorities: [
        'exercise:read', 'exercise:create', 'exercise:copy', 'exercise:revise', 'exercise:conduct', 'exercise:archive',
        'scenario.seal', 'initialMap.approve', 'archive.export', 'TRUTH_READ', 'projection:read', 'instance:start', 'instance:command', 'OFFICIAL_DECISION',
      ],
    }],
  });
  return { created: true, username };
}
