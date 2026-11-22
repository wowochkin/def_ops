import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(resolve(path))).digest('hex');
}
function commitExists(hash: string): void {
  execFileSync('git', ['cat-file', '-e', hash], { stdio: 'pipe' });
}

it('привязывает remediation к версионируемым журналам, baseCommit и фактическим integrated hashes', () => {
  const evidence = JSON.parse(readFileSync(resolve('docs/release/kshvi/admin-remediation.json'), 'utf8')) as {
    baseCommit: string;
    reviewedRange: { from: string; to: string };
    reviewLog: string;
    reviewLogSha256: string;
    reReviewLog: string;
    reReviewLogSha256: string;
    items: { id: string; severity: string; tests: string[] }[];
  };
  expect(evidence.baseCommit).toBe('2e99ba0af7589c1233233b1af0fd11f4616aed17');
  expect(evidence.reviewedRange).toEqual({ from: 'ccf69ac4016743e7bb53bd94675bca3ff3ea054c', to: '4be48c1dbd7b826b6e60b046849e9b0b78e0461e' });
  commitExists(evidence.baseCommit);
  commitExists(evidence.reviewedRange.from);
  commitExists(evidence.reviewedRange.to);
  expect(evidence.reviewLog).toBe('docs/release/kshvi/original-findings.md');
  expect(evidence.reReviewLog).toBe('docs/release/kshvi/rereview.md');
  expect(evidence.reviewLogSha256).toBe(sha256(evidence.reviewLog));
  expect(evidence.reReviewLogSha256).toBe(sha256(evidence.reReviewLog));
  expect(readFileSync(resolve(evidence.reviewLog), 'utf8')).toContain('## Critical');
  expect(readFileSync(resolve(evidence.reReviewLog), 'utf8')).toContain('### Critical');
  expect(JSON.stringify(evidence)).not.toContain('.tmp/');
  expect(evidence.items).toHaveLength(8);
  expect(new Set(evidence.items.map(item => item.id)).size).toBe(8);
  for (const item of evidence.items) {
    expect(item.tests.length, item.id).toBeGreaterThan(0);
    for (const test of item.tests) {
      expect(existsSync(resolve(test)), `${item.id}: ${test}`).toBe(true);
      expect(readFileSync(resolve(test), 'utf8').length, `${item.id}: ${test}`).toBeGreaterThan(100);
    }
  }
});
