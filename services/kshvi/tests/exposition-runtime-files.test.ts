import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createFileExpositionService } from '../src/exposition/exposition-runtime';
import { FileExpositionRepository } from '../src/exposition/exposition-repository';
import { expositionProgram, officialArchive } from '../../../packages/kshvi/tests/fixtures/exposition';

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

it('development создаёт демонстрационный комплект, а официальный режим требует файлы', async () => {
  const root = await mkdtemp(join('.tmp', 'exposition-runtime-'));
  roots.push(root);
  const archivePath = join(root, 'official-archive.json');
  const programPath = join(root, 'program.json');
  const runtimePath = join(root, 'runtime.json');
  const repository = new FileExpositionRepository({ archivePath, programPath, statePath: join(root, 'sessions.json') });
  const service = await createFileExpositionService({ repository, runtimePath, archivePath, programPath, allowDemoFixtures: true });
  expect(service).toBeDefined();
  expect(JSON.parse(await readFile(runtimePath, 'utf8')).policy.allowedLayers).toContain('weather');
  expect(JSON.parse(await readFile(archivePath, 'utf8')).manifestHash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.parse(await readFile(programPath, 'utf8')).id).toBe(expositionProgram().id);
  await expect(repository.officialArchive()).resolves.toMatchObject({ archiveId: officialArchive().archiveId });

  await expect(createFileExpositionService({
    repository: new FileExpositionRepository({ archivePath: join(root, 'missing-official.json'), programPath: join(root, 'missing-program.json'), statePath: join(root, 'missing-sessions.json') }),
    runtimePath: join(root, 'missing-runtime.json'),
    archivePath: join(root, 'missing-official.json'), programPath: join(root, 'missing-program.json'), allowDemoFixtures: false,
  })).rejects.toThrow('Официальный комплект экспозиции не найден');
});
