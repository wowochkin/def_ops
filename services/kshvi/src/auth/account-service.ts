import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { LocalDirectory, isTechnicalPermission, normalizeUsername } from './local-directory';
import { sessionCookie } from './sessions';
import type { TemporaryAccessRequest, TemporaryAccessService } from './temporary-access';
import type { AuditSink } from './durable-jsonl';

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
  private readonly audit?: AuditSink;

  constructor(private readonly directory: LocalDirectory, options: {
    now?: () => Date;
    ttlMs?: number;
    temporaryAccess?: TemporaryAccessService;
    audit?: AuditSink;
  } = {}) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 8 * 60 * 60 * 1000;
    this.temporaryAccess = options.temporaryAccess;
    this.audit = options.audit;
  }

  async login(username: string, password: string, organizationId: string): Promise<{
    token: string;
    csrfToken: string;
    cookie: string;
    sessionId: string;
  }> {
    try {
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
      this.record('login.succeeded', account.userId, account.organizationId, session.id);
      return { token, csrfToken, cookie: sessionCookie(token, Math.floor(this.ttlMs / 1000)), sessionId: session.id };
    } catch (error) {
      this.record('login.failed', normalizeUsername(username) || 'unknown', organizationId, randomUUID());
      throw error;
    }
  }

  authorize(token: string, request: TemporaryAccessRequest): AuthorizationResult {
    const session = this.activeSession(token);
    if (!session) return this.deny('anonymous', request, 'Требуется вход в систему');
    const account = this.directory.getAccount(session.userId);
    if (account.state !== 'ACTIVE') return this.deny(account.userId, request, 'Учётная запись недоступна');
    if (request.organizationId !== account.organizationId) return this.deny(account.userId, request, 'Действие недоступно');
    if (isTechnicalPermission(request.action)) {
      return account.technicalPermissions.includes(request.action)
        ? { allowed: true }
        : this.deny(account.userId, request, 'Недостаточно технических прав');
    }
    const recoveryMetadataActions = ['recovery.manifest.read', 'recovery.hash.read', 'recovery.health.read'];
    if (recoveryMetadataActions.includes(request.action) && this.temporaryAccess?.canAccessForUser(account.userId, request)) return { allowed: true };
    return this.deny(account.userId, request, 'Предметные права назначаются отдельно');
  }

  revokeSession(token: string): void {
    const session = this.sessions.get(digest(token));
    if (session) {
      this.sessions.set(session.tokenHash, { ...session, revokedAt: this.now().toISOString() });
      this.record('session.revoked', session.userId, session.organizationId, session.id);
    }
  }

  revokeAllSessions(userId: string): void {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        this.sessions.set(session.tokenHash, { ...session, revokedAt: this.now().toISOString() });
        this.record('session.revoked', userId, session.organizationId, session.id);
      }
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

  private deny(actorId: string, request: TemporaryAccessRequest, reason: string): AuthorizationResult {
    this.audit?.append({
      actorId, organizationId: request.organizationId, action: 'authorization.denied', outcome: 'DENIED',
      correlationId: request.correlationId ?? randomUUID(), resourceType: 'request', resourceId: request.resourceId,
    });
    return { allowed: false, reason };
  }

  private record(action: string, actorId: string, organizationId: string, correlationId: string): void {
    this.audit?.append({ actorId, organizationId, action, outcome: action === 'login.failed' ? 'DENIED' : 'ALLOWED', correlationId });
  }
}
