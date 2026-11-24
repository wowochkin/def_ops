import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('не экспортирует серверный конвертер в браузерный реестр источника', () => {
  const path = new URL('../src/source/browser.ts', import.meta.url);
  expect(existsSync(path)).toBe(true);
  const source = readFileSync(path, 'utf8');
  expect(source).not.toContain('import-archive');
  expect(source).not.toContain('node:');
});
