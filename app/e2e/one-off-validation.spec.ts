import { test, expect } from '@playwright/test';

test('one-off alarm Save is disabled until a future fire-at time is set', async ({ page }) => {
  await page.goto('/schedules');

  // Scope to the One-off alarm GlassCard: the smallest container that has
  // both the section title and its Save button. Its Enabled switch has no
  // accessible name (unlike the page's other "Enabled" switches), so it must
  // be found by scope rather than by name. hasText is a case-SENSITIVE regex
  // here deliberately: a case-insensitive match on "One-off alarm" would also
  // match the "Save one-off alarm" button's own label.
  const oneOffCard = page.locator('div')
    .filter({ hasText: /One-off alarm/ })
    .filter({ has: page.getByRole('button', { name: 'Save one-off alarm' }) })
    .last();

  const enabledSwitch = oneOffCard.getByRole('switch');
  await expect(enabledSwitch).toBeVisible();
  await expect(enabledSwitch).not.toBeChecked();

  const save = page.getByRole('button', { name: 'Save one-off alarm' });
  await expect(save).toBeVisible();

  await enabledSwitch.click();
  await expect(enabledSwitch).toBeChecked();

  // Enabling with no fire-at set yet must disable Save.
  await expect(save).toBeDisabled();

  await oneOffCard.locator('input[type="datetime-local"]').fill('2027-01-01T08:00');

  // A non-empty future fire-at makes Save enabled.
  await expect(save).toBeEnabled();
});
