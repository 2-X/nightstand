import { test, expect } from '@playwright/test';

test('cancelling the revert-to-stock dialog closes it without reverting', async ({ page }) => {
  await page.goto('/settings/versions');

  await page.getByText('Revert to stock upstream free-sleep').click();

  // The page also has an Update dialog that stays mounted (keepMounted) and
  // hidden when closed, so scope past its own [role="dialog"] node.
  const dialog = page.getByRole('dialog').filter({ hasText: 'Revert to stock upstream?' });
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog).toBeHidden();
});
