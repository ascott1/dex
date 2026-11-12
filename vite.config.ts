import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';
import { dex } from './engine/vite-plugin.ts';

export default defineConfig({
  base: './',
  plugins: [svelte(), dex()],
  resolve: {
    alias: {
      $shared: fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['engine/**/*.test.ts'],
  },
});
