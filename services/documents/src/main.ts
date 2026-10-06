import { createService, env, onShutdown } from '@def-ops/service-kit';
import { FileStore, MemoryStore } from './store';
import { EventBus } from './events';
import { buildRouter } from './app';

const store = env('STORAGE', 'file') === 'memory' ? new MemoryStore() : new FileStore(env('DATA_DIR', './data/documents'));
const svc = createService({
  name: 'documents',
  version: '0.2.0',
  port: Number(env('PORT', '8101')),
  router: buildRouter(store, new EventBus()),
  ready: () => store.ready(),
});
await svc.listen();
onShutdown(svc.close);
