import { expect, it } from 'vitest';
import { authorize, InMemorySessionStore, PgSessionStore, SessionManager, type SessionStore } from '../src/index';
import { withKshviDatabase } from './helpers/database';

const role = { id: 'role-1', role: 'TRAINEE', sideId: 'blue', authorities: ['document:approve'] };
const actor = { userId: 'u1', activeRole: 'TRAINEE', sideId: 'blue', organizationId: 'org1', authorities: ['document:approve'] } as const;

it('закрывает авторизацию без организации и подтверждённой объектной области', () => {
  expect(() => authorize(actor, { action: 'document:approve' })).toThrow('403');
  expect(() => authorize(actor, { action: 'document:approve', organizationId: 'org1' })).toThrow('403');
  expect(() => authorize(actor, { action: 'document:approve', organizationId: 'org1', scope: 'object', objectExists: true })).toThrow('403');
  expect(() => authorize(actor, { action: 'document:approve', organizationId: 'org1', sideId: 'blue', objectExists: false })).toThrow('403');
  expect(() => authorize(actor, { action: 'document:approve', organizationId: 'org1', sideId: 'red', objectExists: true })).toThrow('403');
  expect(() => authorize(actor, { action: 'document:approve', organizationId: 'org1', sideId: 'blue', objectExists: true })).not.toThrow();
  expect(() => authorize(actor, { action: 'document:approve', organizationId: 'org1', scope: 'organization' })).not.toThrow();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

class RacingMemoryStore extends InMemorySessionStore {
  armed = false;
  readonly entered = deferred();
  readonly release = deferred();
  override async findSession(tokenHash: string) {
    const session = await super.findSession(tokenHash);
    if (this.armed) {
      this.armed = false;
      this.entered.resolve();
      await this.release.promise;
    }
    return session;
  }
}

async function checkRevocationRace(store: SessionStore): Promise<void> {
  const sessions = new SessionManager({ store });
  await sessions.createAccount({ userId: 'u1', username: 'race', password: 'secret123', organizationId: 'org1', roles: [role] });
  const login = await sessions.login('race', 'secret123');
  const racing = store as unknown as { armed: boolean; entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> };
  racing.armed = true;
  const selecting = sessions.selectRole(login.token, role.id);
  await racing.entered.promise;
  await sessions.revoke(login.token);
  racing.release.resolve();
  await expect(selecting).rejects.toThrow('401');
  await expect(sessions.authenticate(login.token)).rejects.toThrow('401');
}

it('не позволяет selectRole отменить монотонный revoke в памяти', async () => {
  await checkRevocationRace(new RacingMemoryStore());
});

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;
integration('не позволяет selectRole отменить монотонный revoke в PostgreSQL', async () => {
  await withKshviDatabase(async eventStore => {
    class RacingPgStore extends PgSessionStore {
      armed = false;
      readonly entered = deferred();
      readonly release = deferred();
      override async findSession(tokenHash: string) {
        const session = await super.findSession(tokenHash);
        if (this.armed) {
          this.armed = false;
          this.entered.resolve();
          await this.release.promise;
        }
        return session;
      }
    }
    const store = new RacingPgStore(eventStore.pool, eventStore.schema);
    await store.init();
    await checkRevocationRace(store);
  });
});
