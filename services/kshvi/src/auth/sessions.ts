import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpError } from '@def-ops/service-kit';
import { hashPassword, verifyPassword } from './passwords';
import type { ParticipantContext } from './authorize';

export type RoleAssignment = { id: string; role: string; sideId: string | null; authorities: readonly string[]; assignedNodeIds?: readonly string[]; assignedInstanceIds?: readonly string[] };
export type AccountRecord = { userId: string; username: string; passwordHash: string; organizationId: string; roles: readonly RoleAssignment[]; state: 'ACTIVE' | 'BLOCKED' | 'ARCHIVED' };
export type StoredSession = { id: string; userId: string; tokenHash: string; csrfHash: string; activeRoleId: string | null; expiresAt: Date; revokedAt: Date | null };

export interface SessionStore {
  saveAccount(account: AccountRecord): Promise<void>;
  listAccounts(organizationId: string): Promise<AccountRecord[]>;
  findAccount(username: string): Promise<AccountRecord | null>;
  findAccountById(userId: string): Promise<AccountRecord | null>;
  saveSession(session: StoredSession): Promise<void>;
  findSession(tokenHash: string): Promise<StoredSession | null>;
  /** Атомарно меняет роль только у неотозванной сессии. */
  selectActiveRole(tokenHash: string, roleId: string): Promise<boolean>;
  /** Монотонно фиксирует первый отзыв; stale-копия не может его стереть. */
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
}

export class InMemorySessionStore implements SessionStore {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly sessions = new Map<string, StoredSession>();

  async saveAccount(account: AccountRecord): Promise<void> { this.accounts.set(account.userId, structuredClone(account)); }
  async listAccounts(organizationId: string): Promise<AccountRecord[]> { return [...this.accounts.values()].filter(account => account.organizationId === organizationId).map(account => structuredClone(account)); }
  async findAccount(username: string): Promise<AccountRecord | null> { return [...this.accounts.values()].find(account => account.username === username) ?? null; }
  async findAccountById(userId: string): Promise<AccountRecord | null> { return this.accounts.get(userId) ?? null; }
  async saveSession(session: StoredSession): Promise<void> { this.sessions.set(session.tokenHash, structuredClone(session)); }
  async findSession(tokenHash: string): Promise<StoredSession | null> { return this.sessions.get(tokenHash) ?? null; }
  async selectActiveRole(tokenHash: string, roleId: string): Promise<boolean> {
    const current = this.sessions.get(tokenHash);
    if (!current || current.revokedAt) return false;
    this.sessions.set(tokenHash, { ...current, activeRoleId: roleId });
    return true;
  }
  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    const current = this.sessions.get(tokenHash);
    if (!current) return;
    this.sessions.set(tokenHash, { ...current, revokedAt: current.revokedAt ?? revokedAt });
  }
  records(): StoredSession[] { return [...this.sessions.values()].map(session => structuredClone(session)); }
}

export type SessionOptions = { store: SessionStore; now?: () => Date; ttlMs?: number };

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function unauthorized(): never { throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему'); }

export function sessionCookie(token: string, maxAge: number): string {
  return `kshvi_session=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
export function clearSessionCookie(): string { return sessionCookie('', 0); }

export function assertCsrf(participant: ParticipantContext, csrfToken: string): void {
  if (!participant.csrfHash) throw new HttpError(403, 'csrf', '403: Действие недоступно');
  const actual = Buffer.from(digest(csrfToken));
  const expected = Buffer.from(participant.csrfHash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(403, 'csrf', '403: Действие недоступно');
}

export function publicParticipant(participant: ParticipantContext) {
  return {
    userId: participant.userId,
    activeRole: participant.activeRole,
    sideId: participant.sideId,
    organizationId: participant.organizationId,
    roleId: participant.roleId ?? null,
    authorities: participant.authorities,
  };
}

export class SessionManager {
  private readonly store: SessionStore;
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(options: SessionOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 8 * 60 * 60 * 1000;
  }

  async createAccount(input: { userId: string; username: string; password: string; organizationId: string; roles: readonly RoleAssignment[] }): Promise<void> {
    if (!input.userId || !input.username.trim() || !input.organizationId) throw new Error('Учётная запись неполная');
    await this.store.saveAccount({
      userId: input.userId,
      username: input.username,
      passwordHash: await hashPassword(input.password),
      organizationId: input.organizationId,
      roles: input.roles,
      state: 'ACTIVE',
    });
  }

  async listAccounts(organizationId: string): Promise<AccountRecord[]> {
    return this.store.listAccounts(organizationId);
  }

  async setAccountState(userId: string, state: AccountRecord['state']): Promise<AccountRecord> {
    const account = await this.store.findAccountById(userId);
    if (!account) throw new HttpError(404, 'not_found', 'Учётная запись не найдена');
    const updated = { ...account, state };
    await this.store.saveAccount(updated);
    return updated;
  }

  async login(username: string, password: string): Promise<{ token: string; csrfToken: string; cookie: string; participant: ParticipantContext }> {
    const account = await this.store.findAccount(username);
    if (!account || account.state !== 'ACTIVE' || !(await verifyPassword(password, account.passwordHash))) unauthorized();
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const session: StoredSession = {
      id: randomUUID(), userId: account.userId, tokenHash: digest(token), csrfHash: digest(csrfToken),
      activeRoleId: null, expiresAt: new Date(this.now().getTime() + this.ttlMs), revokedAt: null,
    };
    await this.store.saveSession(session);
    const participant = await this.authenticate(token);
    return { token, csrfToken, cookie: sessionCookie(token, Math.floor(this.ttlMs / 1000)), participant };
  }

  async authenticate(token: string, organizationHint?: string): Promise<ParticipantContext> {
    const session = await this.store.findSession(digest(token));
    if (!session || session.revokedAt || session.expiresAt.getTime() <= this.now().getTime()) unauthorized();
    const account = await this.store.findAccountById(session.userId);
    if (!account || account.state !== 'ACTIVE') unauthorized();
    if (organizationHint && organizationHint !== account.organizationId) throw new HttpError(403, 'forbidden', '403: Действие недоступно');
    const assignment = account.roles.find(role => role.id === session.activeRoleId);
    return {
      userId: account.userId,
      activeRole: assignment?.role ?? null,
      sideId: assignment?.sideId ?? null,
      organizationId: account.organizationId,
      roleId: assignment?.id ?? null,
      authorities: assignment?.authorities ?? [],
      assignedNodeIds: assignment?.assignedNodeIds ?? [],
      assignedInstanceIds: assignment?.assignedInstanceIds,
      sessionId: session.id,
      csrfHash: session.csrfHash,
    };
  }

  async selectRole(token: string, roleId: string): Promise<ParticipantContext> {
    const tokenHash = digest(token);
    const session = await this.store.findSession(tokenHash);
    if (!session || session.revokedAt || session.expiresAt.getTime() <= this.now().getTime()) unauthorized();
    const account = await this.store.findAccountById(session.userId);
    if (!account || !account.roles.some(role => role.id === roleId)) throw new HttpError(403, 'forbidden', '403: Действие недоступно');
    if (!(await this.store.selectActiveRole(tokenHash, roleId))) unauthorized();
    return this.authenticate(token);
  }

  async revoke(token: string): Promise<void> {
    await this.store.revokeSession(digest(token), this.now());
  }
}
