import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const browserEntry = resolve(root, 'packages/kshvi/src/browser.ts');

function browserDependencies(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  const imports = [...source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)].map(match => match[1]);
  return imports.flatMap(reference => {
    const target = resolve(dirname(file), reference.endsWith('.ts') ? reference : `${reference}.ts`);
    return [target, ...browserDependencies(target, seen)];
  });
}

it('сохраняет AppMode, исторический режим, соседнюю карту, погоду и отдельный справочник знаков', () => {
  const app = readFileSync(resolve(root, 'apps/editor/src/AppMode.tsx'), 'utf8');
  expect(app).toContain("export type AppMode = 'historical' | 'modern'");
  for (const label of ['Исторический режим', 'Современный режим', 'Карта и погода', 'КШВИ', 'Условные знаки']) expect(app).toContain(label);
  expect(app).toContain("modernSection === 'atlas' || modernSection === 'weather'");
  expect(readFileSync(resolve(root, 'apps/editor/src/modern/kshvi/KshviView.tsx'), 'utf8')).not.toContain("type AppMode =");
});

it('browser exports включают решения, реплей, разбор и экспозицию без Node и серверных зависимостей', () => {
  const entry = readFileSync(browserEntry, 'utf8');
  for (const reference of ['./decisions/decision-cycle', './replay/replay-engine', './assessment/debrief', './exposition/exposition-session']) {
    expect(entry).toContain(reference);
  }
  const sources = [browserEntry, ...browserDependencies(browserEntry)].map(file => readFileSync(file, 'utf8')).join('\n');
  expect(sources).not.toMatch(/node:(?:crypto|fs|path|http|stream)/);
  expect(sources).not.toContain('services/kshvi');
  expect(sources).not.toContain('packages/sim');
});
