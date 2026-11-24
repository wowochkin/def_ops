import { migrate, type Pool } from '@def-ops/db';
import { KSHVI_AUTH_MIGRATIONS } from './migrations';
import type { AccountRecord, SessionStore, StoredSession } from './sessions';

function account(row: Record<string, unknown>): AccountRecord {
  return {
    userId: String(row.user_id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    organizationId: String(row.organization_id),
    roles: row.roles as AccountRecord['roles'],
    state: row.state as AccountRecord['state'],
  };
}
function session(row: Record<string, unknown>): StoredSession {
  return {
    id: String(row.id), userId: String(row.user_id), tokenHash: String(row.token_hash), csrfHash: String(row.csrf_hash),
    activeRoleId: row.active_role_id ? String(row.active_role_id) : null,
    expiresAt: new Date(String(row.expires_at)), revokedAt: row.revoked_at ? new Date(String(row.revoked_at)) : null,
  };
}

export class PgSessionStore implements SessionStore {
  constructor(private readonly pool: Pool, private readonly schema = 'kshvi') {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Недопустимое имя схемы КШВИ');
  }

  async init(): Promise<void> { await migrate(this.pool, this.schema, KSHVI_AUTH_MIGRATIONS); }

  async saveAccount(value: AccountRecord): Promise<void> {
    await this.pool.query(
      `insert into ${this.schema}.accounts (user_id, username, password_hash, organization_id, roles, state) values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id) do update set password_hash=excluded.password_hash, organization_id=excluded.organization_id, roles=excluded.roles, state=excluded.state`,
      [value.userId, value.username, value.passwordHash, value.organizationId, JSON.stringify(value.roles), value.state],
    );
  }

  async listAccounts(organizationId: string): Promise<AccountRecord[]> {
    const result = await this.pool.query(`select * from ${this.schema}.accounts where organization_id=$1 order by username, user_id`, [organizationId]);
    return result.rows.map(account);
  }

  async findAccount(username: string): Promise<AccountRecord | null> {
    const result = await this.pool.query(`select * from ${this.schema}.accounts where username=$1`, [username]);
    return result.rows[0] ? account(result.rows[0]) : null;
  }

  async findAccountById(userId: string): Promise<AccountRecord | null> {
    const result = await this.pool.query(`select * from ${this.schema}.accounts where user_id=$1`, [userId]);
    return result.rows[0] ? account(result.rows[0]) : null;
  }

  async saveSession(value: StoredSession): Promise<void> {
    await this.pool.query(
      `insert into ${this.schema}.sessions (id, user_id, token_hash, csrf_hash, active_role_id, expires_at, revoked_at) values ($1,$2,$3,$4,$5,$6,$7)`,
      [value.id, value.userId, value.tokenHash, value.csrfHash, value.activeRoleId, value.expiresAt, value.revokedAt],
    );
  }

  async findSession(tokenHash: string): Promise<StoredSession | null> {
    const result = await this.pool.query(`select * from ${this.schema}.sessions where token_hash=$1`, [tokenHash]);
    return result.rows[0] ? session(result.rows[0]) : null;
  }

  async selectActiveRole(tokenHash: string, roleId: string): Promise<boolean> {
    const result = await this.pool.query(
      `update ${this.schema}.sessions set active_role_id=$2 where token_hash=$1 and revoked_at is null`,
      [tokenHash, roleId],
    );
    return result.rowCount === 1;
  }

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.pool.query(
      `update ${this.schema}.sessions set revoked_at=coalesce(revoked_at,$2) where token_hash=$1`,
      [tokenHash, revokedAt],
    );
  }
}
