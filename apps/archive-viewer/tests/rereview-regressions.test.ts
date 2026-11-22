import { expect, it } from 'vitest';
import { makeArchiveBundle } from '../../../packages/kshvi/tests/fixtures/archive-fixture';
import { serializeArchive } from '../../../services/kshvi/src/archive/archive-exporter';
import { verifyStandaloneArchive } from '../src/integrity';

it('RR11: standalone и server одинаково запрещают обратные слэши и Windows paths', () => {
  const components = Object.fromEntries(Object.entries(makeArchiveBundle().manifest.components.map(component => [component.id, component])));
  void components;
  const bundle = makeArchiveBundle();
  const card = bundle.manifest.components.find(component => component.id === 'exercise.card')!;
  const windowsPath = 'C:\\outside.json';
  const data = bundle.files[card.path];
  card.path = windowsPath;
  bundle.files[windowsPath] = data;
  bundle.manifest.manifestSha256 = '';
  const result = verifyStandaloneArchive(JSON.parse(serializeArchive(bundle)));
  expect(result.mode).toBe('REJECTED');
  expect(result.errors.join('\n')).toContain('exercise.card');
});
