import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countPassed, finalReleaseGaps } from '../kshvi-final-verify.mjs';

const complete = { functionalPassed: 267, nfPassed: 22, acPassed: 30, expositionPassed: true, openLimitations: [], fullChecksPassed: true };

test('открытое ограничение или экспозиция без доказательства блокирует релиз', () => {
  assert.deepEqual(finalReleaseGaps({ ...complete, openLimitations: [{ id: 'L1', severity: 'blocker' }] }), ['OPEN_LIMITATION:L1']);
  assert.deepEqual(finalReleaseGaps({ ...complete, expositionPassed: false }), ['EXPOSITION_NOT_PASSED']);
});

test('проверяет точные количества и полные проверки', () => {
  assert.deepEqual(finalReleaseGaps({ ...complete, functionalPassed: 266 }), ['FUNCTIONAL_COUNT:266']);
  assert.deepEqual(finalReleaseGaps({ ...complete, nfPassed: 21 }), ['NF_COUNT:21']);
  assert.deepEqual(finalReleaseGaps({ ...complete, acPassed: 29 }), ['AC_COUNT:29']);
  assert.deepEqual(finalReleaseGaps({ ...complete, fullChecksPassed: false }), ['FULL_CHECKS_FAILED']);
  assert.deepEqual(finalReleaseGaps(complete), []);
});


test('считает только реально пройденные протоколы, без undefined', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kshvi-final-count-'));
  writeFileSync(join(directory, 'NF-01.json'), '{"status":"passed"}');
  writeFileSync(join(directory, 'NF-02.json'), '{"status":"failed"}');
  assert.equal(countPassed(directory, 'NF'), 1);
  assert.equal(countPassed(join(directory, 'missing'), 'AC'), 0);
});
