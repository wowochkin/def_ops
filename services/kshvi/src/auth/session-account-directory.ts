import type { AdminAccountDirectory, AdminAccountPublic } from '../admin/admin-overview-service';
import type { AccountRecord, SessionManager } from './sessions';

function publicAccount(account: AccountRecord): AdminAccountPublic {
  return {
    userId: account.userId, username: account.username, organizationId: account.organizationId,
    technicalPermissions: [...new Set(account.roles.flatMap(role => role.authorities))].sort(), state: account.state,
    createdAt: null, updatedAt: null,
  };
}

/** Проекция единого SessionStore: администрирование не создаёт параллельный каталог пользователей. */
export class SessionAccountDirectory implements AdminAccountDirectory {
  constructor(private readonly sessions: SessionManager) {}

  async listPublic(organizationId: string): Promise<AdminAccountPublic[]> {
    return (await this.sessions.listAccounts(organizationId)).map(publicAccount);
  }

  async blockAccount(userId: string): Promise<AdminAccountPublic> {
    return publicAccount(await this.sessions.setAccountState(userId, 'BLOCKED'));
  }

  async archiveAccount(userId: string): Promise<AdminAccountPublic> {
    return publicAccount(await this.sessions.setAccountState(userId, 'ARCHIVED'));
  }
}
