import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const { version } = JSON.parse(
  readFileSync(new URL('../../server/src/serverInfo.json', import.meta.url), 'utf8'),
) as { version: string };

for (const path of ['', 'schedules', 'sleep', 'settings']) {
  test(`deployed demo /${path} loads cleanly`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('navigation', { name: 'Primary mobile' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('deployed demo reports the version just released', async ({ page }) => {
  await page.goto('settings/versions');
  await expect(page.getByText(`v${version}`).first()).toBeVisible();
});
