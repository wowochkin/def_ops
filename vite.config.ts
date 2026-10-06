import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
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
      },
    },
  },
});
