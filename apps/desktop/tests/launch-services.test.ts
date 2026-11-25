import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('нативный клиент запускает КШВИ и передаёт его адрес шлюзу', () => {
  const launch = readFileSync('apps/desktop/server/launch.mjs', 'utf8');
  expect(launch).toContain("{ name: 'kshvi'");
  expect(launch).toContain('kshvi: await freePort()');
  expect(launch).toContain('KSHVI_URL: url(\'kshvi\')');
  expect(launch).toContain('CARTOGRAPHY_URL: `${url(\'cartography\')}/cartography`');
  expect(launch).toContain('KSHVI_INTERNAL_URL: url(\'kshvi\')');
  expect(launch).toContain("KSHVI_LIBRARY_FILE: join(data, 'kshvi', 'library.json')");
  expect(launch).toContain("KSHVI_DEVELOPMENT_AUTH: '1'");
});
