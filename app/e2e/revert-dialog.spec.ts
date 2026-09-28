import { test, expect } from '@playwright/test';

test('cancelling the revert-to-stock dialog closes it without reverting', async ({ page }) => {
  await page.goto('/settings/versions');

  await page.getByRole('button', { name: 'Recovery', exact: true }).click();
  await page.getByText('Restore upstream free-sleep').click();

  // The page also has an Update dialog that stays mounted (keepMounted) and
  // hidden when closed, so scope past its own [role="dialog"] node.
  const dialog = page.getByRole('dialog').filter({ hasText: 'Restore upstream free-sleep?' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog).toBeHidden();
});
