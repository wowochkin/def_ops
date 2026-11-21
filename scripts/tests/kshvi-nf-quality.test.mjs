import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nfFiles, runNfQuality } from '../kshvi-nf-quality.mjs';

test('содержит 22 нефункциональных протокола', () => {
  assert.equal(nfFiles(1, 22).length, 22);
  assert.equal(nfFiles(1, 22)[21].id, 'NF-22');
});

test('записывает пройденный протокол только после успеха', async () => {
  const evidence = mkdtempSync(join(tmpdir(), 'kshvi-nf-'));
  const result = await runNfQuality({ from: 1, to: 1, evidence, fileExists: () => true, runner: async () => ({ status: 0, output: 'ok' }), currentCommit: 'abc123' });
  assert.equal(result.status, 0);
  const record = JSON.parse(readFileSync(join(evidence, 'NF-01.json'), 'utf8'));
  assert.equal(record.status, 'passed');
  assert.equal(record.openErrors.length, 0);
});

test('не принимает группу при отсутствии или падении протокола', async () => {
  const evidence = mkdtempSync(join(tmpdir(), 'kshvi-nf-'));
  const missing = await runNfQuality({ from: 1, to: 1, evidence, fileExists: () => false, runner: async () => { throw new Error('не запускать'); }, currentCommit: 'abc123' });
  assert.equal(missing.status, 1);
  const failed = await runNfQuality({ from: 1, to: 1, evidence, fileExists: () => true, runner: async () => ({ status: 1, output: 'fail' }), currentCommit: 'abc123' });
  assert.equal(failed.status, 1);
  const record = JSON.parse(readFileSync(join(evidence, 'NF-01.json'), 'utf8'));
  assert.equal(record.status, 'failed');
});
