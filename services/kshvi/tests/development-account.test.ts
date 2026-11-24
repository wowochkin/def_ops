import { expect, it } from 'vitest';
import { ensureDevelopmentAccount } from '../src/auth/development-account';
import { InMemorySessionStore, SessionManager } from '../src/auth/sessions';

it('создаёт локальную учётную запись только по явному разрешению и возвращает назначенные роли при входе', async () => {
  const sessions = new SessionManager({ store: new InMemorySessionStore() });
  await expect(ensureDevelopmentAccount(sessions, { NODE_ENV: 'production', KSHVI_DEVELOPMENT_AUTH: '1' })).rejects.toThrow('запрещ');
  await expect(ensureDevelopmentAccount(sessions, {})).resolves.toMatchObject({ created: false });

  const enabled = { KSHVI_DEVELOPMENT_AUTH: '1', KSHVI_ORGANIZATION_ID: 'default' };
  await expect(ensureDevelopmentAccount(sessions, enabled)).resolves.toMatchObject({ created: true, username: 'local-leader' });
  await expect(ensureDevelopmentAccount(sessions, enabled)).resolves.toMatchObject({ created: false });

  const login = await sessions.login('local-leader', 'local-kshvi');
  expect(login.roles).toEqual([expect.objectContaining({ id: 'local-director-role', role: 'DIRECTOR' })]);
  const participant = await sessions.selectRole(login.token, login.roles[0]!.id);
  expect(participant.authorities).toEqual(expect.arrayContaining(['exercise:read', 'exercise:create', 'exercise:conduct', 'scenario.seal']));
});
