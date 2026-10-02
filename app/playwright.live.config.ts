import { defineConfig, devices } from '@playwright/test';

// Checks the deployed demo, not a local build: no web server.
export default defineConfig({
  testDir: './e2e-live',
  retries: 2,
  use: { baseURL: process.env.LIVE_URL ?? 'https://ltimothy.github.io/nightstand/' },
  projects: [320, 390].map(width => ({
    name: `live-${width}`,
    use: {
      ...devices['Desktop Chrome'],
      viewport: { width, height: 800 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    },
  })),
});
