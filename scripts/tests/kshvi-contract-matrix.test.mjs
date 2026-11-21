import test from 'node:test';
import assert from 'node:assert/strict';
import { collectFunctionalIds, evaluateFunctionalMatrix } from '../kshvi-contract-matrix.mjs';

const spec = 'KSHVI-F-GEN-01 KSHVI-F-GEN-02 KSHVI-NF-01 KSHVI-AC-01 KSHVI-F-GEN-01';

test('собирает только функциональные идентификаторы без дубликатов', () => {
  assert.deepEqual(collectFunctionalIds(spec), ['KSHVI-F-GEN-01', 'KSHVI-F-GEN-02']);
});

test('находит непокрытую реализацию, тесты и доказательства', () => {
  const result = evaluateFunctionalMatrix(spec, {
    total: 2,
    requirements: [{ id: 'KSHVI-F-GEN-01', implementation: ['src/a.ts'], tests: ['a.test.ts'], evidence: ['a.json'] }],
    unimplemented: ['KSHVI-F-GEN-02'],
    missingTests: [],
    missingEvidence: [],
  });
  assert.deepEqual(result.missingTests, ['KSHVI-F-GEN-02']);
  assert.deepEqual(result.missingEvidence, ['KSHVI-F-GEN-02']);
  assert.deepEqual(result.unexpectedIds, []);
});

test('требует полный набор идентификаторов и не принимает лишние', () => {
  const result = evaluateFunctionalMatrix(spec, {
    total: 99,
    requirements: [{ id: 'KSHVI-F-OTHER-99', implementation: [], tests: [], evidence: [] }],
    unimplemented: [],
    missingTests: [],
    missingEvidence: [],
  });
  assert.deepEqual(result.totalMismatch, { expected: 2, actual: 99 });
  assert.deepEqual(result.unexpectedIds, ['KSHVI-F-OTHER-99']);
});
