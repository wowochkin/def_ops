import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

/** Отпечаток модели — хеш выжимки кода и нормативов модели (меняется с ядром и моделью; src/sim/model-stamp.ts). */
const modelStamp = (() => {
  try { return createHash('sha256').update(readFileSync(resolve(__dirname, '../../packages/knowledge/data/model-index.json'))).digest('hex').slice(0, 12); }
  catch { return 'dev'; }
})();

/**
 * Предзапись голоса выставочного стенда в браузере разработки: /expo-voice/manifest.json и /expo-voice/clips/<хеш>.ogg —
 * из папки данных приложения (в приложении их отдаёт команда ядра). Папка — DEFOPS_DATA_DIR или папка данных Tauri.
 */
function expoVoice(): Plugin {
  const dir = join(process.env.DEFOPS_DATA_DIR || join(homedir(), 'Library/Application Support/ru.defops.desktop'), 'expo/voice');
  return {
    name: 'expo-voice',
    configureServer(server) {
      server.middlewares.use('/expo-voice', (req, res, next) => {
        const p = (req.url ?? '').split('?')[0];
        const file = p === '/manifest.json' ? 'manifest.json' : /^\/clips\/[0-9a-f]{8,64}\.ogg$/.test(p) ? p.slice(1) : null;
        if (!file) return next();
        try {
          const body = readFileSync(join(dir, file));
          res.setHeader('content-type', file.endsWith('.ogg') ? 'audio/ogg' : 'application/json');
          res.end(body);
        } catch {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}

/** Живой локальный сервер модели: Bionic часто на 1235, LM Studio — на 1234. */
async function llmOrigin(): Promise<string> {
  const env = process.env.DEFOPS_LLM_URL;
  if (env) return new URL(env).origin;
  for (const port of [1235, 1234]) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(800) });
      if (r.ok) return `http://127.0.0.1:${port}`;
    } catch { /* следующий порт */ }
  }
  return 'http://127.0.0.1:1234';
}

export default defineConfig(async () => {
  const llm = await llmOrigin();
  return {
  plugins: [react(), expoVoice()],
  define: { __MODEL_STAMP__: JSON.stringify(modelStamp) },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // API платформы — через шлюз (npm run dev:services)
      '/api': { target: process.env.GATEWAY_URL || 'http://localhost:8080', changeOrigin: true },
      // /llm/v1/… → живой локальный сервер модели — браузеру не нужен CORS
      '/llm': { target: llm, changeOrigin: true, rewrite: (p) => p.replace(/^\/llm/, '') },
    },
  },
  // MapLibre 6 грузит воркер по относительному пути — пребандлинг Vite его ломает
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        gallery: resolve(__dirname, 'gallery.html'),
        compare: resolve(__dirname, 'compare.html'),
        library: resolve(__dirname, 'library.html'),
      },
    },
  },
  };
});
