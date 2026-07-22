import { test, expect } from '@playwright/test';

test('toggling a feature flips its switch', async ({ page }) => {
  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: 'One-off alarms' });
  await expect(toggle).toBeVisible();
  // Demo default is on; toggling turns it off (posts the mocked /api/settings).
  await expect(toggle).toBeChecked();

  await toggle.click();

  await expect(toggle).not.toBeChecked();
});
