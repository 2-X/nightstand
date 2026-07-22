import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const baseURL = `http://localhost:${PORT}`;

// Drives the pre-built demo (app/dist) in headless Chromium. The demo's MSW
// service worker intercepts every request, so this runs fully offline. Build
// the demo first with `npm run build:demo` (the CI job does this in a prior
// step); the webServer below only serves it.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    // The bottom navigation (aria-label per item, what these specs target)
    // only renders below the MUI 'md' breakpoint (900px); the AppBar variant
    // takes over above it. Narrow the viewport so the app's real mobile
    // layout is what gets exercised.
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 480, height: 854 } } },
  ],
  webServer: {
    command: `VITE_ENV=demo npx vite preview --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
