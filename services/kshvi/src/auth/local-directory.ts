import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from './passwords';
import { appendDurableJsonLine, readDurableJsonLines, type AuditSink } from './durable-jsonl';

export const TECHNICAL_PERMISSIONS = new Set([
  'account.manage', 'audit.read', 'audit.export', 'backup.create', 'backup.verify',
  'health.read', 'metrics.read', 'restore.run', 'temporary-access.grant', 'update.run',
]);

export type AccountState = 'ACTIVE' | 'BLOCKED' | 'ARCHIVED';
export type LocalAccount = Readonly<{
  userId: string;
  username: string;
  passwordHash: string;
  organizationId: string;
  technicalPermissions: readonly string[];
  state: AccountState;
  createdAt: string;
  updatedAt: string;
}>;
export type LocalAccountPublic = Omit<LocalAccount, 'passwordHash'>;
type DirectoryRecord =
  | { type: 'account.created'; account: LocalAccount }
  | { type: 'account.state'; userId: string; state: AccountState; updatedAt: string };

export function isTechnicalPermission(action: string): boolean {
  return TECHNICAL_PERMISSIONS.has(action);
}
export function normalizeUsername(username: string): string {
  return username.trim().normalize('NFKC').toLocaleLowerCase('ru-RU');
}

export class LocalDirectory {
  private readonly accounts = new Map<string, LocalAccount>();
  private readonly now: () => Date;
  private readonly stateFile?: string;
  private readonly audit?: AuditSink;

  constructor(options: { now?: () => Date; stateFile?: string; audit?: AuditSink } = {}) {
    this.now = options.now ?? (() => new Date());
    this.stateFile = options.stateFile;
    this.audit = options.audit;
    for (const record of readDurableJsonLines<DirectoryRecord>(this.stateFile)) {
      if (record.type === 'account.created') this.accounts.set(record.account.userId, record.account);
      else {
        const account = this.accounts.get(record.userId);
        if (account) this.accounts.set(record.userId, { ...account, state: record.state, updatedAt: record.updatedAt });
      }
    }
  }

  async createAccount(input: {
    userId: string;
    username: string;
    password: string;
    organizationId: string;
    technicalPermissions: readonly string[];
  }): Promise<LocalAccount> {
    const username = normalizeUsername(input.username);
    if (!input.userId || !username || !input.organizationId) throw new Error('Учётная запись неполная');
    if (this.accounts.has(input.userId) || [...this.accounts.values()].some(account => account.username === username)) {
      throw new Error('Учётная запись уже существует');
    }
    const unsupported = input.technicalPermissions.filter(permission => !isTechnicalPermission(permission));
    if (unsupported.length) throw new Error('Предметные права назначаются отдельно от технических');
    const timestamp = this.now().toISOString();
    const account: LocalAccount = Object.freeze({
      userId: input.userId,
      username,
      passwordHash: await hashPassword(input.password),
      organizationId: input.organizationId,
      technicalPermissions: Object.freeze([...new Set(input.technicalPermissions)]),
      state: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    appendDurableJsonLine(this.stateFile, { type: 'account.created', account } satisfies DirectoryRecord);
    this.accounts.set(account.userId, account);
    this.record('account.created', account.userId, account.organizationId, account.userId);
    return structuredClone(account);
  }

  getAccount(userId: string): LocalAccount {
    const account = this.accounts.get(userId);
    if (!account) throw new Error('Учётная запись не найдена');
    return structuredClone(account);
  }

  publicAccount(userId: string): LocalAccountPublic {
    const { passwordHash: _passwordHash, ...safe } = this.getAccount(userId);
    return safe;
  }

  listPublic(organizationId: string): LocalAccountPublic[] {
    return [...this.accounts.values()].filter(account => account.organizationId === organizationId)
      .map(account => this.publicAccount(account.userId));
  }

  async authenticate(username: string, password: string): Promise<LocalAccount> {
    const normalized = normalizeUsername(username);
    const account = [...this.accounts.values()].find(candidate => candidate.username === normalized);
    if (!account || account.state !== 'ACTIVE' || !(await verifyPassword(password, account.passwordHash))) {
      throw new Error('Требуется вход в систему');
    }
    return structuredClone(account);
  }

  async blockAccount(userId: string): Promise<LocalAccountPublic> {
    return this.changeState(userId, 'BLOCKED');
  }

  async archiveAccount(userId: string): Promise<LocalAccountPublic> {
    return this.changeState(userId, 'ARCHIVED');
  }

  private changeState(userId: string, state: AccountState): LocalAccountPublic {
    const current = this.accounts.get(userId);
    if (!current) throw new Error('Учётная запись не найдена');
    const updatedAt = this.now().toISOString();
    appendDurableJsonLine(this.stateFile, { type: 'account.state', userId, state, updatedAt } satisfies DirectoryRecord);
    this.accounts.set(userId, { ...current, state, updatedAt });
    this.record(state === 'BLOCKED' ? 'account.blocked' : 'account.archived', userId, current.organizationId, userId);
    return this.publicAccount(userId);
  }

  private record(action: string, actorId: string, organizationId: string, resourceId: string): void {
    this.audit?.append({ actorId, organizationId, action, outcome: 'ALLOWED', correlationId: randomUUID(), resourceType: 'account', resourceId });
  }
}
