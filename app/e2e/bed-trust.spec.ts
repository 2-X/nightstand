/// <reference lib="dom" />
import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

// Monday 9:41 PM in the demo's time zone (Los Angeles).
const EVENING = new Date('2026-09-29T04:41:00Z');

async function open(page: Page, prefs: Record<string, string> = {}) {
  await page.addInitScript(entries => {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  }, prefs);
  await page.clock.install({ time: EVENING });
  await page.goto('/');
}
const lead = (page: Page) => page.locator('[data-dial] p').first();

test('a change the Pod has not confirmed says "Set to" and draws a hollow dot', async ({ page }) => {
  await open(page, { 'nightstand-demo-writes': 'hang' });
  await expect(lead(page)).toHaveText('Warming to');
  await expect(page.locator('[data-dial] circle[data-pending]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Warmer' }).click();
  await expect(lead(page)).toHaveText('Set to');
  await expect(page.locator('[data-dial] h2')).toHaveText('+2');
  await expect(page.locator('[data-dial] circle[data-pending]')).toHaveCount(1);
});

test('the dot fills once the Pod confirms the change', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Warmer' }).click();
  await expect(page.locator('[data-dial] circle[data-pending]')).toHaveCount(1);
  await expect(lead(page)).toHaveText('Warming to');
  await expect(page.locator('[data-dial] circle[data-pending]')).toHaveCount(0);
  await expect(page.locator('[data-dial] circle[data-target]')).toHaveCount(1);
});
