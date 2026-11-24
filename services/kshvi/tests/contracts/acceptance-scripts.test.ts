import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

type AuditResult = { status: number; output: string };
type Options = {
  evidence: string; currentCommit: string; fileExists: () => boolean;
  runner: () => Promise<{ status: number; output: string }>;
  auditRunner?: () => Promise<AuditResult>;
};
type AcceptanceResult = { status: number; overallStatus?: 'passed' | 'failed' | 'blocked' };
type AcceptanceModule = { runSecurityAcceptance(options: Options): Promise<AcceptanceResult> } | { runRecoveryAcceptance(options: Options): Promise<AcceptanceResult> };
const cleanAudit = async (): Promise<AuditResult> => ({ status: 0, output: JSON.stringify({ metadata: { vulnerabilities: { total: 0, high: 0, critical: 0 } } }) });

it('запускает отдельные группы NF-06–NF-10 и NF-11–NF-15 с фактическими протоколами', async () => {
  const evidence = resolve(`.tmp/nf-acceptance-${randomUUID()}`);
  await mkdir(evidence, { recursive: true });
  const options: Options = { evidence, currentCommit: 'test-commit', fileExists: () => true, runner: async () => ({ status: 0, output: 'ok' }), auditRunner: cleanAudit };
  try {
    const security = await import(resolve('scripts/kshvi-security-acceptance.mjs')) as AcceptanceModule;
    const recovery = await import(resolve('scripts/kshvi-recovery-acceptance.mjs')) as AcceptanceModule;
    if (!('runSecurityAcceptance' in security) || !('runRecoveryAcceptance' in recovery)) throw new Error('Отсутствуют точки входа приёмки');
    expect((await security.runSecurityAcceptance(options)).status).toBe(0);
    const recoveryResult = await recovery.runRecoveryAcceptance(options);
    expect(recoveryResult.status).toBe(1);
    expect(recoveryResult.overallStatus).toBe('blocked');
    expect(JSON.parse(await readFile(resolve(evidence, 'NF-12.json'), 'utf8')).status).toBe('blocked');
    for (const id of ['NF-06', 'NF-10', 'NF-11', 'NF-15']) {
      expect(JSON.parse(await readFile(resolve(evidence, `${id}.json`), 'utf8'))).toMatchObject({ status: 'passed', commit: 'test-commit' });
    }
  } finally {
    await rm(evidence, { recursive: true, force: true });
  }
});

it('записывает fresh-install доказательства относительно execution cwd, а не исходного каталога', async () => {
  const root = await mkdtemp(resolve('.tmp', 'acceptance-cwd-'));
  const relativeEvidence = `docs/evidence-${randomUUID()}`;
  const outside = resolve(relativeEvidence);
  try {
    const module = await import(resolve('scripts/kshvi-run-acceptance.mjs'));
    const hash = 'a'.repeat(64);
    const result = await module.runAcceptance({
      from: 1, to: 1, cwd: root, evidence: relativeEvidence, currentCommit: 'current', runId: 'fresh-run',
      fileExists: () => true,
      runner: async () => ({
        status: 0, output: 'ok',
        evidence: {
          runId: 'fresh-run', commit: 'current',
          initialRevision: { id: 'initial', revision: 1, sha256: hash },
          journal: { path: 'journal.json', sha256: hash, eventCount: 1 },
          hashes: { scenario: hash, environment: hash, journal: hash },
          protocols: ['protocol.txt'], metrics: { passed: 1 }, limitations: [], artifacts: ['journal.json', 'protocol.txt'],
        },
      }),
    });
    expect(result.status).toBe(0);
    const expected = resolve(root, relativeEvidence, 'AC-01.json');
    expect(existsSync(expected)).toBe(true);
    expect(JSON.parse(await readFile(expected, 'utf8'))).toMatchObject({ status: 'passed', cwd: root });
    expect(existsSync(resolve(outside, 'AC-01.json'))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

it('не засчитывает NF-06 при известной уязвимости зависимостей даже при зелёных функциональных тестах', async () => {
  const evidence = resolve(`.tmp/nf-acceptance-${randomUUID()}`);
  await mkdir(evidence, { recursive: true });
  try {
    const security = await import(resolve('scripts/kshvi-security-acceptance.mjs')) as AcceptanceModule;
    if (!('runSecurityAcceptance' in security)) throw new Error('Отсутствует security acceptance');
    const result = await security.runSecurityAcceptance({
      evidence, currentCommit: 'test-commit', fileExists: () => true, runner: async () => ({ status: 0, output: 'ok' }),
      auditRunner: async () => ({ status: 1, output: JSON.stringify({ metadata: { vulnerabilities: { total: 2, high: 1, critical: 0 } } }) }),
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(await readFile(resolve(evidence, 'NF-06.json'), 'utf8')).status).toBe('failed');
    expect(JSON.parse(await readFile(resolve(evidence, 'dependency-audit.json'), 'utf8')).status).toBe('failed');
  } finally {
    await rm(evidence, { recursive: true, force: true });
  }
});
