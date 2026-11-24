import { mkdir, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

type ProtocolStatus = 'passed' | 'failed' | 'blocked';
type NfFile = { id: string; path: string; paths?: string[] };
type RunnerResult = { status: number; output: string; protocolStatus?: ProtocolStatus };
type NfModule = {
  nfFiles(from: number, to: number): NfFile[];
  runNfQuality(options: {
    from: number; to: number; evidence: string; currentCommit: string;
    fileExists: () => boolean;
    runner: (files: NfFile[]) => Promise<RunnerResult> | RunnerResult;
  }): Promise<{ status: number }>;
};
const loadModule = async () => import(resolve('scripts/kshvi-nf-quality.mjs')) as Promise<NfModule>;

async function evidenceDirectory(): Promise<string> {
  const path = resolve(`.tmp/nf-quality-${randomUUID()}`);
  await mkdir(path, { recursive: true });
  return path;
}

it('связывает NF с профильными тестами без вымышленных nonfunctional-заглушек', async () => {
  const { nfFiles } = await loadModule();
  expect(nfFiles(6, 10).map(file => file.path)).toEqual([
    'services/kshvi/tests/security/authentication.test.ts',
    'services/kshvi/tests/security/tenant-isolation.test.ts',
    'services/kshvi/tests/security/log-redaction.test.ts',
    'services/kshvi/tests/security/security-audit.test.ts',
    'services/kshvi/tests/security/distribution-labels.test.ts',
  ]);
  expect(nfFiles(11, 15).map(file => file.path)).toEqual([
    'services/kshvi/tests/recovery/rpo-zero.test.ts',
    'services/kshvi/tests/recovery/recovery-time.test.ts',
    'services/kshvi/tests/recovery/backup-schedule.test.ts',
    'services/kshvi/tests/recovery/reconnect.test.ts',
    'services/kshvi/tests/recovery/archive-compatibility.test.ts',
  ]);
});

it('сохраняет failed любого теста группы и blocked внешнего ограничения', async () => {
  const { runNfQuality } = await loadModule();
  const evidence = await evidenceDirectory();
  try {
    const result = await runNfQuality({
      from: 6, to: 10, evidence, currentCommit: 'test-commit', fileExists: () => true,
      runner: async files => ({ status: files[0]?.id === 'NF-08' ? 1 : 0, output: files[0]?.id === 'NF-08' ? 'обнаружен секрет' : 'ok' }),
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(await readFile(resolve(evidence, 'NF-08.json'), 'utf8')).status).toBe('failed');
    expect(JSON.parse(await readFile(resolve(evidence, 'NF-06.json'), 'utf8')).status).toBe('passed');

    await runNfQuality({
      from: 1, to: 1, evidence, currentCommit: 'test-commit', fileExists: () => true,
      runner: async () => ({ status: 2, protocolStatus: 'blocked', output: 'Физическая LAN не проверена' }),
    });
    expect(JSON.parse(await readFile(resolve(evidence, 'NF-01.json'), 'utf8')).status).toBe('blocked');

    await runNfQuality({
      from: 12, to: 12, evidence, currentCommit: 'test-commit', fileExists: () => true,
      runner: async () => ({ status: 0, output: 'Локальный процесс восстановлен за 40 мс' }),
    });
    expect(JSON.parse(await readFile(resolve(evidence, 'NF-12.json'), 'utf8')).status).toBe('blocked');
  } finally {
    await rm(evidence, { recursive: true, force: true });
  }
});
