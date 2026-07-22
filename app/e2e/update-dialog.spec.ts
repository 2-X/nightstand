import { test, expect } from '@playwright/test';

test('opening the update dialog and cancelling closes it', async ({ page }) => {
  await page.goto('/settings/versions');
  await expect(page.getByText('Software & updates')).toBeVisible();

  await page.getByRole('button', { name: 'Update' }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog).toBeHidden();
});
