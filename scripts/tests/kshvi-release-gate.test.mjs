import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectEvidence, releaseGaps, requiredIds } from '../kshvi-release-gate.mjs';

test('неполное доказательство блокирует выпуск', () => {
  const gaps = releaseGaps(
    ['KSHVI-F-GEN-01', 'KSHVI-NF-01', 'KSHVI-AC-01'],
    { 'KSHVI-F-GEN-01': 'docs/release/kshvi/gen-01.json' },
  );
  assert.deepEqual(gaps, ['KSHVI-NF-01', 'KSHVI-AC-01']);
});

test('извлекает все идентификаторы спецификации без дубликатов', () => {
  const ids = requiredIds(`
    KSHVI-F-GEN-01 KSHVI-F-GEN-01 KSHVI-NF-22
    KSHVI-AC-00 KSHVI-AC-30
  `);
  assert.deepEqual(ids, ['KSHVI-F-GEN-01', 'KSHVI-NF-22', 'KSHVI-AC-00', 'KSHVI-AC-30']);
});

test('принимает только существующее свежее пройденное доказательство', () => {
  const root = mkdtempSync(join(tmpdir(), 'kshvi-gate-'));
  mkdirSync(join(root, 'docs/release/kshvi/evidence'), { recursive: true });
  const path = join(root, 'docs/release/kshvi/evidence/gen-01.json');
  writeFileSync(path, '{"result":"ok"}\n');
  writeFileSync(join(root, 'screen.jpg'), 'jpeg');
  const evidence = {
    path: 'docs/release/kshvi/evidence/gen-01.json',
    status: 'passed',
    commit: 'abc123',
    command: 'npx vitest run gen-01.test.ts',
    artifacts: ['docs/release/kshvi/evidence/gen-01.json', 'screen.jpg'],
  };
  assert.deepEqual(inspectEvidence(evidence, { root, currentCommit: 'abc123' }), []);
  assert.ok(inspectEvidence({ ...evidence, status: 'waived' }, { root, currentCommit: 'abc123' }).includes('STATUS'));
  assert.ok(inspectEvidence({ ...evidence, commit: 'old' }, { root, currentCommit: 'abc123' }).includes('STALE_COMMIT'));
  assert.ok(inspectEvidence({ ...evidence, artifacts: ['missing.json'] }, { root, currentCommit: 'abc123' }).includes('MISSING_ARTIFACT:missing.json'));
  assert.ok(inspectEvidence({ ...evidence, path: '../outside.json' }, { root, currentCommit: 'abc123' }).includes('UNSAFE_PATH'));
});

test('отклоняет повреждённое доказательство и непустой список ошибок', () => {
  const root = mkdtempSync(join(tmpdir(), 'kshvi-gate-'));
  mkdirSync(join(root, 'evidence'), { recursive: true });
  writeFileSync(join(root, 'evidence/broken.json'), '{');
  writeFileSync(join(root, 'evidence/failed.json'), '{"openErrors":["AC-01"]}');
  const base = { status: 'passed', commit: 'abc123', command: 'node check.mjs', artifacts: [] };
  assert.ok(inspectEvidence({ ...base, path: 'evidence/broken.json' }, { root, currentCommit: 'abc123' }).includes('INVALID_JSON'));
  assert.ok(inspectEvidence({ ...base, path: 'evidence/failed.json' }, { root, currentCommit: 'abc123' }).includes('OPEN_ERRORS'));
});
