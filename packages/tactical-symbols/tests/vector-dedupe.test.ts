import { expect, it } from 'vitest';
import { dedupeVectorPages } from '../tools/dedupe-vector-pages.mjs';

it('разделяет одинаковые глифы по содержимому и сохраняет ссылки элементов', () => {
  const pages = {
    first: { defs: '<g id="glyph-0-0"><path d="M 0 0 L 1 1"/></g>', elements: [{ html: '<use href="#glyph-0-0"/>', x: 0, y: 0, width: 1, height: 1 }] },
    second: { defs: '<g id="glyph-4-2"><path d="M 0 0 L 1 1"/></g>', elements: [{ html: '<use xlink:href="#glyph-4-2"/>', x: 0, y: 0, width: 1, height: 1 }] },
  };
  const result = dedupeVectorPages(pages);
  expect(Object.keys(result.definitions)).toHaveLength(1);
  const id = Object.keys(result.definitions)[0];
  expect(result.pages.first.definitionIds).toEqual([id]);
  expect(result.pages.second.elements[0].html).toContain(`#${id}`);
});
