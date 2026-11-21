import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceFiles, assertNoDirectOutcomeWrites, buildG2Evidence, runAcceptance } from '../kshvi-run-acceptance.mjs';

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
  const record = JSON.parse(readFileSync(join(evidence, 'AC-01.json'), 'utf8'));
  assert.equal(record.status, 'failed');
});

const run = {
  schemaVersion: 1,
  scenarioHash: 'a'.repeat(64),
  environmentHash: 'b'.repeat(64),
  checks: ['AC-01', 'AC-11'],
  coverage: { 'AC-01': 'passed', 'AC-03': 'passed', 'AC-04': 'passed', 'AC-05': 'passed', 'AC-06': 'passed', 'AC-07': 'passed', 'AC-09': 'passed', 'AC-11': 'passed', 'AC-15': 'passed', 'AC-18': 'passed' },
  events: [{ eventId: 'event-1', sequence: 1, hash: 'c'.repeat(64) }],
};

test('приёмочный контур отклоняет прямую запись исходов', () => {
  assert.deepEqual(assertNoDirectOutcomeWrites(['await store.appendCommand(input);', 'calculate(options);']), []);
  assert.deepEqual(assertNoDirectOutcomeWrites(['await store.pool.query("update world set result = 1")', 'Math.random()']), ['DIRECT_SQL', 'UNRECORDED_RANDOM']);
});

test('отсутствие инфраструктуры и частичные AC не выдаются за полную приёмку G2', () => {
  const evidence = buildG2Evidence(
    { ...run, coverage: { ...run.coverage, 'AC-04': 'partial', 'AC-06': 'partial' } },
    { command: 'npx vitest run services/kshvi/tests/e2e/conduct-cycle.test.ts', infrastructure: { postgresql: 'not_run', cartography: 'not_run', gateway: 'not_run' } },
  );
  assert.equal(evidence.status, 'limited');
  assert.ok(evidence.openErrors.some(issue => issue.includes('AC-04')));
  assert.ok(evidence.openErrors.some(issue => issue.includes('PostgreSQL')));
  assert.equal(evidence.directOutcomeWrites, false);
});

test('полный набор инфраструктуры и AC может быть отмечен как пройденный', () => {
  const evidence = buildG2Evidence(run, { command: 'npm test', infrastructure: { postgresql: 'passed', cartography: 'passed', gateway: 'passed' } });
  assert.equal(evidence.status, 'passed');
  assert.deepEqual(evidence.openErrors, []);
});

test('доказательство ссылается на протокол инфраструктурных ограничений', () => {
  const evidence = buildG2Evidence(run, { command: 'npm test', infrastructure: { postgresql: 'not_run', cartography: 'not_run', gateway: 'not_run' } });
  assert.ok(evidence.artifacts.includes('docs/release/kshvi/evidence/g2-infrastructure.json'));
});
