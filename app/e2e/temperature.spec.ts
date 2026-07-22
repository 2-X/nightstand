import { test, expect } from '@playwright/test';

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
  await page.locator('button:has(path[d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"])').first().click();

  // The label updates optimistically, before the mocked POST resolves.
  await expect(target).not.toHaveText(before ?? '');
});
