import { expect, it } from 'vitest';
import { restoreAt } from '../../src/replay/replay-engine';
import { validateArchivePaths, validateArchiveSchema } from '../../src/archive/archive-schema';
import { makeReplayArchive } from '../fixtures/replay-archive';
import { makeArchiveBundle } from '../fixtures/archive-fixture';

it('сохраняет хеши старого архива и не заявляет идентичность при неизвестном reducer', () => {
  const archive = makeReplayArchive();
  const original = restoreAt({ archive, cursor: 3 });
  expect(restoreAt({ archive: structuredClone(archive), cursor: 3 }).stateHash).toBe(original.stateHash);
  const changed = structuredClone(archive);
  changed.events[2]!.reducerVersion = 999;
  expect(restoreAt({ archive: changed, cursor: 3 })).toMatchObject({ compatibility: 'INCOMPATIBLE_READ', identityClaimed: false, stateHash: null });
});

it('отклоняет неизвестную схему и небезопасную миграцию путей архива', () => {
  const bundle = makeArchiveBundle();
  expect(validateArchiveSchema(bundle.manifest)).toEqual([]);
  expect(validateArchivePaths(bundle.manifest)).toEqual([]);
  expect(validateArchiveSchema({ ...bundle.manifest, schemaVersion: 999 })).toContain('Неподдерживаемая версия схемы архива');
  const traversal = { ...bundle.manifest, components: bundle.manifest.components.map((component, index) => index === 0 ? { ...component, path: '../outside.json' } : component) };
  expect(validateArchivePaths(traversal)).toHaveLength(1);
});
