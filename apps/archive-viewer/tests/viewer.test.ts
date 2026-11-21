import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { makeReplayArchive } from '../../../packages/kshvi/tests/fixtures/replay-archive';
import { replayStateHash } from '../../../packages/kshvi/src/replay/replay-engine';
import { recordedReplayAt } from '../src/replay';

it('автономный движок даёт тот же хеш и не использует внешние ресурсы', () => {
  const archive = makeReplayArchive();
  const frame = recordedReplayAt(archive, 3);
  expect(frame.hash).toBe(replayStateHash(frame.state));
  expect(frame.sequence).toBe(3);
  const sources = ['apps/archive-viewer/index.html', 'apps/archive-viewer/src/main.ts', 'apps/archive-viewer/src/replay.ts', 'apps/archive-viewer/src/style.css']
    .map(path => readFileSync(path, 'utf8')).join('\n');
  expect(sources).not.toMatch(/https?:\/\/|fetch\s*\(|XMLHttpRequest|EventSource|WebSocket|\.ttf|@font-face/i);
});
