import { test, expect } from '@playwright/test';

const ADD = 'button:has(path[d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"])';
const REMOVE = 'button:has(path[d="M19 13H5v-2h14z"])';

test('adjusting the temperature updates the displayed target', async ({ page }) => {
  await page.goto('/');
  // The current-target level renders as an h2 (signed level in demo mode).
  const target = page.getByRole('heading', { level: 2 }).first();
  await expect(target).toBeVisible();
  const before = (await target.textContent())?.trim();

  // The + button is an unlabelled MUI icon button. MUI only emits
  // data-testid="AddIcon" outside production builds, and the demo is a
  // production build, so that attribute is absent here; match the icon's
  // SVG path instead (MUI's Add glyph).
  await page.locator(ADD).first().click();

  // The label updates optimistically, before the mocked POST resolves.
  await expect(target).not.toHaveText(before ?? '');
});

// Regression: rapid taps must not run the value past the level bounds. The
// disable guards read the server value, which lags the optimistic display, so
// without a clamp in the handler a fast burst would show (and POST) a level
// beyond the +10 / -10 range.
test('rapid + taps clamp the level at the maximum', async ({ page }) => {
  await page.goto('/');
  const target = page.getByRole('heading', { level: 2 }).first();
  await expect(target).toBeVisible();

  const plus = page.locator(ADD).first();
  for (let i = 0; i < 20; i++) await plus.click();

  await expect(target).toHaveText('+10');
});

test('rapid - taps clamp the level at the minimum', async ({ page }) => {
  await page.goto('/');
  const target = page.getByRole('heading', { level: 2 }).first();
  await expect(target).toBeVisible();

  const minus = page.locator(REMOVE).first();
  for (let i = 0; i < 20; i++) await minus.click();

  await expect(target).toHaveText('-10');
});
