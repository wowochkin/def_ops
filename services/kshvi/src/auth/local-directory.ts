import { hashPassword, verifyPassword } from './passwords';

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

export function isTechnicalPermission(action: string): boolean {
  return TECHNICAL_PERMISSIONS.has(action);
}

export class LocalDirectory {
  private readonly accounts = new Map<string, LocalAccount>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async createAccount(input: {
    userId: string;
    username: string;
    password: string;
    organizationId: string;
    technicalPermissions: readonly string[];
  }): Promise<LocalAccount> {
    if (!input.userId || !input.username.trim() || !input.organizationId) throw new Error('Учётная запись неполная');
    if (this.accounts.has(input.userId) || [...this.accounts.values()].some(account => account.username === input.username)) {
      throw new Error('Учётная запись уже существует');
    }
    const unsupported = input.technicalPermissions.filter(permission => !isTechnicalPermission(permission));
    if (unsupported.length) throw new Error('Предметные права назначаются отдельно от технических');
    const timestamp = this.now().toISOString();
    const account: LocalAccount = Object.freeze({
      userId: input.userId,
      username: input.username.trim(),
      passwordHash: await hashPassword(input.password),
      organizationId: input.organizationId,
      technicalPermissions: Object.freeze([...new Set(input.technicalPermissions)]),
      state: 'ACTIVE',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.accounts.set(account.userId, account);
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

  async authenticate(username: string, password: string): Promise<LocalAccount> {
    const account = [...this.accounts.values()].find(candidate => candidate.username === username);
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
    this.accounts.set(userId, { ...current, state, updatedAt: this.now().toISOString() });
    return this.publicAccount(userId);
  }
}
