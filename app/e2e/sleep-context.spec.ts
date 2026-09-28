import { test, expect } from '@playwright/test';

test('Monday opens the latest recorded night and expanded charts fill their panel', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-28T19:00:00Z') });
  await page.goto('/sleep');
  await expect(page.getByText(/Woke Sun, Sep 27/)).toBeVisible();
  const hrv = page.getByRole('button', { name: /^HRV/ });
  await expect(hrv).toContainText(/\d+ ms/);
  const value = (await hrv.textContent())!.match(/(\d+) ms/)![1];
  await hrv.click();
  const region = page.getByRole('region');
  await expect(region).toContainText(`${value} ms`);
  const chart = region.getByRole('img');
  await expect(chart).toBeVisible();
  await expect.poll(async () => (await chart.boundingBox())?.width ?? 0).toBeGreaterThan(250);
  await page.getByRole('button', { name: /^Heart rate/ }).click();
  await expect(page.locator('[id="detail-heart_rate"]')).toHaveCount(1);
});
