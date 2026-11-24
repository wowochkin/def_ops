import { parentPort, workerData } from 'node:worker_threads';

const controller = new AbortController();
parentPort.on('message', message => {
  if (message?.type === 'cancel') controller.abort(new Error('Задание отменено'));
});
let effects;
if (workerData.db?.url) {
  const { applyIdempotentEffect } = await import('./pg-effect-port.mjs');
  effects = { apply: (key, apply) => applyIdempotentEffect(workerData.db, key, apply) };
}

try {
  let task;
  if (workerData.runSource) {
    task = (0, eval)(`(${workerData.runSource})`);
  } else {
    const module = await import(workerData.moduleUrl);
    task = module[workerData.exportName];
  }
  if (typeof task !== 'function') throw new Error('Исполняемая функция задания не найдена');
  const result = await task({
    payload: workerData.payload,
    attempt: workerData.attempt,
    signal: controller.signal,
    effects,
    reportProgress: progress => parentPort.postMessage({ type: 'progress', progress }),
  });
  parentPort.postMessage({ type: 'result', result });
} catch (error) {
  parentPort.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
} finally {
  parentPort.close();
}
