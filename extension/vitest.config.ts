import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,ts}', 'src/**/*.spec.{js,ts}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/lib/**/*.{js,ts}'],
      exclude: ['src/**/*.test.{js,ts}', 'src/**/*.spec.{js,ts}', 'src/**/vite-env.d.ts', 'src/**/global.d.ts'],
    },
    globals: true,
  },
  resolve: {
    alias: {
      $lib: '/src/lib',
    },
  },
});
