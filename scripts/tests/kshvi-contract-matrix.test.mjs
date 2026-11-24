import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFunctionalMatrix, collectFunctionalIds, evaluateFunctionalMatrix } from '../kshvi-contract-matrix.mjs';

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

test('блокирует несуществующие файлы реализации, тестов и доказательств', () => {
  const root = mkdtempSync(join(tmpdir(), 'kshvi-matrix-missing-'));
  const result = evaluateFunctionalMatrix('KSHVI-F-GEN-01', {
    total: 1,
    requirements: [{ id: 'KSHVI-F-GEN-01', implementation: ['missing.ts'], tests: ['missing.test.ts'], evidence: ['missing.test.ts#проверка'] }],
  }, { root, validateFiles: true });
  assert.deepEqual(result.unimplemented, ['KSHVI-F-GEN-01']);
  assert.deepEqual(result.missingTests, ['KSHVI-F-GEN-01']);
  assert.deepEqual(result.missingEvidence, ['KSHVI-F-GEN-01']);
});

test('принимает только реальный файл и существующую именованную проверку', () => {
  const root = mkdtempSync(join(tmpdir(), 'kshvi-matrix-real-'));
  mkdirSync(join(root, 'packages/kshvi/src'), { recursive: true });
  mkdirSync(join(root, 'packages/kshvi/tests'), { recursive: true });
  writeFileSync(join(root, 'packages/kshvi/src/model.ts'), 'export const model = true;\n');
  writeFileSync(join(root, 'packages/kshvi/tests/model.test.ts'), "it('проверяет модель', () => { expect(true).toBe(true); });\n");
  const result = evaluateFunctionalMatrix('KSHVI-F-GEN-01', {
    total: 1,
    requirements: [{
      id: 'KSHVI-F-GEN-01', implementation: ['packages/kshvi/src/model.ts'],
      tests: ['packages/kshvi/tests/model.test.ts'], evidence: ['packages/kshvi/tests/model.test.ts#проверяет модель'],
    }],
  }, { root, validateFiles: true });
  assert.deepEqual(result.unimplemented, []);
  assert.deepEqual(result.missingTests, []);
  assert.deepEqual(result.missingEvidence, []);
});

test('сохраняет сквозной E2E integration в тестах и доказательствах', () => {
  const root = mkdtempSync(join(tmpdir(), 'kshvi-matrix-e2e-'));
  const path = 'services/kshvi/tests/e2e/conduct-cycle.test.ts';
  mkdirSync(join(root, 'services/kshvi/tests/e2e'), { recursive: true });
  writeFileSync(join(root, path), "integration('G2: полный связанный доменный цикл', async () => { expect(true).toBe(true); });\n");
  const plan = [
    '### Task 36: Интеграционный контур официального проведения',
    `**Files:** Create \`${path}\`;`,
    '**Requirements:** интеграция PREP-05–PREP-05.',
  ].join('\n');
  const matrix = buildFunctionalMatrix({ specification: 'KSHVI-F-PREP-05', plan, root });
  assert.deepEqual(matrix.requirements[0].tests, [path]);
  assert.deepEqual(matrix.requirements[0].evidence, [`${path}#G2: полный связанный доменный цикл`]);
});
