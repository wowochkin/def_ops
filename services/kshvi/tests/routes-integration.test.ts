import { expect, it } from 'vitest';
import { buildRouter } from '../src/app';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';
import { CartographyEnvironmentProvider } from '../src/environment/cartography-provider';
import { EnvironmentSnapshotStore } from '../src/environment/snapshot-store';

it('регистрирует учения, силы и среду в основном приложении', () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  const environmentProvider = new CartographyEnvironmentProvider({ baseUrl: 'http://127.0.0.1:8104', store: new EnvironmentSnapshotStore('.tmp/environment-integration') });
  const router = buildRouter({ sessions, environmentProvider } as never);
  expect(router.match('GET', '/kshvi/exercises')).not.toBeNull();
  expect(router.match('GET', '/kshvi/forces/import?sideId=blue'.split('?')[0])).not.toBeNull();
  expect(router.match('GET', '/kshvi/environment/snapshots/abc')).not.toBeNull();
});
