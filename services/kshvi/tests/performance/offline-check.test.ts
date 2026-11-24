import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { resolve } from 'node:path';

type OfflineEvaluation = {
  status: 'passed' | 'failed' | 'blocked';
  issues: string[];
};
type OfflineModule = {
  evaluateOfflineEvidence(input: {
    localAssetsVerified: boolean;
    externalRequests: number;
    physicalIsolation: 'passed' | 'failed' | 'not-verified';
  }): OfflineEvaluation;
  runOfflineCheck(options?: {
    physicalProbe?: () => Promise<'passed' | 'failed' | 'not-verified'>;
  }): Promise<OfflineEvaluation & { localAssetsVerified: boolean; externalRequests: number }>;
  buildSandboxArguments(localPort: number): string[];
};

async function loadModule(): Promise<OfflineModule> {
  return import(resolve('scripts/kshvi-offline-check.mjs')) as Promise<OfflineModule>;
}

it('не выдаёт процессную изоляцию за физически закрытый контур', async () => {
  const { evaluateOfflineEvidence } = await loadModule();
  expect(evaluateOfflineEvidence({ localAssetsVerified: true, externalRequests: 0, physicalIsolation: 'not-verified' })).toMatchObject({ status: 'blocked' });
  expect(evaluateOfflineEvidence({ localAssetsVerified: true, externalRequests: 0, physicalIsolation: 'passed' })).toMatchObject({ status: 'passed', issues: [] });
  expect(evaluateOfflineEvidence({ localAssetsVerified: true, externalRequests: 1, physicalIsolation: 'passed' }).status).toBe('failed');
  expect(evaluateOfflineEvidence({ localAssetsVerified: false, externalRequests: 0, physicalIsolation: 'passed' }).status).toBe('failed');
});

it('проверяет настоящие файлы манифеста и не скрывает отсутствие физической изоляции', async () => {
  const { runOfflineCheck } = await loadModule();
  const report = await runOfflineCheck({ physicalProbe: async () => 'not-verified' });
  expect(report.localAssetsVerified).toBe(true);
  expect(report.externalRequests).toBe(0);
  expect(report.status).toBe('blocked');
});

it('передаёт sandbox-exec файл профиля, а не его путь как исходный текст', async () => {
  const { buildSandboxArguments } = await loadModule();
  const args = buildSandboxArguments(49152);
  expect(args.slice(0, 2)).toEqual(['-f', expect.stringMatching(/local-only\.sb$/)]);
  expect(args).toContain('49152');
});

it.runIf(process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec'))('применяет профиль локальной сети средствами ОС', () => {
  const result = spawnSync('/usr/bin/sandbox-exec', ['-f', resolve('deploy/kshvi/closed-lan/local-only.sb'), '/usr/bin/true'], { encoding: 'utf8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
