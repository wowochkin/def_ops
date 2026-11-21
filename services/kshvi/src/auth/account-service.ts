import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { LocalDirectory, isTechnicalPermission } from './local-directory';
import { sessionCookie } from './sessions';
import type { TemporaryAccessRequest, TemporaryAccessService } from './temporary-access';

export type DirectorySession = Readonly<{
  id: string;
  userId: string;
  organizationId: string;
  tokenHash: string;
  csrfHash: string;
  expiresAt: string;
  revokedAt: string | null;
}>;
export type AuthorizationResult = { allowed: true } | { allowed: false; reason: string };

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export class AccountService {
  private readonly sessions = new Map<string, DirectorySession>();
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly temporaryAccess?: TemporaryAccessService;

  constructor(private readonly directory: LocalDirectory, options: {
    now?: () => Date;
    ttlMs?: number;
    temporaryAccess?: TemporaryAccessService;
  } = {}) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 8 * 60 * 60 * 1000;
    this.temporaryAccess = options.temporaryAccess;
  }

  async login(username: string, password: string, organizationId: string): Promise<{
    token: string;
    csrfToken: string;
    cookie: string;
    sessionId: string;
  }> {
    const account = await this.directory.authenticate(username, password);
    if (account.organizationId !== organizationId) throw new Error('Требуется вход в систему');
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const session: DirectorySession = Object.freeze({
      id: randomUUID(), userId: account.userId, organizationId: account.organizationId,
      tokenHash: digest(token), csrfHash: digest(csrfToken),
      expiresAt: new Date(this.now().getTime() + this.ttlMs).toISOString(), revokedAt: null,
    });
    this.sessions.set(session.tokenHash, session);
    return { token, csrfToken, cookie: sessionCookie(token, Math.floor(this.ttlMs / 1000)), sessionId: session.id };
  }

  authorize(token: string, request: TemporaryAccessRequest): AuthorizationResult {
    const session = this.activeSession(token);
    if (!session) return { allowed: false, reason: 'Требуется вход в систему' };
    const account = this.directory.getAccount(session.userId);
    if (account.state !== 'ACTIVE') return { allowed: false, reason: 'Учётная запись недоступна' };
    if (request.organizationId !== account.organizationId) return { allowed: false, reason: 'Действие недоступно' };
    if (isTechnicalPermission(request.action)) {
      return account.technicalPermissions.includes(request.action)
        ? { allowed: true }
        : { allowed: false, reason: 'Недостаточно технических прав' };
    }
    if (this.temporaryAccess?.canAccessForUser(account.userId, request)) return { allowed: true };
    return { allowed: false, reason: 'Предметные права назначаются отдельно' };
  }

  revokeSession(token: string): void {
    const session = this.sessions.get(digest(token));
    if (session) this.sessions.set(session.tokenHash, { ...session, revokedAt: this.now().toISOString() });
  }

  revokeAllSessions(userId: string): void {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) this.sessions.set(session.tokenHash, { ...session, revokedAt: this.now().toISOString() });
    }
  }

  listSessions(userId: string): DirectorySession[] {
    return [...this.sessions.values()].filter(session => session.userId === userId).map(session => structuredClone(session));
  }

  private activeSession(token: string): DirectorySession | null {
    const session = this.sessions.get(digest(token));
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= this.now().getTime()) return null;
    return session;
  }
}
