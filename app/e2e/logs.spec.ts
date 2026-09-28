import { test, expect } from '@playwright/test';

// The Logs page tails a file over server-sent events. In the demo that stream
// comes from an MSW handler, so this also guards the handler itself.
test('streams the selected log file', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/data/logs');

  await expect(page.getByText('Starting Nightstand demo mode')).toBeVisible();
  expect(errors).toEqual([]);
});
