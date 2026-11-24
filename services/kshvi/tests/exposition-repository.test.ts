import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { startArchiveShow } from '../../../packages/kshvi/src/exposition/exposition-session';
import { expositionProgram, officialArchive } from '../../../packages/kshvi/tests/fixtures/exposition';
import {
  ExpositionSessionConflictError,
  FileExpositionRepository,
  sealOfficialExpositionArchive,
} from '../src/exposition/exposition-repository';

const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function setup() {
  const directory = await mkdtemp(resolve('.tmp', `exposition-repo-${randomUUID()}-`));
  paths.push(directory);
  const archive = sealOfficialExpositionArchive(officialArchive());
  const archivePath = resolve(directory, 'official.json');
  const programPath = resolve(directory, 'program.json');
  const statePath = resolve(directory, 'state.json');
  await writeFile(archivePath, JSON.stringify(archive));
  await writeFile(programPath, JSON.stringify(expositionProgram()));
  const repository = new FileExpositionRepository({ archivePath, programPath, statePath });
  return { archive, archivePath, programPath, statePath, repository };
}

describe('репозиторий экспозиции и содержательный manifest hash', () => {
  it('отклоняет изменённое содержимое официального архива без смены хеша', async () => {
    const { archive, archivePath, repository } = await setup();
    await expect(repository.officialArchive()).resolves.toMatchObject({ manifestHash: archive.manifestHash });
    const tampered = structuredClone(archive) as unknown as { journal: { payload: { amount: number } }[] };
    tampered.journal[0].payload.amount = 99;
    await writeFile(archivePath, JSON.stringify(tampered));
    await expect(repository.officialArchive()).rejects.toThrow('manifest');
  });

  it('не перезаписывает sessionId и восстанавливает сеанс и handoff после перезапуска', async () => {
    const { archive, statePath, repository } = await setup();
    const session = startArchiveShow({
      sourceArchive: archive, program: expositionProgram(), sessionId: 'persistent-show', branchId: 'persistent-branch',
    });
    const record = { session, organizationId: 'org1', ownerId: 'presenter-user' };
    await repository.createSession(record);
    await expect(repository.createSession({
      ...record, session: { ...session, branchId: 'attacker-branch' },
    })).rejects.toBeInstanceOf(ExpositionSessionConflictError);
    await expect(repository.getSession(session.sessionId)).resolves.toMatchObject({ session: { branchId: 'persistent-branch' } });
    const first = await repository.publishHandoff('org1', session);
    expect(first.generation).toBe(1);

    const resumed = new FileExpositionRepository({
      archivePath: resolve(statePath, '..', 'official.json'), programPath: resolve(statePath, '..', 'program.json'), statePath,
    });
    await expect(resumed.getSession(session.sessionId)).resolves.toMatchObject({ session: { branchId: 'persistent-branch' } });
    await expect(resumed.activeHandoff('org1')).resolves.toMatchObject({ sessionId: session.sessionId, branchId: session.branchId, generation: 1 });
    expect(JSON.parse(await readFile(statePath, 'utf8')).sessions).toHaveLength(1);
  });
});
