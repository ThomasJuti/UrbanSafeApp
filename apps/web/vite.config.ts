import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');
  return {
    plugins: [react()],
    worker: { format: 'es' },
    server: {
      proxy: {
        // xfwd agrega X-Forwarded-For: sin eso el tope por IP del API vería a todos como localhost.
        '/api': { target: `http://localhost:${env['API_PORT'] ?? '3000'}`, xfwd: true },
        '/socket.io': { target: `http://localhost:${env['API_PORT'] ?? '3000'}`, ws: true, xfwd: true },
      },
    },
  };
});
