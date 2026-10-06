import { env, log, onShutdown } from '@def-ops/service-kit';
import { createGateway, parseKeys } from './gateway';

const port = Number(env('PORT', '8080'));
const server = createGateway({
  port,
  services: {
    documents: env('DOCUMENTS_URL', 'http://localhost:8101'),
    render: env('RENDER_URL', 'http://localhost:8102'),
    registry: env('REGISTRY_URL', 'http://localhost:8103'),
    cartography: env('CARTOGRAPHY_URL', 'http://localhost:8104'),
  },
  routes: [
    ['/api/documents', 'documents', '/documents'],
    ['/api/events', 'documents', '/events'],
    ['/api/render', 'render', '/render'],
    ['/api/import', 'render', '/import'],
    ['/api/presets', 'render', '/presets'],
    ['/api/library', 'render', '/library'],
    ['/api/registry', 'registry', '/registry'],
    ['/api/cartography', 'cartography', '/cartography'],
  ],
  auth: env('AUTH', 'open') === 'keys' ? 'keys' : 'open',
  apiKeys: parseKeys(env('API_KEYS', '')),
  staticDir: process.env.STATIC_DIR,
  corsOrigin: env('CORS_ORIGIN', '*'),
  requestTimeoutMs: Number(env('REQUEST_TIMEOUT_MS', '3600000')),
});
server.listen(port, () => log('gateway', { level: 'info', msg: `listening on :${port}` }));
onShutdown(() => new Promise((r) => server.close(() => r())));
