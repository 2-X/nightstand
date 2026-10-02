import { test, expect } from '@playwright/test';

test('the demo shows missed alarms on request, announces them once and lets them be dismissed', async ({ page }) => {
  await page.goto('/?missed-alarms');
  const region = page.locator('[role="status"][aria-live="polite"]');
  await expect(region.getByText('The 6:30 AM alarm on the left side did not ring because the Pod did not answer in time.')).toBeVisible();
  await expect(region.getByText('The 7:00 AM alarm on the right side did not ring because that side was off.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Primary mobile' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText(/did not ring/)).toHaveCount(2);

  const dismiss = page.getByRole('button', { name: 'Dismiss' });
  expect((await dismiss.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await dismiss.click();
  await expect(page.getByText(/did not ring/)).toHaveCount(0);
  await expect(region).toBeFocused();
});

test('the demo shows no missed alarms by default', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Bed', exact: true })).toBeVisible();
  await expect(page.getByText(/did not ring/)).toHaveCount(0);
});
