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

test('leaving Schedule silently discards unsaved edits', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-28T19:00:00Z') });
  let dialogs = 0;
  page.on('dialog', async dialog => {
    dialogs += 1;
    await dialog.dismiss();
  });
  await page.goto('/schedules');
  const enabled = page.getByRole('switch', { name: 'Enabled' }).first();
  await expect(enabled).toBeChecked();
  const powerOn = page.getByLabel('Power on', { exact: true });
  await expect(powerOn).toHaveValue('21:30');
  await powerOn.fill('21:37');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Primary mobile' });
  await nav.getByRole('link', { name: 'Bed', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await nav.getByRole('link', { name: 'Schedule', exact: true }).click();
  await expect(powerOn).toHaveValue('21:30');
  await expect(save).toBeHidden();
  expect(dialogs).toBe(0);
});

test('new rows stay focused and changing days requires discarding the draft', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-28T19:00:00Z') });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/schedules');
  await page.getByRole('button', { name: 'Add temperature change' }).click();
  const focused = page.locator('input[data-time]:focus');
  await expect(focused).toHaveCount(1);
  await expect(focused).toBeInViewport();
  const day = page.getByRole('tab').filter({ hasText: 'Tuesday' });
  page.once('dialog', dialog => dialog.dismiss());
  await day.click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await day.click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeHidden();
});

test('level options are unique and boundary errors focus the affected row', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/schedules');
  await page.getByRole('combobox', { name: /^Temperature/ }).first().click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(21);
  const labels = await options.allTextContents();
  expect(new Set(labels).size).toBe(21);
  await page.keyboard.press('Escape');
  const off = await page.getByLabel('Power off', { exact: true }).inputValue();
  await page.getByLabel('Adjustment time', { exact: true }).first().fill(off);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Check invalid time' }).click();
  const invalid = page.locator('input[aria-invalid="true"]:focus');
  await expect(invalid).toHaveCount(1);
  await expect(invalid).toBeInViewport();
});
