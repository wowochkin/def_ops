import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceFiles, assertNoDirectOutcomeWrites, buildG2Evidence, resolveRunMode, runAcceptance, assertFreshG2Run } from '../kshvi-run-acceptance.mjs';

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
  runId: 'run-1',
  commit: 'abc123',
  startedAt: '2030-01-01T00:00:00Z',
  completedAt: '2030-01-01T00:01:00Z',
  sessionIds: ['session-1', 'session-2'],
  scenarioHash: 'a'.repeat(64),
  environmentHash: 'b'.repeat(64),
  infrastructure: { postgresql: 'passed', cartography: 'passed', gateway: 'passed' },
  checks: ['AC-01', 'AC-11'],
  coverage: { 'AC-01': 'passed', 'AC-03': 'passed', 'AC-04': 'passed', 'AC-05': 'passed', 'AC-06': 'passed', 'AC-07': 'passed', 'AC-09': 'passed', 'AC-11': 'passed', 'AC-15': 'passed', 'AC-18': 'passed' },
  events: [{ eventId: 'event-1', sequence: 1, hash: 'c'.repeat(64), sessionId: 'session-1', payload: { commandId: 'cmd-1', commandType: 'decision.create', causedBy: 'decision-1' } }],
};

test('приёмочный контур отклоняет прямую запись исходов', () => {
  assert.deepEqual(assertNoDirectOutcomeWrites(['await service.execute(context, command);', 'calculate(options);']), []);
  assert.deepEqual(assertNoDirectOutcomeWrites(['await store.appendCommand(input);', 'await journal.append(input);']), ['DIRECT_EVENT_APPEND']);
  assert.deepEqual(assertNoDirectOutcomeWrites(['await store.pool.query("update world set result = 1")', 'Math.random()']), ['DIRECT_SQL', 'UNRECORDED_RANDOM']);
});

test('отсутствие инфраструктуры и частичные AC не выдаются за полную приёмку G2', () => {
  const evidence = buildG2Evidence(
    { ...run, coverage: { ...run.coverage, 'AC-04': 'partial', 'AC-06': 'partial' }, infrastructure: { postgresql: 'not_run', cartography: 'not_run', gateway: 'not_run' } },
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


test('без аргументов выполняются и AC-01–AC-30, и G2 без перезаписи чужих evidence', () => {
  assert.deepEqual(resolveRunMode([]), { generic: true, g2: true, from: 1, to: 30, reverse: false, freshInstall: false, offline: false, evidence: 'docs/release/kshvi/acceptance', writeGenericEvidence: false, requireComplete: false });
});

test('generic-флаги не исключают G2 без явного --generic-only', () => {
  const mode = resolveRunMode(['--from', '11', '--to', '18', '--reverse', '--offline']);
  assert.equal(mode.generic, true);
  assert.equal(mode.g2, true);
  assert.equal(mode.from, 11);
  assert.equal(mode.to, 18);
  assert.equal(mode.writeGenericEvidence, false);
  assert.equal(resolveRunMode(['--generic-only', '--from', '1']).g2, false);
  assert.equal(resolveRunMode(['--generic-only', '--from', '1']).writeGenericEvidence, true);
  assert.equal(resolveRunMode(['--g2-only']).generic, false);
  assert.throws(() => resolveRunMode(['--g2-only', '--from', '1']), /явно/);
});

test('свежесть журнала проверяется по runId, commit, сеансам и фактической инфраструктуре', () => {
  assert.deepEqual(assertFreshG2Run(run, { runId: 'run-1', currentCommit: 'abc123' }), []);
  assert.ok(assertFreshG2Run({ ...run, infrastructure: { ...run.infrastructure, postgresql: 'not_run' } }, { runId: 'run-1', currentCommit: 'abc123' }).some(issue => issue.includes('postgresql')));
  assert.ok(assertFreshG2Run(run, { runId: 'other', currentCommit: 'abc123' }).some(issue => issue.includes('runId')));
  assert.ok(assertFreshG2Run(run, { runId: 'run-1', currentCommit: 'other' }).some(issue => issue.includes('commit')));
  assert.ok(assertFreshG2Run({ ...run, sessionIds: ['session-A', 'session-B'] }, { runId: 'run-1', currentCommit: 'abc123' }).some(issue => issue.includes('sessionId')));
});

test('неофициальное событие и неуспешный generic контур не дают passed', () => {
  const forged = { ...run, events: [{ ...run.events[0], payload: { outcome: 'COMPLETED' } }] };
  const evidence = buildG2Evidence(forged, { command: 'npm test', infrastructure: run.infrastructure, genericStatus: 1 });
  assert.equal(evidence.status, 'limited');
  assert.equal(evidence.directOutcomeWrites, true);
  assert.ok(evidence.openErrors.some(issue => issue.includes('официальн')));
  assert.ok(evidence.openErrors.some(issue => issue.includes('AC-01–AC-30')));
});

test('evidence содержит commit/runId и точные идентификаторы без диапазонов', () => {
  const evidence = buildG2Evidence(run, { command: 'npm test', infrastructure: run.infrastructure, genericStatus: 0 });
  assert.equal(evidence.commit, 'abc123');
  assert.equal(evidence.runId, 'run-1');
  assert.equal(evidence.directOutcomeWrites, false);
  assert.ok(evidence.requirements.every(id => !id.includes('–')));
});
