import { createService, env, onShutdown } from '@def-ops/service-kit';
import { buildRouter } from './app';

const svc = createService({
  name: 'render',
  version: '0.2.0',
  port: Number(env('PORT', '8102')),
  router: buildRouter(env('DOCUMENTS_URL', 'http://localhost:8101')),
});
await svc.listen();
onShutdown(svc.close);
