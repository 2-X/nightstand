import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the @api/*, @lib/*, etc aliases from tsconfig.app.json, the same
  // way vite.config.ts does for the app build. Without this, mocks/handlers.ts
  // (imported by src/test/setup.ts) fails to resolve its @api/* imports.
  plugins: [tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: false,
    css: false,
    setupFiles: ['./src/test/setup.ts'],
    // The app skips its WebSocket when VITE_ENV is 'demo' (see
    // src/api/eventStream.ts), so the harness runs on the React Query polling
    // path the mocks feed, with no socket to stub.
    env: { VITE_ENV: 'demo' },
  },
});
