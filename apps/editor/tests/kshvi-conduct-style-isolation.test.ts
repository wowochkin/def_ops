import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('стили проведения КШВИ не меняют глобальный цвет текста исторического режима', () => {
  const css = readFileSync(resolve('apps/editor/src/modern/kshvi/conduct/conduct.css'), 'utf8');
  expect(css).not.toMatch(/:root|\bbody\s*[,{]/);
  expect(css).toContain('.kshvi-conduct-workspace');
});
