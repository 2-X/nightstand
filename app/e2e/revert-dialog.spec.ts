import { test, expect } from '@playwright/test';

test('cancelling the revert-to-stock dialog closes it without reverting', async ({ page }) => {
  await page.goto('/settings/versions');

  await page.getByRole('button', { name: 'Recovery', exact: true }).click();
  await page.getByText('Switch to upstream free-sleep').click();

  // Scope the assertion to this recovery action's confirmation.
  const dialog = page.getByRole('dialog').filter({ hasText: 'Switch to upstream free-sleep?' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog).toBeHidden();
});

test('switching while a side is on asks for a second confirmation', async ({ page }) => {
  await page.goto('/settings/versions?in-use');

  await page.getByRole('button', { name: 'Recovery', exact: true }).click();
  await page.getByText('Switch to upstream free-sleep').click();

  const dialog = page.getByRole('dialog').filter({ hasText: 'Switch to upstream free-sleep?' });
  await dialog.getByRole('button', { name: 'Switch to upstream free-sleep' }).click();

  await expect(dialog.getByRole('alert').first()).toContainText('A side is on.');
  await expect(dialog.getByRole('button', { name: 'Continue anyway' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});
