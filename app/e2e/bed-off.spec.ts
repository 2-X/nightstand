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
  const viewSleep = page.getByRole('link', { name: 'View last night\'s sleep' });
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

for (const width of [390, 320]) {
  test(`the dial caption stays put, clear of the ring ends, when the side turns off at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 740 });
    await page.goto('/');
    const caption = page.locator('svg[viewBox="0 0 280 280"] ~ div span.MuiTypography-caption').first();
    await expect(caption).toBeVisible();
    const onBox = (await caption.boundingBox())!;

    await page.getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible();
    await expect(caption).toContainText(/^(Starts warming|Turns on)/);
    const offBox = (await caption.boundingBox())!;
    expect(Math.abs(offBox.y - onBox.y)).toBeLessThanOrEqual(1);

    // The ring is open at the bottom; the caption must fit between its arc ends.
    const dial = (await page.locator('svg[viewBox="0 0 280 280"]').boundingBox())!;
    const gap = dial.width * (211 / 280);
    for (const box of [onBox, offBox]) {
      expect(box.width).toBeLessThanOrEqual(gap * 0.9);
      expect(box.x).toBeGreaterThanOrEqual(dial.x + (dial.width - gap) / 2);
    }
  });
}

const sizes = [[320, 740], [390, 844], [768, 1024], [1280, 800]] as const;
for (const [width, height] of sizes) {
  test(`the power button never moves while toggling at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    // The tabs appear a moment after the page first paints and move everything below them.
    await expect(page.getByRole('link', { name: 'Elevation' })).toBeVisible();
    const power = page.getByRole('button', { name: /^Turn (on|off)$/ });
    await expect(power).toHaveText('Turn off');
    const rest = (await power.boundingBox())!.y;

    for (const next of ['Turn on', 'Turn off']) {
      await power.click();
      const tops: number[] = [];
      for (let i = 0; i < 25; i++) {
        await page.waitForTimeout(80);
        tops.push((await power.boundingBox())!.y);
      }
      await expect(power).toHaveText(next);
      for (const top of tops) expect(Math.abs(top - rest)).toBeLessThanOrEqual(1);
    }
  });
}
