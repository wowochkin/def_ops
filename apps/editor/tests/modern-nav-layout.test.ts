import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('верхняя навигация имеет равные вкладки и тёмную подсветку всей области кнопки', () => {
  const css = readFileSync(resolve('apps/editor/src/styles.css'), 'utf8');
  const nav = css.match(/\.modern-nav\s*\{([^}]*)\}/)?.[1] ?? '';
  const button = css.match(/\.modern-nav button\s*\{([^}]*)\}/)?.[1] ?? '';
  expect(nav).toContain('grid-template-columns: repeat(5, minmax(0, 1fr))');
  expect(button).toContain('padding: 15px 12px 12px');
  expect(css).toMatch(/\.modern-nav button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#1c3339/);
});
