import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, normalize } from 'node:path';

const ROOT = resolve(__dirname, '../..');

/** Разработка в браузере: файлы репозитория (сценарий, ход прогона, театр) по /repo/… — только чтение, только в dev. */
function repoFiles(): Plugin {
  return {
    name: 'repo-files',
    configureServer(server) {
      server.middlewares.use('/repo/', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? '').split('?')[0])).replace(/^[/\\]+/, '');
        const p = resolve(ROOT, rel);
        if (!p.startsWith(ROOT) || rel.includes('..') || !existsSync(p)) return next();
        res.setHeader('Content-Type', p.endsWith('.json') ? 'application/json' : 'text/plain');
        res.end(readFileSync(p));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), repoFiles()],
  // Tauri ждёт фиксированный порт
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // локальная языковая модель (LM Studio): /llm/v1/… → http://localhost:1234/v1/… — в браузере без CORS
      '/llm': { target: new URL(process.env.DEFOPS_LLM_URL || 'http://localhost:1234/v1').origin, changeOrigin: true, rewrite: (p) => p.replace(/^\/llm/, '') },
    },
  },
  clearScreen: false,
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 3000, target: 'es2022' },
});
