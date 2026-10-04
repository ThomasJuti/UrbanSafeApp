import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    env: loadEnv('', repoRoot, ''),
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
