import { test, expect } from '@playwright/test';

test('topTitle reflects the target-vs-current derivation on load and after a nudge', async ({ page }) => {
  await page.goto('/');

  const topTitle = page.getByRole('heading', { level: 2 }).first().locator('xpath=preceding-sibling::p[1]');
  await expect(topTitle).toHaveText('Warming to');

  await page.getByRole('button', { name: 'Increase temperature' }).click();

  // After nudging the target above the current temperature, the label
  // switches to the actively-adjusting branch.
  await expect(topTitle).toHaveText('Set to');
});
