import { test, expect } from '@playwright/test';

// These specs cover the weekly schedule, so the demo starts with Rhythms off.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nightstand-demo-rhythms', 'off'));
});

// "Test alarm" posts to /api/alarm. The demo mocks that route, so pressing it
// must not surface a request error.
test('testing an alarm reports no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const alarmResponse = page.waitForResponse((r) => r.url().endsWith('/api/alarm'));

  await page.goto('/schedules');
  await page.getByRole('button', { name: /^Vibrate/ }).click();
  await page.getByRole('button', { name: "Test on Alex's side" }).click();

  expect((await alarmResponse).status()).toBe(200);
  expect(errors).toEqual([]);
});
