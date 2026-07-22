import { test, expect } from '@playwright/test';

test('saving a schedule edit hides the save button', async ({ page }) => {
  await page.goto('/schedules');
  // exact: true - "Power on temperature ..." also contains this text.
  await expect(page.getByText('Power on', { exact: true })).toBeVisible();

  // Toggle the power Enabled switch to mark the schedule changed. Wait for it
  // to reach its loaded checked state first: the schedule data arrives after
  // the switch first mounts, and clicking before that settles gets silently
  // overwritten by the data-load effect (which loses the edit on a cold run).
  const enabled = page.getByRole('switch', { name: 'Enabled' }).first();
  await expect(enabled).toBeChecked();
  await enabled.click();

  // exact: true - the one-off alarm section also has a "Save one-off alarm" button.
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeVisible();
  await save.click();

  // After the mocked save completes, the pending-edit Save button goes away.
  await expect(save).toBeHidden();
});
