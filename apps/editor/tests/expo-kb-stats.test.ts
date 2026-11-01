import { expect, it } from 'vitest';
import seed from '../../../packages/knowledge/data/seed.json';
import { KB_STATS } from '../src/expo/kb-stats';

it('числа базы на заставке совпадают с наполнением', () => {
  const entries = (seed as { entries: { category: string }[] }).entries;
  expect(KB_STATS.entries).toBe(entries.length);
  expect(KB_STATS.sources).toBe(entries.filter((e) => e.category === 'sources').length);
});
