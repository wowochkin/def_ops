import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadEventCatalog } from '../src/catalog-adapter';
import { validateEventTemplate } from '../src/validate-template';
import { validTemplate } from './fixtures/valid-template';

const catalogDirectory = new URL('../data/catalog/', import.meta.url).pathname;
const temporary: string[] = [];
afterEach(async () => {
  while (temporary.length) await rm(temporary.pop()!, { recursive: true, force: true });
});

it('сохраняет состояния, время и авторизованного наблюдателя без раскрытия всем сторонам', async () => {
  const catalog = await loadEventCatalog(catalogDirectory);
  const template = catalog.templates[0];
  expect(template.applicability.allowedStates).toEqual(['ACTIVE']);
  expect(template.applicability.disallowedStates).toEqual(['UNKNOWN', 'CANCELLED', 'COMPLETED']);
  expect(template.applicability.time).toMatchObject({ operationalOnly: true, withinStage: true, allowBackward: false, minLeadSeconds: 0 });
  expect(template.observations[0].recipientSideIds).toEqual(['AUTHORIZED_SIDE']);
  expect(template.observations[0].source.sideId).toBe('AUTHORIZED_SIDE');
  expect(template.reports[0].recipientSideIds).toEqual(['AUTHORIZED_SIDE']);
  expect(catalog.manifest.templates.every(entry => entry.reviewStatus === 'IN_REVIEW')).toBe(true);
  expect(catalog.manifest.templates.every(entry => !entry.reviewedBy && !entry.reviewedAt)).toBe(true);
});

it('сохраняет оператор исходного предусловия', async () => {
  const directory = await mkdtemp(path.join(process.cwd(), '.catalog-review-'));
  temporary.push(directory);
  const source = JSON.parse(await readFile(path.join(catalogDirectory, 'environment.json'), 'utf8'));
  source.templates = [source.templates[0]];
  source.templates[0].preconditions[0].operator = 'GREATER_THAN';
  await writeFile(path.join(directory, 'environment.json'), JSON.stringify(source));
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ catalogId: 'test', catalogVersion: '1' }));
  const catalog = await loadEventCatalog(directory);
  expect(catalog.templates[0].preconditions[0].operator).toBe('GT');
});

it('запрещает событие против оценки, целей и score обучаемого', () => {
  for (const domain of ['assessment', 'goals', 'score']) {
    const template = structuredClone(validTemplate);
    template.effects = [{
      type: 'catalog.effect', operation: 'updateTerrainState', target: { domain, ref: 'score' },
      mechanism: 'Попытка изменить оценку', reason: 'Контрпример', parameters: {},
    }];
    expect(validateEventTemplate(template).issues).toContainEqual(expect.objectContaining({ code: 'TRAINING_DATA_PROTECTED' }));
  }
});
