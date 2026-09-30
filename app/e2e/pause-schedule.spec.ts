import { test, expect } from '@playwright/test';

// The narrowest supported phone width.
test.use({ viewport: { width: 320, height: 720 } });

test('pausing tonight shows the paused side and resuming brings the schedule back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Pause schedule' }).click();

  await expect(page.getByRole('heading', { name: "Pause Alex's schedule" })).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Tonight only/ })).toBeChecked();
  await page.getByRole('radio', { name: 'Until a set time' }).check();
  await expect(page.getByLabel('Resume at')).toBeVisible();
  const sheet = page.locator('.MuiDrawer-paper');
  expect(await sheet.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByLabel('Resume at')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeInViewport();

  await page.getByRole('radio', { name: /^Tonight only/ }).check();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  await expect(page.getByText(/^Schedule paused until /)).toBeVisible();
  await expect(page.getByRole('radio', { name: /^Alex\. Paused, / })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Pause schedule' })).toHaveCount(0);
  // The button that opened the sheet is gone, so focus moves to Resume.
  await expect(page.getByRole('button', { name: 'Resume schedule' })).toBeFocused();

  await page.getByRole('button', { name: 'Resume schedule' }).click();
  await expect(page.getByRole('button', { name: 'Pause schedule' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause schedule' })).toBeFocused();
  await expect(page.getByText(/^Schedule paused until /)).toHaveCount(0);
});
