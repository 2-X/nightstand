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

const headerStatus = (page: Page) => page.getByRole('heading', { level: 1, name: 'Bed' }).locator('xpath=..').getByRole('status');

test('two minutes without a status shows the last known values, greyed, with their time', async ({ page }) => {
  await open(page);
  const turnOff = page.getByRole('button', { name: 'Turn off' });
  await expect(turnOff).toBeVisible();
  const before = (await page.locator('[data-power-row]').boundingBox())!;

  await page.evaluate(() => localStorage.setItem('nightstand-demo-reads', 'fail'));
  await page.clock.fastForward('02:05');
  await expect(headerStatus(page)).toHaveText('Not responding');
  await expect(lead(page)).toHaveText('Last known');
  await expect(page.locator('[data-dial] h2')).toHaveText('+1');
  await expect(page.locator('[data-dial] p').nth(1)).toHaveText(/^at 9:41\sPM$/);
  await expect(page.locator('[data-dial] circle[data-stale]')).toHaveCount(1);
  await expect(page.locator('[data-caption-slot]'))
    .toHaveText(/^No response from the Pod since 9:41\sPM\.\s*Schedules and alarms may not run\.$/);
  await expect(page.getByRole('radio', { name: 'Alex. Not responding.' })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Warmer' })).toHaveAttribute('aria-disabled', 'true');
  const retry = page.getByRole('button', { name: 'Try again' });
  await expect(retry).toBeVisible();
  const after = (await page.locator('[data-power-row]').boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(after[key] - before[key])).toBeLessThanOrEqual(1);

  await page.evaluate(() => localStorage.removeItem('nightstand-demo-reads'));
  await retry.click();
  await expect(turnOff).toBeVisible();
  await expect(headerStatus(page)).toHaveCount(0);
});

test('a first load that fails says so in the same frame, with Try again', async ({ page }) => {
  await open(page, { 'nightstand-demo-reads': 'fail' });
  await expect(headerStatus(page)).toHaveText('Not responding');
  await expect(page.locator('[data-caption-slot]')).toContainText('Schedules and alarms may not run.');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.locator('[data-dial] h2')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Turn o/ })).toHaveCount(0);
});
