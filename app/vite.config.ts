import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

const isDemoMode = process.env.VITE_ENV === 'demo';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: {
    fs: { allow: [
      searchForWorkspaceRoot(process.cwd()),
      fileURLToPath(new URL('../LICENSE.md', import.meta.url)),
      `${fileURLToPath(new URL('../LICENSE.md', import.meta.url))}?raw`,
    ] },
    host: '0.0.0.0', // This makes the server accessible to other devices on the network
    port: 5173, // Optional: specify a port if you want something other than the default
  },
  build: {
    sourcemap: !isDemoMode,
    outDir: isDemoMode ? './dist/' : '../server/public/',
    rollupOptions: {
      output: {
        entryFileNames: 'index.js', // Set the name for the JS entry file
        chunkFileNames: '[name]-[hash].js', // Names for dynamic imports
        assetFileNames: ({ name }) => {
          if (name?.endsWith('.css')) {
            return 'index.css';
          }
          return '[name]-[hash].[ext]';
        },
      },
    },
  },
});
