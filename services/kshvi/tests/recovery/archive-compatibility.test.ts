import { expect, it } from 'vitest';
import { restoreAt } from '../../../../packages/kshvi/src/replay/replay-engine';
import { makeReplayArchive } from '../../../../packages/kshvi/tests/fixtures/replay-archive';

it('повторяет контрольные хеши старого архива и явно помечает неизвестный reducer', () => {
  const archive = makeReplayArchive();
  const first = restoreAt({ archive, cursor: 3 });
  const second = restoreAt({ archive: structuredClone(archive), cursor: 3 });
  expect(first).toMatchObject({ compatibility: 'REPRODUCIBLE', identityClaimed: true });
  expect(second.stateHash).toBe(first.stateHash);
  expect(second.appliedEventIds).toEqual(first.appliedEventIds);

  const incompatible = structuredClone(archive);
  incompatible.events[2]!.reducerVersion = 999;
  const frame = restoreAt({ archive: incompatible, cursor: 3 });
  expect(frame).toMatchObject({ compatibility: 'INCOMPATIBLE_READ', identityClaimed: false, stateHash: null });
});
