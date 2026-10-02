/// <reference lib="dom" />
import { test, expect, type Page } from '@playwright/test';

const SIZES = [[320, 740], [360, 640], [375, 560], [375, 667], [390, 844], [768, 1024], [1280, 800]] as const;

const layout = (page: Page) => page.evaluate(() => {
  const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top;
  const tiles = Array.from(document.querySelectorAll('[aria-label="Bed side"] label')).map(tile => tile.getBoundingClientRect().height);
  return {
    tiles, dial: top('[data-dial]'), caption: top('[data-caption-slot]'),
    controls: top('[data-controls-row]'), power: top('[data-power-row]'),
  };
});

for (const [width, height] of SIZES) {
  for (const seated of ['fresh', 'fresh-short']) {
    test(`the side tiles keep their size when "${seated}" presence arrives at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible();
      await expect(page.getByText(/^In bed/)).toHaveCount(0);
      const without = await layout(page);

      await page.evaluate(value => localStorage.setItem('nightstand-demo-presence', value), seated);
      await page.reload();
      await expect(page.getByText(/^In bed/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible();
      const withPresence = await layout(page);

      expect(withPresence.tiles).toEqual(without.tiles);
      expect(withPresence.dial).toBeCloseTo(without.dial, 0);
      expect(withPresence.caption).toBeCloseTo(without.caption, 0);
      expect(withPresence.controls).toBeCloseTo(without.controls, 0);
      expect(withPresence.power).toBeCloseTo(without.power, 0);
    });
  }
}

test('the compact side tiles on Schedule stay 48 px tall', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem('nightstand-demo-rhythms', 'off'));
  await page.goto('/schedules');
  await expect(page.getByRole('radio', { name: /^Alex/ })).toBeAttached();
  const heights = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-label="Bed side"] label'))
    .map(tile => tile.getBoundingClientRect().height));
  expect(heights).toEqual([48, 48]);
});
