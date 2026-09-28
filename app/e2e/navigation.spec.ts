import { test, expect } from '@playwright/test';

const destinations = [
  { name: 'Schedule', path: '/schedules', heading: 'Power on' },
  { name: 'Sleep', path: '/sleep', heading: 'Sleep' },
  { name: 'Settings', path: '/settings', heading: 'Settings' },
];

for (const destination of destinations) {
  test(`navigates to ${destination.name}`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Primary mobile' }).getByRole('link', { name: destination.name }).click();
    await expect(page).toHaveURL(new RegExp(`${destination.path}$`));
    await expect(page.getByText(destination.heading, { exact: true }).first()).toBeVisible();
  });
}

test('four named destinations fit 320px and selection follows Back and nested pages', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/settings/versions');
  const nav = page.getByRole('navigation', { name: 'Primary mobile' });
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  const bounds = await Promise.all((await nav.getByRole('link').all()).map(async link => {
    const box = await link.boundingBox();
    return { left: box!.x, right: box!.x + box!.width, width: box!.width, name: await link.textContent() };
  }));
  expect(bounds.map(bound => bound.name)).toEqual(['Bed', 'Schedule', 'Sleep', 'Settings']);
  expect(bounds.every(bound => bound.left >= 0 && bound.right <= 320 && bound.width >= 44)).toBe(true);
  await nav.getByRole('link', { name: 'Sleep' }).click();
  await expect(nav.getByRole('link', { name: 'Sleep' })).toHaveAttribute('aria-current', 'page');
  await page.goBack();
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
});

test('legacy side URLs select their named side and data opens Sleep', async ({ page }) => {
  await page.goto('/right');
  await expect(page.getByRole('button', { name: /^Right/ })).toHaveAttribute('aria-pressed', 'true');
  await page.goto('/data');
  await expect(page).toHaveURL(/\/sleep$/);
  await expect(page.getByText('Sleep', { exact: true }).first()).toBeVisible();
});
