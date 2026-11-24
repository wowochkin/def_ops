import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('не подтягивает серверные Node API в браузерный вход', () => {
  const entry = new URL('../src/browser.ts', import.meta.url);
  expect(existsSync(entry)).toBe(true);
  const source = readFileSync(entry, 'utf8');
  expect(source).not.toContain('./events/');
  expect(source).not.toContain('node:');
  expect(readFileSync(new URL('../src/forces/modern-import.ts', import.meta.url), 'utf8')).not.toContain('node:crypto');
});
