import { test, expect } from '@playwright/test';

// Each nav item carries aria-label={title} on the bottom navigation. Clicking
// it routes client-side; assert the URL and a content anchor unique to the
// destination page. If a nav name matches more than one element (the desktop
// AppBar also renders the title text), scope to the bottom-nav link, which is
// what these getByLabel calls target.
const destinations = [
  { name: 'Schedules', path: '/schedules', anchor: 'Power on' },
  { name: 'Status', path: '/status', anchor: 'System' },
  { name: 'Settings', path: '/settings', anchor: 'Side settings' },
  { name: 'Elevation', path: '/elevation', anchor: 'Flat' },
];

for (const d of destinations) {
  test(`navigates to ${d.name}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Temperature').first()).toBeVisible();

    await page.getByLabel(d.name).first().click();

    await expect(page).toHaveURL(new RegExp(`${d.path}$`));
    await expect(page.getByText(d.anchor).first()).toBeVisible();
  });
}
