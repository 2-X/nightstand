import { test, expect } from '@playwright/test';

test('boots the demo and renders the temperature page', async ({ page }) => {
  await page.goto('/');
  // enableMocking registers the MSW service worker, then the app mounts and
  // ControlTempPage renders its heading.
  await expect(page.getByText('Temperature').first()).toBeVisible();
  // The bottom navigation is present (aria-label per nav item).
  await expect(page.getByLabel('Settings').first()).toBeVisible();
});
