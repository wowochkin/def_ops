import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const files = [
  'apps/editor/src/modern/WeatherView.tsx',
  'apps/editor/src/modern/replay/CompareSessions.tsx',
  'apps/editor/src/modern/replay/ScenarioForm.tsx',
  'apps/editor/src/modern/kshvi/LibraryView.tsx',
  'apps/editor/src/modern/kshvi/preparation/EnvironmentSelectionEditor.tsx',
];

it('современные разделы не используют крошечные системные календари', () => {
  const environmentPage = readFileSync(resolve('apps/editor/src/modern/kshvi/preparation/EnvironmentMapPreparation.tsx'), 'utf8');
  expect(environmentPage).not.toMatch(/type="(?:datetime-local|date)"/);
  for (const file of files) {
    const source = readFileSync(resolve(file), 'utf8');
    expect(source, file).not.toMatch(/type="(?:datetime-local|date)"/);
    expect(source, file).toContain('DateTimeField');
  }
});
