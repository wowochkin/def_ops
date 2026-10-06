import { env, log, onShutdown } from '@def-ops/service-kit';
import { createGateway, parseKeys } from './gateway';

const port = Number(env('PORT', '8080'));
const server = createGateway({
  port,
  services: {
    documents: env('DOCUMENTS_URL', 'http://localhost:8101'),
    render: env('RENDER_URL', 'http://localhost:8102'),
  },
  routes: [
    ['/api/documents', 'documents', '/documents'],
    ['/api/events', 'documents', '/events'],
    ['/api/render', 'render', '/render'],
    ['/api/import', 'render', '/import'],
    ['/api/presets', 'render', '/presets'],
    ['/api/library', 'render', '/library'],
  ],
  auth: env('AUTH', 'open') === 'keys' ? 'keys' : 'open',
  apiKeys: parseKeys(env('API_KEYS', '')),
  staticDir: process.env.STATIC_DIR,
  corsOrigin: env('CORS_ORIGIN', '*'),
});
server.listen(port, () => log('gateway', { level: 'info', msg: `listening on :${port}` }));
onShutdown(() => new Promise((r) => server.close(() => r())));
