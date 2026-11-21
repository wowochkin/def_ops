import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceFiles, runAcceptance } from '../kshvi-run-acceptance.mjs';

test('содержит независимые сценарии AC-01–AC-30', () => {
  const files = acceptanceFiles(1, 30);
  assert.equal(files.length, 30);
  assert.equal(files[0].id, 'AC-01');
  assert.equal(files.at(-1).id, 'AC-30');
});

test('записывает доказательства только после реального успешного запуска', async () => {
  const evidence = mkdtempSync(join(tmpdir(), 'kshvi-acceptance-'));
  const calls = [];
  const result = await runAcceptance({
    from: 1,
    to: 2,
    reverse: true,
    evidence,
    fileExists: () => true,
    runner: async files => { calls.push(files); return { status: 0, output: 'ok' }; },
    currentCommit: 'abc123',
  });
  assert.equal(result.status, 0);
  assert.deepEqual(calls.map(call => call[0].id), ['AC-02', 'AC-01']);
  for (const id of ['AC-01', 'AC-02']) {
    const record = JSON.parse(readFileSync(join(evidence, `${id}.json`), 'utf8'));
    assert.equal(record.status, 'passed');
    assert.equal(record.commit, 'abc123');
    assert.ok(record.command.includes('vitest'));
    assert.ok(record.artifacts.length > 0);
  }
});

test('не создаёт passed при отсутствии сценария или ошибке запуска', async () => {
  const evidence = mkdtempSync(join(tmpdir(), 'kshvi-acceptance-'));
  const missing = await runAcceptance({ from: 1, to: 1, evidence, fileExists: () => false, runner: async () => { throw new Error('не должен запускаться'); }, currentCommit: 'abc123' });
  assert.equal(missing.status, 1);
  const failed = await runAcceptance({ from: 1, to: 1, evidence, fileExists: () => true, runner: async () => ({ status: 1, output: 'fail' }), currentCommit: 'abc123' });
  assert.equal(failed.status, 1);
  for (const id of ['AC-01']) {
    const record = JSON.parse(readFileSync(join(evidence, `${id}.json`), 'utf8'));
    assert.equal(record.status, 'failed');
  }
});
