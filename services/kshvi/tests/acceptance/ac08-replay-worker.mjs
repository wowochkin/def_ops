import { parentPort, workerData } from 'node:worker_threads';

const { register } = await import('tsx/esm/api');
const unregister = register();
try {
  const { restoreAt } = await import('../../../../packages/kshvi/src/replay/replay-engine.ts');
  const frame = restoreAt({ archive: workerData.archive, cursor: workerData.cursor, playbackSpeed: workerData.playbackSpeed });
  const events = frame.events.map(event => ({ type: event.type, payload: event.payload }));
  parentPort.postMessage({
    stateHash: frame.stateHash,
    compatibility: frame.compatibility,
    playbackSpeed: frame.clock.playbackSpeed,
    selectedOutcomeIds: events.map(event => event.payload.calculation?.intermediateResults?.selectedOutcomeId ?? event.payload.selectedOutcomeId).filter(Boolean),
  });
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
} finally {
  unregister();
  parentPort.close();
}
