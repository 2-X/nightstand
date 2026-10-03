import { test, expect } from '@playwright/test';

test('boots the demo and renders the temperature page', async ({ page }) => {
  await page.goto('/');
  // enableMocking registers the MSW service worker, then the app mounts and
  // ControlTempPage renders its heading.
  await expect(page.getByRole('heading', { name: 'Bed', exact: true })).toBeVisible();
  // The bottom navigation is present (aria-label per nav item).
  await expect(page.getByRole('navigation', { name: 'Primary mobile' }).getByRole('link', { name: 'Settings' })).toBeVisible();
});

test('says it is a demo with sample data, and stays dismissed for the session', async ({ page }) => {
  await page.goto('/');
  const bar = page.locator('.MuiAlert-root', { hasText: 'Demo with sample data. Nothing here controls a real Pod.' });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://github.com/LTimothy/nightstand');
  await bar.getByRole('button', { name: 'Close' }).click();
  await expect(bar).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Primary mobile' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(bar).toHaveCount(0);
});

// The bar takes a few lines at the top of a phone, so the power button may start below the fold. It must stay
// reachable: scrolling brings every Bed control clear of the bottom bar.
test('with the demo bar showing, the Bed controls can be scrolled clear of the bottom bar on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.MuiAlert-root', { hasText: 'Demo with sample data.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible();
  const nav = (await page.getByRole('navigation', { name: 'Primary mobile' }).boundingBox())!;
  for (const name of ['Warmer', 'Cooler', 'Turn off']) {
    const control = page.getByRole('button', { name });
    await control.scrollIntoViewIfNeeded();
    const box = (await control.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
  }
  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible();
});
