import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('привязывает все 17 пунктов ревизии к базовому коммиту и регрессионным тестам', () => {
  const evidence = JSON.parse(readFileSync(resolve('docs/release/kshvi/admin-remediation.json'), 'utf8')) as {
    baseCommit: string;
    reviewLog: string;
    items: { id: string; severity: string; tests: string[]; deferredTo?: string }[];
  };
  expect(evidence.baseCommit).toBe('53513dcccad0e145b48ba72e134ab9f6ae916068');
  expect(evidence.reviewLog).toBe('.tmp/independent-review.log');
  expect(evidence.items).toHaveLength(17);
  expect(new Set(evidence.items.map(item => item.id)).size).toBe(17);
  expect(evidence.items.filter(item => item.deferredTo).map(item => item.id)).toEqual(['IMPORTANT-01', 'IMPORTANT-10']);
  for (const item of evidence.items) {
    if (item.deferredTo) expect(item.deferredTo).toBe('Task52');
    else {
      expect(item.tests.length, item.id).toBeGreaterThan(0);
      for (const test of item.tests) expect(existsSync(resolve(test)), `${item.id}: ${test}`).toBe(true);
    }
  }
});
