import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countPassed, finalReleaseGaps, inspectProtocol, openLimitations } from '../kshvi-final-verify.mjs';

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

test('протокол отклоняет устаревший коммит, пропавший артефакт, открытую ошибку и неполный архив', () => {
  const root = mkdtempSync(join(tmpdir(), 'kshvi-protocol-'));
  writeFileSync(join(root, 'proof.json'), '{}\n');
  const valid = { status: 'passed', commit: 'abc123', command: 'npm test', artifacts: ['proof.json'], openErrors: [] };
  assert.deepEqual(inspectProtocol(valid, { root, currentCommit: 'abc123' }), []);
  assert.ok(inspectProtocol({ ...valid, commit: 'old' }, { root, currentCommit: 'abc123' }).includes('STALE_COMMIT'));
  assert.ok(inspectProtocol({ ...valid, artifacts: ['missing.json'] }, { root, currentCommit: 'abc123' }).includes('MISSING_ARTIFACT:missing.json'));
  assert.ok(inspectProtocol({ ...valid, artifacts: ['../outside.json'] }, { root, currentCommit: 'abc123' }).includes('UNSAFE_ARTIFACT:../outside.json'));
  assert.ok(inspectProtocol({ ...valid, openErrors: ['сбой'] }, { root, currentCommit: 'abc123' }).includes('OPEN_ERRORS'));
  assert.ok(inspectProtocol({ ...valid, archive: { autonomous: false, missing: ['environment.weather'] } }, { root, currentCommit: 'abc123' }).includes('INCOMPLETE_ARCHIVE'));
});

test('свежесть протокола обязательна при подсчёте приёмки', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kshvi-fresh-count-'));
  writeFileSync(join(directory, 'proof.json'), '{}\n');
  writeFileSync(join(directory, 'NF-01.json'), JSON.stringify({ status: 'passed', commit: 'current', command: 'npm test', artifacts: ['proof.json'], openErrors: [] }));
  writeFileSync(join(directory, 'NF-02.json'), JSON.stringify({ status: 'passed', commit: 'stale', command: 'npm test', artifacts: ['proof.json'], openErrors: [] }));
  assert.equal(countPassed(directory, 'NF', { root: directory, currentCommit: 'current' }), 1);
});

test('закрытое ограничение требует свежего доказательства устранения', () => {
  const root = mkdtempSync(join(tmpdir(), 'kshvi-limitations-'));
  writeFileSync(join(root, 'fixed.json'), '{}\n');
  const resolution = { status: 'passed', commit: 'current', command: 'npm test', artifacts: ['fixed.json'], openErrors: [] };
  assert.deepEqual(openLimitations([{ id: 'L1', status: 'closed', resolution }], { root, currentCommit: 'current' }), []);
  assert.deepEqual(openLimitations([{ id: 'L2', status: 'open' }], { root, currentCommit: 'current' }).map(item => item.id), ['L2']);
  assert.deepEqual(openLimitations([{ id: 'L3', status: 'closed', resolution: { ...resolution, commit: 'stale' } }], { root, currentCommit: 'current' }).map(item => item.id), ['L3']);
});
