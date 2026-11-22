import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('нативный клиент запускает КШВИ и передаёт его адрес шлюзу', () => {
  const launch = readFileSync('apps/desktop/server/launch.mjs', 'utf8');
  expect(launch).toContain("{ name: 'kshvi'");
  expect(launch).toContain('kshvi: await freePort()');
  expect(launch).toContain('KSHVI_URL: url(\'kshvi\')');
});
