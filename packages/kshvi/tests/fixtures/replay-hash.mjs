import { restoreAt } from '../../src/replay/replay-engine.ts';
import { makeReplayArchive } from './replay-archive.ts';

process.stdout.write(restoreAt({ archive: makeReplayArchive(), cursor: 3 }).stateHash ?? 'INCOMPATIBLE');
