import { test, expect } from '@playwright/test';

test('opening the update dialog and cancelling closes it', async ({ page }) => {
  // The demo is up to date unless asked to offer a sample newer release.
  await page.addInitScript(() => localStorage.setItem('nightstand-demo-update', 'on'));
  await page.goto('/settings/versions');
  await expect(page.getByRole('heading', { name: 'Software', exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^Update to/ }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Nightstand restarts to finish, and schedules and alarms pause for up to five minutes.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog).toBeHidden();
});

test('an update while a side is on asks for a second confirmation and Escape cancels it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nightstand-demo-update', 'on'));
  await page.goto('/settings/versions?in-use');
  const opener = page.getByRole('button', { name: /^Update to/ }).first();
  await opener.click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Update now' }).click();

  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText(
    'A side is on. The bed keeps its current temperature, but schedules and alarms stop for up to five minutes.',
  );
  await expect(alert).toContainText(
    'An alarm is due in the next 15 minutes. If it falls while Nightstand restarts, it will not ring.',
  );
  await expect(dialog.getByRole('button', { name: 'Continue anyway' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});
