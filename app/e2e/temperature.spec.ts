/// <reference lib="dom" />
import { test, expect } from '@playwright/test';

test('adjusting the temperature updates the displayed target', async ({ page }) => {
  await page.goto('/');
  // The current-target level renders as an h2 (signed level in demo mode).
  const target = page.getByRole('heading', { level: 2 }).first();
  await expect(target).toBeVisible();
  const before = (await target.textContent())?.trim();

  await page.getByRole('button', { name: 'Increase temperature' }).click();

  // The label updates optimistically, before the mocked POST resolves.
  await expect(target).not.toHaveText(before ?? '');
});

test('rapid + taps clamp the level at the maximum', async ({ page }) => {
  await page.goto('/');
  const target = page.getByRole('heading', { level: 2 }).first();
  await expect(target).toBeVisible();

  const plus = page.getByRole('button', { name: 'Increase temperature' });
  await plus.evaluate(button => {
    for (let i = 0; i < 20; i++) (button as HTMLElement).click();
  });

  await expect(target).toHaveText('+10');
  await expect(plus).toBeDisabled();
});

test('rapid - taps clamp the level at the minimum', async ({ page }) => {
  await page.goto('/');
  const target = page.getByRole('heading', { level: 2 }).first();
  await expect(target).toBeVisible();

  const minus = page.getByRole('button', { name: 'Decrease temperature' });
  await minus.evaluate(button => {
    for (let i = 0; i < 20; i++) (button as HTMLElement).click();
  });

  await expect(target).toHaveText('\u221210');
  await expect(minus).toBeDisabled();
});
