import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePyramid } from '../kshvi-test-pyramid.mjs';

const levels = ['unit', 'contract', 'integration', 'endToEnd', 'loadAndRecovery'];

test('требует все пять уровней NF-22', () => {
  const result = evaluatePyramid({ levels: levels.map(kind => ({ kind, status: 'passed', command: 'npm test', artifacts: ['result.json'] })) });
  assert.deepEqual(result.missingLevels, []);
  assert.deepEqual(result.invalidLevels, []);
});

test('находит пропущенный уровень и непройденное доказательство', () => {
  const result = evaluatePyramid({ levels: [{ kind: 'unit', status: 'failed', command: '', artifacts: [] }] });
  assert.deepEqual(result.missingLevels, ['contract', 'integration', 'endToEnd', 'loadAndRecovery']);
  assert.deepEqual(result.invalidLevels, ['unit']);
});
