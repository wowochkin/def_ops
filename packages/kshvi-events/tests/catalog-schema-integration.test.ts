import { expect, it } from 'vitest';
import { loadEventCatalog } from '../src/catalog-adapter';
import { validateEventTemplate } from '../src/validate-template';
import { validateCatalogManifest } from '../src/catalog-manifest';

it('проводит все 240 событий через единый строгий валидатор и канонический манифест', async () => {
  const catalog = await loadEventCatalog(new URL('../data/catalog/', import.meta.url).pathname);
  expect(catalog.templates).toHaveLength(240);
  expect(catalog.issues).toEqual([]);
  for (const template of catalog.templates) {
    expect(validateEventTemplate(template).issues, template.templateId).toEqual([]);
  }
  expect(validateCatalogManifest(catalog.manifest, catalog.templates).issues).toEqual([]);
  expect(new Set(catalog.templates.map(template => template.templateId)).size).toBe(240);
});
