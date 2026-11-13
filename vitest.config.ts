import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: [
      // rollup injects the real, pre-bundled MapLibre worker source here (see
      // `maplibreWorkerInlinePlugin` in rollup.config.js); the tests only need a string.
      {
        find: 'virtual:maplibre-worker-source',
        replacement: fileURLToPath(new URL('./frontend/test/maplibreWorkerSourceMock.ts', import.meta.url)),
      },
      // Style imports become Lit styles in the rollup build. Vitest would hand them over as empty
      // strings, which jsdom 31 refuses in `adoptedStyleSheets`, so they resolve to a CSSResult.
      {
        find: /^.*\.s?css$/,
        replacement: fileURLToPath(new URL('./frontend/test/styleMock.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './frontend/test/setup.ts',
    // The end-to-end specs are Playwright's, not vitest's - without this the
    // default glob picks them up and dies on the import.
    exclude: ['**/node_modules/**', '**/dist/**', 'test/e2e/**'],
  },
});
