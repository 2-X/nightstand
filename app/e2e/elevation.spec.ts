import { test, expect } from '@playwright/test';

test('Relax sends a preset and keeps Stop available until movement finishes', async ({ page }) => {
  await page.goto('/elevation');
  const head = page.getByText('Head angle', { exact: true }).locator('..');
  const feet = page.getByText('Feet angle', { exact: true }).locator('..');
  await expect(head).toContainText('0°');
  await expect(feet).toContainText('0°');
  await page.getByRole('button', { name: /Relax Head/ }).click();
  await expect(page.getByRole('button', { name: 'Stop Movement' })).toBeVisible();
  await expect(head).toContainText('30°', { timeout: 15_000 });
  await expect(feet).toContainText('15°', { timeout: 15_000 });
});
