import { defineConfig } from 'vitest/config';

// GitHub Pages serves a project page from /<repository>/.
export default defineConfig({
  base: '/lnx_kernel_city/',
  // three.js alone is about 600 kB minified.
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
  },
});
