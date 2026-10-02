/// <reference lib="dom" />
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('turning a side off keeps the power button in place and shows last night under the dial', async ({ page }) => {
  await page.goto('/');
  const turnOff = page.getByRole('button', { name: 'Turn off' });
  await expect(turnOff).toBeVisible();
  // While on, last night stays in the card below the controls.
  await expect(page.getByRole('button', { name: /^Last night estimate \d+/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Increase temperature' })).toBeVisible();
  const onTop = (await turnOff.boundingBox())!.y;

  await turnOff.click();
  const turnOn = page.getByRole('button', { name: 'Turn on' });
  await expect(turnOn).toBeVisible();
  const viewSleep = page.getByRole('link', { name: 'View sleep' });
  await expect(viewSleep).toBeVisible();
  await expect(page.getByText(/^Last night estimate \d+$/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Last night estimate/ })).toHaveCount(0);

  const offTop = (await turnOn.boundingBox())!.y;
  expect(Math.abs(offTop - onTop)).toBeLessThanOrEqual(1);

  // Above the fold: clear of the bottom navigation without scrolling.
  const nav = (await page.getByRole('navigation', { name: 'Primary mobile' }).boundingBox())!;
  const link = (await viewSleep.boundingBox())!;
  expect(link.y + link.height).toBeLessThanOrEqual(nav.y);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
