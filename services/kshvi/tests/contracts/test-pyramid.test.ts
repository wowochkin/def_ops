import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { expect, it } from 'vitest';

type Status = 'passed' | 'failed' | 'blocked';
type Pyramid = { levels: Array<{ kind: string; status: Status; command: string; artifacts: string[]; commit?: string; completedAt?: string }> };
type PyramidModule = {
  REQUIRED_LEVELS: string[];
  evaluatePyramid(pyramid: Pyramid): { missingLevels: string[]; invalidLevels: string[]; unexpectedLevels: string[] };
  validatePyramidStructure(pyramid: Pyramid): { missingLevels: string[]; invalidLevels: string[]; unexpectedLevels: string[] };
  runPyramid(options: {
    output: string; requireComplete?: boolean; currentCommit: string;
    runner: (step: { command: string }, level: { kind: string }) => Promise<{ status: number; output: string; protocolStatus?: Status }>;
  }): Promise<{ status: number; overallStatus: Status }>;
};
const loadModule = async () => import(resolve('scripts/kshvi-test-pyramid.mjs')) as Promise<PyramidModule>;

it('содержит пять обязательных уровней с командами, свежими результатами и артефактами', async () => {
  const { REQUIRED_LEVELS, validatePyramidStructure } = await loadModule();
  const pyramid = JSON.parse(await readFile('docs/release/kshvi/test-pyramid.json', 'utf8')) as Pyramid;
  expect(pyramid.levels.map(level => level.kind)).toEqual(REQUIRED_LEVELS);
  expect(validatePyramidStructure(pyramid)).toEqual({ missingLevels: [], invalidLevels: [], unexpectedLevels: [] });
  for (const level of pyramid.levels) {
    expect(level.command.trim()).not.toBe('');
    expect(level.artifacts.length).toBeGreaterThan(0);
    for (const artifact of level.artifacts) {
      expect(existsSync(artifact), `Артефакт не создан: ${artifact}`).toBe(true);
      let ignored = false;
      try { execFileSync('git', ['check-ignore', '-q', artifact], { stdio: 'ignore' }); ignored = true; } catch { /* Git возвращает 1 для коммитимого файла. */ }
      expect(ignored, `Артефакт игнорируется Git: ${artifact}`).toBe(false);
    }
    expect(['passed', 'failed', 'blocked']).toContain(level.status);
    expect(level.commit).toBeTruthy();
    expect(Date.parse(level.completedAt ?? '')).not.toBeNaN();
  }
});

it('отклоняет устаревшие, дублированные и неполные уровни', async () => {
  const { REQUIRED_LEVELS, evaluatePyramid } = await loadModule();
  const levels = REQUIRED_LEVELS.map(kind => ({ kind, status: 'passed' as const, command: 'npm test', artifacts: ['log'], commit: 'abc', completedAt: 'not-a-date' }));
  expect(evaluatePyramid({ levels }).invalidLevels).toEqual(REQUIRED_LEVELS);
  expect(evaluatePyramid({ levels: [...levels, levels[0]!] }).invalidLevels).toContain('unit');
  expect(evaluatePyramid({ levels: levels.slice(1) }).missingLevels).toEqual(['unit']);
});

it('выполняет уровни фактически и сохраняет blocked внешнего ограничения', async () => {
  const { REQUIRED_LEVELS, runPyramid, evaluatePyramid } = await loadModule();
  const output = resolve(`.tmp/test-pyramid-${randomUUID()}.json`);
  const calls: string[] = [];
  const success = await runPyramid({
    output, currentCommit: 'test-commit', requireComplete: true,
    runner: async (step, level) => { calls.push(`${level.kind}:${step.command}`); return { status: 0, output: 'ok' }; },
  });
  expect(success).toEqual({ status: 0, overallStatus: 'passed' });
  expect(new Set(calls.map(call => call.split(':')[0]))).toEqual(new Set(REQUIRED_LEVELS));
  const saved = JSON.parse(await readFile(output, 'utf8')) as Pyramid;
  expect(evaluatePyramid(saved).invalidLevels).toEqual([]);
  expect(saved.levels.flatMap(level => level.artifacts).every(path => !isAbsolute(path))).toBe(true);

  const blockedOutput = resolve(`.tmp/test-pyramid-${randomUUID()}.json`);
  const blocked = await runPyramid({
    output: blockedOutput, currentCommit: 'test-commit', requireComplete: true,
    runner: async (_step, level) => level.kind === 'loadAndRecovery' ? { status: 2, protocolStatus: 'blocked', output: 'Нет физической LAN' } : { status: 0, output: 'ok' },
  });
  expect(blocked).toEqual({ status: 1, overallStatus: 'blocked' });
  await Promise.all([output, blockedOutput].map(path => rm(path, { force: true })));
});
